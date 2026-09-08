// site/hathor-live/participant-key.mjs — identity without identification.
//
// THE PROBLEM THIS SOLVES. Within-subject comparison is the entire scientific value of the Temple
// Exams: you sober against you tired, not you against a stranger. That requires knowing Tuesday's
// taker and Friday's taker are the same person. It does not require knowing who they are, and every
// route that learns who they are is a route that can leak.
//
// THE ANSWER. A key generated in the participant's own browser from `crypto.getRandomValues`, held
// in localStorage, and shown to them as something they can write down and re-enter on another
// device. Same shape as the pool's in-browser walletgen: the institution never holds the mapping
// because the mapping was never made. No email, no account, no name.
//
// AND NOTHING FROM THESE EXAMS GOES ON CHAIN. A pseudonym on a public ledger is permanent and
// globally readable, so a chain-side participant id would make every entry public forever — which
// is exactly the harm .local/TEMPLE_EXAMS_SAFETY_GATE.md §4 forbids for disclosures. The chain may
// see a boolean, at most, and nothing here emits one.
//
// WHAT THE SERVER STORES. Not the key — its salted hash. `participantId()` is one-way, so a copy of
// the data file cannot be replayed against a person who still holds their key, and the store cannot
// be used to check whether a guessed key exists without doing the same work an attacker would.
//
// DELETION. A person holding their key can delete their whole record. A person who lost it cannot,
// and the consent text says so IN ADVANCE rather than promising a deletion that cannot be performed.
//
// Offline, no network, soft-fail. esc() lives in melek-theme.

import { createHash } from 'node:crypto';

/**
 * Crockford base32: no I, L, O or U. I/L/O are dropped because they are misread as 1/1/0 when
 * copied off paper — which is the whole point of a key you write down — and U is dropped so the
 * alphabet cannot spell the more common obscenities by accident.
 */
export const KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const KEY_GROUP_LEN = 5;
export const KEY_GROUPS = 5;
/** 25 symbols × 5 bits = 125 bits of entropy. Not a wallet, but far past guessable. */
export const KEY_LENGTH = KEY_GROUP_LEN * KEY_GROUPS;
export const KEY_BITS = KEY_LENGTH * 5;

// Domain separator, so a participant id from this battery can never collide with, or be looked up
// against, an id derived from the same key anywhere else in the ecosystem.
const HASH_DOMAIN = 'melek/temple-exams/participant/v1';

/**
 * Fold the ambiguous glyphs the way Crockford specifies, drop everything else, upper-case.
 * A person typing their key off a scrap of paper gets O for 0 and l for 1; refusing that would be
 * a data-loss bug wearing a validation costume.
 */
export function normalizeKey(input) {
  return String(input == null ? '' : input)
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V')
    .split('')
    .filter((c) => KEY_ALPHABET.includes(c))
    .join('');
}

export function isValidKey(input) {
  return normalizeKey(input).length === KEY_LENGTH;
}

/** Group for display: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX. Easier to read back off paper. */
export function formatKey(input) {
  const k = normalizeKey(input);
  if (!k) return '';
  return (k.match(/.{1,5}/g) || []).join('-');
}

// injectable hash, so the offline suite can assert the store never sees a raw key without
// depending on a particular digest.
let _hash = null;
export function __setHash(fn) { _hash = typeof fn === 'function' ? fn : null; }

/**
 * The storage id: a one-way function of the key. Never reversible, never logged next to the key,
 * and never shown to the participant (they hold the key; the id is the server's business).
 *
 * Returns '' for anything that is not a valid key, which callers must treat as "refuse", never as
 * "store it anonymously" — an entry with no participant id cannot be deleted by its owner.
 */
export function participantId(key) {
  if (!isValidKey(key)) return '';
  const k = normalizeKey(key);
  if (_hash) return String(_hash(`${HASH_DOMAIN}:${k}`) || '');
  try {
    return createHash('sha256').update(`${HASH_DOMAIN}:${k}`).digest('hex');
  } catch {
    return '';
  }
}

/**
 * The browser-side generator, as a string, so the page and this module can never disagree about the
 * alphabet or the length. It is deliberately tiny and deliberately has no network call in it.
 *
 * Read it before you ship it: it must never POST the key anywhere. The key goes to the server only
 * inside a submission the participant chose to make, and the server hashes it on arrival.
 */
export const KEYGEN_JS = `
// Temple Exams participant key — generated HERE, in your browser. Never sent anywhere on its own.
var TE_ALPHABET=${JSON.stringify(KEY_ALPHABET)}, TE_LEN=${KEY_LENGTH}, TE_STORE='melek.temple-exams.key';
function teNormalize(s){
  return String(s==null?'':s).toUpperCase()
    .replace(/O/g,'0').replace(/[IL]/g,'1').replace(/U/g,'V')
    .split('').filter(function(c){return TE_ALPHABET.indexOf(c)>=0;}).join('');
}
function teFormat(k){ return (teNormalize(k).match(/.{1,5}/g)||[]).join('-'); }
function teGenerate(){
  var out='', bytes=new Uint8Array(TE_LEN);
  (window.crypto||window.msCrypto).getRandomValues(bytes);
  // Rejection-free is not needed here: 32 divides 256 exactly, so the modulo is unbiased.
  for(var i=0;i<TE_LEN;i++) out+=TE_ALPHABET[bytes[i]%32];
  return out;
}
function teKey(){
  var k='';
  try{ k=teNormalize(localStorage.getItem(TE_STORE)||''); }catch(e){ k=''; }
  if(k.length!==TE_LEN){ k=teGenerate(); try{ localStorage.setItem(TE_STORE,k); }catch(e){} }
  return k;
}
function teSetKey(s){
  var k=teNormalize(s);
  if(k.length!==TE_LEN) return null;
  try{ localStorage.setItem(TE_STORE,k); }catch(e){}
  return k;
}
function teForget(){ try{ localStorage.removeItem(TE_STORE); }catch(e){} }
`;

export default { KEY_ALPHABET, KEY_LENGTH, KEY_BITS, normalizeKey, isValidKey, formatKey, participantId, KEYGEN_JS };
