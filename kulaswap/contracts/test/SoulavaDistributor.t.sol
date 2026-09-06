// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SoulavaDistributor, ISoulavaMintable} from "../src/SoulavaDistributor.sol";

/// @dev Minimal forge cheatcode surface (no forge-std dependency, so the suite runs fully offline with
///      only the `forge` binary). Address is the canonical HEVM cheatcode address.
interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes memory) external;
}

/// @dev Mock of SOULAVA: a capped, mintable PRC-20 whose `mint` is MINTER_ROLE-gated. The gating is the
///      point — it proves the distributor cannot mint until governance grants it the role, and that
///      revoking the role is a complete off-switch.
contract MockSoulava is ISoulavaMintable {
    string public name = "SOULAVA";
    string public symbol = "SOULA";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    uint256 public immutable cap;
    mapping(address => uint256) public balanceOf;
    mapping(address => bool) public isMinter;
    address public admin;

    error NotMinter();
    error CapExceeded();

    constructor(address admin_, uint256 cap_) {
        admin = admin_;
        cap = cap_;
    }

    function grantMinter(address who) external {
        require(msg.sender == admin, "not admin");
        isMinter[who] = true;
    }

    function revokeMinter(address who) external {
        require(msg.sender == admin, "not admin");
        isMinter[who] = false;
    }

    function mint(address to, uint256 amount) external {
        if (!isMinter[msg.sender]) revert NotMinter();
        if (cap != 0 && totalSupply + amount > cap) revert CapExceeded();
        totalSupply += amount;
        balanceOf[to] += amount;
    }
}

/// @dev A token that re-enters the distributor from inside `mint`. Proves the cumulative model closes the
///      re-entrancy hole by construction: on re-entry `mintedTo` is already written, so the delta is zero.
contract ReentrantSoulava is ISoulavaMintable {
    SoulavaDistributor public dist;
    address public target;
    uint256 public cumulative;
    bool public entered;
    uint256 public reentrantMinted;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    function arm(SoulavaDistributor d, address t, uint256 c) external {
        dist = d;
        target = t;
        cumulative = c;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        if (!entered && address(dist) != address(0)) {
            entered = true;
            reentrantMinted = dist.mintTo(target, cumulative);
        }
    }
}

contract SoulavaDistributorTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    MockSoulava soul;
    SoulavaDistributor dist;

    address constant DAO = address(0xDA0); // stands in for the DAO Timelock (distributor admin)
    address constant KEEPER = address(0xKEE);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);

    uint256 constant CAP = 100_000_000 ether;   // SOULAVA max supply
    uint256 constant DAILY = 10_000 ether;      // one day's honest emission plus headroom

    function setUp() public {
        soul = new MockSoulava(DAO, CAP);
        dist = new SoulavaDistributor(ISoulavaMintable(address(soul)), DAO, KEEPER, DAILY);
        vm.prank(DAO);
        soul.grantMinter(address(dist));
        vm.warp(1_800_000_000);   // a fixed, mid-day timestamp so day rollovers are deliberate
    }

    // ── the cumulative model ────────────────────────────────────────────────────────────────────

    function test_mintsTheDifferenceNotTheTotal() public {
        vm.prank(KEEPER);
        dist.mintTo(ALICE, 100 ether);
        require(soul.balanceOf(ALICE) == 100 ether, "first mint");

        vm.prank(KEEPER);
        dist.mintTo(ALICE, 175 ether);
        require(soul.balanceOf(ALICE) == 175 ether, "second mint must top up, not add 175 again");
        require(dist.mintedTo(ALICE) == 175 ether, "mintedTo mirrors the ledger");
    }

    /// THE test. A replayed batch is the realistic keeper failure, and it must cost nothing.
    function test_replayingTheSameSubmissionMintsZero() public {
        vm.prank(KEEPER);
        dist.mintTo(ALICE, 100 ether);
        vm.prank(KEEPER);
        uint256 second = dist.mintTo(ALICE, 100 ether);
        require(second == 0, "replay must mint zero");
        require(soul.balanceOf(ALICE) == 100 ether, "balance unchanged by the replay");
        require(soul.totalSupply() == 100 ether, "supply unchanged by the replay");
    }

    function test_aBackwardsLedgerIsFatalNotSilent() public {
        vm.prank(KEEPER);
        dist.mintTo(ALICE, 100 ether);
        vm.prank(KEEPER);
        vm.expectRevert(
            abi.encodeWithSelector(SoulavaDistributor.NonMonotonic.selector, ALICE, 99 ether, 100 ether)
        );
        dist.mintTo(ALICE, 99 ether);
    }

    function test_pendingForMatchesWhatMintToWouldMint() public {
        vm.prank(KEEPER);
        dist.mintTo(ALICE, 40 ether);
        require(dist.pendingFor(ALICE, 65 ether) == 25 ether, "pendingFor is the delta");
        require(dist.pendingFor(ALICE, 40 ether) == 0, "already settled");
    }

    // ── batch ───────────────────────────────────────────────────────────────────────────────────

    function test_batchSettlesEveryone() public {
        address[] memory who = new address[](2);
        uint256[] memory amt = new uint256[](2);
        who[0] = ALICE; amt[0] = 10 ether;
        who[1] = BOB;   amt[1] = 30 ether;
        vm.prank(KEEPER);
        uint256 total = dist.mintBatch(who, amt);
        require(total == 40 ether, "batch total");
        require(soul.balanceOf(ALICE) == 10 ether && soul.balanceOf(BOB) == 30 ether, "both credited");
        require(dist.totalMinted() == 40 ether, "lifetime total");
    }

    function test_aDuplicateInsideOneBatchDoesNotDoubleMint() public {
        address[] memory who = new address[](2);
        uint256[] memory amt = new uint256[](2);
        who[0] = ALICE; amt[0] = 50 ether;
        who[1] = ALICE; amt[1] = 50 ether;   // same cumulative twice
        vm.prank(KEEPER);
        uint256 total = dist.mintBatch(who, amt);
        require(total == 50 ether, "the duplicate contributes nothing");
        require(soul.balanceOf(ALICE) == 50 ether, "credited once");
    }

    function test_batchRejectsMismatchedLengths() public {
        address[] memory who = new address[](2);
        uint256[] memory amt = new uint256[](1);
        who[0] = ALICE; who[1] = BOB; amt[0] = 1 ether;
        vm.prank(KEEPER);
        vm.expectRevert(SoulavaDistributor.LengthMismatch.selector);
        dist.mintBatch(who, amt);
    }

    function test_batchIsAllOrNothingWhenOneEntryIsBad() public {
        vm.prank(KEEPER);
        dist.mintTo(BOB, 100 ether);

        address[] memory who = new address[](2);
        uint256[] memory amt = new uint256[](2);
        who[0] = ALICE; amt[0] = 10 ether;
        who[1] = BOB;   amt[1] = 5 ether;    // backwards — the whole batch must revert
        vm.prank(KEEPER);
        vm.expectRevert(
            abi.encodeWithSelector(SoulavaDistributor.NonMonotonic.selector, BOB, 5 ether, 100 ether)
        );
        dist.mintBatch(who, amt);
        require(soul.balanceOf(ALICE) == 0, "no partial credit survived the revert");
    }

    // ── the daily cap: bounding a compromised keeper ─────────────────────────────────────────────

    function test_theDailyCapStopsADrain() public {
        vm.prank(KEEPER);
        vm.expectRevert(
            abi.encodeWithSelector(SoulavaDistributor.DailyCapExceeded.selector, DAILY + 1, DAILY)
        );
        dist.mintTo(ALICE, DAILY + 1);
    }

    function test_theCapIsConsumedAcrossCallsWithinADay() public {
        vm.prank(KEEPER);
        dist.mintTo(ALICE, DAILY - 1 ether);
        require(dist.remainingToday() == 1 ether, "allowance drawn down");
        vm.prank(KEEPER);
        vm.expectRevert(
            abi.encodeWithSelector(SoulavaDistributor.DailyCapExceeded.selector, 2 ether, 1 ether)
        );
        dist.mintTo(BOB, 2 ether);
    }

    function test_theCapResetsOnTheDayBoundary() public {
        vm.prank(KEEPER);
        dist.mintTo(ALICE, DAILY);
        require(dist.remainingToday() == 0, "spent");
        vm.warp(block.timestamp + 1 days);
        require(dist.remainingToday() == DAILY, "a new day restores the allowance");
        vm.prank(KEEPER);
        dist.mintTo(BOB, 5 ether);
        require(soul.balanceOf(BOB) == 5 ether, "mints again after the rollover");
    }

    function test_aZeroCapDisablesMintingEntirely() public {
        vm.prank(DAO);
        dist.setDailyMintCap(0);
        vm.prank(KEEPER);
        vm.expectRevert(abi.encodeWithSelector(SoulavaDistributor.DailyCapExceeded.selector, 1 ether, 0));
        dist.mintTo(ALICE, 1 ether);
    }

    /// A no-op settle must not burn daily allowance — otherwise a replayed batch would still be a DoS.
    function test_aReplayDoesNotConsumeTheDailyAllowance() public {
        vm.prank(KEEPER);
        dist.mintTo(ALICE, 100 ether);
        uint256 before = dist.remainingToday();
        vm.prank(KEEPER);
        dist.mintTo(ALICE, 100 ether);
        require(dist.remainingToday() == before, "a zero-delta replay costs no allowance");
    }

    // ── access control ──────────────────────────────────────────────────────────────────────────

    function test_onlyTheKeeperMayMint() public {
        vm.prank(ALICE);
        vm.expectRevert(SoulavaDistributor.NotAuthorized.selector);
        dist.mintTo(ALICE, 1 ether);
    }

    function test_theDistributorCannotMintWithoutTheTokenRole() public {
        SoulavaDistributor orphan =
            new SoulavaDistributor(ISoulavaMintable(address(soul)), DAO, KEEPER, DAILY);
        vm.prank(KEEPER);
        vm.expectRevert(MockSoulava.NotMinter.selector);
        orphan.mintTo(ALICE, 1 ether);
    }

    function test_revokingMinterOnTheTokenIsACompleteOffSwitch() public {
        vm.prank(DAO);
        soul.revokeMinter(address(dist));
        vm.prank(KEEPER);
        vm.expectRevert(MockSoulava.NotMinter.selector);
        dist.mintTo(ALICE, 1 ether);
    }

    function test_pauseHaltsMintingAndUnpauseRestoresIt() public {
        vm.prank(DAO);
        dist.setPaused(true);
        vm.prank(KEEPER);
        vm.expectRevert(SoulavaDistributor.Paused.selector);
        dist.mintTo(ALICE, 1 ether);

        vm.prank(DAO);
        dist.setPaused(false);
        vm.prank(KEEPER);
        dist.mintTo(ALICE, 1 ether);
        require(soul.balanceOf(ALICE) == 1 ether, "unpause restores");
    }

    function test_onlyAdminMayPauseOrSetTheCap() public {
        vm.prank(KEEPER);
        vm.expectRevert(SoulavaDistributor.NotAuthorized.selector);
        dist.setPaused(true);
        vm.prank(KEEPER);
        vm.expectRevert(SoulavaDistributor.NotAuthorized.selector);
        dist.setDailyMintCap(1);
    }

    function test_mintingToTheZeroAddressIsRefused() public {
        vm.prank(KEEPER);
        vm.expectRevert(SoulavaDistributor.ZeroAddress.selector);
        dist.mintTo(address(0), 1 ether);
    }

    // ── two-step admin handover ─────────────────────────────────────────────────────────────────

    function test_theHandoverIsATransferNotAnAddition() public {
        address NEW = address(0xNEW00);
        vm.prank(DAO);
        dist.transferAdmin(NEW);
        require(dist.hasRole(dist.DEFAULT_ADMIN_ROLE(), DAO), "old admin still holds it until accepted");

        vm.prank(NEW);
        dist.acceptAdmin();
        require(dist.hasRole(dist.DEFAULT_ADMIN_ROLE(), NEW), "new admin holds it");
        require(!dist.hasRole(dist.DEFAULT_ADMIN_ROLE(), DAO), "OLD ADMIN MUST LOSE IT");

        vm.prank(DAO);
        vm.expectRevert(SoulavaDistributor.NotAuthorized.selector);
        dist.setPaused(true);
    }

    function test_onlyThePendingAdminMayAccept() public {
        vm.prank(DAO);
        dist.transferAdmin(address(0xNEW00));
        vm.prank(ALICE);
        vm.expectRevert(SoulavaDistributor.NotAuthorized.selector);
        dist.acceptAdmin();
    }

    function test_anUnacceptedHandoverChangesNothing() public {
        vm.prank(DAO);
        dist.transferAdmin(address(0xNEW00));
        vm.prank(DAO);
        dist.setPaused(true);
        require(dist.paused(), "the outgoing admin still governs until acceptance");
    }

    // ── re-entrancy ─────────────────────────────────────────────────────────────────────────────

    /// The cumulative model is itself the re-entrancy guard: state is written before the external mint,
    /// so a token that calls back in finds the account already settled and mints nothing further.
    function test_aReentrantTokenCannotMintTheSameDeltaTwice() public {
        ReentrantSoulava evil = new ReentrantSoulava();
        SoulavaDistributor d =
            new SoulavaDistributor(ISoulavaMintable(address(evil)), DAO, address(this), DAILY);
        evil.arm(d, ALICE, 10 ether);

        d.mintTo(ALICE, 10 ether);

        require(evil.reentrantMinted() == 0, "the re-entrant call minted nothing");
        require(evil.balanceOf(ALICE) == 10 ether, "credited exactly once");
        require(d.mintedTo(ALICE) == 10 ether, "ledger credited exactly once");
    }
}
