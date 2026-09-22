// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title WrappedReserveToken (wPRANA / wVKBT / wCURE on the target chain)
///
/// @notice ⚠️⚠️ TRUSTED, CUSTODIAL WRAPPER — READ THE TRUST MODEL. TESTNET / LOCAL until deploy. ⚠️⚠️
///
///         This is Part-2 Option-1 of the plan: "custodied mint + published proof-of-reserve." Native
///         PRANA (or VKBT/CURE on Hive-Engine) is LOCKED in a PUBLIC, DECLARED reserve address on the
///         home chain; an equal amount of this ERC-20 is minted on Base/Polygon so it can seed AMM
///         pools. It is honestly custodial/federated — there is NO on-chain proof of the home-chain
///         lock. The whole point of the design is to make the backing *auditable and enforced*, so
///         this is NEVER an orphan wrap (the fake-wMELEK-in-pair hazard, plan §3.1 / Part 7).
///
///         ── THE ANTI-ORPHAN INVARIANT (enforced on-chain) ──────────────────────────────────────
///         `totalSupply() <= attestedReserve` is enforced on every mint. The custodian CANNOT mint
///         wrapped supply that exceeds the reserve it has publicly attested. To mint more, it must
///         FIRST call {attestReserve} with a higher figure AND a fresh `proofURI` — an on-chain,
///         event-logged, publicly-auditable claim of how much is locked and where. Anyone can compare
///         the on-chain `attestedReserve` / `reserveLocator` / `proofURI` against the real home-chain
///         balance and detect under-collateralization. This turns "please trust us" into "here is the
///         reserve, here is the proof link, and the contract itself refuses to over-mint."
///
///         ── ROLES ──────────────────────────────────────────────────────────────────────────────
///           DEFAULT_ADMIN_ROLE : manage roles, set the reserve locator.
///           ATTESTER_ROLE      : publish reserve attestations (proof-of-reserve).
///           MINTER_ROLE        : mint wrapped tokens against attested reserve (the custodian relayer).
///         Splitting ATTESTER from MINTER lets a K-of-N attestation process (or a separate oracle)
///         gate the ceiling that the minter operates under.
///
///         ── UPGRADE PATH ───────────────────────────────────────────────────────────────────────
///         Start here (cheapest, honest). Graduate to a two-way lock-mint bridge (plan Part 2 Option 2
///         / PRANA's PeggedBridgeVault + GrapheneDepositBridge) so wPRANA can flow HOME to PRANA and
///         close the funnel. This contract is {ERC20Burnable} + exposes {IBridgeMintable}-shaped
///         mint/burn so that future bridge vault can drive it without a redeploy.
contract WrappedReserveToken is ERC20, ERC20Burnable, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");

    /// @notice The amount of home-chain asset currently attested as locked in reserve (18-dec, 1:1).
    ///         Serves as the hard ceiling on `totalSupply()`.
    uint256 public attestedReserve;

    /// @notice Human/machine-readable pointer to WHERE the reserve is held on the home chain, e.g.
    ///         "prana:0xReserve..." or a hive-engine account/token locator string. Public by construction.
    string public reserveLocator;

    /// @notice URI of the latest published proof-of-reserve (IPFS/https snapshot the community audits).
    string public proofURI;

    /// @notice Monotonic id of the latest attestation (increments each {attestReserve}).
    uint256 public attestationId;

    event ReserveLocatorSet(string locator);
    event ReserveAttested(uint256 indexed attestationId, uint256 amount, string proofURI, address indexed by);
    event WrappedMinted(address indexed to, uint256 amount, uint256 reserveAfterSupply);
    event WrappedBurned(address indexed from, uint256 amount);

    error ExceedsAttestedReserve(uint256 wouldBeSupply, uint256 attested);
    error ZeroAddress();
    error ZeroAmount();
    error EmptyProof();

    /// @param name_    e.g. "Wrapped PRANA".
    /// @param symbol_  e.g. "wPRANA".
    /// @param admin_   receives DEFAULT_ADMIN_ROLE; also seeded with ATTESTER_ROLE + MINTER_ROLE so a
    ///                 single operator can bootstrap, then split roles to a federation / relayer later.
    /// @param locator_ the public home-chain reserve locator (may be updated by admin).
    constructor(string memory name_, string memory symbol_, address admin_, string memory locator_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        if (admin_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ATTESTER_ROLE, admin_);
        _grantRole(MINTER_ROLE, admin_);
        reserveLocator = locator_;
        emit ReserveLocatorSet(locator_);
    }

    // ===================================================================== //
    //                        PROOF-OF-RESERVE
    // ===================================================================== //

    /// @notice Update where the reserve is held (e.g. rotating the custody account). Public forever.
    function setReserveLocator(string calldata locator_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        reserveLocator = locator_;
        emit ReserveLocatorSet(locator_);
    }

    /// @notice Publish a proof-of-reserve: the amount currently locked on the home chain + a link to
    ///         the evidence. This sets the hard ceiling for minting. Lowering it below current supply
    ///         is allowed (e.g. after redemptions) but can never be forced to violate the invariant on
    ///         mint. A non-empty `proofURI_` is REQUIRED so an attestation is never unverifiable.
    /// @param amount    total home-chain reserve now attested (wei, 1:1 with wrapped decimals).
    /// @param proofURI_ IPFS/https link to the reserve snapshot anyone can check against `reserveLocator`.
    function attestReserve(uint256 amount, string calldata proofURI_) external onlyRole(ATTESTER_ROLE) {
        if (bytes(proofURI_).length == 0) revert EmptyProof();
        attestedReserve = amount;
        proofURI = proofURI_;
        uint256 id = ++attestationId;
        emit ReserveAttested(id, amount, proofURI_, msg.sender);
    }

    /// @notice Fraction of supply backed, in basis points (10000 = fully backed). View for dashboards.
    ///         >= 10000 means fully (or over-) collateralized. Reverts-free: 0 supply reads as 10000.
    function collateralizationBps() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 10000;
        return (attestedReserve * 10000) / supply;
    }

    // ===================================================================== //
    //                          MINT / BURN
    // ===================================================================== //

    /// @notice Mint wrapped tokens against attested reserve. REVERTS if it would push total supply
    ///         above `attestedReserve` — the anti-orphan invariant. The custodian must attest more
    ///         reserve (with proof) before it can mint more.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 wouldBe = totalSupply() + amount;
        if (wouldBe > attestedReserve) revert ExceedsAttestedReserve(wouldBe, attestedReserve);
        _mint(to, amount);
        emit WrappedMinted(to, amount, wouldBe);
    }

    /// @notice Burn on redemption (holder bridged home; custodian releases native and attests down).
    ///         {ERC20Burnable} already exposes burn/burnFrom; this variant emits the bridge event and
    ///         is the {IBridgeMintable}-shaped hook a future lock-mint vault calls.
    function burn(uint256 amount) public override(ERC20Burnable) {
        super.burn(amount);
        emit WrappedBurned(msg.sender, amount);
    }
}
