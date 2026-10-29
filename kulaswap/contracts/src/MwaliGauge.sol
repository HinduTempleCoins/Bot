// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMintableMwali {
    function mint(address to, uint256 amount) external;
    function remainingMintable() external view returns (uint256);
}

/// @title MwaliGauge — stake LP, MINT MWALI
/// @notice Stake the KULA/WPRANA LP token here and accrue MWALI at a fixed rate per second, split
///         pro-rata across everything staked. Claiming MINTS the MWALI; it is not paid out of a
///         pre-funded balance.
///
///         WHY MINTING AND NOT DISTRIBUTING. The gauge already deployed on PRANA
///         (0x46d92Ae6...) is a Synthetix-style distributor: `notifyRewardAmount` pulls reward
///         tokens from a `rewardDistributor` account that must already be holding them. It never
///         mints. That is why MWALI holds a MINTER_ROLE on that gauge and has still never issued a
///         single unit — the role was granted to a contract that has no code path to use it, and
///         `rewardToken` is immutable so it cannot be repointed.
///
///         It also requires an ACCOUNT to be sitting on a pile of reward tokens to feed it, which
///         is exactly the thing we are not doing. Here there is no distributor, no pre-funding and
///         no treasury: the gauge mints what it owes, when it is claimed, and holds nothing except
///         the LP tokens that stakers can withdraw at any time.
///
///         THE RATE DECAYS. A flat rate forever is an uncapped token wearing a schedule: at a
///         constant 0.01/sec this would issue ~315,360 MWALI every year, for ever, and outrun its
///         own sink. The rate here halves off by 10% a year, mirroring KULA, so the series converges
///         — first-year emission divided by 0.10 is the lifetime total. The token's own hard cap
///         backs it up, so even a mistake in this arithmetic cannot mint past the ceiling.
///
///         No admin, no owner, no pause. The rate, the decay and the cap are all immutable.
contract MwaliGauge {
    using SafeERC20 for IERC20;

    IERC20 public immutable stakeToken;      // KULA/WPRANA LP
    IMintableMwali public immutable mwali;   // minted to stakers
    uint256 public immutable ratePerSecond;  // first-year MWALI per second, shared across stakers
    uint256 public immutable startTime;      // when year one began
    uint256 public constant YEAR = 365 days;
    uint256 public constant DECAY_BPS = 9000; // 90% of the previous year, i.e. -10%/yr
    uint256 public constant MAX_YEARS = 50;   // past this the rate is treated as zero

    uint256 public totalStaked;
    uint256 public accPerShare;              // scaled by 1e18
    uint256 public lastUpdate;

    mapping(address => uint256) public stakedOf;
    mapping(address => uint256) private _debt;
    mapping(address => uint256) public claimedOf;
    uint256 public totalMinted;

    event Staked(address indexed who, uint256 amount);
    event Withdrawn(address indexed who, uint256 amount);
    event Claimed(address indexed who, uint256 amount);

    constructor(IERC20 stakeToken_, IMintableMwali mwali_, uint256 ratePerSecond_) {
        require(address(stakeToken_) != address(0) && address(mwali_) != address(0), "zero");
        require(ratePerSecond_ > 0, "rate=0");
        stakeToken = stakeToken_;
        mwali = mwali_;
        ratePerSecond = ratePerSecond_;
        startTime = block.timestamp;
        lastUpdate = block.timestamp;
    }

    /// @notice The emission rate right now, after decay. Year 0 is `ratePerSecond`; each year after
    ///         is 90% of the one before; past MAX_YEARS it is zero.
    function currentRate() public view returns (uint256) {
        uint256 y = (block.timestamp - startTime) / YEAR;
        if (y >= MAX_YEARS) return 0;
        uint256 r = ratePerSecond;
        for (uint256 i = 0; i < y; ++i) r = (r * DECAY_BPS) / 10000;
        return r;
    }

    /// @notice Total MWALI this gauge will ever emit, as a closed form: first-year / (1 - decay).
    ///         At 0.01/sec that is 315,360 in year one and ~3,153,600 over the life of the gauge.
    function lifetimeEmission() external view returns (uint256) {
        return (ratePerSecond * YEAR * 10000) / (10000 - DECAY_BPS);
    }

    function _sync() internal {
        if (block.timestamp == lastUpdate) return;
        if (totalStaked > 0) {
            accPerShare += ((block.timestamp - lastUpdate) * currentRate() * 1e18) / totalStaked;
        }
        lastUpdate = block.timestamp;
    }

    /// @notice MWALI owed to `who` but not yet claimed.
    function earned(address who) public view returns (uint256) {
        uint256 acc = accPerShare;
        if (block.timestamp > lastUpdate && totalStaked > 0) {
            acc += ((block.timestamp - lastUpdate) * currentRate() * 1e18) / totalStaked;
        }
        return (stakedOf[who] * acc) / 1e18 - _debt[who];
    }

    function _claim(address who) internal {
        uint256 owed = (stakedOf[who] * accPerShare) / 1e18 - _debt[who];
        if (owed > 0) {
            claimedOf[who] += owed;
            totalMinted += owed;
            // Respect the token's hard cap: never ask for more than is left, so a gauge running
            // past the ceiling tapers to zero rather than reverting and bricking every claim.
            uint256 left = mwali.remainingMintable();
            if (owed > left) owed = left;
            if (owed > 0) mwali.mint(who, owed);   // the emission — no pre-funded pile anywhere
            emit Claimed(who, owed);
        }
    }

    function stake(uint256 amount) external {
        require(amount > 0, "amount=0");
        _sync();
        _claim(msg.sender);
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        stakedOf[msg.sender] += amount;
        totalStaked += amount;
        _debt[msg.sender] = (stakedOf[msg.sender] * accPerShare) / 1e18;
        emit Staked(msg.sender, amount);
    }

    /// @notice Withdraw staked LP. Always available — the gauge never locks anyone in.
    function withdraw(uint256 amount) external {
        require(amount > 0 && stakedOf[msg.sender] >= amount, "bad amount");
        _sync();
        _claim(msg.sender);
        stakedOf[msg.sender] -= amount;
        totalStaked -= amount;
        _debt[msg.sender] = (stakedOf[msg.sender] * accPerShare) / 1e18;
        stakeToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claim() external {
        _sync();
        _claim(msg.sender);
        _debt[msg.sender] = (stakedOf[msg.sender] * accPerShare) / 1e18;
    }

    /// @notice Leave entirely: claim what is owed and take every LP token back.
    function exit() external {
        uint256 amount = stakedOf[msg.sender];
        require(amount > 0, "nothing staked");
        _sync();
        _claim(msg.sender);
        stakedOf[msg.sender] = 0;
        totalStaked -= amount;
        _debt[msg.sender] = 0;
        stakeToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }
}
