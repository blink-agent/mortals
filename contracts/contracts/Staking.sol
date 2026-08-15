// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMortalsStaking {
    function ownerOf(uint256 tokenId) external view returns (address);

    function isDead(uint256 tokenId) external view returns (bool);

    function transferFrom(address from, address to, uint256 tokenId) external;
}

interface ISoulMint {
    function mint(address to, uint256 amount) external;
}

/**
 * @title Staking
 * @notice Custodial staking. 100 SOUL per NFT per day, streamed per second.
 *         Per-wallet settlement; blocked windows forfeit (not delay) emission.
 */
contract Staking is Ownable, ReentrancyGuard {
    /// @notice 100 SOUL per NFT per day, per second (integer-truncated, as specified)
    uint256 public constant RATE = uint256(100 ether) / 86400;

    IMortalsStaking public immutable nft;
    ISoulMint public immutable soul;

    address public game;

    /// @notice wallet that staked a given token id (address(0) if not staked)
    mapping(uint256 => address) public stakerOf;

    mapping(address => uint256[]) private _staked;
    mapping(uint256 => uint256) private _stakedIndex;

    /// @notice settled-but-unclaimed SOUL
    mapping(address => uint256) public accrued;
    /// @notice timestamp of the last settlement for a wallet
    mapping(address => uint256) public lastSettle;
    /// @notice emission is forfeited until this timestamp
    mapping(address => uint256) public blockedUntil;

    event Staked(address indexed wallet, uint256 indexed tokenId);
    event Unstaked(address indexed wallet, uint256 indexed tokenId);
    event Claimed(address indexed wallet, uint256 amount);
    event Blocked(address indexed wallet, uint256 duration, uint256 blockedUntil);
    event GameSet(address game);

    error NotGame();
    error GameAlreadySet();
    error ZeroAddress();
    error EmptyArray();
    error CannotStakeDead();
    error NotStaker();

    modifier onlyGame() {
        if (msg.sender != game) revert NotGame();
        _;
    }

    constructor(address nft_, address soul_) Ownable(msg.sender) {
        if (nft_ == address(0) || soul_ == address(0)) revert ZeroAddress();
        nft = IMortalsStaking(nft_);
        soul = ISoulMint(soul_);
    }

    /// @dev One-time wiring, owner only.
    function setGame(address game_) external onlyOwner {
        if (game != address(0)) revert GameAlreadySet();
        if (game_ == address(0)) revert ZeroAddress();
        game = game_;
        emit GameSet(game_);
    }

    // ─── Settlement ───────────────────────────────────────────────────────

    function _accrualStart(address wallet) internal view returns (uint256) {
        uint256 nowTs = block.timestamp;
        uint256 bu = blockedUntil[wallet];
        uint256 capped = bu < nowTs ? bu : nowTs; // min(blockedUntil, now)
        uint256 ls = lastSettle[wallet];
        return capped > ls ? capped : ls; // max(lastSettle, min(blockedUntil, now))
    }

    function _settle(address wallet) internal {
        uint256 nowTs = block.timestamp;
        uint256 from = _accrualStart(wallet);
        if (nowTs > from) {
            uint256 count = _staked[wallet].length;
            if (count > 0) {
                accrued[wallet] += count * RATE * (nowTs - from);
            }
        }
        lastSettle[wallet] = nowTs;
    }

    // ─── Actions ──────────────────────────────────────────────────────────

    function stake(uint256[] calldata ids) external nonReentrant {
        if (ids.length == 0) revert EmptyArray();
        _settle(msg.sender);
        for (uint256 i = 0; i < ids.length; ) {
            uint256 id = ids[i];
            if (nft.isDead(id)) revert CannotStakeDead();
            nft.transferFrom(msg.sender, address(this), id);
            stakerOf[id] = msg.sender;
            _stakedIndex[id] = _staked[msg.sender].length;
            _staked[msg.sender].push(id);
            emit Staked(msg.sender, id);
            unchecked {
                ++i;
            }
        }
    }

    function unstake(uint256[] calldata ids) external nonReentrant {
        if (ids.length == 0) revert EmptyArray();
        _settle(msg.sender);
        _claim(msg.sender);
        for (uint256 i = 0; i < ids.length; ) {
            uint256 id = ids[i];
            if (stakerOf[id] != msg.sender) revert NotStaker();
            stakerOf[id] = address(0);
            _removeToken(msg.sender, id);
            nft.transferFrom(address(this), msg.sender, id);
            emit Unstaked(msg.sender, id);
            unchecked {
                ++i;
            }
        }
    }

    function claim() external nonReentrant {
        _settle(msg.sender);
        _claim(msg.sender);
    }

    function _claim(address wallet) internal {
        uint256 amount = accrued[wallet];
        if (amount == 0) return;
        accrued[wallet] = 0;
        soul.mint(wallet, amount);
        emit Claimed(wallet, amount);
    }

    /// @notice Game-only. Settles first, then stacks a blocked window.
    function applyBlock(address wallet, uint256 duration) external onlyGame {
        _settle(wallet);
        uint256 base = blockedUntil[wallet];
        if (block.timestamp > base) base = block.timestamp; // max(now, blockedUntil)
        blockedUntil[wallet] = base + duration;
        emit Blocked(wallet, duration, blockedUntil[wallet]);
    }

    // ─── Internal bookkeeping ─────────────────────────────────────────────

    function _removeToken(address wallet, uint256 id) internal {
        uint256[] storage arr = _staked[wallet];
        uint256 idx = _stakedIndex[id];
        uint256 last = arr.length - 1;
        if (idx != last) {
            uint256 movedId = arr[last];
            arr[idx] = movedId;
            _stakedIndex[movedId] = idx;
        }
        arr.pop();
        delete _stakedIndex[id];
    }

    // ─── Views ────────────────────────────────────────────────────────────

    function stakedCountOf(address wallet) external view returns (uint256) {
        return _staked[wallet].length;
    }

    function stakedTokensOf(address wallet) external view returns (uint256[] memory) {
        return _staked[wallet];
    }

    function pendingRewards(address wallet) external view returns (uint256) {
        uint256 nowTs = block.timestamp;
        uint256 from = _accrualStart(wallet);
        uint256 pending = accrued[wallet];
        if (nowTs > from) {
            pending += _staked[wallet].length * RATE * (nowTs - from);
        }
        return pending;
    }

    function isBlocked(address wallet) external view returns (bool) {
        return blockedUntil[wallet] > block.timestamp;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
