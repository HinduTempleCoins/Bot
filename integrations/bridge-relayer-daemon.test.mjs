// bridge-relayer-daemon.test.mjs — the daemon is a thin ethers edge over the (separately tested)
// runner; here we just confirm the edge adapter constructs without network + returns a submit fn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEthersSubmit } from './bridge-relayer-daemon.mjs';

test('makeEthersSubmit returns a submit(call) function (no network at construction)', () => {
  const submit = makeEthersSubmit({
    pranaRpc: 'https://rpc.example', bridgeAddress: '0x' + 'a'.repeat(40), attesterKey: '0x' + '1'.repeat(64),
  });
  assert.equal(typeof submit, 'function');
});
