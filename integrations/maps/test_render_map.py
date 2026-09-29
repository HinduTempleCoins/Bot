"""python3 -m unittest integrations/maps/test_render_map.py — pure helpers of the renderer (offline, no data files)."""
import importlib.util, os, unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def load():
    try:
        spec = importlib.util.spec_from_file_location("render_map", os.path.join(HERE, "render_map.py"))
        m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
    except ImportError as e:  # shapely/pyproj not installed here (they are on the worker)
        raise unittest.SkipTest(f"renderer deps missing: {e}")


class Pure(unittest.TestCase):
    def test_years(self):
        m = load()
        self.assertEqual(m.format_year(-334), "334 BC"); self.assertEqual(m.format_year(117), "AD 117"); self.assertEqual(m.format_year(1453), "1453")
        self.assertEqual(m.year_at(5, 11, -336, -326), -331)

    def test_route(self):
        m = load()
        pts = [{"lat": 0, "lon": 0, "year": -336}, {"lat": 10, "lon": 20, "year": -334}]
        lat, lon, reached, done = m.route_at(pts, -335)
        self.assertEqual((lat, lon, reached, done), (5, 10, 0, False))
        self.assertTrue(m.route_at(pts, -300)[3])

    def test_validate(self):
        m = load()
        ok = {"title": "t", "bbox": [0, 0, 10, 10], "years": [-10, 10], "routes": [{"points": []}]}
        self.assertEqual(m.validate(ok)["fps"], 24)
        with self.assertRaises(SystemExit):
            m.validate({**ok, "years": [10, -10]})


    def test_stops(self):
        m = load()
        years = [-219, -201]
        st = m.validate_stops([{"label": "Cannae", "lat": 41.3, "lon": 16.1, "year": -215.41, "media": ["a.png", {"src": "https://x/y.jpg", "credit": "PD"}], "kind": "record"}], years)
        self.assertEqual(st[0]["hold"], 12.0); self.assertEqual(st[0]["date"], "216 BC"); self.assertEqual(st[0]["media"][1]["credit"], "PD")
        for bad in ([{"label": "B", "lat": 1, "lon": 1, "year": -210}, {"label": "A", "lat": 1, "lon": 1, "year": -215}],
                    [{"label": "X", "lat": 1, "lon": 1, "year": -100}], [{"label": "X", "lat": 1, "lon": 1, "year": -210, "kind": "maybe"}],
                    [{"label": "X", "lat": 1, "lon": 1, "year": -210, "media": ["../../etc/passwd"]}]):
            with self.assertRaises(SystemExit):
                m.validate_stops(bad, years)

    def test_zoom_crop_and_ease(self):
        m = load()
        from PIL import Image
        im = Image.new("RGBA", (200, 100), (255, 0, 0, 255))
        self.assertEqual(m.zoom_crop(im, 190, 90, 3).size, (200, 100))  # clamped inside the picture
        self.assertEqual(m.ease(0), 0); self.assertEqual(m.ease(1), 1); self.assertAlmostEqual(m.ease(0.5), 0.5)


if __name__ == "__main__":
    unittest.main()
