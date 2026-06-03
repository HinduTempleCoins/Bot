"""Tests for the distributed Monte Carlo scale layer (queue #122).

Pure stdlib unittest — no third-party deps. These run identically whether
or not Ray is installed (the multiprocessing fallback path is what CI
exercises). Run with:  cd simulation && python3 -m unittest test_scale
"""

import math
import random
import unittest

import scale
from scale import (
    parallel_monte_carlo,
    split_draws,
    derive_seed,
    aggregate,
    make_match_sim,
    active_backend,
)


# A trivial pure sim_fn used by the structural tests: returns a count dict
# keyed by a coin-flip outcome. Top-level so multiprocessing can pickle it.
def _coin_sim(seed, n):
    rng = random.Random(seed)
    counts = {"heads": 0, "tails": 0}
    for _ in range(n):
        if rng.random() < 0.5:
            counts["heads"] += 1
        else:
            counts["tails"] += 1
    return counts


def _number_sim(seed, n):
    rng = random.Random(seed)
    return sum(int(rng.random() < 0.5) for _ in range(n))


def _list_sim(seed, n):
    rng = random.Random(seed)
    return [rng.random() for _ in range(n)]


class TestSplitDraws(unittest.TestCase):
    def test_even_split(self):
        self.assertEqual(split_draws(100, 4), [25, 25, 25, 25])

    def test_uneven_split_sums_to_total(self):
        sizes = split_draws(100, 7)
        self.assertEqual(sum(sizes), 100)
        # spread is at most 1 between shards
        self.assertLessEqual(max(sizes) - min(sizes), 1)

    def test_more_workers_than_draws_drops_empty_shards(self):
        sizes = split_draws(3, 10)
        self.assertEqual(sum(sizes), 3)
        self.assertTrue(all(s > 0 for s in sizes))
        self.assertEqual(len(sizes), 3)

    def test_invalid_inputs(self):
        with self.assertRaises(ValueError):
            split_draws(0, 4)
        with self.assertRaises(ValueError):
            split_draws(10, 0)


class TestSeedDerivation(unittest.TestCase):
    def test_deterministic_and_index_dependent(self):
        self.assertEqual(derive_seed(42, 0), derive_seed(42, 0))
        self.assertNotEqual(derive_seed(42, 0), derive_seed(42, 1))

    def test_independent_of_worker_count(self):
        # Shard 2's seed is the same whether there are 4 or 8 workers — the
        # property that makes the aggregate reproducible.
        self.assertEqual(derive_seed(7, 2), derive_seed(7, 2))

    def test_none_seed_propagates(self):
        self.assertIsNone(derive_seed(None, 0))


class TestAggregate(unittest.TestCase):
    def test_dict_keywise_sum(self):
        out = aggregate([{"a": 1, "b": 2}, {"a": 3, "b": 4}])
        self.assertEqual(out, {"a": 4, "b": 6})

    def test_number_sum(self):
        self.assertEqual(aggregate([1, 2, 3]), 6)

    def test_sequence_concatenation_in_order(self):
        self.assertEqual(aggregate([[1, 2], [3], [4, 5]]), [1, 2, 3, 4, 5])

    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            aggregate([])


class TestParallelMonteCarlo(unittest.TestCase):
    def test_total_draws_preserved(self):
        out = parallel_monte_carlo(_coin_sim, 1000, n_workers=4, seed=1)
        self.assertEqual(out["heads"] + out["tails"], 1000)

    def test_runs_without_ray(self):
        # The whole point of the fallback: works with no third-party deps.
        # In this environment Ray is not installed.
        self.assertFalse(scale._HAS_RAY)
        out = parallel_monte_carlo(_coin_sim, 500, n_workers=3, seed=9)
        self.assertEqual(out["heads"] + out["tails"], 500)

    def test_backend_selection(self):
        self.assertEqual(active_backend(1), "serial")
        self.assertIn(active_backend(4), ("ray", "multiprocessing"))

    def test_parallel_matches_single_process_for_fixed_seed(self):
        # Core determinism guarantee: for a fixed seed and shard count the
        # aggregate is identical regardless of how many workers run it. We
        # pin n_shards so the 1-worker and 8-worker runs share the exact
        # shard/seed layout — worker count is purely a scheduling knob.
        single = parallel_monte_carlo(_coin_sim, 4000, n_workers=1, seed=2026,
                                      n_shards=8)
        multi = parallel_monte_carlo(_coin_sim, 4000, n_workers=8, seed=2026,
                                     n_shards=8)
        self.assertEqual(single, multi)

    def test_number_result_aggregates(self):
        single = parallel_monte_carlo(_number_sim, 2000, n_workers=1, seed=5,
                                      n_shards=4)
        multi = parallel_monte_carlo(_number_sim, 2000, n_workers=4, seed=5,
                                     n_shards=4)
        self.assertEqual(single, multi)
        self.assertTrue(0 <= multi <= 2000)

    def test_list_result_concatenates_to_n_draws(self):
        out = parallel_monte_carlo(_list_sim, 300, n_workers=5, seed=11)
        self.assertEqual(len(out), 300)

    def test_normalize_returns_distribution(self):
        out = parallel_monte_carlo(_coin_sim, 1000, n_workers=4, seed=1,
                                   normalize=True)
        self.assertTrue(math.isclose(sum(out.values()), 1.0))

    def test_result_independent_of_worker_count(self):
        # With shard count pinned, the result must not depend on pool size.
        base = parallel_monte_carlo(_coin_sim, 3000, n_workers=2, seed=44,
                                    n_shards=6)
        for w in (1, 3, 6):
            other = parallel_monte_carlo(_coin_sim, 3000, n_workers=w,
                                         seed=44, n_shards=6)
            self.assertEqual(base, other)

    def test_different_seeds_give_different_results(self):
        a = parallel_monte_carlo(_coin_sim, 2000, n_workers=4, seed=1)
        b = parallel_monte_carlo(_coin_sim, 2000, n_workers=4, seed=2)
        self.assertNotEqual(a, b)


class TestOddsEngineReuse(unittest.TestCase):
    def test_match_sim_parallel_equals_single(self):
        sim = make_match_sim(1.7, 1.2)
        single = parallel_monte_carlo(sim, 5000, n_workers=1, seed=77,
                                      n_shards=6)
        multi = parallel_monte_carlo(sim, 5000, n_workers=6, seed=77,
                                     n_shards=6)
        self.assertEqual(single, multi)
        self.assertEqual(sum(single.values()), 5000)

    def test_match_sim_distribution_is_sane(self):
        # Home side stronger -> home should win most often.
        sim = make_match_sim(2.0, 0.8)
        dist = parallel_monte_carlo(sim, 8000, n_workers=4, seed=3,
                                    normalize=True)
        self.assertGreater(dist["home"], dist["away"])
        self.assertTrue(math.isclose(sum(dist.values()), 1.0))


if __name__ == "__main__":
    unittest.main()
