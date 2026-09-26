"""Offline tests for genai_cpu_worker.py — the pipeline is faked; no torch, no model download, no network."""
import base64, io, json, os, sys, threading, time, unittest, urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(__file__))
import genai_cpu_worker as w
from PIL import Image


class FakePipe:
    def __init__(self):
        self.calls, self.scales = [], []

    def set_ip_adapter_scale(self, s):
        self.scales.append(s)

    def __call__(self, **kw):
        self.calls.append(kw)

        class R:
            images = [Image.new("RGB", (kw["width"], kw["height"]), (218, 174, 207))]
        return R()


FAKE = FakePipe()
w.set_loader(lambda: FAKE)
SFAKE = FakePipe()
SKINDS = []
w.set_structure_loader(lambda base, kinds: (SKINDS.append(tuple(kinds)), SFAKE)[1])


def ref_b64():
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), (10, 10, 10)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


class NormJob(unittest.TestCase):
    def test_defaults_and_clamps(self):
        j = w.norm_job({"prompt": "  a   goddess ", "steps": 50, "size": "2000x100", "strength": 9})
        self.assertEqual(j["prompt"], "a goddess")
        self.assertEqual(j["steps"], 6)
        self.assertEqual((j["w"], j["h"]), (768, 256))
        self.assertEqual(j["strength"], 0.6)
        self.assertIsNone(j["image_b64"])

    def test_empty_prompt_soft_fails(self):
        self.assertFalse(w.generate_sync({"prompt": ""})["ok"])
        self.assertFalse(w.submit_job({"prompt": ""})["ok"])


class Render(unittest.TestCase):
    def test_txt2img_turns_ip_adapter_off(self):
        r = w.generate_sync({"prompt": "Carthage harbor", "seed": 7, "size": "512x512"})
        self.assertTrue(r["ok"]); self.assertEqual(r["mode"], "txt2img")
        self.assertEqual(FAKE.scales[-1], 0.0)
        self.assertEqual(FAKE.calls[-1]["width"], 512)
        Image.open(io.BytesIO(base64.b64decode(r["base64"])))  # a real PNG came back

    def test_reference_image_is_character_mode(self):
        r = w.generate_sync({"prompt": "her at the pyramids", "image": {"base64": ref_b64()}, "strength": 0.5})
        self.assertEqual(r["mode"], "character")
        self.assertEqual(FAKE.scales[-1], 0.5)
        self.assertEqual(FAKE.calls[-1]["ip_adapter_image"].size, (32, 32))

    def test_several_references_are_passed_together(self):
        r = w.generate_sync({"prompt": "her wearing the crown", "images": [{"base64": ref_b64()}, {"base64": ref_b64()}]})
        self.assertEqual(r["mode"], "compose")
        refs = FAKE.calls[-1]["ip_adapter_image"]
        self.assertEqual(len(refs), 1); self.assertEqual(len(refs[0]), 2)   # one adapter, two images

    def test_character_hathor_uses_canonical_ref(self):
        tmp = os.path.join(os.path.dirname(__file__), "_tmp_ref.png")
        Image.new("RGB", (40, 40)).save(tmp)
        old = w.HATHOR_REF
        w.HATHOR_REF = tmp
        try:
            r = w.generate_sync({"prompt": "Hathor at Carthage", "character": "hathor"})
            self.assertEqual(r["mode"], "character")
            self.assertEqual(FAKE.calls[-1]["ip_adapter_image"].size, (40, 40))
        finally:
            w.HATHOR_REF = old
            os.remove(tmp)


class Remake(unittest.TestCase):
    def src_b64(self, size=(600, 300)):
        im = Image.new("RGB", size, (240, 220, 180))
        for x in range(100, 200):
            for y in range(50, 250):
                im.putpixel((x, y), (20, 20, 20))
        buf = io.BytesIO(); im.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()

    def test_structure_uses_controlnet_and_keeps_source_aspect(self):
        r = w.generate_sync({"prompt": "banquet ladies, realistic", "structure": {"base64": self.src_b64()}})
        self.assertTrue(r["ok"]); self.assertEqual(r["mode"], "remake")
        kw = SFAKE.calls[-1]
        self.assertEqual((kw["width"], kw["height"]), (768, 384))
        self.assertEqual(kw["image"].size, (768, 384))
        self.assertEqual(kw["controlnet_conditioning_scale"], 0.8)
        self.assertGreater(max(kw["image"].convert("L").getdata()), 0)  # edges were found

    def test_structure_with_reference_and_scale_clamp(self):
        r = w.generate_sync({"prompt": "x", "structure": {"base64": self.src_b64()}, "structureScale": 9,
                             "image": {"base64": ref_b64()}, "size": "512x512"})
        self.assertEqual(r["mode"], "remake+character")
        self.assertEqual((SFAKE.calls[-1]["width"], SFAKE.calls[-1]["controlnet_conditioning_scale"]), (512, 0.8))

    def test_pose_alone_and_with_structure(self):
        pose = self.src_b64((400, 800))
        r = w.generate_sync({"prompt": "a dancer", "pose": {"base64": pose}})
        self.assertEqual(r["mode"], "pose")
        kw = SFAKE.calls[-1]
        self.assertEqual((kw["width"], kw["height"]), (384, 768))      # pose map's proportions
        self.assertEqual(kw["controlnet_conditioning_scale"], 1.0)
        self.assertEqual(SKINDS[-1], ("pose",))
        r = w.generate_sync({"prompt": "banquet", "structure": {"base64": self.src_b64()}, "pose": {"base64": pose}, "poseScale": 0.9})
        self.assertEqual(r["mode"], "remake+pose")
        kw = SFAKE.calls[-1]
        self.assertEqual(SKINDS[-1], ("canny", "pose"))
        self.assertEqual(kw["controlnet_conditioning_scale"], [0.8, 0.9])
        self.assertEqual(len(kw["image"]), 2)

    def test_plain_jobs_do_not_touch_controlnet(self):
        n = len(SFAKE.calls)
        w.generate_sync({"prompt": "plain"})
        self.assertEqual(len(SFAKE.calls), n)


class Priority(unittest.TestCase):
    def test_customer_jobs_jump_background_batches(self):
        order = []
        gate = threading.Event()

        class Slow(FakePipe):
            def __call__(self, **kw):
                gate.wait(2)
                order.append(kw.get("prompt") or "embeds")
                return super().__call__(**kw)

        slow = Slow()
        w.set_loader(lambda: slow)
        try:
            first = w.submit_job({"prompt": "running-now", "priority": "low"})
            time.sleep(0.05)  # let it start
            b = w.submit_job({"prompt": "batch-2", "priority": "low"})
            c = w.submit_job({"prompt": "customer"})
            self.assertEqual(c["position"], 1)          # only the running job is ahead of a customer
            self.assertEqual(w.status()["background"], 1)
            gate.set()
            for jid in (first["id"], b["id"], c["id"]):
                for _ in range(300):
                    if w.job_status(jid)["status"] in ("done", "error"):
                        break
                    time.sleep(0.01)
            self.assertEqual(order[1:], ["customer", "batch-2"])
        finally:
            w.set_loader(lambda: FAKE)


class Jobs(unittest.TestCase):
    def test_job_lifecycle(self):
        sub = w.submit_job({"prompt": "Hathor", "steps": 4})
        self.assertTrue(sub["ok"])
        for _ in range(200):
            st = w.job_status(sub["id"])
            if st["status"] == "done":
                break
            time.sleep(0.01)
        self.assertEqual(st["status"], "done")
        self.assertTrue(st["result"]["ok"])
        self.assertFalse(w.job_status("nope")["ok"])


class HTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["CPU_SD_TOKEN"] = "s3cret"
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), w.Handler)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        del os.environ["CPU_SD_TOKEN"]

    def req(self, method, path, body=None, tok=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, method=method)
        if tok:
            r.add_header("authorization", f"Bearer {tok}")
        try:
            with urllib.request.urlopen(r) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_cors_only_when_enabled(self):
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}/health", headers={"origin": "https://hathor.soapbox.community"})
        with urllib.request.urlopen(r) as resp:
            self.assertIsNone(resp.headers.get("access-control-allow-origin"))
        os.environ["CPU_SD_CORS"] = "https://hathor.soapbox.community"
        try:
            with urllib.request.urlopen(r) as resp:
                self.assertEqual(resp.headers.get("access-control-allow-origin"), "https://hathor.soapbox.community")
            o = urllib.request.Request(f"http://127.0.0.1:{self.port}/jobs", method="OPTIONS", headers={"origin": "https://evil.example"})
            with urllib.request.urlopen(o) as resp:
                self.assertEqual(resp.status, 204); self.assertIsNone(resp.headers.get("access-control-allow-origin"))
        finally:
            del os.environ["CPU_SD_CORS"]

    def test_health_open_everything_else_gated(self):
        self.assertEqual(self.req("GET", "/health")[0], 200)
        self.assertEqual(self.req("POST", "/jobs", {"prompt": "x"})[0], 401)
        self.assertEqual(self.req("POST", "/jobs", {"prompt": "x"}, "nope")[0], 401)
        code, out = self.req("POST", "/jobs", {"prompt": "x"}, "s3cret")
        self.assertEqual(code, 202); self.assertTrue(out["id"])
        self.assertEqual(self.req("GET", f"/jobs/{out['id']}", tok="s3cret")[0], 200)
        self.assertEqual(self.req("GET", "/jobs/zzz", tok="s3cret")[0], 404)


if __name__ == "__main__":
    unittest.main()
