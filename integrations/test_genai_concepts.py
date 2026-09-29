"""Offline tests for genai_concepts.py — fake embedder (no CLIP download), temp dirs, no network."""
import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(__file__))
import genai_concepts as gc
from PIL import Image


def fake_embed(images):
    # fingerprint = mean colour: "reddish" concept vs "bluish" non-concept
    out = []
    for im in images:
        r, g, b = im.resize((4, 4)).convert("RGB").getpixel((1, 1))
        n = (r * r + g * g + b * b) ** 0.5 or 1
        out.append([r / n, g / n, b / n])
    return out


gc.set_embedder(fake_embed)


class Concepts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.pos, self.neg = os.path.join(self.tmp, "pos"), os.path.join(self.tmp, "neg")
        os.makedirs(self.pos); os.makedirs(self.neg)
        for i in range(6):
            Image.new("RGB", (16, 16), (200 + i * 5, 40, 60)).save(os.path.join(self.pos, f"p{i}.png"))
            Image.new("RGB", (16, 16), (30, 60, 200 + i * 5)).save(os.path.join(self.neg, f"n{i}.png"))
        self.models = os.path.join(self.tmp, "models")

    def test_train_reports_cross_validated_accuracy(self):
        r = gc.train("redness", gc.expand([self.pos]), gc.expand([self.neg]), out_dir=self.models)
        self.assertTrue(r["ok"]); self.assertEqual((r["n_pos"], r["n_neg"]), (6, 6))
        self.assertGreaterEqual(r["cv_accuracy"], 0.9)

    def test_score_and_gate(self):
        gc.train("redness", gc.expand([self.pos]), gc.expand([self.neg]), out_dir=self.models)
        red, blue = os.path.join(self.tmp, "red.png"), os.path.join(self.tmp, "blue.png")
        Image.new("RGB", (16, 16), (230, 50, 50)).save(red); Image.new("RGB", (16, 16), (40, 40, 220)).save(blue)
        s = {os.path.basename(x["file"]): x["p"] for x in gc.score("redness", [red, blue], out_dir=self.models)}
        self.assertGreater(s["red.png"], 0.5); self.assertLess(s["blue.png"], 0.5)
        g = gc.gate("redness", [red, blue], out_dir=self.models)
        self.assertEqual([os.path.basename(x["file"]) for x in g["reject"]], ["blue.png"])

    def test_too_few_examples_soft_fails(self):
        r = gc.train("x", gc.expand([os.path.join(self.pos, "p0.png")]), gc.expand([self.neg]), out_dir=self.models)
        self.assertFalse(r["ok"])

    def test_expand_skips_non_images(self):
        open(os.path.join(self.pos, "notes.txt"), "w").close()
        self.assertEqual(len(gc.expand([self.pos])), 6)


if __name__ == "__main__":
    unittest.main()
