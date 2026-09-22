// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title BatchDisperse — stateless push-airdrop distributor (the cheap L2 "disperse" option)
///
/// @notice ⚠️ TESTNET / LOCAL until the operator deploys. This is the plan's preferred airdrop
///         mechanism on an L2 (Part 3b): batch-transfer the whole list in one tx (~$5–50 for 10k on
///         Base, ~$1–10 on Polygon). Tokens simply APPEAR in recipient wallets — maximally visible,
///         zero claim friction, every transfer on-chain. Mirrors PRANA's BatchAirdrop exactly: holds
///         no balance, keeps no state, pulls the total from the caller and pushes it out.
///
///         "Visible/transparent" (the plan's requirement) is proven by these on-chain Transfer events
///         matching the published recipient CSV. For lists too large for one tx's gas/calldata,
///         chunk the CSV and call repeatedly, or use {MerkleDistributor} (root + IPFS CSV).
contract BatchDisperse {
    using SafeERC20 for IERC20;

    event Dispersed(address indexed token, address indexed sender, uint256 recipientCount, uint256 totalAmount);

    error EmptyRecipients();
    error LengthMismatch();

    /// @notice Send per-recipient `amounts` of `token` to `recipients` in one tx.
    /// @dev Caller must approve this contract for the sum of `amounts` first.
    function disperse(IERC20 token, address[] calldata recipients, uint256[] calldata amounts) external {
        uint256 len = recipients.length;
        if (len == 0) revert EmptyRecipients();
        if (len != amounts.length) revert LengthMismatch();

        uint256 total;
        for (uint256 i; i < len; ++i) total += amounts[i];

        token.safeTransferFrom(msg.sender, address(this), total);
        for (uint256 i; i < len; ++i) token.safeTransfer(recipients[i], amounts[i]);

        emit Dispersed(address(token), msg.sender, len, total);
    }

    /// @notice Send the same `amountEach` of `token` to every recipient (uniform airdrop).
    function disperseEqual(IERC20 token, address[] calldata recipients, uint256 amountEach) external {
        uint256 len = recipients.length;
        if (len == 0) revert EmptyRecipients();

        uint256 total = amountEach * len;
        token.safeTransferFrom(msg.sender, address(this), total);
        for (uint256 i; i < len; ++i) token.safeTransfer(recipients[i], amountEach);

        emit Dispersed(address(token), msg.sender, len, total);
    }
}
