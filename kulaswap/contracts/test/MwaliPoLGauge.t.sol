// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MwaliPoLGauge, IERC20Min, IMwaliMintable} from "../src/MwaliPoLGauge.sol";

/// @dev Minimal forge cheatcode surface (avoids a forge-std dependency so the suite runs fully
///      offline with only the `forge` binary). Address is the canonical HEVM cheatcode address.
interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
}

/// @dev Standard, non-fee-on-transfer ERC-20 mock — stands in for the KULA/WPRANA LP token.
contract MockLP {
    string public name = "KULA-WPRANA LP";
    string public symbol = "KULA-LP";
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        uint256 al = allowance[f][msg.sender];
        if (al != type(uint256).max) allowance[f][msg.sender] = al - a;
        balanceOf[f] -= a;
        balanceOf[t] += a;
        return true;
    }
}

/// @dev Mock of MWALI (`PoLToken`): mintable ERC-20 gated by a MINTER_ROLE-style authorization,
///      supply starts at 0. `mint` reverts unless the caller was granted minter authority — mirrors
///      OZ AccessControl `onlyRole(MINTER_ROLE)`, so the test proves the gauge must hold the role.
contract MockMwali is IMwaliMintable {
    string public name = "Mwali";
    string public symbol = "MWALI";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => bool) public isMinter;
    address public admin;

    error NotMinter();

    constructor(address admin_) {
        admin = admin_;
    }

    function grantMinter(address who) external {
        require(msg.sender == admin, "not admin");
        isMinter[who] = true;
    }

    function mint(address to, uint256 amount) external {
        if (!isMinter[msg.sender]) revert NotMinter();
        totalSupply += amount;
        balanceOf[to] += amount;
    }
}

contract MwaliPoLGaugeTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    MockLP lp;
    MockMwali mwali;
    MwaliPoLGauge gauge;

    address constant DISTRIBUTOR = address(0xD1);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    address constant DAO = address(0xDA0); // stands in for the DAO Timelock (MWALI admin)

    uint256 constant WEEK = 7 days;

    function setUp() public {
        lp = new MockLP();
        mwali = new MockMwali(DAO);
        gauge = new MwaliPoLGauge(IERC20Min(address(lp)), IMwaliMintable(address(mwali)), DISTRIBUTOR);

        // GOVERNANCE STEP (mocked): the DAO admin grants the gauge MINTER_ROLE on MWALI. On mainnet
        // this is the DAO-Timelock propose->queue->execute in MWALI_FIX_GOLIVE.md.
        vm.prank(DAO);
        mwali.grantMinter(address(gauge));

        // Fund two LPs and approve the gauge.
        lp.mint(ALICE, 1_000e18);
        lp.mint(BOB, 1_000e18);
        vm.prank(ALICE);
        lp.approve(address(gauge), type(uint256).max);
        vm.prank(BOB);
        lp.approve(address(gauge), type(uint256).max);
    }

    function _assertEq(uint256 a, uint256 b, string memory tag) internal pure {
        require(a == b, tag);
    }

    function _assertApprox(uint256 a, uint256 b, uint256 tol, string memory tag) internal pure {
        uint256 d = a > b ? a - b : b - a;
        require(d <= tol, tag);
    }

    // ---- THE CORE PROOF: stake -> accrue -> claim MINTS MWALI ----------------------------------

    function test_stakeAccrueClaimMintsMwali() public {
        // Distributor opens a 1-week emission of 100k MWALI (rate/budget only, nothing pre-funded).
        uint256 reward = 100_000e18;
        vm.prank(DISTRIBUTOR);
        gauge.notifyRewardAmount(reward, WEEK);

        // MWALI supply is 0 and the gauge holds no MWALI (nothing pre-funded — the contrast with the
        // broken transfer-only gauge, which would need pre-funded reward tokens).
        _assertEq(mwali.totalSupply(), 0, "supply not 0 at start");
        _assertEq(mwali.balanceOf(address(gauge)), 0, "gauge should hold no MWALI");

        // Alice stakes and lets a full week accrue.
        vm.prank(ALICE);
        gauge.stake(100e18);
        vm.warp(block.timestamp + WEEK);

        uint256 pending = gauge.earned(ALICE);
        // Sole staker for the whole week -> ~= the full emission (integer-division dust aside).
        _assertApprox(pending, reward, 1e6, "earned != full emission");
        require(pending > 0, "no accrual");

        uint256 before = mwali.balanceOf(ALICE);
        vm.prank(ALICE);
        gauge.getReward();
        uint256 minted = mwali.balanceOf(ALICE) - before;

        _assertEq(minted, pending, "claimed != earned");
        // Proof it was MINTED, not transferred: total supply rose by exactly the claim.
        _assertEq(mwali.totalSupply(), minted, "supply did not rise by mint");
        _assertEq(gauge.totalMinted(), minted, "totalMinted mismatch");
        // Gauge still holds zero MWALI — it never custodies reward tokens.
        _assertEq(mwali.balanceOf(address(gauge)), 0, "gauge accrued MWALI balance");
        // Pending cleared.
        _assertEq(gauge.earned(ALICE), 0, "pending not cleared");
    }

    // ---- Two stakers split pro-rata by stake x time -------------------------------------------

    function test_twoStakersProRata() public {
        vm.prank(DISTRIBUTOR);
        gauge.notifyRewardAmount(100_000e18, WEEK);

        // Equal stake, staked at the same instant, for the same duration -> equal mint.
        vm.prank(ALICE);
        gauge.stake(100e18);
        vm.prank(BOB);
        gauge.stake(100e18);

        vm.warp(block.timestamp + WEEK);

        vm.prank(ALICE);
        gauge.getReward();
        vm.prank(BOB);
        gauge.getReward();

        uint256 a = mwali.balanceOf(ALICE);
        uint256 b = mwali.balanceOf(BOB);
        require(a > 0 && b > 0, "no rewards");
        _assertApprox(a, b, 1e6, "not pro-rata equal");
        // Combined mint ~= the emission; supply == sum of the two mints.
        _assertEq(mwali.totalSupply(), a + b, "supply != sum of mints");
    }

    // ---- Only the distributor can set emission -------------------------------------------------

    function test_onlyDistributorNotifies() public {
        vm.expectRevert(MwaliPoLGauge.NotDistributor.selector);
        vm.prank(ALICE);
        gauge.notifyRewardAmount(1e18, WEEK);
    }

    // ---- Without MINTER_ROLE, claim reverts (proves the governance grant is load-bearing) ------

    function test_claimRevertsWithoutMinterRole() public {
        // Fresh gauge that was NEVER granted MINTER_ROLE on MWALI.
        MwaliPoLGauge ungranted =
            new MwaliPoLGauge(IERC20Min(address(lp)), IMwaliMintable(address(mwali)), DISTRIBUTOR);
        vm.prank(DISTRIBUTOR);
        ungranted.notifyRewardAmount(100_000e18, WEEK);

        lp.mint(ALICE, 100e18);
        vm.prank(ALICE);
        lp.approve(address(ungranted), type(uint256).max);
        vm.prank(ALICE);
        ungranted.stake(100e18);
        vm.warp(block.timestamp + WEEK);

        require(ungranted.earned(ALICE) > 0, "should have accrued");
        vm.expectRevert(MockMwali.NotMinter.selector); // mint denied -> claim reverts
        vm.prank(ALICE);
        ungranted.getReward();
    }

    // ---- Withdraw returns LP; accrual stops after periodFinish ---------------------------------

    function test_withdrawAndPeriodEnd() public {
        vm.prank(DISTRIBUTOR);
        gauge.notifyRewardAmount(100_000e18, WEEK);

        vm.prank(ALICE);
        gauge.stake(100e18);
        _assertEq(lp.balanceOf(ALICE), 900e18, "LP not pulled");

        vm.warp(block.timestamp + 2 * WEEK); // past periodFinish
        uint256 earnedAtEnd = gauge.earned(ALICE);

        vm.warp(block.timestamp + WEEK); // further time — no more accrual after periodFinish
        _assertEq(gauge.earned(ALICE), earnedAtEnd, "accrued past periodFinish");

        vm.prank(ALICE);
        gauge.exit(); // claim + withdraw all
        _assertEq(lp.balanceOf(ALICE), 1_000e18, "LP not returned on exit");
        _assertEq(mwali.balanceOf(ALICE), earnedAtEnd, "exit mint mismatch");
    }
}
