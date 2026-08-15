// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only stand-in for a LimitBreak transfer validator.
contract MockTransferValidator {
    bool public shouldRevert;
    uint256 public calls;
    address public lastCaller;
    address public lastFrom;
    address public lastTo;
    uint256 public lastTokenId;

    error TransferNotAllowed();

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function validateTransfer(address caller, address from, address to, uint256 tokenId) external {
        if (shouldRevert) revert TransferNotAllowed();
        calls += 1;
        lastCaller = caller;
        lastFrom = from;
        lastTo = to;
        lastTokenId = tokenId;
    }
}
