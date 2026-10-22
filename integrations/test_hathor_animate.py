"""Offline tests for the animation pipeline — no network, no model download, no ffmpeg.

The regression these exist for: `hathor_motion.parallax_frames` built its cv2.remap maps as float64 under
NumPy 2's NEP-50 promotion, cv2.remap only accepts float32, the exception was swallowed by a bare
`except Exception: return None`, and hathor_animate quietly downgraded the clip to a Ken Burns pan. That made
31.4% of the published catalogue a slow pan over a still picture with nothing in the recipes to say why.
"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import cv2
    import numpy as np
    HAVE_CV2 = True
except Exception:  # pragma: no cover - the test box may not carry OpenCV
    HAVE_CV2 = False

if HAVE_CV2:
    import cutout_anim
    import hathor_animate as ha
    import hathor_motion as hm


@unittest.skipUnless(HAVE_CV2, "needs numpy + cv2")
class ParallaxMaps(unittest.TestCase):
    def setUp(self):
        self.im = np.zeros((360, 640, 3), np.uint8)
        self.im[:, :, 1] = 120
        self.d = (np.mgrid[0:360, 0:640][0] / 359.0).astype(np.float32)

    def test_every_camera_yields_frames(self):
        """Each camera move must actually render. Before the fix all four raised inside the generator."""
        for cam in ("dolly_in", "orbit_left", "orbit_right", "crane_up"):
            frames = list(hm.parallax_frames(self.im, self.d, 3, cam, 1.0, 0))
            self.assertEqual(len(frames), 3, cam)
            for f in frames:
                self.assertEqual(f.shape, self.im.shape, cam)
                self.assertEqual(f.dtype, np.uint8, cam)

    def test_near_and_far_move_differently(self):
        """Parallax, not a zoom: the near band must shift visibly more than the far band — and the shift must
        stay sane on every frame (a loop variable once shadowed the shift scale, so every frame after the
        first slid the picture thousands of pixels and clamped to a flat smear)."""
        ramp = np.linspace(0, 255, 480, dtype=np.float32)
        im = np.repeat(np.tile(ramp, (240, 1))[:, :, None], 3, axis=2).astype(np.uint8)
        d = np.zeros((240, 480), np.float32)
        d[:120] = 1.0                                      # top half near, bottom half far
        frames = list(hm.parallax_frames(im, d, 12, "orbit_left", 1.0, 0))
        self.assertEqual(len(frames), 12)
        a = frames[0][:, 180:300, 0].astype(np.float32)    # centre columns: no zoom displacement there
        b = frames[-1][:, 180:300, 0].astype(np.float32)
        near = abs(float((b[:110] - a[:110]).mean()))
        far = abs(float((b[140:] - a[140:]).mean()))
        self.assertGreater(near, 3.0, f"the near layer barely moved ({near:.2f})")
        self.assertGreater(near, far * 3, f"near {near:.2f} far {far:.2f} — this is a zoom, not parallax")
        for j_, f in enumerate(frames):                    # and no frame may collapse to an edge smear
            self.assertGreater(float(f.std()), 30.0, f"frame {j_} lost its detail (std {f.std():.1f})")

    def test_out_size_crops_the_overscan(self):
        """parallax() renders a larger plate and delivers the middle of it, so no rim needs inpainting."""
        frames = list(hm.parallax_frames(self.im, self.d, 2, "orbit_left", 1.0, 0, out_size=(560, 320)))
        self.assertEqual(len(frames), 2)
        for f in frames:
            self.assertEqual(f.shape[:2], (320, 560))

    def test_float64_depth_still_works(self):
        """A caller handing in float64 depth must not re-introduce the bug."""
        frames = list(hm.parallax_frames(self.im, self.d.astype(np.float64), 2, "dolly_in", 1.0, 0))
        self.assertEqual(len(frames), 2)

    def test_parallax_records_a_reason_when_it_gives_up(self):
        self.assertIsNone(hm.parallax("/nonexistent/nope.png", "/nonexistent/out.mp4"))
        self.assertIn("unreadable", hm.LAST_ERROR)


@unittest.skipUnless(HAVE_CV2, "needs numpy + cv2")
class Framing(unittest.TestCase):
    def test_small_mismatch_fills_the_frame(self):
        scale, crop = cutout_anim.frame_fit(1600, 1000, 1280, 720)
        self.assertTrue(crop)

    def test_tall_portrait_is_not_force_cropped(self):
        scale, crop = cutout_anim.frame_fit(800, 1600, 1280, 720)
        self.assertFalse(crop)

    def test_fit_canvas_returns_exactly_the_canvas(self):
        for w, h in ((1600, 900), (900, 1600), (1024, 1024)):
            im = np.zeros((h, w, 3), np.uint8)
            for canvas in ha.CANVASES:
                out, _ = ha.fit_canvas(im, canvas)
                self.assertEqual(out.shape[:2], (canvas[1], canvas[0]), f"{w}x{h} -> {canvas}")

    def test_fill_leaves_no_blurred_bars(self):
        """A 16:9 source on the 16:9 canvas must be edge to edge, not letterboxed over a blurred copy."""
        im = np.full((900, 1600, 3), 200, np.uint8)
        out, _ = ha.fit_canvas(im, (1280, 720))
        self.assertTrue((out[:, 0] > 150).all() and (out[:, -1] > 150).all())

    def test_camera_preserves_any_canvas(self):
        for canvas in ha.CANVASES:
            fr = np.zeros((canvas[1], canvas[0], 3), np.uint8)
            for cam in ("push_in", "pull_out", "pan_left", "pan_right", "still"):
                out = ha.camera(fr, 0.5, cam, 1.0)
                self.assertEqual(out.shape, fr.shape, f"{cam} {canvas}")


@unittest.skipUnless(HAVE_CV2, "needs numpy + cv2")
class Puppet(unittest.TestCase):
    POSE = {"nose": (300, 120), "neck": (300, 190), "r_eye": (285, 112), "l_eye": (315, 112),
            "r_shoulder": (255, 200), "l_shoulder": (345, 200), "r_elbow": (235, 290), "l_elbow": (365, 290),
            "r_wrist": (225, 380), "l_wrist": (375, 380), "r_hip": (272, 400), "l_hip": (328, 400),
            "r_knee": (268, 560), "l_knee": (332, 560), "r_ankle": (266, 720), "l_ankle": (334, 720)}

    @staticmethod
    def _ramps(h=800, w=600):
        """An image whose blue channel encodes x and green encodes y, so the warp field can be read back off
        the rendered frame in pixels."""
        im = np.zeros((h, w, 3), np.uint8)
        im[:, :, 0] = np.tile(np.linspace(0, 255, w), (h, 1)).astype(np.uint8)
        im[:, :, 1] = np.tile(np.linspace(0, 255, h)[:, None], (1, w)).astype(np.uint8)
        return im, 255.0 / (w - 1), 255.0 / (h - 1)

    def test_warp_never_liquefies_the_figure(self):
        """The strongest motion at the strongest amplitude must still move every point by a bounded amount —
        a 45-degree wrist swing used to shear the whole torso into an S through the thin-plate spline."""
        im, sx, sy = self._ramps()
        ceiling = ha.MAX_WARP * im.shape[0] * 2.0   # the spline may overshoot a little between control points
        for amp in (1.0, 1.6):
            for mot in ("all", "arm_raise", "sway", "head_tilt"):
                out = ha.pose_frame(im, self.POSE, 1.7, mot, amp)
                dx = (out[:, :, 0].astype(np.float32) - im[:, :, 0]) / sx
                dy = (out[:, :, 1].astype(np.float32) - im[:, :, 1]) / sy
                mag = np.hypot(dx, dy)
                self.assertLess(float(mag.max()), ceiling, f"{mot} amp={amp} moved a pixel {mag.max():.0f}px")
                self.assertLess(float(mag[620:].max()), 10.0,
                                f"{mot} amp={amp} dragged the legs {mag[620:].max():.0f}px")

    def test_motion_actually_happens(self):
        im = np.zeros((800, 600, 3), np.uint8)
        im[:, ::10] = 255
        a = ha.pose_frame(im, self.POSE, 0.0, "all", 1.0)
        b = ha.pose_frame(im, self.POSE, 1.7, "all", 1.0)
        self.assertGreater(float(np.abs(a.astype(np.int16) - b.astype(np.int16)).mean()), 0.5)


@unittest.skipUnless(HAVE_CV2, "needs numpy + cv2")
class Captions(unittest.TestCase):
    def test_caption_fits_a_narrow_canvas(self):
        """A long title on the 720-wide portrait canvas must be shrunk and elided, not run off both edges."""
        for canvas in ha.CANVASES:
            fr = np.zeros((canvas[1], canvas[0], 3), np.uint8)
            out = ha.caption(fr, "Priestess of Neith at Sais, with the lotus and the shendyt kilt, Dynasty XXVI")
            self.assertEqual(out.shape, fr.shape)
            k = max(0.8, min(canvas) / 540.0)
            band = out[canvas[1] - int(58 * k):, :, :]
            lit = (band.max(2) > 60)
            # the text must not touch either edge column of the caption band
            self.assertFalse(lit[:, :3].any(), f"caption runs off the left edge at {canvas}")
            self.assertFalse(lit[:, -3:].any(), f"caption runs off the right edge at {canvas}")
            self.assertTrue(lit.any(), f"no caption drawn at {canvas}")


@unittest.skipUnless(HAVE_CV2, "needs numpy + cv2")
class Fallbacks(unittest.TestCase):
    def test_plan_downgrade_never_lands_on_kenburns(self):
        """A plan-time downgrade goes to a real-motion engine, and says so in the recipe."""
        import random
        scenes = [{"key": "k", "title": "T", "group": "G", "credit": "",
                   "looks": {"1_real": {"egyptian": "/nonexistent/a.png"}}}]
        rng = random.Random(7)
        stats = {p: {v: [0, 0] for v in vals} for p, vals in ha.ARMS.items()}
        got = ha.plan(scenes, [], stats, 60, rng)
        self.assertTrue(got)
        self.assertEqual([r for r in got if r["kind"] == "kenburns"], [])
        for r in got:
            if r.get("fell_back_from"):
                self.assertTrue(r.get("engine_log"), r)

    def test_engine_failure_is_recorded_not_swallowed(self):
        r = {"kind": "cutout", "pace": "normal", "amplitude": "medium", "camera": "still", "id": "abcdef123456"}
        self.assertIsNone(ha._try_engine("cutout", r, "/nonexistent/x.png", "/nonexistent/o.mp4", (1280, 720)))
        self.assertTrue(r["engine_log"])
        self.assertIn("cutout", r["engine_log"][0])


if __name__ == "__main__":
    unittest.main()
