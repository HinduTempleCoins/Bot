// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title EnvironmentalToken — the new themed "native" ERC-20 for the ETH-leg (Base) launch.
///
/// @notice ⚠️ TESTNET / LOCAL until the operator deploys. Placeholder name/symbol "GileadBalm"/"BALM"
///         — the operator RENAMES at deploy (constructor args). This is a clean, audited-pattern
///         OpenZeppelin ERC-20 (the same composition PRANA's ERC20Base uses): fixed hard CAP, no
///         hidden mint, burnable, EIP-2612 permit (gasless approvals for the airdrop-claim UX).
///
///         DESIGN CHOICE vs. PRANA's role-based ERC20Base: this flagship token uses a SINGLE `Ownable`
///         owner and a mint that can be permanently switched OFF (`renounceMinting`). The intended
///         lifecycle is: (1) owner mints the fixed allocations ONCE at genesis — airdrop float, pool
///         seed, treasury — into the distributor / disperser / treasury; (2) owner calls
///         `renounceMinting()` so supply is forever frozen at what was minted; (3) optionally
///         `renounceOwnership()`. After step 2 the cap is irrelevant and holders have a hard guarantee
///         of no further inflation — the "environmental/community, not a pump" framing the plan (Part
///         3a, Risk "brand fit") asks for. No fee-on-transfer, no blacklist, no rebasing: those break
///         AMM pairing and are exactly the rug surfaces this avoids.
contract EnvironmentalToken is ERC20, ERC20Burnable, ERC20Capped, ERC20Permit, Ownable {
    /// @notice Once true, `mint` is permanently disabled. One-way switch.
    bool public mintingRenounced;

    event MintingRenounced();

    error MintingIsRenounced();

    /// @param name_   token name (operator sets at deploy, e.g. "Gilead Balm").
    /// @param symbol_ token symbol (operator sets at deploy, e.g. "BALM").
    /// @param cap_    hard supply cap in wei. Fixed; mint can never exceed it.
    /// @param owner_  the deployer/treasury multisig that mints the genesis allocations.
    constructor(string memory name_, string memory symbol_, uint256 cap_, address owner_)
        ERC20(name_, symbol_)
        ERC20Capped(cap_)
        ERC20Permit(name_)
        Ownable(owner_)
    {}

    /// @notice Mint an allocation (airdrop float / pool seed / treasury). Owner-only; blocked once
    ///         minting is renounced; capped by ERC20Capped.
    function mint(address to, uint256 amount) external onlyOwner {
        if (mintingRenounced) revert MintingIsRenounced();
        _mint(to, amount);
    }

    /// @notice Permanently disable all future minting. Freezes total supply forever. Irreversible.
    function renounceMinting() external onlyOwner {
        mintingRenounced = true;
        emit MintingRenounced();
    }

    // ERC20 + ERC20Capped share the _update hook; resolve the override explicitly.
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}
