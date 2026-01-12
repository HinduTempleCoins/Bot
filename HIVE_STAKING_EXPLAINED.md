# HIVE Staking System Explained

**Important**: HIVE doesn't use traditional PoS APR! It uses **DPoS (Delegated Proof of Stake)** with curation rewards.

---

## How HIVE Staking Actually Works

### 1. Stake-Weighted Voting (Like STEEM)

**HIVE Power (HP)**:
- Stake HIVE → Get HIVE Power
- HIVE Power = Voting weight
- More HP = Stronger votes
- Votes earn curation rewards

**Curation Rewards**:
- Upvote content BEFORE it trends
- Earn % of post rewards
- Based on your HP stake
- Distributed 50/50 (author/curators)

**Example**:
```
You have: 1000 HP
You upvote: Post at $0.10
Post reaches: $100
Your curation: ~$2-5 (depends on timing)
```

### 2. HIVE-Engine Tokens (Same Model!)

**BBH, DRIP, LEO, etc.**:
- Stake tokens → Get voting power
- Upvote tribe posts
- Earn curation rewards IN THAT TOKEN
- Plus dividends from project revenue

**BBH Example**:
```
Stake: 1000 BBH
Upvote: Posts in BBH community
Earn: BBH curation rewards
Bonus: BRO dividends (from BBH project revenue)
```

**DRIP Example**:
```
Stake: 100 DRIP
Daily drip: ~0.5-1 DRIP/day (compounds!)
Plus: Curation if you vote
Result: 100%+ APY from compounding
```

### 3. Dividends vs Curation

**Curation** (Active):
- Requires voting
- Timing matters (early = more rewards)
- Variable returns
- Competitive (others voting too)

**Dividends** (Passive):
- Just stake and hold
- Automatic distribution
- Fixed rate
- No competition

**BBH = Both!**:
- Curation: Vote on BBH posts
- Dividends: BRO tokens distributed
- Combined: 50%+ annual return

---

## Staking Analyzer Update Needed

### Current Problem:
The staking-analyzer.cjs tries to calculate traditional APR, but HIVE tokens don't work that way!

### What It Should Do Instead:

#### 1. Check Token Project Type
```javascript
const TOKEN_TYPES = {
  'BBH': {
    type: 'CURATION + DIVIDENDS',
    curationActive: true,
    dividendToken: 'BRO',
    estimatedReturn: '50%+',
    requiresVoting: 'Optional'
  },

  'DRIP': {
    type: 'DAILY_DRIP',
    curationActive: false,
    dividendToken: 'DRIP',
    estimatedReturn: '100%+',
    requiresVoting: 'No'
  },

  'LEO': {
    type: 'CURATION',
    curationActive: true,
    dividendToken: null,
    estimatedReturn: '15-25%',
    requiresVoting: 'Yes'
  }
};
```

#### 2. Query Project Fundamentals
```javascript
async function getProjectHealth(token) {
  // Check:
  // - Is project still active?
  // - Are posts being made?
  // - Are rewards being distributed?
  // - Is community growing?

  return {
    active: true,
    weeklyPosts: 50,
    rewardsDistributed: true,
    communityGrowing: true,
    healthScore: 85
  };
}
```

#### 3. Compare Returns
```javascript
async function shouldStakeOrTrade(token, tradingProfit) {
  const projectHealth = await getProjectHealth(token);
  const tokenType = TOKEN_TYPES[token];

  if (!projectHealth.active) {
    return {
      recommendation: 'TRADE',
      reason: 'Project inactive - no staking rewards'
    };
  }

  if (tokenType.type === 'DAILY_DRIP') {
    return {
      recommendation: 'STAKE',
      reason: `${tokenType.estimatedReturn} from daily drip > ${tradingProfit}% trading`
    };
  }

  if (tokenType.type === 'CURATION + DIVIDENDS') {
    return {
      recommendation: 'STAKE',
      reason: 'Curation + BRO dividends > trading profits',
      note: 'Can still vote while staked!'
    };
  }

  // Default: Compare estimated return vs trading
  const stakingReturn = parseEstimatedReturn(tokenType.estimatedReturn);
  if (stakingReturn > tradingProfit * 1.2) {
    return {
      recommendation: 'STAKE',
      reason: `${stakingReturn}% staking > ${tradingProfit}% trading`
    };
  } else {
    return {
      recommendation: 'TRADE',
      reason: `${tradingProfit}% trading > ${stakingReturn}% staking`
    };
  }
}
```

---

## Known HIVE-Engine Staking Returns

### High Return (STAKE THESE!)

**DRIP**:
- Type: Daily drip token
- Return: 100-200% APY
- Method: Compounds automatically
- Voting: Not required
- **Decision: ALWAYS STAKE**

**BBH**:
- Type: Curation + BRO dividends
- Return: 50-100% APY combined
- Method: Vote on BBH posts + automatic BRO
- Voting: Optional but recommended
- **Decision: STAKE**

**PIZZA**:
- Type: Curation + staking
- Return: 25-50% APY
- Method: Vote on PIZZA posts
- Voting: Recommended
- **Decision: STAKE**

### Medium Return (DEPENDS)

**LEO**:
- Type: Curation
- Return: 15-25% APY
- Method: Vote on LeoFinance posts
- Voting: Required for rewards
- **Decision: STAKE if active voter, TRADE if not**

**POB**:
- Type: Curation
- Return: 20-30% APY
- Method: Vote on POB posts
- Voting: Required
- **Decision: STAKE if active, TRADE if not**

### Low Return (TRADE THESE)

**SWAP.HIVE**:
- Type: Liquid (no staking)
- Return: 0%
- **Decision: TRADE (it's the base currency!)**

**Most other tokens**:
- Type: Varies
- Return: < 10% or inactive
- **Decision: TRADE unless project active**

---

## Integration with Trading Bot

### Recommended Logic:

```javascript
// When bot considers selling token to buy VKBT/CURE

async function beforeSelling(token, amount) {
  // Step 1: Check if token has staking
  const stakingInfo = await getStakingInfo(token);

  if (!stakingInfo.stakingEnabled) {
    // No staking, safe to trade
    return { canSell: true, reason: 'No staking available' };
  }

  // Step 2: Check project health
  const health = await getProjectHealth(token);

  if (!health.active) {
    // Dead project, sell it
    return { canSell: true, reason: 'Project inactive' };
  }

  // Step 3: Check if high-return staker
  const knownStakers = ['DRIP', 'BBH', 'PIZZA'];

  if (knownStakers.includes(token)) {
    // High return staker - DON'T sell unless amazing trading opportunity
    const requiredProfit = 50; // Need 50%+ to justify selling BBH/DRIP

    return {
      canSell: false,
      reason: `${token} earns ${health.estimatedReturn} staked - better than trading`,
      override: requiredProfit // Can override if trade profit > 50%
    };
  }

  // Step 4: Default - compare returns
  const stakingReturn = health.estimatedReturn;
  const tradingReturn = calculateExpectedTrading(token);

  if (stakingReturn > tradingReturn * 1.2) {
    return {
      canSell: false,
      reason: `Staking (${stakingReturn}%) > Trading (${tradingReturn}%)`
    };
  }

  return {
    canSell: true,
    reason: `Trading (${tradingReturn}%) > Staking (${stakingReturn}%)`
  };
}
```

---

## Summary

**Key Differences from Traditional PoS**:
- ❌ No fixed APR percentage
- ✅ Curation rewards (vote-based)
- ✅ Dividends (project revenue)
- ✅ Daily drips (compounding)
- ✅ Community activity matters
- ✅ Project health matters

**For Trading Bot**:
- Check project health, not just APR
- Known high-returners: DRIP, BBH, PIZZA (STAKE THESE!)
- Dead projects: Sell immediately
- Active projects: Compare curation + dividends vs trading
- Work with token health checker you already built!

**Next Update**:
- Update staking-analyzer.cjs to use project health
- Add known token database (BBH, DRIP, LEO, etc.)
- Integrate with existing health checker
- Query active posts/community instead of APR

---

**Status**: Staking analyzer works, but needs HIVE-specific logic update
**Priority**: MEDIUM (can deploy bot now, update staking logic later)
**Impact**: Will make smarter stake vs trade decisions for BBH, DRIP, etc.
