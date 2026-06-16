// integrations/token-launch.mjs — turnkey "Create a Token" / "Clone a contract" descriptor builder.
//
// "MELEK-Engine is the turnkey operation." This is the point-and-click layer over the PRANA
// contract factories: pure, dependency-free helpers that BUILD unsigned transaction descriptors
// a wallet (Akasha / MetaMask) then signs. It NEVER signs, NEVER broadcasts, NEVER touches a key —
// it only encodes calldata.
//
// The descriptors call the deployed PRANA factories:
//   • ERC20FactoryWizard.createToken(name,symbol,cap,initialMint,mintTo)              [full deploy]
//   • ERC20CloneFactory.createToken(...) / createTokenDeterministic(...,salt)         [EIP-1167 clone]
// Both factories share the createToken signature, so a "clone a contract from ETH/TRX onto PRANA"
// is just createToken on the clone factory (the factory deploys an EIP-1167 minimal proxy of the
// shared ERC20Initializable implementation). buildCloneTx also covers raw EIP-1167 proxy deploy +
// init for an arbitrary `implementation` (the literal minimal-proxy pattern).
//
// SELECTORS are precomputed keccak256(signature)[:4] (verified against the PRANA ABI 2026-06-16):
//   createToken(string,string,uint256,uint256,address)               -> 0x350d4d65
//   createTokenDeterministic(string,string,uint256,uint256,address,bytes32) -> 0xefa41838
//   initialize(string,string,uint256,address)                        -> 0xbd3a13f6
//
// House style: ESM .mjs, esc() all interpolation, soft-fail-never-throw (validators return
// {ok,errors}; builders return {ok:false,errors} instead of throwing), no network, no deps.

import { CHAINS } from '../kulaswap/kula-config.mjs';

const PRANA = CHAINS.prana || { chainId: 108369 };
export const PRANA_CHAIN_ID = PRANA.chainId || 108369;
const ZERO = '0x0000000000000000000000000000000000000000';

// Function selectors (4-byte) — keccak256(canonical-signature)[:4].
export const SELECTORS = {
  createToken: '0x350d4d65',              // createToken(string,string,uint256,uint256,address)
  createTokenDeterministic: '0xefa41838', // createTokenDeterministic(string,string,uint256,uint256,address,bytes32)
  initialize: '0xbd3a13f6',               // initialize(string,string,uint256,address)
};

// ---- HTML escape (house style) ---------------------------------------------
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- low-level ABI encoding (no deps) ---------------------------------------
// We hand-roll the subset of ABI encoding we need (static uint256/address/bytes32 + dynamic string).

/** Coerce a value to a non-negative BigInt. Throws on garbage (callers guard first). */
function toBig(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0) throw new Error(`not a non-negative integer: ${v}`);
    return BigInt(v);
  }
  const s = String(v == null ? '' : v).trim();
  if (s === '') return 0n;
  const b = BigInt(s); // accepts decimal and 0x
  if (b < 0n) throw new Error(`negative not allowed: ${s}`);
  return b;
}

/** 32-byte hex (no 0x) for a uint256. */
function word(v) {
  return toBig(v).toString(16).padStart(64, '0');
}

/** 32-byte left-padded hex (no 0x) for a 20-byte address. */
function addrWord(a) {
  const h = String(a || ZERO).toLowerCase().replace(/^0x/, '');
  if (h.length !== 40 || /[^0-9a-f]/.test(h)) throw new Error(`bad address: ${a}`);
  return h.padStart(64, '0');
}

/** 32-byte hex (no 0x) for a bytes32 (right-padded if short). */
function bytes32Word(b) {
  let h = String(b == null ? '' : b).toLowerCase().replace(/^0x/, '');
  if (/[^0-9a-f]/.test(h) || h.length > 64) throw new Error(`bad bytes32: ${b}`);
  return h.padEnd(64, '0');
}

/** UTF-8 bytes of a string as hex (no 0x). */
function utf8Hex(s) {
  const bytes = new TextEncoder().encode(String(s == null ? '' : s));
  let h = '';
  for (const byte of bytes) h += byte.toString(16).padStart(2, '0');
  return h;
}

/** ABI dynamic-string tail: 32-byte length + right-padded UTF-8 data. */
function stringTail(s) {
  const data = utf8Hex(s);
  const lenBytes = data.length / 2;
  const padded = data.padEnd(Math.ceil(data.length / 64) * 64 || 0, '0');
  return word(lenBytes) + padded;
}

/**
 * ABI-encode a function call from a 4-byte selector and a typed arg list.
 * Each arg: {t:'uint'|'address'|'bytes32'|'string', v}. Strings are dynamic (head=offset, tail appended).
 * Pure; returns 0x-prefixed calldata.
 */
export function encodeCall(selector, args) {
  const sel = String(selector).replace(/^0x/, '');
  const heads = [];
  const tails = [];
  const headLen = args.length * 32; // bytes
  // First pass: static heads, collect dynamic tails + their offsets.
  let tailOffset = headLen;
  for (const a of args) {
    if (a.t === 'string') {
      heads.push(word(tailOffset));
      const tail = stringTail(a.v);
      tails.push(tail);
      tailOffset += tail.length / 2;
    } else if (a.t === 'address') {
      heads.push(addrWord(a.v));
    } else if (a.t === 'bytes32') {
      heads.push(bytes32Word(a.v));
    } else { // uint
      heads.push(word(a.v));
    }
  }
  return '0x' + sel + heads.join('') + tails.join('');
}

// ---- validation ------------------------------------------------------------
const SYMBOL_RE = /^[A-Z0-9]{2,11}$/;
const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Validate user-supplied token params. Soft: returns {ok, errors[]}, never throws.
 * @param {{name,symbol,decimals,supply,cap?,owner?}} p  supply/cap are HUMAN units (multiplied by 10^decimals here).
 */
export function validateTokenParams(p) {
  const errors = [];
  const params = p || {};

  const name = String(params.name == null ? '' : params.name).trim();
  if (!name) errors.push('name is required');
  else if (name.length > 64) errors.push('name must be <= 64 characters');

  const symbol = String(params.symbol == null ? '' : params.symbol).trim().toUpperCase();
  if (!symbol) errors.push('symbol is required');
  else if (!SYMBOL_RE.test(symbol)) errors.push('symbol must be 2-11 uppercase letters/digits');

  // The PRANA token templates (ERC20Base / ERC20Initializable) FIX decimals at 18; the factory
  // createToken signature has no decimals arg. Accept only 18 (or unset) to avoid a false promise.
  const dec = params.decimals == null || params.decimals === '' ? 18 : Number(params.decimals);
  if (!Number.isInteger(dec) || dec !== 18) {
    errors.push('decimals must be 18 (the PRANA ERC-20 template is fixed at 18 decimals)');
  }

  let supply = 0n;
  try {
    supply = toBig(params.supply);
  } catch {
    errors.push('supply must be a non-negative integer');
  }
  if (supply <= 0n) errors.push('supply must be greater than 0');

  // cap: optional; default uncapped (0). If set, must be >= supply and within uint256.
  let cap = 0n;
  if (params.cap != null && params.cap !== '') {
    try {
      cap = toBig(params.cap);
    } catch {
      errors.push('cap must be a non-negative integer');
    }
    if (cap !== 0n && cap < supply) errors.push('cap must be >= supply (or 0 for uncapped)');
  }

  // base-unit overflow guard (supply * 10^18 must fit uint256)
  const scale = 10n ** BigInt(Number.isInteger(dec) ? dec : 18);
  if (supply > 0n && supply * scale > MAX_UINT256) errors.push('supply too large');

  if (params.owner != null && params.owner !== '' && !/^0x[0-9a-fA-F]{40}$/.test(String(params.owner))) {
    errors.push('owner must be a 0x address');
  }

  return { ok: errors.length === 0, errors };
}

// ---- descriptor builders ---------------------------------------------------

/** Multiply a human amount by 10^decimals → base-unit BigInt. */
function toBaseUnits(human, decimals) {
  return toBig(human) * 10n ** BigInt(decimals);
}

/**
 * Build the unsigned tx descriptor that deploys a new token via ERC20FactoryWizard
 * (or ERC20CloneFactory — same createToken signature). The wallet signs & broadcasts this.
 *
 * @param {{name,symbol,decimals?,supply,cap?,owner}} params  supply/cap in HUMAN units; owner = mintTo + role recipient.
 * @param {{factoryAddr, chainId?, decimals?}} opts
 * @returns {{ok:true,to,data,value,chainId,call}} | {ok:false,errors}
 */
export function buildCreateTokenTx(params, opts = {}) {
  const v = validateTokenParams(params);
  if (!v.ok) return { ok: false, errors: v.errors };

  const factoryAddr = opts.factoryAddr;
  if (!factoryAddr || !/^0x[0-9a-fA-F]{40}$/.test(String(factoryAddr))) {
    return { ok: false, errors: [`invalid factory address: ${factoryAddr}`] };
  }
  const owner = params.owner;
  if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(String(owner))) {
    return { ok: false, errors: ['owner (mint recipient) must be a 0x address'] };
  }

  const decimals = params.decimals == null || params.decimals === '' ? (opts.decimals || 18) : Number(params.decimals);
  const name = String(params.name).trim();
  const symbol = String(params.symbol).trim().toUpperCase();

  let initialMint;
  let cap;
  try {
    initialMint = toBaseUnits(params.supply, decimals);
    // cap: explicit human cap → base units; else uncapped (0). Wizard treats 0 as uncapped.
    cap = params.cap != null && params.cap !== '' ? toBaseUnits(params.cap, decimals) : 0n;
  } catch {
    return { ok: false, errors: ['supply/cap could not be converted to base units'] };
  }
  if (cap !== 0n && initialMint > cap) {
    return { ok: false, errors: ['supply (initial mint) exceeds cap'] };
  }

  const data = encodeCall(SELECTORS.createToken, [
    { t: 'string', v: name },
    { t: 'string', v: symbol },
    { t: 'uint', v: cap },
    { t: 'uint', v: initialMint },
    { t: 'address', v: owner },
  ]);

  return {
    ok: true,
    to: String(factoryAddr),
    data,
    value: '0x0',
    chainId: opts.chainId || PRANA_CHAIN_ID,
    call: { fn: 'createToken', selector: SELECTORS.createToken, name, symbol, cap, initialMint, mintTo: owner },
  };
}

/**
 * Build the unsigned tx descriptor that CLONES a contract onto PRANA via EIP-1167 minimal proxy.
 *
 * Two modes:
 *  A) Factory clone (recommended): pass {cloneFactoryAddr, initArgs:{name,symbol,supply,cap?,owner,decimals?}}.
 *     If initArgs.salt is set → createTokenDeterministic (counterfactual address), else createToken.
 *     This is how you "clone a contract from ETH/TRX onto PRANA": deploy a fresh EIP-1167 proxy of
 *     the shared ERC20Initializable implementation, atomically initialized in the same tx.
 *  B) Raw proxy init: pass {implementation, cloneFactoryAddr, initArgs} where the caller wants the
 *     literal initialize(...) calldata for an arbitrary implementation (returned as `initData`).
 *
 * @param {{implementation?, initArgs}} clone
 * @param {{cloneFactoryAddr, chainId?, decimals?}} opts
 * @returns {{ok:true,to,data,value,chainId,call,...}} | {ok:false,errors}
 */
export function buildCloneTx(clone, opts = {}) {
  const c = clone || {};
  const initArgs = c.initArgs || {};
  const factoryAddr = opts.cloneFactoryAddr;
  if (!factoryAddr || !/^0x[0-9a-fA-F]{40}$/.test(String(factoryAddr))) {
    return { ok: false, errors: [`invalid clone-factory address: ${factoryAddr}`] };
  }

  const v = validateTokenParams(initArgs);
  if (!v.ok) return { ok: false, errors: v.errors };

  const owner = initArgs.owner;
  if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(String(owner))) {
    return { ok: false, errors: ['owner must be a 0x address'] };
  }
  if (c.implementation != null && c.implementation !== '' && !/^0x[0-9a-fA-F]{40}$/.test(String(c.implementation))) {
    return { ok: false, errors: [`invalid implementation address: ${c.implementation}`] };
  }

  const decimals = initArgs.decimals == null || initArgs.decimals === '' ? (opts.decimals || 18) : Number(initArgs.decimals);
  const name = String(initArgs.name).trim();
  const symbol = String(initArgs.symbol).trim().toUpperCase();

  let initialMint;
  let cap;
  try {
    initialMint = toBaseUnits(initArgs.supply, decimals);
    cap = initArgs.cap != null && initArgs.cap !== '' ? toBaseUnits(initArgs.cap, decimals) : 0n;
  } catch {
    return { ok: false, errors: ['supply/cap could not be converted to base units'] };
  }
  if (cap !== 0n && initialMint > cap) return { ok: false, errors: ['supply exceeds cap'] };

  const salt = initArgs.salt;
  const deterministic = salt != null && salt !== '';

  let data;
  let call;
  if (deterministic) {
    data = encodeCall(SELECTORS.createTokenDeterministic, [
      { t: 'string', v: name },
      { t: 'string', v: symbol },
      { t: 'uint', v: cap },
      { t: 'uint', v: initialMint },
      { t: 'address', v: owner },
      { t: 'bytes32', v: salt },
    ]);
    call = { fn: 'createTokenDeterministic', selector: SELECTORS.createTokenDeterministic, name, symbol, cap, initialMint, mintTo: owner, salt };
  } else {
    data = encodeCall(SELECTORS.createToken, [
      { t: 'string', v: name },
      { t: 'string', v: symbol },
      { t: 'uint', v: cap },
      { t: 'uint', v: initialMint },
      { t: 'address', v: owner },
    ]);
    call = { fn: 'createToken', selector: SELECTORS.createToken, name, symbol, cap, initialMint, mintTo: owner };
  }

  const out = {
    ok: true,
    to: String(factoryAddr),
    data,
    value: '0x0',
    chainId: opts.chainId || PRANA_CHAIN_ID,
    call,
  };

  // Mode B helper: also expose the raw initialize() calldata for an explicit implementation,
  // so a caller doing a literal EIP-1167 proxy deploy can post-init it.
  if (c.implementation) {
    out.implementation = String(c.implementation);
    out.initData = encodeCall(SELECTORS.initialize, [
      { t: 'string', v: name },
      { t: 'string', v: symbol },
      { t: 'uint', v: cap },
      { t: 'address', v: owner },
    ]);
  }

  return out;
}

// ---- server-rendered "Create" tab form fragment ----------------------------

/**
 * Server-rendered HTML fragment for the portal's "Create" tab. Collects token params, builds the
 * descriptor client-side, and hands it to the connected wallet (Akasha / MetaMask) to sign.
 * esc() everything. The factory addresses are injected (read by the portal from kula-config).
 *
 * @param {{wizardAddr?, cloneFactoryAddr?, chainIdHex?}} cfg
 */
export function createTabFragment(cfg = {}) {
  const wizard = esc(cfg.wizardAddr || '');
  const cloneFactory = esc(cfg.cloneFactoryAddr || '');
  const chainIdHex = esc(cfg.chainIdHex || PRANA.chainIdHex || '0x1a751');
  const sel = JSON.stringify(SELECTORS);

  return `<div class=card>
  <div class=row><b>Create a Token</b><span class=dim>turnkey ERC-20 on PRANA — point, click, sign in your wallet</span></div>
  <p class=dim style="margin:.4rem 0">Your wallet signs the deploy. We never see your keys; we only build the transaction.</p>
  <div class=row style="margin:.3rem 0">
    <label class=dim style="display:flex;gap:.3rem;align-items:center"><input type=radio name=mode value=wizard checked> Full deploy (wizard)</label>
    <label class=dim style="display:flex;gap:.3rem;align-items:center"><input type=radio name=mode value=clone> Clone (EIP-1167, cheaper)</label>
  </div>
  <div class=row style="margin:.3rem 0"><input id=t_name placeholder="Token name (e.g. Melek Reward)" autocomplete=off style="flex:1"></div>
  <div class=row style="margin:.3rem 0"><input id=t_symbol placeholder="SYMBOL (2-11, A-Z 0-9)" autocomplete=off maxlength=11>
    <input id=t_decimals value="18" readonly title="PRANA ERC-20 is fixed at 18 decimals" style="width:5rem"></div>
  <div class=row style="margin:.3rem 0"><input id=t_supply placeholder="Initial supply (e.g. 1000000)" autocomplete=off>
    <input id=t_cap placeholder="Cap (blank = uncapped)" autocomplete=off></div>
  <div class=row style="margin:.3rem 0"><input id=t_owner placeholder="Owner / mint-to 0x address (auto-fills from wallet)" autocomplete=off style="flex:1"></div>
  <div class=row style="margin:.5rem 0"><button onclick=melekCreate()>Build &amp; sign in wallet</button>
    <button type=button onclick=melekConnect() style="background:#2c7be5;color:#fff">Connect wallet</button></div>
  <div id=t_out class=dim style="margin-top:.6rem"></div>
</div>
<script>
const WIZARD=${JSON.stringify(wizard)};
const CLONE_FACTORY=${JSON.stringify(cloneFactory)};
const CHAIN_HEX=${JSON.stringify(chainIdHex)};
const SEL=${sel};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ZERO='0x0000000000000000000000000000000000000000';
function _word(v){let h=BigInt(v).toString(16);return h.padStart(64,'0')}
function _addr(a){let h=String(a||ZERO).toLowerCase().replace(/^0x/,'');return h.padStart(64,'0')}
function _b32(b){let h=String(b||'').toLowerCase().replace(/^0x/,'');return h.padEnd(64,'0')}
function _utf8(s){const b=new TextEncoder().encode(String(s||''));let h='';for(const x of b)h+=x.toString(16).padStart(2,'0');return h}
function _strTail(s){const d=_utf8(s);const len=d.length/2;const pad=d.padEnd(Math.ceil(d.length/64)*64||0,'0');return _word(len)+pad}
function _encode(selector,args){const sel=selector.replace(/^0x/,'');const heads=[],tails=[];let off=args.length*32;
 for(const a of args){if(a.t==='string'){heads.push(_word(off));const t=_strTail(a.v);tails.push(t);off+=t.length/2}
 else if(a.t==='address')heads.push(_addr(a.v));else if(a.t==='bytes32')heads.push(_b32(a.v));else heads.push(_word(a.v))}
 return '0x'+sel+heads.join('')+tails.join('')}
async function melekConnect(){try{if(!window.ethereum){document.getElementById('t_out').textContent='No wallet found (install Akasha / MetaMask).';return}
 const acc=await window.ethereum.request({method:'eth_requestAccounts'});if(acc&&acc[0])document.getElementById('t_owner').value=acc[0];
 try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN_HEX}]})}catch(e){}
 document.getElementById('t_out').textContent='Wallet connected: '+(acc&&acc[0]||'?')}catch(e){document.getElementById('t_out').textContent='Connect failed: '+(e&&e.message||e)}}
async function melekCreate(){const out=document.getElementById('t_out');
 const mode=(document.querySelector('input[name=mode]:checked')||{}).value||'wizard';
 const name=document.getElementById('t_name').value.trim();
 const symbol=document.getElementById('t_symbol').value.trim().toUpperCase();
 const supplyH=document.getElementById('t_supply').value.trim();
 const capH=document.getElementById('t_cap').value.trim();
 const owner=document.getElementById('t_owner').value.trim();
 const errs=[];
 if(!name)errs.push('name required');
 if(!/^[A-Z0-9]{2,11}$/.test(symbol))errs.push('symbol 2-11 A-Z/0-9');
 if(!/^[0-9]+$/.test(supplyH)||BigInt(supplyH)<=0n)errs.push('supply must be a positive integer');
 if(capH&&(!/^[0-9]+$/.test(capH)))errs.push('cap must be a non-negative integer');
 if(!/^0x[0-9a-fA-F]{40}$/.test(owner))errs.push('owner must be a 0x address (Connect wallet)');
 if(errs.length){out.innerHTML='<span style="color:#e74c3c">'+errs.map(esc).join('; ')+'</span>';return}
 const scale=10n**18n;const initialMint=BigInt(supplyH)*scale;const cap=capH?BigInt(capH)*scale:0n;
 if(cap!==0n&&initialMint>cap){out.innerHTML='<span style="color:#e74c3c">supply exceeds cap</span>';return}
 const to=mode==='clone'?CLONE_FACTORY:WIZARD;
 if(!/^0x[0-9a-fA-F]{40}$/.test(to)){out.innerHTML='<span style="color:#e74c3c">factory not configured for this mode</span>';return}
 const data=_encode(SEL.createToken,[{t:'string',v:name},{t:'string',v:symbol},{t:'uint',v:cap},{t:'uint',v:initialMint},{t:'address',v:owner}]);
 if(!window.ethereum){out.textContent='No wallet found (install Akasha / MetaMask).';return}
 out.innerHTML='Confirm in your wallet…';
 try{const tx=await window.ethereum.request({method:'eth_sendTransaction',params:[{from:owner,to:to,data:data,value:'0x0'}]});
  out.innerHTML='Submitted ✓ tx '+esc(tx)+' — your token deploys when it confirms.'}
 catch(e){out.innerHTML='<span style="color:#e74c3c">'+esc(e&&e.message||String(e))+'</span>'}}
</script>`;
}

export default {
  PRANA_CHAIN_ID,
  SELECTORS,
  esc,
  encodeCall,
  validateTokenParams,
  buildCreateTokenTx,
  buildCloneTx,
  createTabFragment,
};
