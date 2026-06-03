"""SoapBox odds / simulation engine (queue #121).

Pure Python standard library only — no numpy/scipy. Implements:

  * Poisson goals model with Dixon-Coles low-score correction
  * Elo ratings as a team-strength input (expected score + rating update)
  * Per-match win / draw / loss probabilities (exact grid sum)
  * Monte Carlo simulator (configurable N draws, seedable, deterministic)
    producing tournament / win odds
  * implied_from_decimal(odds), overround(probs)
  * compare_true_vs_implied(true_probs, book_odds) — the vig / house-edge
    gap, which is the educational payoff of the whole module.

Everything is pure and deterministic where it can be: any randomness flows
through an explicit `seed` argument so results are reproducible.

The "education" framing: bookmakers quote decimal odds whose implied
probabilities sum to MORE than 1. That excess is the overround (a.k.a.
"the vig" or "juice"). `compare_true_vs_implied` makes the gap between a
fair model and the posted price legible.
"""

from __future__ import annotations

import math
import random
from collections import defaultdict

__all__ = [
    "poisson_pmf",
    "dixon_coles_tau",
    "score_matrix",
    "match_probabilities",
    "elo_expected_score",
    "elo_update",
    "elo_to_expected_goals",
    "EloModel",
    "simulate_match",
    "monte_carlo_match",
    "monte_carlo_tournament",
    "implied_from_decimal",
    "overround",
    "remove_overround",
    "compare_true_vs_implied",
]


# --------------------------------------------------------------------------
# Poisson goals model
# --------------------------------------------------------------------------

def poisson_pmf(k: int, lam: float) -> float:
    """Probability of exactly ``k`` events for a Poisson(lam) variable.

    Pure stdlib: uses math.exp / math.lgamma (no scipy). ``lam`` is the
    expected number of goals; ``k`` is a non-negative integer.
    """
    if k < 0:
        return 0.0
    if lam < 0:
        raise ValueError("lambda must be non-negative")
    if lam == 0:
        return 1.0 if k == 0 else 0.0
    # log-space for numerical stability with larger k.
    log_p = -lam + k * math.log(lam) - math.lgamma(k + 1)
    return math.exp(log_p)


def dixon_coles_tau(home_goals: int, away_goals: int,
                    lam_home: float, lam_away: float, rho: float) -> float:
    """Dixon-Coles low-score correction factor tau.

    The independent Poisson model misprices the four lowest scorelines
    (0-0, 1-0, 0-1, 1-1). Dixon & Coles (1997) introduce a dependence
    parameter ``rho`` that re-weights exactly those cells. ``rho`` is
    typically a small negative number (around -0.1) which lifts the
    probability of 0-0 and 1-1 (draws) and trims 1-0 / 0-1.
    """
    if home_goals == 0 and away_goals == 0:
        return 1.0 - lam_home * lam_away * rho
    if home_goals == 0 and away_goals == 1:
        return 1.0 + lam_home * rho
    if home_goals == 1 and away_goals == 0:
        return 1.0 + lam_away * rho
    if home_goals == 1 and away_goals == 1:
        return 1.0 - rho
    return 1.0


def score_matrix(lam_home: float, lam_away: float, max_goals: int = 10,
                 rho: float = 0.0) -> list[list[float]]:
    """Return a normalised (max_goals+1) x (max_goals+1) score grid.

    Cell ``[i][j]`` is P(home scores i, away scores j). When ``rho`` is
    non-zero the Dixon-Coles correction is applied to the four low-score
    cells. The grid is re-normalised so it sums to 1 (covering the small
    mass lost by truncating at ``max_goals`` and by the tau correction).
    """
    if lam_home < 0 or lam_away < 0:
        raise ValueError("expected goals must be non-negative")
    grid = [[0.0] * (max_goals + 1) for _ in range(max_goals + 1)]
    total = 0.0
    for i in range(max_goals + 1):
        ph = poisson_pmf(i, lam_home)
        for j in range(max_goals + 1):
            pa = poisson_pmf(j, lam_away)
            tau = dixon_coles_tau(i, j, lam_home, lam_away, rho)
            # tau can in principle drive a cell slightly negative for
            # extreme rho; clamp at 0 to keep a valid distribution.
            p = max(0.0, ph * pa * tau)
            grid[i][j] = p
            total += p
    if total > 0:
        for i in range(max_goals + 1):
            for j in range(max_goals + 1):
                grid[i][j] /= total
    return grid


def match_probabilities(lam_home: float, lam_away: float, max_goals: int = 10,
                        rho: float = 0.0) -> dict[str, float]:
    """Exact home-win / draw / away-win probabilities from the score grid.

    Returns a dict with keys ``home``, ``draw``, ``away`` summing to ~1.
    """
    grid = score_matrix(lam_home, lam_away, max_goals=max_goals, rho=rho)
    home = draw = away = 0.0
    for i in range(len(grid)):
        for j in range(len(grid)):
            p = grid[i][j]
            if i > j:
                home += p
            elif i == j:
                draw += p
            else:
                away += p
    return {"home": home, "draw": draw, "away": away}


# --------------------------------------------------------------------------
# Elo ratings as a team-strength input
# --------------------------------------------------------------------------

def elo_expected_score(rating_a: float, rating_b: float) -> float:
    """Elo expected score for A vs B (logistic, scale 400). In [0, 1]."""
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))


def elo_update(rating_a: float, rating_b: float, score_a: float,
               k: float = 20.0) -> tuple[float, float]:
    """Return updated (rating_a, rating_b) after a result.

    ``score_a`` is A's actual score: 1.0 win, 0.5 draw, 0.0 loss. Elo is
    zero-sum so B moves by the equal and opposite amount.
    """
    exp_a = elo_expected_score(rating_a, rating_b)
    delta = k * (score_a - exp_a)
    return rating_a + delta, rating_b - delta


def elo_to_expected_goals(rating_home: float, rating_away: float,
                          base_goals: float = 1.35,
                          home_advantage: float = 65.0,
                          goal_scale: float = 0.5) -> tuple[float, float]:
    """Map Elo ratings to a pair of Poisson expected-goals (lam_home, lam_away).

    The Elo expected score (with a home-field rating bump) is turned into
    a goal-supremacy via the log-odds, then split symmetrically around a
    league ``base_goals`` rate. ``goal_scale`` controls how strongly the
    Elo edge translates into a goal difference. Result feeds straight into
    the Poisson / Dixon-Coles model above.
    """
    exp_home = elo_expected_score(rating_home + home_advantage, rating_away)
    exp_home = min(max(exp_home, 1e-6), 1 - 1e-6)
    # supremacy in "logit" space; positive favours the home side.
    supremacy = math.log(exp_home / (1 - exp_home))
    lam_home = base_goals * math.exp(goal_scale * supremacy)
    lam_away = base_goals * math.exp(-goal_scale * supremacy)
    return lam_home, lam_away


class EloModel:
    """A tiny mutable Elo rating book for a set of teams.

    Deterministic: ratings only change when you call :meth:`record`.
    """

    def __init__(self, default_rating: float = 1500.0, k: float = 20.0):
        self.default_rating = default_rating
        self.k = k
        self.ratings: dict[str, float] = {}

    def rating(self, team: str) -> float:
        return self.ratings.get(team, self.default_rating)

    def expected(self, home: str, away: str,
                 home_advantage: float = 65.0) -> float:
        return elo_expected_score(self.rating(home) + home_advantage,
                                  self.rating(away))

    def record(self, home: str, away: str, home_score: float) -> None:
        """Update ratings after a match. ``home_score`` in {1.0, 0.5, 0.0}."""
        ra, rb = elo_update(self.rating(home), self.rating(away),
                            home_score, k=self.k)
        self.ratings[home] = ra
        self.ratings[away] = rb

    def expected_goals(self, home: str, away: str,
                       **kwargs) -> tuple[float, float]:
        return elo_to_expected_goals(self.rating(home), self.rating(away),
                                     **kwargs)

    def match_probabilities(self, home: str, away: str, rho: float = 0.0,
                            max_goals: int = 10) -> dict[str, float]:
        lam_h, lam_a = self.expected_goals(home, away)
        return match_probabilities(lam_h, lam_a, max_goals=max_goals, rho=rho)


# --------------------------------------------------------------------------
# Monte Carlo simulation
# --------------------------------------------------------------------------

def _sample_poisson(lam: float, rng: random.Random) -> int:
    """Knuth's algorithm — sample a Poisson(lam) using only random()."""
    if lam <= 0:
        return 0
    L = math.exp(-lam)
    k = 0
    p = 1.0
    while True:
        k += 1
        p *= rng.random()
        if p <= L:
            return k - 1


def simulate_match(lam_home: float, lam_away: float,
                   rng: random.Random) -> tuple[int, int]:
    """Sample a single (home_goals, away_goals) scoreline.

    Note: independent-Poisson sampling does not carry the Dixon-Coles
    low-score correction (that adjusts a continuous grid, not a draw); for
    score-grid-accurate probabilities use :func:`match_probabilities`.
    Monte Carlo here is for compounding many matches (tournaments).
    """
    return _sample_poisson(lam_home, rng), _sample_poisson(lam_away, rng)


def monte_carlo_match(lam_home: float, lam_away: float, n: int = 10000,
                      seed: int | None = None) -> dict[str, float]:
    """Estimate home/draw/away probabilities by simulating ``n`` matches.

    Deterministic for a fixed ``seed``. Converges to
    :func:`match_probabilities` (with rho=0) as n grows.
    """
    if n <= 0:
        raise ValueError("n must be positive")
    rng = random.Random(seed)
    home = draw = away = 0
    for _ in range(n):
        hg, ag = simulate_match(lam_home, lam_away, rng)
        if hg > ag:
            home += 1
        elif hg == ag:
            draw += 1
        else:
            away += 1
    return {"home": home / n, "draw": draw / n, "away": away / n}


def monte_carlo_tournament(matchups, n: int = 10000, seed: int | None = None,
                           points=(3, 1, 0)) -> dict[str, float]:
    """Simulate a round-robin tournament and return each team's title odds.

    ``matchups`` is an iterable of ``(home, away, lam_home, lam_away)``.
    Each of ``n`` simulated seasons plays every matchup, tallies points
    (win/draw/loss = ``points``), and credits the points leader with a
    title (ties split the credit). Returns ``{team: P(win title)}`` summing
    to ~1. Deterministic for a fixed ``seed``.
    """
    if n <= 0:
        raise ValueError("n must be positive")
    matchups = list(matchups)
    teams = set()
    for home, away, _, _ in matchups:
        teams.add(home)
        teams.add(away)
    win_pts, draw_pts, loss_pts = points
    titles: dict[str, float] = defaultdict(float)
    rng = random.Random(seed)
    for _ in range(n):
        table: dict[str, float] = {t: 0.0 for t in teams}
        for home, away, lam_h, lam_a in matchups:
            hg, ag = simulate_match(lam_h, lam_a, rng)
            if hg > ag:
                table[home] += win_pts
                table[away] += loss_pts
            elif hg == ag:
                table[home] += draw_pts
                table[away] += draw_pts
            else:
                table[home] += loss_pts
                table[away] += win_pts
        best = max(table.values())
        leaders = [t for t, p in table.items() if p == best]
        share = 1.0 / len(leaders)
        for t in leaders:
            titles[t] += share
    return {t: titles[t] / n for t in teams}


# --------------------------------------------------------------------------
# Odds / vig math — the education payoff
# --------------------------------------------------------------------------

def implied_from_decimal(odds: float) -> float:
    """Implied probability from a decimal odd. P = 1 / odds."""
    if odds <= 1.0:
        raise ValueError("decimal odds must be > 1.0")
    return 1.0 / odds


def overround(probs) -> float:
    """Sum of a set of implied probabilities.

    Accepts either an iterable of probabilities or a mapping. For a fair
    market this is 1.0; bookmakers post markets summing to >1, and the
    excess (``overround - 1``) is the house margin / vig.
    """
    values = probs.values() if isinstance(probs, dict) else probs
    return sum(values)


def remove_overround(implied) -> dict | list:
    """Normalise a set of implied probabilities back to sum 1 (the 'fair'
    no-vig estimate). Preserves dict vs list shape."""
    total = overround(implied)
    if total <= 0:
        raise ValueError("implied probabilities must sum to a positive value")
    if isinstance(implied, dict):
        return {k: v / total for k, v in implied.items()}
    return [v / total for v in implied]


def compare_true_vs_implied(true_probs: dict, book_odds: dict) -> dict:
    """Compare a fair model's probabilities against a book's posted odds.

    ``true_probs`` and ``book_odds`` are dicts over the same outcome keys
    (e.g. ``{"home":..,"draw":..,"away":..}``); ``book_odds`` holds decimal
    odds. Returns a report exposing the vig / house edge — the gap between
    what the book implies and a fair price:

      * ``implied``       — raw implied prob per outcome (sums > 1)
      * ``overround``     — sum of implied (e.g. 1.06)
      * ``vig``           — overround - 1 (the house's built-in margin)
      * ``vig_pct``       — vig as a percentage
      * ``fair_implied``  — implied with the overround removed (sums to 1)
      * ``edge``          — true_prob - fair_implied per outcome
                            (positive = a value bet vs the book's fair line)
      * ``edge_vs_raw``   — true_prob - raw implied per outcome
    """
    outcomes = list(true_probs.keys())
    missing = [o for o in outcomes if o not in book_odds]
    if missing:
        raise ValueError(f"book_odds missing outcomes: {missing}")

    implied = {o: implied_from_decimal(book_odds[o]) for o in outcomes}
    book_overround = overround(implied)
    vig = book_overround - 1.0
    fair_implied = remove_overround(implied)

    edge = {o: true_probs[o] - fair_implied[o] for o in outcomes}
    edge_vs_raw = {o: true_probs[o] - implied[o] for o in outcomes}

    return {
        "implied": implied,
        "overround": book_overround,
        "vig": vig,
        "vig_pct": vig * 100.0,
        "fair_implied": fair_implied,
        "edge": edge,
        "edge_vs_raw": edge_vs_raw,
    }


# --------------------------------------------------------------------------
# Demo
# --------------------------------------------------------------------------

if __name__ == "__main__":
    print("SoapBox odds engine — demo\n" + "=" * 40)

    # 1. Two teams via Elo.
    book = EloModel()
    book.ratings["Lions"] = 1650.0
    book.ratings["Bears"] = 1500.0
    lam_h, lam_a = book.expected_goals("Lions", "Bears")
    print(f"\nElo: Lions 1650 (home) vs Bears 1500")
    print(f"  expected goals -> Lions {lam_h:.2f}, Bears {lam_a:.2f}")

    # 2. Exact match probabilities, plain Poisson vs Dixon-Coles.
    plain = match_probabilities(lam_h, lam_a, rho=0.0)
    dc = match_probabilities(lam_h, lam_a, rho=-0.1)
    print("\nMatch probabilities (exact grid):")
    print(f"  Poisson      : home {plain['home']:.3f} "
          f"draw {plain['draw']:.3f} away {plain['away']:.3f}")
    print(f"  Dixon-Coles  : home {dc['home']:.3f} "
          f"draw {dc['draw']:.3f} away {dc['away']:.3f}")
    print(f"  (DC lifts draw by {dc['draw'] - plain['draw']:+.4f})")

    # 3. Monte Carlo cross-check.
    mc = monte_carlo_match(lam_h, lam_a, n=50000, seed=42)
    print("\nMonte Carlo (n=50000, seed=42):")
    print(f"  home {mc['home']:.3f} draw {mc['draw']:.3f} away {mc['away']:.3f}")

    # 4. The education payoff: true vs book odds.
    book_odds = {"home": 1.80, "draw": 3.50, "away": 4.50}
    report = compare_true_vs_implied(plain, book_odds)
    print("\nTrue model vs book odds (the vig):")
    print(f"  book odds      : {book_odds}")
    print(f"  overround      : {report['overround']:.4f}")
    print(f"  vig / house edge: {report['vig_pct']:.2f}%")
    print(f"  fair (no-vig)  : "
          + ", ".join(f"{k} {v:.3f}" for k, v in report['fair_implied'].items()))
    print(f"  your edge      : "
          + ", ".join(f"{k} {v:+.3f}" for k, v in report['edge'].items()))

    # 5. Mini tournament.
    matchups = [
        ("Lions", "Bears", lam_h, lam_a),
        ("Bears", "Lions", *book.expected_goals("Bears", "Lions")),
        ("Lions", "Wolves", *book.expected_goals("Lions", "Wolves")),
        ("Wolves", "Bears", *book.expected_goals("Wolves", "Bears")),
    ]
    odds = monte_carlo_tournament(matchups, n=20000, seed=7)
    print("\nTournament title odds (n=20000, seed=7):")
    for team, p in sorted(odds.items(), key=lambda kv: -kv[1]):
        print(f"  {team:8s} {p:.3f}")
