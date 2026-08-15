// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMortalsGame {
    function ownerOf(uint256 tokenId) external view returns (address);

    function exists(uint256 tokenId) external view returns (bool);

    function isDead(uint256 tokenId) external view returns (bool);

    function setDead(uint256 tokenId, bool dead) external;

    function gameMint(address to, uint256 qty) external;

    function nextTokenId() external view returns (uint256);
}

interface ISoulGame {
    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);

    function gameBurn(address from, uint256 amount) external;

    function gameTake(address from, uint256 amount) external;
}

interface IStakingGame {
    function stakerOf(uint256 tokenId) external view returns (address);

    function applyBlock(address wallet, uint256 duration) external;

    function blockedUntil(address wallet) external view returns (uint256);
}

/**
 * @title Game
 * @notice All MORTALS actions and THE POT. The pot holds ETH (10% of primary mints +
 *         50% of royalties) and SOUL (50% of every soulMint). It can only ever leave
 *         through stealPot(). There are no owner rescue functions.
 */
contract Game is ReentrancyGuard {
    // ─── Costs (SOUL, 18 decimals) ────────────────────────────────────────
    uint256 public constant PROTECT_COST = 100 ether;
    uint256 public constant KILL_COST = 500 ether;
    uint256 public constant REVIVE_COST = 6900 ether;
    uint256 public constant SHIELD_COST = 1000 ether;
    uint256 public constant BLOCK_COST = 100 ether;
    uint256 public constant STEAL_COST = 69000 ether;
    uint256 public constant SOUL_MINT_BASE = 100 ether;
    uint256 public constant SOUL_MINT_STEP = 1 ether;

    // ─── Durations ────────────────────────────────────────────────────────
    uint256 public constant PROTECT_DURATION = 24 hours;
    uint256 public constant SHIELD_DURATION = 24 hours;
    uint256 public constant BLOCK_DURATION = 1 hours;

    IMortalsGame public immutable nft;
    ISoulGame public immutable soul;
    IStakingGame public immutable staking;
    address public immutable payout;

    // ─── Counters ─────────────────────────────────────────────────────────
    uint256 public killedCount;
    uint256 public revivedCount;
    uint256 public soulMintCount;

    // fib state: _fibA is fib(soulMintCount), _fibB is fib(soulMintCount + 1)
    uint256 private _fibA; // starts at 0
    uint256 private _fibB = 1;

    // ─── Protection / shields ─────────────────────────────────────────────
    mapping(uint256 => uint256) public protectedUntil;
    mapping(address => uint256) public shieldUntil;

    // ─── Events ───────────────────────────────────────────────────────────
    event Protected(uint256 indexed tokenId, address indexed by, uint256 protectedUntil);
    event Killed(uint256 indexed tokenId, address indexed killer, address indexed owner);
    event Revived(uint256 indexed tokenId, address indexed by, address indexed owner);
    event SoulMinted(address indexed to, uint256 indexed tokenId, uint256 cost);
    event Shielded(address indexed wallet, uint256 shieldUntil);
    event StakeBlocked(address indexed wallet, address indexed by, uint256 blockedUntil);
    event PotStolen(address indexed thief, uint256 eth, uint256 soul);
    event PotDeposit(address indexed from, uint256 amount);
    event RoyaltyReceived(address indexed from, uint256 amount, uint256 forwarded);

    // ─── Errors ───────────────────────────────────────────────────────────
    error TokenDoesNotExist();
    error AlreadyDead();
    error NotDead();
    error CannotProtectDead();
    error TargetIsStaked();
    error TargetIsProtected();
    error OwnerIsShielded();
    error NoDeadSlots();
    error ZeroAddress();
    error TransferFailed();

    constructor(address nft_, address soul_, address staking_, address payout_) {
        if (nft_ == address(0) || soul_ == address(0) || staking_ == address(0) || payout_ == address(0)) {
            revert ZeroAddress();
        }
        nft = IMortalsGame(nft_);
        soul = ISoulGame(soul_);
        staking = IStakingGame(staking_);
        payout = payout_;
    }

    // ─── Views ────────────────────────────────────────────────────────────

    function potEth() public view returns (uint256) {
        return address(this).balance;
    }

    function potSoul() public view returns (uint256) {
        return soul.balanceOf(address(this));
    }

    /// @notice mint/revive slots opened by kills and not yet consumed
    function deadSlots() public view returns (uint256) {
        uint256 used = revivedCount + soulMintCount;
        if (used >= killedCount) return 0;
        return killedCount - used;
    }

    function nextSoulMintCost() public view returns (uint256) {
        return SOUL_MINT_BASE + _fibA * SOUL_MINT_STEP;
    }

    function isProtected(uint256 tokenId) external view returns (bool) {
        return protectedUntil[tokenId] > block.timestamp;
    }

    function isShielded(address wallet) external view returns (bool) {
        return shieldUntil[wallet] > block.timestamp;
    }

    // ─── Actions ──────────────────────────────────────────────────────────

    /// @notice Burn 100 SOUL to give a token 24h of kill immunity. Stacks. Follows the token.
    function protect(uint256 id) external nonReentrant {
        if (!nft.exists(id)) revert TokenDoesNotExist();
        if (nft.isDead(id)) revert CannotProtectDead();

        soul.gameBurn(msg.sender, PROTECT_COST);

        uint256 base = protectedUntil[id];
        if (block.timestamp > base) base = block.timestamp;
        protectedUntil[id] = base + PROTECT_DURATION;

        emit Protected(id, msg.sender, protectedUntil[id]);
    }

    /// @notice Burn 500 SOUL to kill a token. Opens a dead slot.
    function kill(uint256 id) external nonReentrant {
        if (!nft.exists(id)) revert TokenDoesNotExist();
        if (nft.isDead(id)) revert AlreadyDead();

        address owner = nft.ownerOf(id);
        if (owner == address(staking) || staking.stakerOf(id) != address(0)) revert TargetIsStaked();
        if (protectedUntil[id] > block.timestamp) revert TargetIsProtected();
        if (shieldUntil[owner] > block.timestamp) revert OwnerIsShielded();

        soul.gameBurn(msg.sender, KILL_COST);

        nft.setDead(id, true);
        unchecked {
            ++killedCount;
        }

        emit Killed(id, msg.sender, owner);
    }

    /// @notice Burn 6900 SOUL to bring a dead token back. Consumes a dead slot.
    function revive(uint256 id) external nonReentrant {
        if (!nft.exists(id)) revert TokenDoesNotExist();
        if (!nft.isDead(id)) revert NotDead();
        if (deadSlots() == 0) revert NoDeadSlots();

        soul.gameBurn(msg.sender, REVIVE_COST);

        unchecked {
            ++revivedCount;
        }
        nft.setDead(id, false);

        emit Revived(id, msg.sender, nft.ownerOf(id));
    }

    /// @notice Mint 1 new MORTAL against a dead slot. 50% of the cost goes to the pot, 50% burns.
    function soulMint() external nonReentrant returns (uint256 tokenId) {
        if (deadSlots() == 0) revert NoDeadSlots();

        uint256 cost = nextSoulMintCost();
        uint256 toPot = cost / 2;
        uint256 toBurn = cost - toPot;

        soul.gameTake(msg.sender, toPot);
        soul.gameBurn(msg.sender, toBurn);

        unchecked {
            ++soulMintCount;
            uint256 nextA = _fibB;
            _fibB = _fibA + _fibB;
            _fibA = nextA;
        }

        tokenId = nft.nextTokenId();
        nft.gameMint(msg.sender, 1);

        emit SoulMinted(msg.sender, tokenId, cost);
    }

    /// @notice Burn 1000 SOUL for 24h of kill immunity across every token you own. Stacks.
    function shieldWallet() external nonReentrant {
        soul.gameBurn(msg.sender, SHIELD_COST);

        uint256 base = shieldUntil[msg.sender];
        if (block.timestamp > base) base = block.timestamp;
        shieldUntil[msg.sender] = base + SHIELD_DURATION;

        emit Shielded(msg.sender, shieldUntil[msg.sender]);
    }

    /// @notice Burn 100 SOUL to freeze a wallet's staking emission for 1h. Cannot be defended against.
    function blockStake(address wallet) external nonReentrant {
        if (wallet == address(0)) revert ZeroAddress();

        soul.gameBurn(msg.sender, BLOCK_COST);
        staking.applyBlock(wallet, BLOCK_DURATION);

        emit StakeBlocked(wallet, msg.sender, staking.blockedUntil(wallet));
    }

    /// @notice Burn 69000 SOUL and take the entire pot (all ETH and all SOUL).
    function stealPot() external nonReentrant {
        soul.gameBurn(msg.sender, STEAL_COST);

        uint256 soulAmount = soul.balanceOf(address(this));
        uint256 ethAmount = address(this).balance;

        if (soulAmount > 0) {
            soul.transfer(msg.sender, soulAmount);
        }
        if (ethAmount > 0) {
            (bool ok, ) = payable(msg.sender).call{value: ethAmount}("");
            if (!ok) revert TransferFailed();
        }

        emit PotStolen(msg.sender, ethAmount, soulAmount);
    }

    // ─── ETH inflows ──────────────────────────────────────────────────────

    /// @notice 100% stays in the pot. Used by the primary-mint 10% path.
    function depositPot() external payable {
        emit PotDeposit(msg.sender, msg.value);
    }

    /// @notice Royalty inflow: 50% forwarded to the payout wallet, 50% stays in the pot.
    receive() external payable {
        uint256 half = msg.value / 2;
        uint256 forwarded;
        if (half > 0) {
            (bool ok, ) = payable(payout).call{value: half}("");
            if (ok) forwarded = half;
        }
        emit RoyaltyReceived(msg.sender, msg.value, forwarded);
    }
}
