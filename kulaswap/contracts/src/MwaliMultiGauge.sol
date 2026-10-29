// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMintableMwali {
    function mint(address to, uint256 amount) external;
    function remainingMintable() external view returns (uint256);
}

/// @title MwaliMultiGauge — every liquidity pair earns MWALI, not just one
/// @notice Stake the LP token of ANY listed pair and accrue MWALI. The emission rate is split across
///         pairs by weight; inside a pair it is split pro-rata by stake.
///
///         WHY THIS REPLACES THE SINGLE-PAIR GAUGE. The first gauge took one immutable `stakeToken`,
///         so only KULA/WPRANA earned anything and KULA/wVKBT, wCURE/KULA, wCURE/wVKBT and
///         KULA/wMELEK earned nothing. MWALI is the PROOF-OF-LIQUIDITY token: rewarding one pair and
///         ignoring the rest measures almost none of the liquidity it claims to measure.
///
///         And because MWALI's admin was renounced the moment it was deployed, no second gauge could
///         ever be granted minting rights — the seal that makes "nobody can print this" true also
///         made the system unfinishable in place. Sealing is correct; sealing BEFORE the shape is
///         right is not. Hence a redeploy, while the supply in existence is still tiny.
///
///         The pair list and weights are fixed at construction and immutable. That keeps the
///         no-admin guarantee — nobody can add a pair, change a weight or redirect emission
///         afterwards — while covering every pair that exists today.
contract MwaliMultiGauge {
    using SafeERC20 for IERC20;

    struct Pool {
        IERC20 lp;
        uint256 weight;        // share of the emission, relative to totalWeight
        uint256 totalStaked;
        uint256 accPerShare;   // scaled 1e18
        uint256 lastUpdate;
    }

    IMintableMwali public immutable mwali;
    uint256 public immutable ratePerSecond;   // first-year, across ALL pools combined
    uint256 public immutable startTime;
    uint256 public immutable totalWeight;
    uint256 public constant YEAR = 365 days;
    uint256 public constant DECAY_BPS = 9000; // -10%/yr
    uint256 public constant MAX_YEARS = 50;

    Pool[] public pools;
    mapping(uint256 => mapping(address => uint256)) public stakedOf;
    mapping(uint256 => mapping(address => uint256)) private _debt;
    uint256 public totalMinted;

    event Staked(uint256 indexed pid, address indexed who, uint256 amount);
    event Withdrawn(uint256 indexed pid, address indexed who, uint256 amount);
    event Claimed(uint256 indexed pid, address indexed who, uint256 amount);

    error BadPool();

    constructor(IMintableMwali mwali_, uint256 ratePerSecond_, IERC20[] memory lps, uint256[] memory weights) {
        require(address(mwali_) != address(0) && ratePerSecond_ > 0, "bad args");
        require(lps.length > 0 && lps.length == weights.length, "bad pools");
        mwali = mwali_;
        ratePerSecond = ratePerSecond_;
        startTime = block.timestamp;
        uint256 tw;
        for (uint256 i = 0; i < lps.length; ++i) {
            require(address(lps[i]) != address(0) && weights[i] > 0, "bad pool");
            pools.push(Pool({ lp: lps[i], weight: weights[i], totalStaked: 0, accPerShare: 0, lastUpdate: block.timestamp }));
            tw += weights[i];
        }
        totalWeight = tw;
    }

    function poolCount() external view returns (uint256) { return pools.length; }

    /// @notice Emission per second across ALL pools, after decay.
    function currentRate() public view returns (uint256) {
        uint256 y = (block.timestamp - startTime) / YEAR;
        if (y >= MAX_YEARS) return 0;
        uint256 r = ratePerSecond;
        for (uint256 i = 0; i < y; ++i) r = (r * DECAY_BPS) / 10000;
        return r;
    }

    /// @notice Emission per second for one pool, after decay and weight.
    function poolRate(uint256 pid) public view returns (uint256) {
        if (pid >= pools.length) revert BadPool();
        return (currentRate() * pools[pid].weight) / totalWeight;
    }

    /// @notice Total MWALI this gauge will ever emit: first-year / (1 - decay).
    function lifetimeEmission() external view returns (uint256) {
        return (ratePerSecond * YEAR * 10000) / (10000 - DECAY_BPS);
    }

    function _sync(uint256 pid) internal {
        Pool storage p = pools[pid];
        if (block.timestamp == p.lastUpdate) return;
        if (p.totalStaked > 0) {
            p.accPerShare += ((block.timestamp - p.lastUpdate) * poolRate(pid) * 1e18) / p.totalStaked;
        }
        p.lastUpdate = block.timestamp;
    }

    function earned(uint256 pid, address who) public view returns (uint256) {
        if (pid >= pools.length) revert BadPool();
        Pool storage p = pools[pid];
        uint256 acc = p.accPerShare;
        if (block.timestamp > p.lastUpdate && p.totalStaked > 0) {
            acc += ((block.timestamp - p.lastUpdate) * poolRate(pid) * 1e18) / p.totalStaked;
        }
        return (stakedOf[pid][who] * acc) / 1e18 - _debt[pid][who];
    }

    function _claim(uint256 pid, address who) internal {
        uint256 owed = (stakedOf[pid][who] * pools[pid].accPerShare) / 1e18 - _debt[pid][who];
        if (owed > 0) {
            uint256 left = mwali.remainingMintable();
            if (owed > left) owed = left;
            if (owed > 0) { totalMinted += owed; mwali.mint(who, owed); emit Claimed(pid, who, owed); }
        }
    }

    function stake(uint256 pid, uint256 amount) external {
        if (pid >= pools.length) revert BadPool();
        require(amount > 0, "amount=0");
        _sync(pid); _claim(pid, msg.sender);
        pools[pid].lp.safeTransferFrom(msg.sender, address(this), amount);
        stakedOf[pid][msg.sender] += amount;
        pools[pid].totalStaked += amount;
        _debt[pid][msg.sender] = (stakedOf[pid][msg.sender] * pools[pid].accPerShare) / 1e18;
        emit Staked(pid, msg.sender, amount);
    }

    function withdraw(uint256 pid, uint256 amount) external {
        if (pid >= pools.length) revert BadPool();
        require(amount > 0 && stakedOf[pid][msg.sender] >= amount, "bad amount");
        _sync(pid); _claim(pid, msg.sender);
        stakedOf[pid][msg.sender] -= amount;
        pools[pid].totalStaked -= amount;
        _debt[pid][msg.sender] = (stakedOf[pid][msg.sender] * pools[pid].accPerShare) / 1e18;
        pools[pid].lp.safeTransfer(msg.sender, amount);
        emit Withdrawn(pid, msg.sender, amount);
    }

    function claim(uint256 pid) external {
        if (pid >= pools.length) revert BadPool();
        _sync(pid); _claim(pid, msg.sender);
        _debt[pid][msg.sender] = (stakedOf[pid][msg.sender] * pools[pid].accPerShare) / 1e18;
    }

    /// @notice Claim every pool you are in, in one transaction.
    function claimAll() external {
        for (uint256 i = 0; i < pools.length; ++i) {
            if (stakedOf[i][msg.sender] == 0) continue;
            _sync(i); _claim(i, msg.sender);
            _debt[i][msg.sender] = (stakedOf[i][msg.sender] * pools[i].accPerShare) / 1e18;
        }
    }

    function exit(uint256 pid) external {
        if (pid >= pools.length) revert BadPool();
        uint256 amount = stakedOf[pid][msg.sender];
        require(amount > 0, "nothing staked");
        _sync(pid); _claim(pid, msg.sender);
        stakedOf[pid][msg.sender] = 0;
        pools[pid].totalStaked -= amount;
        _debt[pid][msg.sender] = 0;
        pools[pid].lp.safeTransfer(msg.sender, amount);
        emit Withdrawn(pid, msg.sender, amount);
    }
}
