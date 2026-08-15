// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "erc721a/contracts/ERC721A.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ITransferValidator {
    function validateTransfer(address caller, address from, address to, uint256 tokenId) external;
}

interface IGameDeposit {
    function depositPot() external payable;
}

/**
 * @title MORTALS
 * @notice Agent-only ERC721A collection. Ids start at 1.
 *         ETH mints follow an 8-tier price ladder (1234 per tier) and are capped at 9872.
 *         The Game contract may mint extra tokens against "dead slots" and may flip tokens dead.
 *         Dead tokens are non-transferable until revived.
 */
contract Mortals is ERC721A, ERC2981, Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─── Supply / ladder ──────────────────────────────────────────────────
    uint256 public constant MAX_ETH_SUPPLY = 9872;
    uint256 public constant MAX_PER_TX = 32;
    uint256 public constant TIER_SIZE = 1234;
    uint256 public constant TIER_COUNT = 8;
    uint256 public constant BASE_PRICE = 0.00001 ether;

    /// @notice number of tokens minted through the ETH voucher path (drives the ladder)
    uint256 public ethMinted;
    /// @notice number of tokens minted through the Game (soulMint) path
    uint256 public gameMinted;

    // ─── Mint config ──────────────────────────────────────────────────────
    address public signer;
    address public payout;
    bool public mintActive;
    mapping(bytes32 => bool) public usedNonces;

    // ─── Wiring ───────────────────────────────────────────────────────────
    address public game;

    // ─── Life / death ─────────────────────────────────────────────────────
    mapping(uint256 => bool) public isDead;
    mapping(address => uint256) private _aliveBalance;

    // ─── Metadata ─────────────────────────────────────────────────────────
    string private _baseTokenURI;
    string private _contractMetadataURI;

    // ─── ICreatorToken (LimitBreak) transfer validator ─────────────────────
    address private _transferValidator;

    // ─── Events ───────────────────────────────────────────────────────────
    event TransferValidatorUpdated(address oldValidator, address newValidator);
    event Minted(address indexed minter, uint256 quantity, uint256 startTokenId, uint256 cost);
    event GameMinted(address indexed to, uint256 quantity, uint256 startTokenId);
    event DeadStateChanged(uint256 indexed tokenId, bool dead);
    event GameSet(address game);
    event SignerSet(address signer);
    event PayoutSet(address payout);
    event MintActiveSet(bool active);
    event BaseURISet(string baseURI);
    event ContractURISet(string contractURI);

    // ─── Errors ───────────────────────────────────────────────────────────
    error MintNotActive();
    error InvalidQuantity();
    error MaxSupplyReached();
    error NonceAlreadyUsed();
    error InvalidSignature();
    error InsufficientPayment();
    error TransferFailed();
    error NotGame();
    error GameAlreadySet();
    error GameNotSet();
    error ZeroAddress();
    error DeadTokensCannotMove();
    error TokenDoesNotExist();
    error DeadStateUnchanged();

    modifier onlyGame() {
        if (msg.sender != game) revert NotGame();
        _;
    }

    constructor(
        address signer_,
        address payout_,
        string memory baseURI_,
        string memory contractURI_
    ) ERC721A("MORTALS", "MORTAL") Ownable(msg.sender) {
        if (signer_ == address(0) || payout_ == address(0)) revert ZeroAddress();
        signer = signer_;
        payout = payout_;
        _baseTokenURI = baseURI_;
        _contractMetadataURI = contractURI_;
        // Royalty receiver is set to the Game contract at wiring time.
        _setDefaultRoyalty(payout_, 500);
    }

    function _startTokenId() internal pure override returns (uint256) {
        return 1;
    }

    // ─── Price ladder ─────────────────────────────────────────────────────

    /// @notice price of a single token at 0-based ETH-mint index `i`
    function priceAtIndex(uint256 i) public pure returns (uint256) {
        uint256 tier = i / TIER_SIZE;
        if (tier == 0) return 0;
        return BASE_PRICE << (tier - 1);
    }

    function _priceForRange(uint256 start, uint256 qty) internal pure returns (uint256 total) {
        uint256 i = start;
        uint256 end = start + qty;
        while (i < end) {
            uint256 tier = i / TIER_SIZE;
            uint256 tierEnd = (tier + 1) * TIER_SIZE;
            uint256 chunkEnd = tierEnd < end ? tierEnd : end;
            unchecked {
                total += (chunkEnd - i) * priceAtIndex(i);
            }
            i = chunkEnd;
        }
    }

    /// @notice exact total cost, in wei, of minting `qty` tokens right now
    function priceForQuantity(uint256 qty) public view returns (uint256) {
        if (ethMinted + qty > MAX_ETH_SUPPLY) revert MaxSupplyReached();
        return _priceForRange(ethMinted, qty);
    }

    /// @notice current 0-based tier index of the ladder
    function currentTier() external view returns (uint256) {
        uint256 t = ethMinted / TIER_SIZE;
        return t >= TIER_COUNT ? TIER_COUNT - 1 : t;
    }

    /// @notice remaining ETH-mintable supply
    function remainingEthSupply() external view returns (uint256) {
        return MAX_ETH_SUPPLY - ethMinted;
    }

    /// @notice next token id that will be assigned
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId();
    }

    function totalMinted() external view returns (uint256) {
        return _totalMinted();
    }

    // ─── Voucher digest ───────────────────────────────────────────────────

    function mintDigest(address minter, uint256 quantity, bytes32 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(minter, quantity, nonce, block.chainid, address(this)));
    }

    // ─── Mint ─────────────────────────────────────────────────────────────

    function mint(uint256 quantity, bytes32 nonce, bytes calldata signature) external payable nonReentrant {
        if (!mintActive) revert MintNotActive();
        if (quantity == 0 || quantity > MAX_PER_TX) revert InvalidQuantity();
        if (ethMinted + quantity > MAX_ETH_SUPPLY) revert MaxSupplyReached();
        if (usedNonces[nonce]) revert NonceAlreadyUsed();
        if (game == address(0)) revert GameNotSet();

        bytes32 digest = mintDigest(msg.sender, quantity, nonce).toEthSignedMessageHash();
        if (digest.recover(signature) != signer) revert InvalidSignature();
        usedNonces[nonce] = true;

        uint256 cost = _priceForRange(ethMinted, quantity);
        if (msg.value < cost) revert InsufficientPayment();

        uint256 startId = _nextTokenId();
        ethMinted += quantity;
        _mint(msg.sender, quantity);

        emit Minted(msg.sender, quantity, startId, cost);

        if (cost > 0) {
            uint256 potShare = cost / 10; // 10%
            uint256 payoutShare = cost - potShare; // 90%
            IGameDeposit(game).depositPot{value: potShare}();
            (bool okP, ) = payable(payout).call{value: payoutShare}("");
            if (!okP) revert TransferFailed();
        }

        uint256 excess = msg.value - cost;
        if (excess > 0) {
            (bool okR, ) = payable(msg.sender).call{value: excess}("");
            if (!okR) revert TransferFailed();
        }
    }

    /// @notice Game-only mint against dead slots. Ignores the ETH ladder and the 9872 cap.
    function gameMint(address to, uint256 qty) external onlyGame {
        if (qty == 0) revert InvalidQuantity();
        uint256 startId = _nextTokenId();
        gameMinted += qty;
        _mint(to, qty);
        emit GameMinted(to, qty, startId);
    }

    // ─── Dead state ───────────────────────────────────────────────────────

    function setDead(uint256 id, bool dead) external onlyGame {
        if (!_exists(id)) revert TokenDoesNotExist();
        if (isDead[id] == dead) revert DeadStateUnchanged();
        isDead[id] = dead;
        address holder = ownerOf(id);
        if (dead) {
            unchecked {
                _aliveBalance[holder] -= 1;
            }
        } else {
            unchecked {
                _aliveBalance[holder] += 1;
            }
        }
        emit DeadStateChanged(id, dead);
    }

    /// @notice O(1) count of non-dead tokens held by `owner`
    function aliveBalanceOf(address owner) external view returns (uint256) {
        return _aliveBalance[owner];
    }

    function exists(uint256 id) external view returns (bool) {
        return _exists(id);
    }

    // ─── Owner config ─────────────────────────────────────────────────────

    /// @dev One-time wiring. Once set the Game can never be swapped out.
    function setGame(address game_) external onlyOwner {
        if (game != address(0)) revert GameAlreadySet();
        if (game_ == address(0)) revert ZeroAddress();
        game = game_;
        emit GameSet(game_);
    }

    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        emit SignerSet(signer_);
    }

    function setPayout(address payout_) external onlyOwner {
        if (payout_ == address(0)) revert ZeroAddress();
        payout = payout_;
        emit PayoutSet(payout_);
    }

    function setMintActive(bool active) external onlyOwner {
        mintActive = active;
        emit MintActiveSet(active);
    }

    function setBaseURI(string calldata uri) external onlyOwner {
        _baseTokenURI = uri;
        emit BaseURISet(uri);
    }

    function setContractURI(string calldata uri) external onlyOwner {
        _contractMetadataURI = uri;
        emit ContractURISet(uri);
    }

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function deleteDefaultRoyalty() external onlyOwner {
        _deleteDefaultRoyalty();
    }

    // ─── Metadata ─────────────────────────────────────────────────────────

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function contractURI() external view returns (string memory) {
        return _contractMetadataURI;
    }

    // ─── ICreatorToken ────────────────────────────────────────────────────

    function getTransferValidator() external view returns (address) {
        return _transferValidator;
    }

    function setTransferValidator(address validator) external onlyOwner {
        address old = _transferValidator;
        _transferValidator = validator;
        emit TransferValidatorUpdated(old, validator);
    }

    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction) {
        // 0xcaee23ea = validateTransfer(address,address,address,uint256)
        return (0xcaee23ea, false);
    }

    // ─── Hooks ────────────────────────────────────────────────────────────

    function _beforeTokenTransfers(
        address from,
        address to,
        uint256 startTokenId,
        uint256 quantity
    ) internal virtual override {
        super._beforeTokenTransfers(from, to, startTokenId, quantity);
        if (from == address(0)) return; // mints are always allowed and never validated

        address v = _transferValidator;
        for (uint256 i = 0; i < quantity; ) {
            uint256 id = startTokenId + i;
            if (isDead[id]) revert DeadTokensCannotMove();
            if (v != address(0)) {
                ITransferValidator(v).validateTransfer(msg.sender, from, to, id);
            }
            unchecked {
                ++i;
            }
        }
    }

    function _afterTokenTransfers(
        address from,
        address to,
        uint256 startTokenId,
        uint256 quantity
    ) internal virtual override {
        super._afterTokenTransfers(from, to, startTokenId, quantity);
        // Only alive tokens ever reach here with from != 0 (dead ones revert above),
        // and freshly minted tokens are always alive.
        if (from != address(0)) {
            unchecked {
                _aliveBalance[from] -= quantity;
            }
        }
        if (to != address(0)) {
            unchecked {
                _aliveBalance[to] += quantity;
            }
        }
    }

    // ─── Interface ────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) public view override(ERC721A, ERC2981) returns (bool) {
        return
            interfaceId == 0xad0d7f6c || // ICreatorToken
            interfaceId == 0xe8a3d485 || // contractURI()
            ERC721A.supportsInterface(interfaceId) ||
            ERC2981.supportsInterface(interfaceId);
    }
}
