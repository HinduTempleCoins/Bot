// router-abi.mjs — minimal UniswapV2 Router02 + Factory ABIs (Base/Aerodrome-v2, QuickSwap all use
// the canonical UniV2 interface, so KulaSwap's router logic ports directly — see the plan Parts 3/4).
// These are the ONLY functions the add-liquidity script needs. No addresses here — those live in
// config/chains.mjs behind env placeholders. Read-only ABI data; no keys, no network.

export const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
  "function createPair(address tokenA, address tokenB) returns (address pair)",
  "function allPairsLength() view returns (uint256)",
];

export const ROUTER_ABI = [
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
  // The call that seeds the opening pool. amountAMin/BMin guard against front-run price shifts;
  // for the FIRST mint of a fresh pair there is no existing ratio so min==desired is safe.
  "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
];

export const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function totalSupply() view returns (uint256)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
