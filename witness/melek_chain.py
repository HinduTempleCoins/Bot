#!/usr/bin/env python3
"""melek_chain.py — MELEK chain op construction + serialization on the CANONICAL Graphene/Steem
stack (beem / python-graphenelib), configured for MELEK.

WHY THIS EXISTS: our JS chain client (@hiveio/dhive) MIS-SERIALIZES `witness_update` on this
Steem fork — we had been working around it with the chain's cli_wallet. beem (the maintained
successor to xeroc's python-steem, built on python-graphenelib's serialization base) serializes
Steem-family ops CORRECTLY. Verified: this module produces `witness_update` bytes that are
BYTE-FOR-BYTE IDENTICAL to the chain's own serializer (condenser_api.get_transaction_hex) — see
GOLDEN below and `--selftest`. So MELEK does witness ops via the lib the chain format's authors
wrote, not the JS client that gets it wrong.

KEY CUSTODY (zero-WIF, BRIEF.md §7): this module ONLY CONSTRUCTS + SERIALIZES ops. It holds no
key, never signs, never broadcasts. Signing is the MELEK-Signer's job (KMS-wrapped, separate host).
Correct serialization is the keyless half — and the half dhive got wrong.

Setup:  pip install beem
Use:    python3 witness/melek_chain.py --selftest        # offline golden-hex check (no network)
        python3 witness/melek_chain.py --verify-live      # serialize vs the live chain (ground truth)
"""
from __future__ import annotations
import json
import sys
import urllib.request

# MELEK chain config (public chain params — from the node's get_config, no secrets).
MELEK_TESTNET = {
    "chain_id": "18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e",
    "min_version": "0.0.0",
    "prefix": "TST",
    "chain_assets": [
        {"asset": "@@000000013", "symbol": "TBD", "precision": 3, "id": 0},
        {"asset": "@@000000021", "symbol": "TESTS", "precision": 3, "id": 1},
        {"asset": "@@000000037", "symbol": "VESTS", "precision": 6, "id": 2},
    ],
}
# Mainnet: same shape with prefix MELEK + symbols MELEK/MBD; chain_id set at mainnet genesis (TODO).
TESTNET_RPC = "https://alpha.melek.salon/rpc"

# Golden serialization of the witness_update OPERATION below, as produced by the CHAIN ITSELF
# (condenser_api.get_transaction_hex, op portion). beem must reproduce this exactly. 119 bytes.
GOLDEN_WITNESS_UPDATE_OP = "0b06686174686f722768747470733a2f2f6769746875622e636f6d2f48696e647554656d706c65436f696e732f426f7402be643d4c424ac7cf2f3cf51dd048773cbdcee30b111adb30d89c27668c5017050100000000000000035445535453000000000100000000000000000000000354455354530000"
SAMPLE_WITNESS_UPDATE = {
    "owner": "hathor",
    "url": "https://github.com/HinduTempleCoins/Bot",
    "block_signing_key": "TST6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4",
    "props": {"account_creation_fee": "0.001 TESTS", "maximum_block_size": 65536, "sbd_interest_rate": 0},
    "fee": "0.000 TESTS",
}


def _register(chain=MELEK_TESTNET):
    """Register MELEK with beem so its serializer uses the TST prefix + TESTS/TBD assets."""
    from beemgraphenebase.chains import known_chains
    known_chains["MELEK"] = chain
    return chain


def serialize_witness_update(fields=SAMPLE_WITNESS_UPDATE, chain=MELEK_TESTNET) -> str:
    """Serialize a witness_update OPERATION to hex via beem, configured for MELEK. Keyless.
    Byte-identical to the chain's own serializer (see --selftest / --verify-live)."""
    _register(chain)
    from beembase.operations import Witness_update
    from beembase.objects import Operation
    op = Witness_update(prefix=chain["prefix"], **fields)
    return bytes(Operation(op)).hex()


def chain_op_hex(fields=SAMPLE_WITNESS_UPDATE, rpc=TESTNET_RPC) -> str:
    """Ground truth: ask the chain to serialize a tx carrying this op, return the op portion."""
    tx = {"ref_block_num": 1234, "ref_block_prefix": 5678, "expiration": "2026-06-09T20:00:00",
          "operations": [["witness_update", fields]], "extensions": [], "signatures": []}
    req = urllib.request.Request(rpc, json.dumps(
        {"jsonrpc": "2.0", "method": "condenser_api.get_transaction_hex", "params": [tx], "id": 1}
    ).encode(), {"content-type": "application/json"})
    full = json.load(urllib.request.urlopen(req, timeout=15))["result"]
    return full[22:-4]  # strip tx envelope (ref+prefix+exp+opcount = 11B) + extensions+signatures (2B)


def _selftest() -> int:
    got = serialize_witness_update()
    ok = got == GOLDEN_WITNESS_UPDATE_OP
    print("beem  :", got)
    print("golden:", GOLDEN_WITNESS_UPDATE_OP)
    print("MATCH (beem serializes MELEK witness_update == chain golden):", ok)
    return 0 if ok else 1


def _verify_live() -> int:
    beem_hex, chain_hex = serialize_witness_update(), chain_op_hex()
    ok = beem_hex == chain_hex
    print("beem :", beem_hex)
    print("chain:", chain_hex)
    print("MATCH (beem == live chain serializer):", ok)
    return 0 if ok else 1


if __name__ == "__main__":
    if "--verify-live" in sys.argv:
        sys.exit(_verify_live())
    sys.exit(_selftest())
