// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal ERC-20 surface this gauge needs from the LP stake token.
/// @dev The stake token is a standard Uniswap-V2 LP token (UniswapV2ERC20) — a standard,
///      non-fee-on-transfer ERC-20 — so `transfer`/`transferFrom` move the exact amount. Even so,
///      `stake()` credits the *received* balance delta (fee-on-transfer safe) as a belt-and-braces.
interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice The mint entrypoint on the Proof-of-Liquidity reward token (MWALI / `PoLToken`).
/// @dev MWALI is a mintable `PoLToken` (OZ AccessControl). This gauge must hold `MINTER_ROLE` on
///      MWALI for `mint` to succeed — that grant is a DAO-Timelock governance step, NOT part of
///      deploying this contract (see .local/MWALI_FIX_GOLIVE.md).
interface IMwaliMintable {
    function mint(address to, uint256 amount) external;
}

/// @title MwaliPoLGauge — Proof-of-Liquidity emitter: stake LP, MINT MWALI over time
/// @notice The correct MWALI emitter. Reward accrual is the canonical Synthetix StakingRewards model
///         (stake x time, linear, pro-rata, not flash-gameable) — identical math to the repo's
///         {LiquidityGauge}. The ONE difference is the payout leg: {getReward} **mints** MWALI to the
///         staker via {IMwaliMintable.mint}, rather than `safeTransfer`-ing a pre-funded reward token.
///
///         This is why the currently-deployed `LiquidityGauge_KULA_WPRANA` can never emit MWALI even
///         though it holds MWALI's only `MINTER_ROLE`: a vanilla {LiquidityGauge} has NO `mint` code
///         path — its `getReward()` only `safeTransfer`s its rewardToken (KULA). Granting a
///         transfer-only gauge `MINTER_ROLE` is inert. MWALI, the Proof-of-Liquidity token, is minted
///         to liquidity providers — so the emitter must be a *minting* gauge. This contract is it.
///
/// @dev Because rewards are MINTED on claim, {notifyRewardAmount} sets the emission *rate/budget* only
///      — it does NOT pull reward tokens in (there is nothing to pre-fund; supply is created at claim
///      time under `MINTER_ROLE`). The distributor (an emission controller / EmissionScheduler-style
///      feed, or a governance-set EOA) is the sole caller of {notifyRewardAmount}. Deliberately
///      dependency-free (no external imports) and immutable in its wiring — easy to audit, easy to
///      drop into the PRANA `contracts/contracts/` tree, and it mints only what the honest linear
///      accrual has earned.
contract MwaliPoLGauge {
    IERC20Min public immutable stakeToken;      // the KULA/WPRANA LP token
    IMwaliMintable public immutable mwali;       // the MWALI PoL reward token (this gauge mints it)
    address public immutable rewardDistributor;  // sole caller of notifyRewardAmount (emission controller)
    uint256 private constant ACC = 1e18;

    uint256 public rewardRate;          // MWALI minted per second across all stakers
    uint256 public periodFinish;        // timestamp the current emission window ends
    uint256 public lastUpdate;          // last accrual checkpoint
    uint256 public rewardPerTokenStored;
    uint256 public totalSupply;         // total LP staked

    uint256 public totalMinted;         // lifetime MWALI minted by this gauge (accounting/telemetry)

    mapping(address => uint256) public balanceOf;               // LP staked per user
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;                 // pending (unminted) MWALI per user

    error ZeroAmount();
    error BadAmount();
    error NotDistributor();
    error BadParams();
    error TransferFailed();

    event Staked(address indexed user, uint256 amount, uint256 received);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 amount);   // amount = MWALI minted to user
    event RewardAdded(uint256 rate, uint256 duration, uint256 periodFinish);

    constructor(IERC20Min stakeToken_, IMwaliMintable mwali_, address rewardDistributor_) {
        require(address(stakeToken_) != address(0), "stake=0");
        require(address(mwali_) != address(0), "mwali=0");
        require(rewardDistributor_ != address(0), "distributor=0");
        stakeToken = stakeToken_;
        mwali = mwali_;
        rewardDistributor = rewardDistributor_;
    }

    // ---------------------------------------------------------------------------------------------
    // Reward accounting (Synthetix StakingRewards) — identical to {LiquidityGauge}
    // ---------------------------------------------------------------------------------------------

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdate = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((lastTimeRewardApplicable() - lastUpdate) * rewardRate * ACC) / totalSupply;
    }

    /// @notice Pending (not-yet-minted) MWALI for `account`.
    function earned(address account) public view returns (uint256) {
        return (balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / ACC + rewards[account];
    }

    // ---------------------------------------------------------------------------------------------
    // User actions
    // ---------------------------------------------------------------------------------------------

    /// @notice Stake `amount` of the LP token; credits the *actually received* amount (FoT-safe).
    function stake(uint256 amount) external updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        uint256 balBefore = stakeToken.balanceOf(address(this));
        _pull(msg.sender, amount);
        uint256 received = stakeToken.balanceOf(address(this)) - balBefore;
        if (received == 0) revert ZeroAmount();
        totalSupply += received;
        balanceOf[msg.sender] += received;
        emit Staked(msg.sender, amount, received);
    }

    /// @notice Withdraw `amount` of staked LP back to the caller.
    function withdraw(uint256 amount) public updateReward(msg.sender) {
        if (amount == 0 || balanceOf[msg.sender] < amount) revert BadAmount();
        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        _push(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Claim accrued MWALI — MINTS it to the caller (the fix: mint, not transfer).
    function getReward() public updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            totalMinted += reward;
            mwali.mint(msg.sender, reward); // requires this gauge to hold MINTER_ROLE on MWALI
            emit RewardPaid(msg.sender, reward);
        }
    }

    /// @notice Claim rewards then withdraw all staked LP.
    function exit() external {
        getReward();
        uint256 bal = balanceOf[msg.sender];
        if (bal > 0) withdraw(bal);
    }

    // ---------------------------------------------------------------------------------------------
    // Emission control — sets the MINT rate/budget (no pre-funding: rewards are minted on claim)
    // ---------------------------------------------------------------------------------------------

    /// @notice Open a fresh emission window: stream `reward` MWALI over `duration` seconds. Because
    ///         payouts are minted, this only sets the rate — the distributor need not (and cannot)
    ///         pre-fund reward tokens here. Distributor-only.
    function notifyRewardAmount(uint256 reward, uint256 duration) external updateReward(address(0)) {
        if (msg.sender != rewardDistributor) revert NotDistributor();
        if (duration == 0 || reward == 0) revert BadParams();
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / duration;
        } else {
            uint256 remaining = (periodFinish - block.timestamp) * rewardRate;
            rewardRate = (reward + remaining) / duration;
        }
        if (rewardRate == 0) revert BadParams();
        lastUpdate = block.timestamp;
        periodFinish = block.timestamp + duration;
        emit RewardAdded(rewardRate, duration, periodFinish);
    }

    // ---------------------------------------------------------------------------------------------
    // Internal checked LP transfers (stake token is a standard ERC-20)
    // ---------------------------------------------------------------------------------------------

    function _pull(address from, uint256 amount) internal {
        if (!stakeToken.transferFrom(from, address(this), amount)) revert TransferFailed();
    }

    function _push(address to, uint256 amount) internal {
        if (!stakeToken.transfer(to, amount)) revert TransferFailed();
    }
}
