import { ethers } from 'ethers';
const p = new ethers.JsonRpcProvider('https://rpc.prana.melek.salon');
const W = '0x3E41F6708c61bddbBfc55c389718640486558f64';
const w = new ethers.Contract(W, [
  'function mwali() view returns (address)', 'function gauge() view returns (address)',
  'function lotto() view returns (address)', 'function isSealed() view returns (bool)'], p);
const [mw, gg, lt, sealed] = await Promise.all([w.mwali(), w.gauge(), w.lotto(), w.isSealed()]);
console.log('wiring   :', W);
console.log('MWALI    :', mw);
console.log('gauge    :', gg);
console.log('lotto    :', lt);
console.log('SEALED   :', sealed);
const m = new ethers.Contract(mw, [
  'function name() view returns (string)','function symbol() view returns (string)',
  'function cap() view returns (uint256)','function totalSupply() view returns (uint256)',
  'function totalMinted() view returns (uint256)','function remainingMintable() view returns (uint256)',
  'function MINTER_ROLE() view returns (bytes32)','function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'function getRoleMemberCount(bytes32) view returns (uint256)','function hasRole(bytes32,address) view returns (bool)'], p);
const MR = await m.MINTER_ROLE(), AR = await m.DEFAULT_ADMIN_ROLE();
console.log(`\n${await m.name()} (${await m.symbol()})`);
console.log('  cap            :', ethers.formatEther(await m.cap()));
console.log('  totalSupply    :', ethers.formatEther(await m.totalSupply()));
console.log('  admins         :', (await m.getRoleMemberCount(AR)).toString(), '<-- must be 0');
console.log('  minters        :', (await m.getRoleMemberCount(MR)).toString());
console.log('  gauge is minter:', await m.hasRole(MR, gg));
const g = new ethers.Contract(gg, [
  'function stakeToken() view returns (address)','function mwali() view returns (address)',
  'function ratePerSecond() view returns (uint256)','function currentRate() view returns (uint256)',
  'function lifetimeEmission() view returns (uint256)','function totalStaked() view returns (uint256)'], p);
console.log('\ngauge');
console.log('  stakeToken     :', await g.stakeToken(), '(KULA/WPRANA LP)');
console.log('  rate/sec       :', ethers.formatEther(await g.currentRate()));
console.log('  per year       :', (Number(ethers.formatEther(await g.currentRate())) * 31536000).toLocaleString());
console.log('  LIFETIME TOTAL :', Number(ethers.formatEther(await g.lifetimeEmission())).toLocaleString(), 'MWALI');
const l = new ethers.Contract(lt, [
  'function mwali() view returns (address)','function kula() view returns (address)',
  'function mwaliPerTicket() view returns (uint256)','function maxBoostBps() view returns (uint256)',
  'function prizePool() view returns (uint256)','function ticketCount() view returns (uint256)'], p);
console.log('\nlotto');
console.log('  burns          :', await l.mwali());
console.log('  pays           :', await l.kula());
console.log('  MWALI/ticket   :', ethers.formatEther(await l.mwaliPerTicket()));
console.log('  max boost      :', (Number(await l.maxBoostBps())/10000)+'x');
console.log('  prizePool      :', ethers.formatEther(await l.prizePool()));
