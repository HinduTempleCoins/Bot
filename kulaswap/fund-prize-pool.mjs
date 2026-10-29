// Fund the NoLossLotto prize pool: approve KULA, then addPrize(uint256).
const RPC = 'https://rpc.prana.melek.salon';
const SIGNER = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/+$/, '');
const TOKEN = process.env.MELEK_SIGNER_TOKEN;
const KULA = '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631';
const LOTTO = '0xfE5CC3c2919c893a33690bf6b36d58Ae5A989dB3';
const AMT = BigInt(process.argv[2] || '15680365296803652967557');
const DRY = process.argv.includes('--dry');

const w = (v) => BigInt(v).toString(16).padStart(64, '0');
const a = (x) => x.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const rpc = async (m, p) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', method: m, params: p, id: 1 }) })).json()).result;
const post = async (path, body) => {
  const j = await (await fetch(SIGNER + path, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })).json();
  if (!j.ok) throw new Error(j.error || 'signer refused'); return j;
};
const send = async (to, data) => (await post('/v1/evm', { tx: { to, data, value: '0x0' } })).result.hash;
const wait = async (h) => { for (let i = 0; i < 60; i += 1) { const rc = await rpc('eth_getTransactionReceipt', [h]);
  if (rc) return rc.status === '0x1'; await new Promise((r) => setTimeout(r, 2500)); } return false; };

const { address } = await post('/v1/evm/address', {});
const bal = BigInt(await rpc('eth_call', [{ to: KULA, data: '0x70a08231' + a(address) }, 'latest']));
const pot = BigInt(await rpc('eth_call', [{ to: LOTTO, data: '0x719ce73e' }, 'latest']));
console.log(`owner     : ${address}`);
console.log(`KULA bal  : ${Number(bal) / 1e18}`);
console.log(`prizePool : ${Number(pot) / 1e18}`);
console.log(`to add    : ${Number(AMT) / 1e18}`);
if (bal < AMT) { console.log('insufficient KULA'); process.exit(1); }
if (DRY) { console.log('--dry'); process.exit(0); }

const allow = BigInt(await rpc('eth_call', [{ to: KULA, data: '0xdd62ed3e' + a(address) + a(LOTTO) }, 'latest']));
if (allow < AMT) {
  const h = await send(KULA, '0x095ea7b3' + a(LOTTO) + w(AMT));
  console.log(`approve   : ${h} ${(await wait(h)) ? 'ok' : 'FAILED'}`);
}
const h2 = await send(LOTTO, '0x2a050024' + w(AMT));
console.log(`addPrize  : ${h2} ${(await wait(h2)) ? 'ok' : 'FAILED'}`);
const pot2 = BigInt(await rpc('eth_call', [{ to: LOTTO, data: '0x719ce73e' }, 'latest']));
console.log(`prizePool : ${Number(pot2) / 1e18}`);
