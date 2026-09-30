"""test_sd_pool.py — OFFLINE. The pull lane is closed by default; when open, a runner takes a background job, posts
the result, and the client sees it done; customer jobs never go to the lane; the GPU puller loop exits on a closed lane.
  python -m unittest integrations/test_sd_pool.py
"""
import importlib, io, json, os, sys, threading, unittest, urllib.request
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, "gpu"))


def load_pool(enabled):
    os.environ.update(SD_POOL_BACKENDS="[]", SD_POOL_TOKEN="client-token", SD_POOL_PULL_ENABLED="1" if enabled else "0", SD_POOL_PULL_TOKEN="pull-token")
    import sd_pool
    return importlib.reload(sd_pool)


def serve(mod):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), mod.H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def req(url, method="GET", body=None, token="client-token"):
    r = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                               headers={"authorization": f"Bearer {token}", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, (json.loads(resp.read() or b"{}") if resp.status != 204 else None)
    except urllib.error.HTTPError as e:
        return e.code, None


class PoolLane(unittest.TestCase):
    def test_lane_closed_by_default(self):
        mod = load_pool(False); srv, u = serve(mod)
        try:
            self.assertEqual(req(u + "/pull", "POST", {"name": "k"}, token="pull-token")[0], 401)
        finally:
            srv.shutdown()

    def test_background_job_round_trip_and_customer_jobs_stay_home(self):
        mod = load_pool(True); srv, u = serve(mod)
        try:
            self.assertEqual(req(u + "/pull", "POST", {"name": "kaggle"}, token="pull-token")[0], 204)   # heartbeat, empty
            code, r = req(u + "/jobs", "POST", {"prompt": "a jar", "priority": "low"})
            self.assertEqual(code, 202); self.assertTrue(r["id"].startswith("p~"))
            code, cust = req(u + "/jobs", "POST", {"prompt": "customer"})                             # no CPU backends
            self.assertEqual(code, 503)                                                               # never the lane
            code, got = req(u + "/pull", "POST", {"name": "kaggle"}, token="pull-token")
            self.assertEqual(got["job"]["body"]["prompt"], "a jar")
            self.assertEqual(req(u + f"/done/{got['job']['id']}", "POST", {"result": {"ok": True, "base64": "AA=="}}, token="pull-token")[0], 200)
            code, st = req(u + f"/jobs/{r['id']}")
            self.assertEqual(st["status"], "done"); self.assertTrue(st["result"]["ok"])
            self.assertEqual(req(u + "/pull", "POST", {"name": "x"}, token="wrong")[0], 401)
        finally:
            srv.shutdown()

    def test_puller_exits_on_closed_lane(self):
        mod = load_pool(False); srv, u = serve(mod)
        try:
            import gpu_puller
            gpu_puller.POOL, gpu_puller.TOKEN = u, "pull-token"
            made = gpu_puller.run(render_fn=lambda j: {"ok": True}, norm_fn=lambda b: b, sleep=lambda s: None)
            self.assertEqual(made, 0)
        finally:
            srv.shutdown()


if __name__ == "__main__":
    unittest.main()
