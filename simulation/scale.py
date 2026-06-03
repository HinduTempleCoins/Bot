"""Distributed Monte Carlo scale layer (queue #122).

This is the PRANA useful-work payload: real computation (parallel Monte
Carlo simulation), NOT hash-burning. Where a proof-of-work chain spends
energy on a meaningless hash race, PRANA spends the same parallel effort
on simulations that produce an actually-useful result (e.g. the SoapBox
odds engine's tournament / match distributions).

Backend selection is automatic:

  * If Ray is installed, work is fanned out across a Ray cluster.
  * Otherwise we fall back to the Python standard library's
    ``multiprocessing`` pool, so this module runs and tests with ZERO
    third-party dependencies.

The public entry point is :func:`parallel_monte_carlo`. It splits
``n_draws`` across ``n_workers``, runs a pure ``sim_fn(seed) -> result``
on each shard, and aggregates the per-shard results into one combined
distribution. Determinism is guaranteed for a fixed master ``seed``: each
shard's seed is derived deterministically from the master seed and the
shard index, independent of how many workers actually run it. That means a
1-worker run and an 8-worker run with the same ``seed`` produce the
*identical* aggregate distribution — the parallelism is an implementation
detail, not a source of variance.

``sim_fn`` contract:
    A pure callable ``sim_fn(seed: int, n: int) -> result`` where
    ``result`` is one of:
      * a mapping ``{outcome: count_or_prob}`` (counts preferred — they
        aggregate exactly; probabilities are weighted by ``n``),
      * a number (summed across shards),
      * a sequence (concatenated across shards).
    See :func:`make_match_sim` for a ready-made one built on the odds
    engine, and the ``__main__`` demo below.
"""

from __future__ import annotations

import math
import os
from collections import defaultdict

# odds_engine is imported lazily / optionally so this module stays useful
# even if the engine moves. We never edit odds_engine.py.
try:  # pragma: no cover - exercised indirectly by the demo/tests
    from odds_engine import simulate_match  # noqa: F401
    _HAS_ODDS_ENGINE = True
except Exception:  # pragma: no cover
    _HAS_ODDS_ENGINE = False

try:  # pragma: no cover - depends on the host environment
    import ray  # type: ignore
    _HAS_RAY = True
except Exception:
    _HAS_RAY = False


# --------------------------------------------------------------------------
# Work splitting + seed derivation (the determinism guarantee lives here)
# --------------------------------------------------------------------------

def split_draws(n_draws: int, n_workers: int) -> list[int]:
    """Split ``n_draws`` into ``n_workers`` shard sizes as evenly as possible.

    The first ``n_draws % n_workers`` shards get one extra draw. The result
    sums exactly to ``n_draws`` and drops any zero-sized trailing shards
    (so n_workers > n_draws does not create empty work).
    """
    if n_draws <= 0:
        raise ValueError("n_draws must be positive")
    if n_workers <= 0:
        raise ValueError("n_workers must be positive")
    n_workers = min(n_workers, n_draws)
    base, extra = divmod(n_draws, n_workers)
    sizes = [base + (1 if i < extra else 0) for i in range(n_workers)]
    return [s for s in sizes if s > 0]


def derive_seed(master_seed: int | None, shard_index: int) -> int | None:
    """Deterministically derive a shard seed from the master seed + index.

    Independent of worker count: shard ``i`` always gets the same seed for
    a given master seed, so the aggregate is reproducible regardless of how
    the shards are scheduled. Returns ``None`` (non-deterministic) only when
    the master seed is ``None``.
    """
    if master_seed is None:
        return None
    # A cheap, stable mixing function over (master_seed, shard_index).
    mixed = (master_seed * 1_000_003) ^ (shard_index * 2_654_435_761)
    return mixed & 0x7FFF_FFFF_FFFF_FFFF


# --------------------------------------------------------------------------
# Aggregation
# --------------------------------------------------------------------------

def aggregate(results: list) -> object:
    """Combine per-shard results deterministically.

    * mappings  -> key-wise sum (handles count dicts; probability dicts
                   should be weighted before aggregation, see
                   :func:`parallel_monte_carlo`).
    * numbers   -> sum.
    * sequences -> concatenation (in shard order).
    """
    if not results:
        raise ValueError("no results to aggregate")
    first = results[0]
    if isinstance(first, dict):
        out: dict = defaultdict(float)
        for r in results:
            for k, v in r.items():
                out[k] += v
        return dict(out)
    if isinstance(first, (int, float)):
        return sum(results)
    if isinstance(first, (list, tuple)):
        combined: list = []
        for r in results:
            combined.extend(r)
        return combined
    raise TypeError(f"don't know how to aggregate result of type {type(first)}")


# --------------------------------------------------------------------------
# Backend runners
# --------------------------------------------------------------------------

def _run_serial(sim_fn, shards: list[tuple[int, int | None]]) -> list:
    return [sim_fn(seed, n) for (n, seed) in shards]


def _run_multiprocessing(sim_fn, shards: list[tuple[int, int | None]],
                         n_workers: int) -> list:
    import multiprocessing as mp

    # Order is preserved by Pool.starmap, which keeps determinism intact.
    with mp.Pool(processes=n_workers) as pool:
        return pool.starmap(_invoke, [(sim_fn, seed, n) for (n, seed) in shards])


def _invoke(sim_fn, seed, n):
    # Top-level helper so it is picklable by multiprocessing on all start
    # methods (spawn/forkserver).
    return sim_fn(seed, n)


def _run_ray(sim_fn, shards: list[tuple[int, int | None]],
             n_workers: int) -> list:  # pragma: no cover - needs Ray installed
    if not ray.is_initialized():
        ray.init(num_cpus=n_workers, ignore_reinit_error=True,
                 logging_level="ERROR")
    remote = ray.remote(_invoke)
    futures = [remote.remote(sim_fn, seed, n) for (n, seed) in shards]
    # ray.get preserves the order of the futures list -> determinism holds.
    return ray.get(futures)


def _default_workers() -> int:
    return os.cpu_count() or 1


def active_backend(n_workers: int | None = None) -> str:
    """Report which backend :func:`parallel_monte_carlo` will use.

    ``"serial"`` when one shard, ``"ray"`` when Ray is importable, else
    ``"multiprocessing"``.
    """
    if n_workers == 1:
        return "serial"
    return "ray" if _HAS_RAY else "multiprocessing"


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------

def parallel_monte_carlo(sim_fn, n_draws: int, n_workers: int | None = None,
                         seed: int | None = None, normalize: bool = False,
                         n_shards: int | None = None):
    """Run ``n_draws`` of a Monte Carlo ``sim_fn`` split across workers.

    Parameters
    ----------
    sim_fn :
        Pure callable ``sim_fn(seed, n) -> result``. Must depend only on
        its arguments (no shared mutable state) so shards are independent.
        It must be importable by name (a module-level function), since the
        multiprocessing / Ray backends pickle it to send to workers — a
        local closure cannot cross the process boundary.
    n_draws :
        Total number of Monte Carlo draws across all shards.
    n_workers :
        Size of the worker pool. Defaults to the CPU count. This is the
        *parallelism* knob only; it does NOT change the result, because the
        work is split into a fixed number of seeded shards (see
        ``n_shards``) and the pool merely schedules them.
    seed :
        Master seed. For a fixed seed (and fixed ``n_shards``) the
        aggregate is identical no matter how many workers run it — the
        determinism guarantee. With ``seed=None`` results are random.
    normalize :
        When the per-shard result is a count mapping, set ``True`` to
        return shares summing to 1 (a probability distribution).
    n_shards :
        Number of independently-seeded work shards. Defaults to ``n_workers``
        (capped at ``n_draws``). Because shard seeds derive only from
        ``(seed, shard_index)``, the aggregate depends on ``n_shards`` and
        ``seed`` but never on ``n_workers``. Pass an explicit ``n_shards``
        to compare runs across different pool sizes deterministically.

    Returns
    -------
    The aggregated result (see :func:`aggregate`). For count mappings with
    ``normalize=True`` the counts are converted to probabilities.
    """
    if n_workers is None:
        n_workers = _default_workers()
    if n_shards is None:
        n_shards = n_workers
    sizes = split_draws(n_draws, n_shards)
    shards = [(n, derive_seed(seed, i)) for i, n in enumerate(sizes)]

    # The worker pool only needs as many processes as there are shards.
    pool_size = min(n_workers, len(shards))
    if pool_size <= 1:
        results = _run_serial(sim_fn, shards)
    elif _HAS_RAY:  # pragma: no cover - needs Ray installed
        results = _run_ray(sim_fn, shards, pool_size)
    else:
        results = _run_multiprocessing(sim_fn, shards, pool_size)

    combined = aggregate(results)

    if normalize and isinstance(combined, dict):
        total = sum(combined.values())
        if total > 0:
            combined = {k: v / total for k, v in combined.items()}
    return combined


# --------------------------------------------------------------------------
# A ready-made sim_fn built on the (unmodified) odds engine
# --------------------------------------------------------------------------

class _MatchSim:
    """A picklable ``sim_fn(seed, n)`` that returns home/draw/away counts.

    Implemented as a top-level callable class (not a closure) so the
    multiprocessing / Ray backends can pickle it across the process
    boundary. Reuses ``odds_engine.simulate_match`` — we import it, never
    edit it. The returned counts aggregate exactly across shards.
    """

    def __init__(self, lam_home: float, lam_away: float):
        self.lam_home = lam_home
        self.lam_away = lam_away

    def __call__(self, seed, n):
        import random
        from odds_engine import simulate_match
        rng = random.Random(seed)
        counts = {"home": 0, "draw": 0, "away": 0}
        for _ in range(n):
            hg, ag = simulate_match(self.lam_home, self.lam_away, rng)
            if hg > ag:
                counts["home"] += 1
            elif hg == ag:
                counts["draw"] += 1
            else:
                counts["away"] += 1
        return counts


def make_match_sim(lam_home: float, lam_away: float) -> "_MatchSim":
    """Build a pure, picklable ``sim_fn(seed, n)`` over the odds engine.

    See :class:`_MatchSim`. The returned counts aggregate exactly across
    shards, so a parallel run matches a single-process run for the same
    master seed and shard count.
    """
    if not _HAS_ODDS_ENGINE:  # pragma: no cover
        raise RuntimeError("odds_engine not importable; run from simulation/")
    return _MatchSim(lam_home, lam_away)


# --------------------------------------------------------------------------
# Demo
# --------------------------------------------------------------------------

if __name__ == "__main__":
    # PRANA useful-work payload in action: a real match-odds simulation,
    # parallelised, not a hash race.
    print("PRANA scale layer — distributed Monte Carlo demo")
    print("=" * 50)
    print(f"backend (multi-worker): {active_backend()}  "
          f"(Ray installed: {_HAS_RAY})")
    print(f"cpu count: {_default_workers()}")

    sim = make_match_sim(1.8, 1.1)
    n = 60000

    # Pin n_shards so worker count is purely a scheduling knob: 1 worker and
    # 4 workers must produce the identical distribution for the same seed.
    single = parallel_monte_carlo(sim, n, n_workers=1, seed=123,
                                  n_shards=4, normalize=True)
    parallel = parallel_monte_carlo(sim, n, n_workers=4, seed=123,
                                    n_shards=4, normalize=True)

    print(f"\nMatch odds (lam_home=1.8, lam_away=1.1, n={n}, seed=123):")
    print("  1 worker :", {k: round(v, 4) for k, v in single.items()})
    print("  4 workers:", {k: round(v, 4) for k, v in parallel.items()})
    same = all(math.isclose(single[k], parallel[k]) for k in single)
    print(f"  identical distribution across worker counts: {same}")

    # Show work splitting.
    print("\nWork split of 100 draws across 7 workers:",
          split_draws(100, 7), "(sums to", sum(split_draws(100, 7)), ")")
