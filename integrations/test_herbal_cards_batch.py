"""test_herbal_cards_batch.py — OFFLINE. Jobs go out as priority low, never more than --inflight at once, wait while
customers are queued, save PNG + sidecar + ledger, skip finished files, retry an error once.
  python -m unittest integrations/test_herbal_cards_batch.py
"""
import base64, json, os, shutil, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import herbal_cards_batch as hb

SCRATCH = os.path.join(HERE, ".test-herbal-cards")
PNG = base64.b64encode(b"\x89PNG fake").decode()
CARDS = [{"id": f"c{i}", "prompts": {"ours": {"prompt": f"p{i} ours", "style": "art-nouveau"},
                                     "pinterest": {"prompt": f"p{i} pin", "style": "herbarium"}}} for i in range(3)]


class FakePool:
    def __init__(self, customers=0, fail_first=False):
        self.jobs, self.seq, self.max_open, self.customers, self.fail_first, self.bodies = {}, 0, 0, customers, fail_first, []

    def __call__(self, method, path, body=None):
        if path == "/health":
            q = self.customers
            self.customers = max(0, self.customers - 1)
            return 200, {"ok": True, "queued": q}
        if method == "POST":
            self.seq += 1
            jid = f"0~{self.seq}"
            self.jobs[jid] = 0
            self.bodies.append(body)
            self.max_open = max(self.max_open, len(self.jobs))
            return 202, {"ok": True, "id": jid, "position": 0, "backend": "worker"}
        jid = path.split("/jobs/")[1]
        self.jobs[jid] += 1
        if self.jobs[jid] < 2:
            return 200, {"ok": True, "status": "running"}
        del self.jobs[jid]
        if self.fail_first and jid == "0~1":
            return 200, {"ok": True, "status": "error", "result": {"ok": False, "error": "render failed"}}
        return 200, {"ok": True, "status": "done", "result": {"ok": True, "base64": PNG, "seed": 1, "ms": 5}}


class T(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(SCRATCH, ignore_errors=True)

    def tearDown(self):
        shutil.rmtree(SCRATCH, ignore_errors=True)

    def test_low_priority_capped_and_saved(self):
        pool = FakePool(customers=2)
        r = hb.run(CARDS, SCRATCH, pool, inflight=2, sleep=lambda s: None)
        self.assertEqual(r, {"done": 6, "failed": 0, "left": 0})
        self.assertLessEqual(pool.max_open, 2)
        self.assertTrue(all(b["priority"] == "low" for b in pool.bodies))
        self.assertTrue(os.path.exists(os.path.join(SCRATCH, "c0__ours.png")))
        side = json.load(open(os.path.join(SCRATCH, "c0__pinterest.json")))
        self.assertEqual(side["style"], "herbarium")
        events = [json.loads(l)["event"] for l in open(os.path.join(SCRATCH, "ledger.jsonl"))]
        self.assertEqual(events.count("submitted"), 6)
        # re-run: everything is finished, nothing is submitted
        pool2 = FakePool()
        self.assertEqual(hb.run(CARDS, SCRATCH, pool2, sleep=lambda s: None)["done"], 0)
        self.assertEqual(pool2.seq, 0)

    def test_error_retried_once(self):
        pool = FakePool(fail_first=True)
        r = hb.run(CARDS[:1], SCRATCH, pool, inflight=1, sleep=lambda s: None)
        self.assertEqual(r["done"], 2)
        self.assertEqual(pool.seq, 3)

    def test_pause_flag_holds_submits(self):
        flag = os.path.join(HERE, ".test-herbal-pause")
        open(flag, "w").close()
        try:
            pool = FakePool()
            r = hb.run(CARDS[:1], SCRATCH, pool, pause_file=flag, sleep=lambda s: None, max_loops=5)
            self.assertEqual(pool.seq, 0)
            self.assertEqual(r["left"], 2)
        finally:
            os.remove(flag)


if __name__ == "__main__":
    unittest.main()
