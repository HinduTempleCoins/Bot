"""Unit tests for the SoapBox odds engine (stdlib unittest only).

Run:  python3 -m unittest simulation/test_odds_engine.py
  or: cd simulation && python3 -m unittest test_odds_engine
"""

import math
import unittest

import odds_engine as oe


class TestPoisson(unittest.TestCase):
    def test_pmf_sums_to_one(self):
        lam = 1.7
        total = sum(oe.poisson_pmf(k, lam) for k in range(50))
        self.assertAlmostEqual(total, 1.0, places=9)

    def test_pmf_known_values(self):
        # Poisson(0) is a point mass at 0.
        self.assertEqual(oe.poisson_pmf(0, 0.0), 1.0)
        self.assertEqual(oe.poisson_pmf(3, 0.0), 0.0)
        # P(k=0; lam) = e^-lam.
        self.assertAlmostEqual(oe.poisson_pmf(0, 2.0), math.exp(-2.0), places=12)
        # P(k=1; lam=1) = e^-1.
        self.assertAlmostEqual(oe.poisson_pmf(1, 1.0), math.exp(-1.0), places=12)

    def test_negative_k(self):
        self.assertEqual(oe.poisson_pmf(-1, 2.0), 0.0)

    def test_negative_lambda_raises(self):
        with self.assertRaises(ValueError):
            oe.poisson_pmf(1, -1.0)


class TestScoreGridAndMatchProbs(unittest.TestCase):
    def test_grid_normalised(self):
        grid = oe.score_matrix(1.4, 1.1, max_goals=12, rho=0.0)
        total = sum(sum(row) for row in grid)
        self.assertAlmostEqual(total, 1.0, places=9)

    def test_grid_normalised_with_dc(self):
        grid = oe.score_matrix(1.4, 1.1, max_goals=12, rho=-0.1)
        total = sum(sum(row) for row in grid)
        self.assertAlmostEqual(total, 1.0, places=9)

    def test_match_probs_sum_to_one(self):
        p = oe.match_probabilities(1.6, 1.2, rho=0.0)
        self.assertAlmostEqual(p["home"] + p["draw"] + p["away"], 1.0, places=9)

    def test_match_probs_sum_to_one_with_dc(self):
        p = oe.match_probabilities(1.6, 1.2, rho=-0.12)
        self.assertAlmostEqual(p["home"] + p["draw"] + p["away"], 1.0, places=9)

    def test_stronger_home_wins_more(self):
        p = oe.match_probabilities(2.2, 0.9)
        self.assertGreater(p["home"], p["away"])

    def test_symmetric_equal_lambdas(self):
        p = oe.match_probabilities(1.3, 1.3)
        self.assertAlmostEqual(p["home"], p["away"], places=9)


class TestDixonColes(unittest.TestCase):
    def test_tau_unity_outside_low_scores(self):
        # tau is 1 for any scoreline beyond the four low-score cells.
        self.assertEqual(oe.dixon_coles_tau(2, 3, 1.5, 1.2, -0.1), 1.0)
        self.assertEqual(oe.dixon_coles_tau(0, 2, 1.5, 1.2, -0.1), 1.0)
        self.assertEqual(oe.dixon_coles_tau(2, 0, 1.5, 1.2, -0.1), 1.0)

    def test_tau_identity_when_rho_zero(self):
        for hg in range(2):
            for ag in range(2):
                self.assertEqual(
                    oe.dixon_coles_tau(hg, ag, 1.5, 1.2, 0.0), 1.0)

    def test_dc_negative_rho_lifts_draw_and_zero_zero(self):
        lam_h, lam_a = 1.4, 1.2
        rho = -0.1
        plain = oe.match_probabilities(lam_h, lam_a, rho=0.0)
        dc = oe.match_probabilities(lam_h, lam_a, rho=rho)
        # Classic Dixon-Coles effect: negative rho increases the draw prob.
        self.assertGreater(dc["draw"], plain["draw"])

        # And specifically the 0-0 cell rises.
        g_plain = oe.score_matrix(lam_h, lam_a, rho=0.0)
        g_dc = oe.score_matrix(lam_h, lam_a, rho=rho)
        self.assertGreater(g_dc[0][0], g_plain[0][0])

    def test_dc_trims_one_nil_scores(self):
        lam_h, lam_a = 1.4, 1.2
        rho = -0.1
        g_plain = oe.score_matrix(lam_h, lam_a, rho=0.0)
        g_dc = oe.score_matrix(lam_h, lam_a, rho=rho)
        # 1-0 and 0-1 get trimmed by negative rho.
        self.assertLess(g_dc[1][0], g_plain[1][0])
        self.assertLess(g_dc[0][1], g_plain[0][1])


class TestElo(unittest.TestCase):
    def test_equal_ratings_expect_half(self):
        self.assertAlmostEqual(oe.elo_expected_score(1500, 1500), 0.5, places=12)

    def test_expected_score_monotone(self):
        self.assertGreater(oe.elo_expected_score(1600, 1500),
                           oe.elo_expected_score(1500, 1500))

    def test_400_point_gap(self):
        # A classic Elo fact: +400 rating => ~10/11 expected score.
        self.assertAlmostEqual(oe.elo_expected_score(1900, 1500),
                               10.0 / 11.0, places=9)

    def test_update_is_zero_sum(self):
        ra, rb = oe.elo_update(1500, 1500, 1.0, k=20)
        self.assertAlmostEqual((ra - 1500) + (rb - 1500), 0.0, places=12)
        # Winner gains 10 against an equal opponent (k/2).
        self.assertAlmostEqual(ra, 1510.0, places=9)
        self.assertAlmostEqual(rb, 1490.0, places=9)

    def test_elo_to_goals_favours_stronger(self):
        lam_h, lam_a = oe.elo_to_expected_goals(1700, 1500)
        self.assertGreater(lam_h, lam_a)

    def test_elo_model_record_and_probs(self):
        m = oe.EloModel()
        m.ratings["A"] = 1600
        m.ratings["B"] = 1500
        p = m.match_probabilities("A", "B")
        self.assertAlmostEqual(sum(p.values()), 1.0, places=9)
        self.assertGreater(p["home"], p["away"])
        # Recording an A win should raise A and lower B.
        before = m.rating("A")
        m.record("A", "B", 1.0)
        self.assertGreater(m.rating("A"), before)


class TestMonteCarlo(unittest.TestCase):
    def test_match_probs_sum_to_one(self):
        p = oe.monte_carlo_match(1.5, 1.1, n=2000, seed=1)
        self.assertAlmostEqual(p["home"] + p["draw"] + p["away"], 1.0, places=9)

    def test_reproducible_with_fixed_seed(self):
        a = oe.monte_carlo_match(1.5, 1.1, n=5000, seed=123)
        b = oe.monte_carlo_match(1.5, 1.1, n=5000, seed=123)
        self.assertEqual(a, b)

    def test_different_seeds_differ(self):
        a = oe.monte_carlo_match(1.5, 1.1, n=5000, seed=1)
        b = oe.monte_carlo_match(1.5, 1.1, n=5000, seed=2)
        self.assertNotEqual(a, b)

    def test_mc_converges_to_exact(self):
        lam_h, lam_a = 1.7, 1.0
        exact = oe.match_probabilities(lam_h, lam_a, rho=0.0)
        mc = oe.monte_carlo_match(lam_h, lam_a, n=60000, seed=99)
        for key in ("home", "draw", "away"):
            self.assertAlmostEqual(mc[key], exact[key], delta=0.02)

    def test_tournament_odds_sum_to_one(self):
        matchups = [
            ("A", "B", 1.6, 1.0),
            ("B", "C", 1.4, 1.1),
            ("C", "A", 1.0, 1.5),
        ]
        odds = oe.monte_carlo_tournament(matchups, n=4000, seed=5)
        self.assertAlmostEqual(sum(odds.values()), 1.0, places=9)
        self.assertEqual(set(odds), {"A", "B", "C"})

    def test_tournament_reproducible(self):
        matchups = [("A", "B", 1.6, 1.0), ("B", "A", 1.0, 1.6)]
        a = oe.monte_carlo_tournament(matchups, n=3000, seed=11)
        b = oe.monte_carlo_tournament(matchups, n=3000, seed=11)
        self.assertEqual(a, b)

    def test_n_zero_raises(self):
        with self.assertRaises(ValueError):
            oe.monte_carlo_match(1.0, 1.0, n=0)


class TestOddsAndVigMath(unittest.TestCase):
    def test_implied_from_decimal(self):
        self.assertAlmostEqual(oe.implied_from_decimal(2.0), 0.5, places=12)
        self.assertAlmostEqual(oe.implied_from_decimal(4.0), 0.25, places=12)

    def test_implied_invalid_odds(self):
        with self.assertRaises(ValueError):
            oe.implied_from_decimal(1.0)
        with self.assertRaises(ValueError):
            oe.implied_from_decimal(0.5)

    def test_overround_fair_market(self):
        # Two outcomes priced at evens => implied sum exactly 1 (no vig).
        implied = [oe.implied_from_decimal(2.0), oe.implied_from_decimal(2.0)]
        self.assertAlmostEqual(oe.overround(implied), 1.0, places=12)

    def test_overround_with_vig(self):
        # Both sides at 1.9 => 1/1.9 + 1/1.9 = ~1.0526 => ~5.26% vig.
        implied = [oe.implied_from_decimal(1.9), oe.implied_from_decimal(1.9)]
        ovr = oe.overround(implied)
        self.assertAlmostEqual(ovr, 2.0 / 1.9, places=12)
        self.assertAlmostEqual(ovr - 1.0, (2.0 / 1.9) - 1.0, places=12)

    def test_overround_accepts_dict(self):
        d = {"home": 0.55, "away": 0.50}
        self.assertAlmostEqual(oe.overround(d), 1.05, places=12)

    def test_remove_overround_normalises(self):
        implied = {"home": 0.55, "draw": 0.30, "away": 0.25}  # sums 1.10
        fair = oe.remove_overround(implied)
        self.assertAlmostEqual(sum(fair.values()), 1.0, places=12)
        # ratios preserved.
        self.assertAlmostEqual(fair["home"] / fair["away"], 0.55 / 0.25,
                               places=9)

    def test_compare_true_vs_implied_vig(self):
        # Symmetric book at 1.9 each side: 5.26% overround.
        true_probs = {"home": 0.5, "away": 0.5}
        book_odds = {"home": 1.9, "away": 1.9}
        rep = oe.compare_true_vs_implied(true_probs, book_odds)
        self.assertAlmostEqual(rep["overround"], 2.0 / 1.9, places=12)
        self.assertAlmostEqual(rep["vig"], (2.0 / 1.9) - 1.0, places=12)
        self.assertAlmostEqual(rep["vig_pct"], ((2.0 / 1.9) - 1.0) * 100.0,
                               places=9)
        # fair implied is symmetric back to 0.5/0.5.
        self.assertAlmostEqual(rep["fair_implied"]["home"], 0.5, places=12)
        self.assertAlmostEqual(rep["fair_implied"]["away"], 0.5, places=12)
        # true == fair here, so edge is ~0.
        self.assertAlmostEqual(rep["edge"]["home"], 0.0, places=12)
        # but edge vs raw implied is negative (you pay the vig).
        self.assertLess(rep["edge_vs_raw"]["home"], 0.0)

    def test_compare_detects_value_bet(self):
        # Model thinks home is 0.60; book prices it at 2.0 (implied 0.50).
        true_probs = {"home": 0.60, "away": 0.40}
        book_odds = {"home": 2.0, "away": 2.0}
        rep = oe.compare_true_vs_implied(true_probs, book_odds)
        # raw implied home is 0.5 < 0.6 => positive edge vs raw.
        self.assertGreater(rep["edge_vs_raw"]["home"], 0.0)
        # fair implied is 0.5 here too (symmetric book), so edge positive.
        self.assertGreater(rep["edge"]["home"], 0.0)

    def test_compare_missing_outcome_raises(self):
        with self.assertRaises(ValueError):
            oe.compare_true_vs_implied({"home": 0.5, "away": 0.5},
                                       {"home": 2.0})


if __name__ == "__main__":
    unittest.main()
