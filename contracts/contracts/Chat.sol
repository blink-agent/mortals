// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IMortalsChat {
    function aliveBalanceOf(address owner) external view returns (uint256);
}

interface IStakingChat {
    function stakedCountOf(address wallet) external view returns (uint256);
}

/**
 * @title Chat
 * @notice On-chain holder chat. Event-only storage; the frontend reads logs over RPC.
 *         Ownership proof is the transaction signature itself: only a wallet holding an
 *         alive or staked MORTAL (or the operator) can post.
 */
contract Chat is Ownable {
    uint256 public constant MAX_MESSAGE_BYTES = 280;
    uint256 public constant MAX_USERNAME_BYTES = 24;

    IMortalsChat public immutable nft;
    IStakingChat public immutable staking;

    /// @notice announcements lane
    address public operator;

    mapping(address => string) public usernameOf;

    event Message(address indexed sender, string text, uint256 timestamp);
    event UsernameSet(address indexed wallet, string name);
    event OperatorSet(address operator);

    error EmptyMessage();
    error MessageTooLong();
    error NotAllowedToPost();
    error UsernameTooLong();
    error ZeroAddress();

    constructor(address nft_, address staking_, address operator_) Ownable(msg.sender) {
        if (nft_ == address(0) || staking_ == address(0) || operator_ == address(0)) revert ZeroAddress();
        nft = IMortalsChat(nft_);
        staking = IStakingChat(staking_);
        operator = operator_;
    }

    function canPost(address wallet) public view returns (bool) {
        return wallet == operator || nft.aliveBalanceOf(wallet) >= 1 || staking.stakedCountOf(wallet) >= 1;
    }

    function post(string calldata text) external {
        uint256 len = bytes(text).length;
        if (len == 0) revert EmptyMessage();
        if (len > MAX_MESSAGE_BYTES) revert MessageTooLong();
        if (!canPost(msg.sender)) revert NotAllowedToPost();
        emit Message(msg.sender, text, block.timestamp);
    }

    function setUsername(string calldata name) external {
        if (bytes(name).length > MAX_USERNAME_BYTES) revert UsernameTooLong();
        usernameOf[msg.sender] = name;
        emit UsernameSet(msg.sender, name);
    }

    function setOperator(address operator_) external onlyOwner {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorSet(operator_);
    }
}
