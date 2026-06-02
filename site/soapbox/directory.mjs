// directory.mjs — the SoapBox crypto resources Directory (operator 2026-06-02). A curated, categorized
// set of useful crypto resources for visitors: data/index sites, forums, wallets, browser extensions,
// explorers, tools, security, faucets, learning. Our own ecosystem items are marked. Plain data so the
// page factory renders it; add entries here. (Outbound links are a user service + SEO content.)

export const DIRECTORY = [
  { cat: 'Data & Index Sites', items: [
    { name: 'SoapBox Markets', url: 'https://data.soapbox.community', blurb: 'This aggregator — prices + a Clarity transparency score + first-party ecosystem data.', ours: true },
    { name: 'CoinGecko', url: 'https://www.coingecko.com', blurb: 'Broad market data; the keyless API powering much of this site.' },
    { name: 'CoinMarketCap', url: 'https://coinmarketcap.com', blurb: 'The widely-known price aggregator.' },
    { name: 'DeFiLlama', url: 'https://defillama.com', blurb: 'TVL + DeFi protocol metrics across chains (keyless API).' },
    { name: 'CoinPaprika', url: 'https://coinpaprika.com', blurb: 'Market data + team/People metadata.' },
    { name: 'Messari', url: 'https://messari.io', blurb: 'Research-grade metrics + reports.' },
    { name: 'DappRadar', url: 'https://dappradar.com', blurb: 'dApp directory + activity rankings.' },
    { name: 'CoinGlass', url: 'https://www.coinglass.com', blurb: 'Derivatives, funding, liquidations data.' },
  ] },
  { cat: 'Forums & Communities', items: [
    { name: 'Bitcointalk', url: 'https://bitcointalk.org', blurb: 'The oldest, largest crypto forum — most official ANN threads live here.' },
    { name: 'Altcoinstalks', url: 'https://www.altcoinstalks.com', blurb: 'Active altcoin forum with announcement boards.' },
    { name: 'CryptocurrencyTalk', url: 'https://cryptocurrencytalk.com', blurb: 'Long-running coin + exchange discussion forum.' },
    { name: 'BitcoinGarden', url: 'https://bitcoingarden.org', blurb: 'Established altcoin/ANN forum.' },
    { name: 'r/CryptoCurrency', url: 'https://www.reddit.com/r/CryptoCurrency/', blurb: '8M+ members; daily discussion + coin threads.' },
    { name: 'Hive (PeakD / Ecency)', url: 'https://peakd.com', blurb: 'Hive blockchain social — where our ecosystem tokens post.', ours: true },
  ] },
  { cat: 'Wallets', items: [
    { name: 'MetaMask', url: 'https://metamask.io', blurb: 'The standard EVM wallet (extension + mobile).' },
    { name: 'Rabby', url: 'https://rabby.io', blurb: 'EVM wallet with strong transaction previews/security.' },
    { name: 'Phantom', url: 'https://phantom.app', blurb: 'Solana (+ multichain) wallet.' },
    { name: 'Keplr', url: 'https://www.keplr.app', blurb: 'Cosmos ecosystem wallet.' },
    { name: 'Hive Keychain', url: 'https://hive-keychain.com', blurb: 'Wallet/signer for Hive + Hive-Engine (our ecosystem).', ours: true },
    { name: 'Ledger', url: 'https://www.ledger.com', blurb: 'Hardware wallet (cold storage).' },
    { name: 'Trezor', url: 'https://trezor.io', blurb: 'Open-source hardware wallet.' },
    { name: 'Trust Wallet', url: 'https://trustwallet.com', blurb: 'Multichain mobile wallet.' },
  ] },
  { cat: 'Browser Extensions', items: [
    { name: 'Revoke.cash', url: 'https://revoke.cash', blurb: 'Review + revoke token approvals (essential security).' },
    { name: 'Pocket Universe', url: 'https://www.pocketuniverse.app', blurb: 'Simulates transactions to catch scams before you sign.' },
    { name: 'Wallet Guard', url: 'https://www.walletguard.app', blurb: 'Phishing + malicious-transaction protection.' },
    { name: 'Scam Sniffer', url: 'https://www.scamsniffer.io', blurb: 'Web3 phishing detection.' },
    { name: 'Hive Keychain (extension)', url: 'https://hive-keychain.com', blurb: 'Browser signer for Hive/Hive-Engine.', ours: true },
  ] },
  { cat: 'Block Explorers', items: [
    { name: 'Etherscan', url: 'https://etherscan.io', blurb: 'Ethereum explorer (+ the V2 multichain API).' },
    { name: 'Blockchair', url: 'https://blockchair.com', blurb: 'Multi-chain explorer + analytics.' },
    { name: 'Solscan', url: 'https://solscan.io', blurb: 'Solana explorer.' },
    { name: 'Tronscan', url: 'https://tronscan.org', blurb: 'TRON explorer.' },
    { name: 'HiveBlocks', url: 'https://hiveblocks.com', blurb: 'Hive blockchain explorer (our ecosystem rails).', ours: true },
  ] },
  { cat: 'Portfolio & Tools', items: [
    { name: 'TradingView', url: 'https://www.tradingview.com', blurb: 'Charts + technical analysis + ideas.' },
    { name: 'DeBank', url: 'https://debank.com', blurb: 'Multichain DeFi portfolio tracker.' },
    { name: 'Zapper', url: 'https://zapper.xyz', blurb: 'DeFi portfolio + on-chain dashboard.' },
    { name: 'Bubblemaps', url: 'https://bubblemaps.io', blurb: 'Visualizes token holder clusters (spot concentration).' },
    { name: 'Arkham', url: 'https://www.arkhamintelligence.com', blurb: 'On-chain entity intelligence.' },
    { name: 'TribalDEX', url: 'https://tribaldex.com', blurb: 'Hive-Engine DEX — where VKBT/CURE trade.', ours: true },
  ] },
  { cat: 'Security & Anti-Scam', items: [
    { name: 'Revoke.cash', url: 'https://revoke.cash', blurb: 'Revoke risky token approvals.' },
    { name: 'Chainabuse', url: 'https://www.chainabuse.com', blurb: 'Report + look up scam addresses.' },
    { name: 'ScamAdviser', url: 'https://www.scamadviser.com', blurb: 'Check a site’s trust score.' },
    { name: 'Library of Ashurbanipal — scam patterns', url: 'https://data.soapbox.community/learn/recognizing-scam-patterns', blurb: 'Our own guide to reading scam red flags.', ours: true },
  ] },
  { cat: 'Testnet Faucets', items: [
    { name: 'Alchemy Faucets', url: 'https://www.alchemy.com/faucets', blurb: 'Sepolia + other testnet ETH (free, for developers).' },
    { name: 'Chainlink Faucets', url: 'https://faucets.chain.link', blurb: 'Testnet ETH + LINK across chains.' },
    { name: 'QuickNode Faucet', url: 'https://faucet.quicknode.com', blurb: 'Multi-chain testnet faucet.' },
    { name: 'Solana Faucet', url: 'https://faucet.solana.com', blurb: 'Devnet/testnet SOL.' },
  ], note: 'Testnet faucets give free TEST coins for development — they have no real value. Be wary of any “mainnet faucet” promising real coins; most are scams.' },
  { cat: 'Learn', items: [
    { name: 'SoapBox Learn', url: 'https://data.soapbox.community/learn', blurb: 'Plain-English explainers: token value, scam patterns, Clarity Score.', ours: true },
    { name: 'Library of Ashurbanipal', url: 'https://wiki.soapbox.community', blurb: 'Our fact-checked knowledge base.', ours: true },
  ] },
];
