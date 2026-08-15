// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SOUL
 * @notice ERC20 emitted exclusively by the Staking contract.
 *         The Game contract may burn or take SOUL without an allowance so that agents
 *         never have to send an approve transaction before acting.
 */
contract Soul is ERC20, Ownable {
    /// @notice the only address allowed to mint (the Staking contract)
    address public minter;
    /// @notice the only address allowed to gameBurn / gameTake (the Game contract)
    address public game;

    event MinterSet(address minter);
    event GameSet(address game);
    event GameBurn(address indexed from, uint256 amount);
    event GameTake(address indexed from, uint256 amount);

    error NotMinter();
    error NotGame();
    error MinterAlreadySet();
    error GameAlreadySet();
    error ZeroAddress();

    constructor() ERC20("SOUL", "SOUL") Ownable(msg.sender) {}

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    modifier onlyGame() {
        if (msg.sender != game) revert NotGame();
        _;
    }

    /// @dev One-time wiring, owner only.
    function setMinter(address minter_) external onlyOwner {
        if (minter != address(0)) revert MinterAlreadySet();
        if (minter_ == address(0)) revert ZeroAddress();
        minter = minter_;
        emit MinterSet(minter_);
    }

    /// @dev One-time wiring, owner only.
    function setGame(address game_) external onlyOwner {
        if (game != address(0)) revert GameAlreadySet();
        if (game_ == address(0)) revert ZeroAddress();
        game = game_;
        emit GameSet(game_);
    }

    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    /// @notice burn SOUL held by `from` without an allowance. Game only.
    function gameBurn(address from, uint256 amount) external onlyGame {
        _burn(from, amount);
        emit GameBurn(from, amount);
    }

    /// @notice move SOUL from `from` into the Game (pot) without an allowance. Game only.
    function gameTake(address from, uint256 amount) external onlyGame {
        _transfer(from, game, amount);
        emit GameTake(from, amount);
    }

    /// @notice burn your own SOUL
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
