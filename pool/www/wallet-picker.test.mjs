// wallet-picker.test.mjs — the pure model + storage memory + DOM rendering (fake doc).
import { test } from 'node:test';
import assert from 'node:assert';
import {
  pickerModel, shortAddr, lastChoices, rememberChoice, renderPicker, mountPicker,
} from './wallet-picker.mjs';

// in-memory localStorage stub
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

// minimal fake DOM: enough for renderPicker/mountPicker
function fakeEl(tag) {
  return {
    tagName: tag, children: [], attrs: {}, listeners: {},
    className: '', textContent: '', innerHTML: '', title: '', href: '', type: '', value: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    appendChild(c) { this.children.push(c); return c; },
    click() { (this.listeners.click || []).forEach((f) => f()); },
  };
}
const fakeDoc = () => ({ createElement: (t) => fakeEl(t) });

const CHAINS = [
  { coin: 'monero', symbol: 'XMR', name: 'Monero' },
  { coin: 'zephyr', symbol: 'ZEPH', name: 'Zephyr' },
  { coin: 'ethereum_classic', symbol: 'ETC', match: ['evm'] },
];

test('saved wallets become selectable chips; missing chains grey out to the wallet page', () => {
  const m = pickerModel({
    chains: CHAINS,
    records: [{ coin: 'monero', address: '4'.padEnd(95, 'a') }],
  });
  const xmr = m.chips.find((c) => c.coin === 'monero');
  const zeph = m.chips.find((c) => c.coin === 'zephyr');
  assert.equal(xmr.have, true);
  assert.equal(xmr.selected, true); // the only saved wallet is auto-selected
  assert.equal(zeph.have, false);
  assert.equal(zeph.href, '/wallet/?coin=zephyr');
  assert.match(zeph.text, /make this wallet/);
});

test('match keys let a generic evm record satisfy the ETC chain', () => {
  const m = pickerModel({
    chains: CHAINS,
    records: [{ coin: 'evm', address: '0x' + 'b'.repeat(40) }],
  });
  const etc = m.chips.find((c) => c.coin === 'ethereum_classic');
  assert.equal(etc.have, true);
});

test('the remembered wallet wins the selection on return visits', () => {
  const a1 = '4' + 'a'.repeat(94); const a2 = '4' + 'b'.repeat(94);
  const m = pickerModel({
    chains: [CHAINS[0]],
    records: [{ coin: 'monero', address: a1 }, { coin: 'monero', address: a2 }],
    lastUsed: { monero: a2 },
  });
  assert.equal(m.selected.address, a2);
  assert.equal(m.chips.filter((c) => c.selected).length, 1);
});

test('rememberChoice/lastChoices round-trip per coin (soft-fail without storage)', () => {
  const s = memStorage();
  rememberChoice('monero', '4abc', s);
  rememberChoice('zephyr', 'ZEPHsXYZ', s);
  assert.deepEqual(lastChoices(s), { monero: '4abc', zephyr: 'ZEPHsXYZ' });
  assert.deepEqual(lastChoices({ getItem: () => { throw new Error('x'); } }), {});
  rememberChoice('monero', '4abc', null); // no storage → no throw
});

test('shortAddr keeps short strings, shortens long ones', () => {
  assert.equal(shortAddr('0xabc'), '0xabc');
  const long = '4' + 'a'.repeat(94);
  assert.match(shortAddr(long), /^4aaaaaa…aaaa$/);
});

test('renderPicker: saved → button with data-address, missing → grey link', () => {
  const host = fakeEl('div');
  const m = pickerModel({ chains: CHAINS, records: [{ coin: 'monero', address: '4' + 'a'.repeat(94) }] });
  renderPicker(host, m, { doc: fakeDoc() });
  const btn = host.children.find((c) => c.tagName === 'button');
  const link = host.children.find((c) => c.tagName === 'a' && c.attrs['data-coin'] === 'zephyr');
  assert.ok(btn && btn.attrs['data-address']);
  assert.match(link.className, /wp-missing/);
  assert.equal(link.href, '/wallet/?coin=zephyr');
});

test('renderPicker: tile grid — container is wp-grid, tiles carry wp-tile + a big symbol', () => {
  const host = fakeEl('div');
  const m = pickerModel({ chains: CHAINS, records: [{ coin: 'monero', address: '4' + 'a'.repeat(94) }] });
  renderPicker(host, m, { doc: fakeDoc(), onOwn: () => {} });
  // the host becomes a grid, not the old thin row
  assert.equal(host.className, 'wp-grid');
  // every rendered tile is a card (wp-tile) and shows its symbol + name + subtext as child spans
  const xmr = host.children.find((c) => c.attrs['data-coin'] === 'monero');
  assert.match(xmr.className, /wp-tile/);
  const sym = xmr.children.find((c) => /wp-sym/.test(c.className));
  const sub = xmr.children.find((c) => /wp-sub/.test(c.className));
  assert.equal(sym.textContent, 'XMR');
  assert.match(sub.textContent, /…/); // shortened address as subtext
  // the missing tile's subtext is the "+ make this wallet" call to action
  const zeph = host.children.find((c) => c.attrs['data-coin'] === 'zephyr');
  assert.match(zeph.className, /wp-tile wp-missing/);
  assert.match(zeph.children.find((c) => /wp-sub/.test(c.className)).textContent, /make this wallet/);
  // "use my own wallet" is a small secondary tile, not the primary path
  const own = host.children.find((c) => /wp-own/.test(c.className));
  assert.ok(own, 'own-wallet tile present');
  assert.match(own.className, /wp-tile/);
});

test('mountPicker auto-fills the input with the selected wallet but never overwrites typing', () => {
  const addr = '4' + 'c'.repeat(94);
  const store = { list: () => [{ coin: 'monero', address: addr }] };
  const host = fakeEl('div'); const input = fakeEl('input');
  const p = mountPicker({ host, input, chains: [CHAINS[0]], store, storage: memStorage(), doc: fakeDoc() });
  assert.equal(input.value, addr);
  // typed value is preserved on refresh
  input.value = 'typed-by-hand';
  p.refresh();
  assert.equal(input.value, 'typed-by-hand');
});

test('mountPicker: clicking a chip fills the input and remembers the choice', () => {
  const a1 = '4' + 'd'.repeat(94); const a2 = '4' + 'e'.repeat(94);
  const store = { list: () => [{ coin: 'monero', address: a1 }, { coin: 'monero', address: a2 }] };
  const host = fakeEl('div'); const input = fakeEl('input');
  const storage = memStorage();
  mountPicker({ host, input, chains: [CHAINS[0]], store, storage, doc: fakeDoc() });
  // click the second chip (not auto-selected)
  const chip2 = host.children.find((c) => c.attrs && c.attrs['data-address'] === a2);
  chip2.click();
  assert.equal(input.value, a2);
  assert.equal(lastChoices(storage).monero, a2);
});

test('mountPicker soft-fails to null with no DOM/host and on a broken store', () => {
  assert.equal(mountPicker({}), null);
  const host = fakeEl('div'); const input = fakeEl('input');
  const p = mountPicker({
    host, input, chains: CHAINS,
    store: { list: () => { throw new Error('broken'); } },
    storage: memStorage(), doc: fakeDoc(),
  });
  assert.ok(p); // renders the make-wallet chips instead of throwing
  // every chip is a make-wallet link, except the always-present "use my own wallet" button
  assert.ok(host.children.every((c) => c.tagName === 'a' || /wp-own/.test(c.className)));
});

test('gated chain: missing wallet → grey make-wallet; existing wallet → informational, never selectable', () => {
  const gatedChains = [
    { coin: 'monero', symbol: 'XMR' },
    { coin: 'zephyr', symbol: 'ZEPH', gated: true },
  ];
  const none = pickerModel({ chains: gatedChains, records: [{ coin: 'monero', address: '4' + 'a'.repeat(94) }] });
  assert.match(none.chips.find((c) => c.coin === 'zephyr').text, /make this wallet/);
  const withZeph = pickerModel({
    chains: gatedChains,
    records: [
      { coin: 'monero', address: '4' + 'a'.repeat(94) },
      { coin: 'zephyr', address: 'ZEPHs' + 'x'.repeat(93) },
    ],
  });
  const z = withZeph.chips.find((c) => c.coin === 'zephyr');
  assert.equal(z.gated, true);
  assert.match(z.text, /wallet ready/);
  assert.equal(withZeph.selected.coin, 'monero'); // gated never wins selection
});

test('renderPicker renders gated chips as non-clickable spans', () => {
  const host = fakeEl('div');
  const m = pickerModel({
    chains: [{ coin: 'zephyr', symbol: 'ZEPH', gated: true }],
    records: [{ coin: 'zephyr', address: 'ZEPHs' + 'x'.repeat(93) }],
  });
  renderPicker(host, m, { doc: fakeDoc() });
  assert.equal(host.children[0].tagName, 'span');
  assert.match(host.children[0].className, /wp-gated/);
});

test('"use my own wallet" button renders, clears the input, and saveOwn persists it as a chip', () => {
  const records = [];
  const store = { list: () => records.slice(), add: (r) => { records.push(r); return r; } };
  const host = fakeEl('div'); const input = fakeEl('input');
  input.focus = () => {};
  const p = mountPicker({ host, input, chains: [CHAINS[0]], store, storage: memStorage(), doc: fakeDoc() });
  const ownBtn = host.children.find((c) => /wp-own/.test(c.className));
  assert.ok(ownBtn, 'own-wallet button present');
  input.value = 'leftover';
  ownBtn.click();
  assert.equal(input.value, '');
  // they paste an address and it gets used → saved → appears as a chip
  const myAddr = '4' + 'z'.repeat(94);
  assert.equal(p.saveOwn('monero', myAddr), true);
  assert.equal(records.length, 1);
  assert.equal(records[0].label, 'my wallet');
  assert.ok(host.children.some((c) => c.attrs && c.attrs['data-address'] === myAddr));
  // saving the same address again does not duplicate
  p.saveOwn('monero', myAddr);
  assert.equal(records.length, 1);
});

test('mountPicker: the onOwn hook fires (page reveals the hidden address box) before the input is cleared/focused', () => {
  const store = { list: () => [] };
  const host = fakeEl('div'); const input = fakeEl('input');
  let revealed = false;
  input.focus = () => { assert.equal(revealed, true, 'box is revealed before it is focused'); };
  mountPicker({
    host, input, chains: [CHAINS[0]], store, storage: memStorage(), doc: fakeDoc(),
    onOwn: () => { revealed = true; },
  });
  const ownBtn = host.children.find((c) => /wp-own/.test(c.className));
  ownBtn.click();
  assert.equal(revealed, true, 'onOwn ran');
  assert.equal(input.value, '');
});
