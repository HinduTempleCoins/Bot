// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The mint entrypoint on SOULAVA (a {PRC20} with a cap and MINTER_ROLE).
/// @dev This distributor must hold `MINTER_ROLE` on SOULAVA for {mintTo} to succeed. That grant is a
///      governance step performed AFTER deployment — it is not part of deploying this contract, and it
///      should be the token's ONLY minter once the deployer has renounced.
interface ISoulavaMintable {
    function mint(address to, uint256 amount) external;
}

/// @title SoulavaDistributor — mints SOULAVA from off-chain MELEK delegation accounting, idempotently
/// @notice SOULAVA is the delegation-mining reward: you delegate MELEK vesting shares (or a MELEK-Engine
///         SCOT stake) to the pool account on the Graphene side, and mine SOULAVA on PRANA for the giving.
///         The accrual itself CANNOT live on PRANA — the delegations are Graphene state on another chain,
///         so a keeper computes each delegator's earned balance off-chain (`integrations/delegation-program.mjs`,
///         pure and recomputable by anyone from the public ledger) and pushes it here.
///
/// @dev THE ONE DESIGN DECISION THAT MATTERS: this contract takes a **CUMULATIVE LIFETIME TOTAL**, not a
///      per-epoch delta, and mints only `cumulative - alreadyMinted`.
///
///      A keeper that submits deltas is one retry away from double-minting. Network hiccup, an ambiguous
///      receipt, a restarted process replaying its queue, an operator running the script twice because the
///      first run "looked stuck" — every one of those mints the same reward again, and there is no way to
///      claw it back. With cumulative totals, **re-submitting an identical batch mints exactly zero.** The
///      off-chain job becomes safely re-runnable, which is the property you actually want at 3 a.m.
///
///      It also means the on-chain record is self-describing: `mintedTo[account]` IS that account's lifetime
///      earned figure, directly comparable to the off-chain ledger. Reconciliation is a diff, not an audit.
///
///      Monotonicity is enforced: a cumulative BELOW what was already minted reverts rather than silently
///      no-op'ing. That case means the off-chain ledger was rolled back or corrupted, and it should stop the
///      run and wake someone up, not quietly continue.
///
///      SECOND GUARD — the daily cap. A compromised or buggy keeper holds MINTER_ROLE by proxy, so it could
///      otherwise mint the entire remaining supply in one transaction. {dailyMintCap} bounds the blast radius
///      to one day's honest emission plus headroom; exceeding it reverts and the admin has a day to notice.
///      The cap resets on the calendar-day boundary (`block.timestamp / 1 days`). Day granularity makes the
///      few seconds of validator timestamp discretion irrelevant.
///
///      Deliberately dependency-free, mirroring {PRC20} and {MwaliPoLGauge}: no imports to audit, nothing to
///      version-pin, and it drops straight into the PRANA contracts tree.
///
///      NOT UPGRADEABLE and holds NO funds. It never takes custody of SOULAVA or of anything else — it only
///      calls `mint`. To retire it, revoke its MINTER_ROLE on the token; nothing is stranded.
contract SoulavaDistributor {
    /// @notice The SOULAVA token this contract mints. Immutable — a distributor is bound to one token.
    ISoulavaMintable public immutable soulava;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    mapping(bytes32 => mapping(address => bool)) public hasRole;

    /// @notice Lifetime SOULAVA minted to each account by this distributor, in wei.
    /// @dev This is the on-chain mirror of the off-chain ledger's `earned` field. Reconciliation is a diff.
    mapping(address => uint256) public mintedTo;

    /// @notice Lifetime SOULAVA minted by this distributor across all accounts, in wei.
    uint256 public totalMinted;

    /// @notice Maximum wei this distributor may mint in one calendar day. 0 disables minting entirely.
    uint256 public dailyMintCap;

    /// @notice The day index (`block.timestamp / 1 days`) that {mintedToday} is counted against.
    uint256 public currentDay;

    /// @notice Wei minted so far during {currentDay}.
    uint256 public mintedToday;

    /// @notice While paused, no minting is possible. Admin only.
    bool public paused;

    /// @notice Pending admin under the two-step handover. See {transferAdmin}.
    address public pendingAdmin;

    /// @notice The admin that started the pending handover, and whose role is revoked when it completes.
    address public outgoingAdmin;

    /// @notice Upper bound on one {mintBatch} call, so a malformed batch reverts on length rather than
    ///         burning the whole block gas limit before failing.
    uint256 public constant MAX_BATCH = 256;

    error ZeroAddress();
    error NotAuthorized();
    error Paused();
    error LengthMismatch();
    error BatchTooLarge();
    /// @dev The submitted cumulative total is BELOW what has already been minted — the off-chain ledger
    ///      moved backwards. Deliberately fatal: stop the run and investigate.
    error NonMonotonic(address account, uint256 submitted, uint256 alreadyMinted);
    error DailyCapExceeded(uint256 requested, uint256 remaining);

    event Distributed(address indexed account, uint256 cumulative, uint256 minted);
    event DailyMintCapSet(uint256 previous, uint256 current);
    event PausedSet(bool paused);
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    event AdminTransferStarted(address indexed previous, address indexed pending);
    event AdminTransferred(address indexed previous, address indexed current);

    /// @param soulava_     the SOULAVA PRC-20. This contract must later be granted MINTER_ROLE on it.
    /// @param admin        holds DEFAULT_ADMIN_ROLE. Should be the DAO timelock, not an EOA.
    /// @param keeper       the off-chain distribution runner. May be an EOA; its blast radius is one day's cap.
    /// @param dailyMintCap_ wei per calendar day. Set it to honest emission plus headroom, not to the supply cap.
    constructor(ISoulavaMintable soulava_, address admin, address keeper, uint256 dailyMintCap_) {
        if (address(soulava_) == address(0) || admin == address(0)) revert ZeroAddress();
        soulava = soulava_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (keeper != address(0)) _grantRole(KEEPER_ROLE, keeper);
        dailyMintCap = dailyMintCap_;
        currentDay = block.timestamp / 1 days;
        emit DailyMintCapSet(0, dailyMintCap_);
    }

    // ── distribution ─────────────────────────────────────────────────────────────────────────────

    /// @notice Bring `account` up to its lifetime `cumulative` earned total, minting only the difference.
    /// @param account    the delegator's PRANA address.
    /// @param cumulative that account's LIFETIME earned SOULAVA in wei, from the off-chain ledger.
    /// @return minted    wei actually minted — zero if the account is already up to date.
    /// @dev Re-submitting the same `cumulative` mints zero and emits nothing. That is the point.
    function mintTo(address account, uint256 cumulative) external onlyRole(KEEPER_ROLE) returns (uint256 minted) {
        _requireNotPaused();
        minted = _settle(account, cumulative);
        if (minted != 0) _consumeDailyAllowance(minted);
        _mintIfAny(account, cumulative, minted);
    }

    /// @notice {mintTo} for many accounts in one transaction.
    /// @dev A duplicated address inside one batch is harmless: the first entry mints the delta and any
    ///      later entry with the same cumulative mints zero. A later entry with a HIGHER cumulative mints
    ///      the further difference — also correct.
    /// @return totalMintedInBatch wei minted across the whole batch.
    function mintBatch(address[] calldata accounts, uint256[] calldata cumulatives)
        external
        onlyRole(KEEPER_ROLE)
        returns (uint256 totalMintedInBatch)
    {
        _requireNotPaused();
        uint256 n = accounts.length;
        if (n != cumulatives.length) revert LengthMismatch();
        if (n > MAX_BATCH) revert BatchTooLarge();

        // Settle every account first, then charge the daily allowance ONCE for the batch total. Charging
        // per-entry would let a batch pass its first half and revert on its second, which is the same
        // outcome (the whole tx reverts) but costs more gas to discover.
        uint256[] memory deltas = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            uint256 d = _settle(accounts[i], cumulatives[i]);
            deltas[i] = d;
            totalMintedInBatch += d;
        }
        if (totalMintedInBatch != 0) _consumeDailyAllowance(totalMintedInBatch);

        for (uint256 i = 0; i < n; ++i) {
            _mintIfAny(accounts[i], cumulatives[i], deltas[i]);
        }
    }

    /// @notice What {mintTo} would mint right now for this account and cumulative. Reverts on a backwards
    ///         ledger exactly as {mintTo} would, so a dry run surfaces the same failure.
    function pendingFor(address account, uint256 cumulative) external view returns (uint256) {
        uint256 already = mintedTo[account];
        if (cumulative < already) revert NonMonotonic(account, cumulative, already);
        return cumulative - already;
    }

    /// @notice Wei this distributor may still mint today.
    function remainingToday() public view returns (uint256) {
        if (block.timestamp / 1 days != currentDay) return dailyMintCap;   // a new day has rolled over
        uint256 used = mintedToday;
        return used >= dailyMintCap ? 0 : dailyMintCap - used;
    }

    // ── internals ────────────────────────────────────────────────────────────────────────────────

    /// @dev Records the new cumulative and returns the delta. Storage is written BEFORE any external call
    ///      (checks-effects-interactions), so a hostile token cannot re-enter into a second mint of the
    ///      same delta — on re-entry `mintedTo` is already up to date and the delta is zero.
    function _settle(address account, uint256 cumulative) internal returns (uint256 delta) {
        if (account == address(0)) revert ZeroAddress();
        uint256 already = mintedTo[account];
        if (cumulative < already) revert NonMonotonic(account, cumulative, already);
        delta = cumulative - already;
        if (delta == 0) return 0;
        mintedTo[account] = cumulative;
        totalMinted += delta;
    }

    function _mintIfAny(address account, uint256 cumulative, uint256 delta) internal {
        if (delta == 0) return;
        soulava.mint(account, delta);
        emit Distributed(account, cumulative, delta);
    }

    function _consumeDailyAllowance(uint256 amount) internal {
        uint256 day = block.timestamp / 1 days;
        if (day != currentDay) { currentDay = day; mintedToday = 0; }
        uint256 remaining = dailyMintCap > mintedToday ? dailyMintCap - mintedToday : 0;
        if (amount > remaining) revert DailyCapExceeded(amount, remaining);
        mintedToday += amount;
    }

    function _requireNotPaused() internal view {
        if (paused) revert Paused();
    }

    // ── admin ────────────────────────────────────────────────────────────────────────────────────

    modifier onlyRole(bytes32 role) {
        if (!hasRole[role][msg.sender]) revert NotAuthorized();
        _;
    }

    function setDailyMintCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit DailyMintCapSet(dailyMintCap, cap);
        dailyMintCap = cap;
    }

    /// @notice Halt all minting. The intended response to a suspected keeper compromise, and faster than
    ///         revoking the role on a timelock.
    function setPaused(bool paused_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function grantRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        _grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (hasRole[role][account]) { hasRole[role][account] = false; emit RoleRevoked(role, account, msg.sender); }
    }

    /// @notice Begin handing DEFAULT_ADMIN_ROLE to `newAdmin`. Two-step on purpose: a one-step transfer to a
    ///         mistyped or non-existent address permanently bricks pause, the cap, and role management, and
    ///         this contract has no other way to recover.
    function transferAdmin(address newAdmin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newAdmin == address(0)) revert ZeroAddress();
        pendingAdmin = newAdmin;
        outgoingAdmin = msg.sender;
        emit AdminTransferStarted(msg.sender, newAdmin);
    }

    /// @notice Accept the admin handover. Callable only by the address named in {transferAdmin}, which
    ///         proves it exists and can transact before the outgoing admin loses the role.
    /// @dev The handover REVOKES the outgoing admin. Granting the incoming one without revoking the
    ///      outgoing one would leave two admins and quietly turn a transfer into an addition — which is
    ///      the failure a two-step handover exists to prevent, not one it may reintroduce.
    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotAuthorized();
        address previous = outgoingAdmin;
        pendingAdmin = address(0);
        outgoingAdmin = address(0);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        if (previous != address(0) && previous != msg.sender && hasRole[DEFAULT_ADMIN_ROLE][previous]) {
            hasRole[DEFAULT_ADMIN_ROLE][previous] = false;
            emit RoleRevoked(DEFAULT_ADMIN_ROLE, previous, msg.sender);
        }
        emit AdminTransferred(previous, msg.sender);
    }

    function _grantRole(bytes32 role, address account) internal {
        if (!hasRole[role][account]) { hasRole[role][account] = true; emit RoleGranted(role, account, msg.sender); }
    }
}
