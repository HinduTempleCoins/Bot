// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title PRC20 — the canonical PRANA token standard (PRANA's ERC-20)
/// @notice PRC-20 is ERC-20, verbatim, on PRANA: the same interface, events, and semantics every wallet,
///         DEX, and indexer already speaks — so a PRC-20 token is an ERC-20 token, and KulaSwap / MetaMask /
///         explorers need zero special handling. This is the REFERENCE implementation: a standard, non-fee-
///         on-transfer ERC-20 with an optional mint cap and role-gated minting (the shape KULA/MWALI/SOULAVA
///         use). Deliberately dependency-free (no external imports) — easy to audit, easy to drop into the
///         PRANA contracts tree, and identical in behavior to a canonical OpenZeppelin ERC-20 + AccessControl.
///
/// @dev Conformance (see PRC-20.md): implements the full ERC-20 interface + events; 18 decimals by default;
///      `transfer`/`transferFrom` move the EXACT amount (no fee-on-transfer, no rebasing); reverts on
///      insufficient balance/allowance and on transfers to the zero address. Extensions: {mint} (MINTER_ROLE,
///      respects {cap}), {burn}, and minimal role admin. A token MAY omit the extensions and still be PRC-20
///      as long as the ERC-20 core is unchanged.
contract PRC20 {
    // ── ERC-20 metadata ──────────────────────────────────────────────────────────────────────────
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public immutable cap;        // max supply; 0 == uncapped

    // ── ERC-20 state ─────────────────────────────────────────────────────────────────────────────
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ── minimal roles (MINTER_ROLE + admin) ──────────────────────────────────────────────────────
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    mapping(bytes32 => mapping(address => bool)) public hasRole;

    // ── ERC-20 events (the exact standard signatures wallets/indexers listen for) ─────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();
    error CapExceeded();
    error NotAuthorized();

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 cap_, address admin) {
        if (admin == address(0)) revert ZeroAddress();
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        cap = cap_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    // ── ERC-20 core ──────────────────────────────────────────────────────────────────────────────

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;   // infinite allowance (max) is not decremented
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked { balanceOf[from] = bal - amount; balanceOf[to] += amount; }
        emit Transfer(from, to, amount);
    }

    // ── extensions: mint (role + cap), burn ──────────────────────────────────────────────────────

    /// @notice Create `amount` tokens to `to`. MINTER_ROLE only; respects {cap} when non-zero.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (cap != 0 && totalSupply + amount > cap) revert CapExceeded();
        totalSupply += amount;
        unchecked { balanceOf[to] += amount; }
        emit Transfer(address(0), to, amount);
    }

    /// @notice Destroy `amount` of the caller's tokens.
    function burn(uint256 amount) external {
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance();
        unchecked { balanceOf[msg.sender] = bal - amount; totalSupply -= amount; }
        emit Transfer(msg.sender, address(0), amount);
    }

    // ── minimal AccessControl ─────────────────────────────────────────────────────────────────────

    modifier onlyRole(bytes32 role) {
        if (!hasRole[role][msg.sender]) revert NotAuthorized();
        _;
    }

    function grantRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) { _grantRole(role, account); }
    function revokeRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (hasRole[role][account]) { hasRole[role][account] = false; emit RoleRevoked(role, account, msg.sender); }
    }

    function _grantRole(bytes32 role, address account) internal {
        if (!hasRole[role][account]) { hasRole[role][account] = true; emit RoleGranted(role, account, msg.sender); }
    }
}
