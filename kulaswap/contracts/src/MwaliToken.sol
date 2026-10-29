// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";

/// @title MWALI — the proof-of-liquidity reward token
/// @notice What you EARN by providing liquidity, and what you BURN to enter the KULA lotto.
///         Earned by liquidity, destroyed by the lotto: that is the whole loop, and it is why the
///         lottery is a sink rather than a carousel.
///
///         WHY THIS REPLACES THE EARLIER MWALI. The first MWALI
///         (0x36C6921e2CECe9DEc7a5AAC42bC6738011F2a1c9) has a total supply of ZERO and has never
///         minted a unit. Its only MINTER_ROLE holder is the KULA/WPRANA LiquidityGauge, whose
///         `rewardToken` is an IMMUTABLE set to KULA — it pays KULA and can never be repointed to
///         mint MWALI. Its admin is the DAO Timelock, so re-granting that role is a 48-hour
///         governance action. Nothing is lost by replacing it: zero supply means zero holders and
///         zero balances to migrate. The name stays, because it is the name that matches KULA.
///
///         HARD CAP. Supply can never exceed `cap`, enforced in the token itself rather than trusted
///         to the gauge. A cap that lives only in the emitter is not a cap: swap the emitter, or get
///         its arithmetic wrong, and the ceiling is gone. Here mint() reverts past it no matter what
///         any gauge believes.
///
///         Burned supply is NOT reminted. totalSupply falls when the lotto burns, and the cap is
///         measured against everything ever minted, so burning does not quietly raise the ceiling.
///
///         No premine. Supply starts at zero and only a MINTER_ROLE holder — a gauge — can add to
///         it. Burning is open to holders, so the lotto can consume supply without permission.
contract MwaliToken is ERC20, ERC20Burnable, AccessControlEnumerable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Hard ceiling on everything ever minted. Immutable.
    uint256 public immutable cap;
    /// @notice Everything ever minted, burns included. This is what `cap` limits.
    uint256 public totalMinted;

    error CapExceeded(uint256 requested, uint256 remaining);

    /// @param admin gets DEFAULT_ADMIN_ROLE so it can grant MINTER_ROLE to a gauge, and can later
    ///        hand that admin to a timelock. It does NOT get MINTER_ROLE: the token's claim is that
    ///        emission comes from a mechanism, so no human address should be able to print it.
    constructor(address admin, uint256 cap_) ERC20("Mwali", "MWALI") {
        require(admin != address(0), "admin=0");
        require(cap_ > 0, "cap=0");
        cap = cap_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice MWALI still mintable before the hard cap is reached, ever.
    function remainingMintable() public view returns (uint256) {
        return totalMinted >= cap ? 0 : cap - totalMinted;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        uint256 left = remainingMintable();
        if (amount > left) revert CapExceeded(amount, left);
        totalMinted += amount;
        _mint(to, amount);
    }
}
