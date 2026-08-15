// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../Mortals.sol";

/// @dev Test-only. Lets tests jump the ETH-mint counter so the 8-tier ladder and the
///      9872 cap can be exercised without minting ten thousand tokens.
contract MortalsHarness is Mortals {
    constructor(
        address signer_,
        address payout_,
        string memory baseURI_,
        string memory contractURI_
    ) Mortals(signer_, payout_, baseURI_, contractURI_) {}

    function setEthMinted(uint256 v) external {
        ethMinted = v;
    }
}
