"""The detective: decides which products caused a reaction and which ingredients explain it.

Method, the same logic dermatologists use when they compare labels by hand:
  1. For each product, compare skin scores before and after the start date.
  2. Label it "reaction", "tolerated", "unclear", or "not enough data".
  3. Ingredients found in reaction products but not in tolerated ones are suspects.
     An ingredient that you used safely in another product is cleared.
"""

from datetime import date, timedelta
from statistics import mean, pstdev

from .ingredients import families_of, family_note

# How much each concern counts towards the irritation index. Contact reactions show
# up mostly as redness, then breakouts and rough texture.
WEIGHTS = {"redness": 0.5, "acne": 0.3, "texture": 0.2}
BEFORE_DAYS = 10    # baseline window before starting a product
AFTER_START = 1     # reactions rarely show the same day
AFTER_DAYS = 10     # most irritant and allergic reactions appear within this window
OVERLAP_DAYS = 4    # two products started this close together cannot be told apart
MIN_POINTS = 2      # check-ins needed in each window
MIN_EFFECT = 6.0    # smallest worsening (index points) we call a reaction
TOLERATED_MAX = 2.5

DOSE_DEPENDENT = {"Chemical exfoliants (acids)", "Retinoids", "Drying alcohols"}

CONCERN_LABELS = {"redness": "redness", "acne": "breakouts", "texture": "texture"}


def _d(value) -> date:
    return value if isinstance(value, date) else date.fromisoformat(str(value)[:10])


def irritation_index(scores: dict) -> float | None:
    """0 = calm skin, 100 = very irritated. YouCam ui_scores are higher-is-healthier."""
    parts = [(w, scores[c]) for c, w in WEIGHTS.items() if scores.get(c) is not None]
    if not parts:
        return None
    total = sum(w for w, _ in parts)
    return round(100 - sum(w * s for w, s in parts) / total, 1)


def _window(checkins, start: date, end: date):
    return [c for c in checkins if start <= _d(c["date"]) < end]


def _mean_scores(window) -> dict:
    keys = {k for c in window for k in c["scores"]}
    return {k: round(mean(c["scores"][k] for c in window if k in c["scores"]), 1) for k in sorted(keys)}


def evaluate_product(product: dict, checkins: list[dict], all_products: list[dict]) -> dict:
    start = _d(product["start_date"])
    after_end = start + timedelta(days=AFTER_DAYS + 1)
    if product.get("stop_date"):
        after_end = min(after_end, _d(product["stop_date"]) + timedelta(days=1))

    before = _window(checkins, start - timedelta(days=BEFORE_DAYS), start)
    after = _window(checkins, start + timedelta(days=AFTER_START), after_end)

    overlapping = [
        p["name"] for p in all_products
        if p["id"] != product["id"] and abs((_d(p["start_date"]) - start).days) <= OVERLAP_DAYS
    ]
    result = {
        "product_id": product["id"],
        "before_n": len(before),
        "after_n": len(after),
        "overlapping": overlapping,
        "delta": None,
        "concern_deltas": {},
        "verdict": "not enough data",
        "confidence": "low",
        "explanation": "",
    }
    if checkins and start < _d(checkins[0]["date"]):
        return _evaluate_routine(product, checkins, result)

    if len(before) < MIN_POINTS or len(after) < MIN_POINTS:
        missing = []
        if len(before) < MIN_POINTS:
            missing.append(f"{MIN_POINTS - len(before)} more check-in(s) before you started it")
        if len(after) < MIN_POINTS:
            missing.append(f"{MIN_POINTS - len(after)} more check-in(s) after")
        result["explanation"] = "Needs " + " and ".join(missing) + "."
        return result

    before_idx = [i for c in before if (i := irritation_index(c["scores"])) is not None]
    after_idx = [i for c in after if (i := irritation_index(c["scores"])) is not None]
    delta = round(mean(after_idx) - mean(before_idx), 1)
    # Average scores on each side of the start date, for the before/after comparison in the app.
    result["before_index"] = round(mean(before_idx), 1)
    result["after_index"] = round(mean(after_idx), 1)
    result["before_scores"] = _mean_scores(before)
    result["after_scores"] = _mean_scores(after)
    noise = pstdev(before_idx) if len(before_idx) > 1 else 0.0
    threshold = max(MIN_EFFECT, 2 * noise)

    for concern in WEIGHTS:
        b = [c["scores"][concern] for c in before if concern in c["scores"]]
        a = [c["scores"][concern] for c in after if concern in c["scores"]]
        if b and a:
            # positive = this concern got worse
            result["concern_deltas"][concern] = round(mean(b) - mean(a), 1)

    result["delta"] = delta
    worst = max(result["concern_deltas"].items(), key=lambda kv: kv[1], default=(None, 0))
    if delta >= threshold:
        result["verdict"] = "reaction"
        result["explanation"] = (
            f"Skin irritation rose by {delta} points in the {AFTER_DAYS} days after starting it"
            + (f", mostly {CONCERN_LABELS[worst[0]]} ({worst[1]:.0f} points worse)." if worst[0] and worst[1] > 0 else ".")
        )
    elif delta <= TOLERATED_MAX:
        result["verdict"] = "tolerated"
        if delta <= -MIN_EFFECT:
            result["explanation"] = "Your skin got calmer after starting it (it may also have been recovering from something else)."
        else:
            result["explanation"] = "No meaningful change in redness, breakouts, or texture."
    else:
        result["verdict"] = "unclear"
        result["explanation"] = f"Slight change ({delta:+} points), within the range of a normal day-to-day swing."

    result["confidence"] = "high" if len(before) >= 4 and len(after) >= 4 else "medium"
    if overlapping:
        result["confidence"] = "low"
        result["explanation"] += f" Started within {OVERLAP_DAYS} days of {', '.join(overlapping)}, so the two cannot be fully separated."
    return result


def _evaluate_routine(product: dict, checkins: list[dict], result: dict) -> dict:
    """Products already in use when tracking began have no "before" period.

    If the skin keeps returning to its calm level while the product is in use, the
    product cannot be causing a lasting reaction, so it counts as tolerated.
    """
    stop = _d(product["stop_date"]) if product.get("stop_date") else None
    in_use = [c for c in checkins if stop is None or _d(c["date"]) <= stop]
    all_idx = sorted(i for c in checkins if (i := irritation_index(c["scores"])) is not None)
    use_idx = sorted(i for c in in_use if (i := irritation_index(c["scores"])) is not None)
    result["after_n"] = len(use_idx)
    if len(use_idx) < 4:
        result["explanation"] = "Already in your routine before tracking began. Needs a few more check-ins to judge."
        return result
    calm_level = all_idx[len(all_idx) // 10]  # 10th percentile of all check-ins
    typical = use_idx[len(use_idx) // 4]      # skin on its better days while using it
    if typical - calm_level <= MIN_EFFECT / 2:
        result["verdict"] = "tolerated"
        result["confidence"] = "medium"
        result["explanation"] = "Already in your routine before tracking began, and your skin stays calm while you use it."
    else:
        result["verdict"] = "unclear"
        result["explanation"] = "Already in your routine before tracking began, and your skin rarely looks calm while using it. Consider pausing it for 2 weeks."
    return result


def _suspect_rows(items_by_product, reactive, tolerated, kind):
    """Rank items (ingredients or families) by how well they separate reactions from tolerated products."""
    total_reactive = sum(reactive.values())
    candidates = set()
    for pid in reactive:
        candidates |= items_by_product[pid]

    rows = []
    for item in candidates:
        in_reactive = [pid for pid in reactive if item in items_by_product[pid]]
        in_tolerated = [pid for pid in tolerated if item in items_by_product[pid]]
        r = sum(reactive[pid] for pid in in_reactive)
        # Smoothed ratio: share of reactions containing it vs share of safe products containing it.
        score = ((r + 0.5) / (total_reactive + 1)) / ((len(in_tolerated) + 0.5) / (len(tolerated) + 1))
        if in_tolerated:
            # Using it safely elsewhere clears it, unless it is an irritant whose effect
            # depends on concentration (a 10% acid can sting where a 1% acid does not).
            dose_dependent = kind == "ingredient" and any(f in DOSE_DEPENDENT for f in families_of(item))
            level = "weak" if dose_dependent and len(in_tolerated) < len(in_reactive) else "cleared"
        elif len(in_reactive) >= 2 and len(in_reactive) == len(reactive):
            level = "strong"
        elif len(in_reactive) >= 2:
            level = "likely"
        else:
            level = "possible"
        rows.append({
            "name": item,
            "kind": kind,
            "score": round(score, 2),
            "level": level,
            "in_reactive": in_reactive,
            "in_tolerated": in_tolerated,
            "families": families_of(item) if kind == "ingredient" else [],
            "note": family_note(item) if kind == "family" else "",
        })
    order = {"strong": 0, "likely": 1, "possible": 2, "weak": 3, "cleared": 4}
    rows.sort(key=lambda row: (order[row["level"]], -row["score"], row["name"]))
    return rows


def find_culprits(products: list[dict], evaluations: dict[int, dict]) -> dict:
    # Products started together with another one count half: we cannot be sure which caused it.
    reactive = {
        pid: (0.5 if ev["overlapping"] else 1.0)
        for pid, ev in evaluations.items() if ev["verdict"] == "reaction"
    }
    tolerated = [pid for pid, ev in evaluations.items() if ev["verdict"] == "tolerated"]
    by_id = {p["id"]: p for p in products}

    ingredients = {pid: set(p["ingredients"]) for pid, p in by_id.items()}
    families = {pid: {f for i in p["ingredients"] for f in families_of(i)} for pid, p in by_id.items()}

    result = {
        "reactive": list(reactive),
        "tolerated": tolerated,
        "families": [],
        "ingredients": [],
        "next_step": "",
    }
    if not reactive:
        result["next_step"] = (
            "No reactions detected yet. Keep checking in daily and add one new product at a time, "
            "about a week apart, so each one can be judged on its own."
        )
        return result

    result["families"] = [f for f in _suspect_rows(families, reactive, tolerated, "family") if f["level"] != "cleared"]
    all_ingredients = _suspect_rows(ingredients, reactive, tolerated, "ingredient")
    result["ingredients"] = [i for i in all_ingredients if i["level"] != "cleared"][:15]
    result["cleared_count"] = sum(1 for i in all_ingredients if i["level"] == "cleared")
    result["next_step"] = _next_step(result, by_id, tolerated)
    return result


def _next_step(result, by_id, tolerated) -> str:
    top = [i for i in result["ingredients"] if i["level"] in ("strong", "likely", "possible")]
    if not top:
        return "Your reactions do not share an obvious ingredient yet. Log a few more products to narrow it down."
    if len(result["reactive"]) == 1:
        return (
            f"Only one reaction so far, so {len(top)} ingredients are still possible. "
            "Every product you tolerate clears more of them; the next reaction will narrow it down fast."
        )
    tied = [i for i in top if i["level"] == top[0]["level"] and i["score"] == top[0]["score"]]
    if len(tied) > 1:
        names = ", ".join(i["name"] for i in tied[:4])
        return (
            f"{len(tied)} ingredients are tied ({names}). A product that contains only one of them "
            "would tell them apart. Use the Shop check to find one."
        )
    return f"Strongest suspect: {top[0]['name']}. Avoid it for 3 to 4 weeks and watch whether your skin settles."


def check_product(ingredients: list[str], culprits: dict) -> dict:
    """Shop mode: compare a product's label with the current suspect list."""
    bad_levels = {"strong": "avoid", "likely": "avoid", "possible": "caution", "weak": "caution"}
    hits = []
    for row in culprits.get("ingredients", []):
        if row["name"] in ingredients and row["level"] in bad_levels:
            hits.append({"name": row["name"], "level": row["level"], "kind": "ingredient"})
    product_families = {f for i in ingredients for f in families_of(i)}
    for row in culprits.get("families", []):
        if row["name"] in product_families and row["level"] in ("strong", "likely"):
            members = [i for i in ingredients if row["name"] in families_of(i)]
            hits.append({"name": row["name"], "level": row["level"], "kind": "family", "members": members})

    if any(bad_levels[h["level"]] == "avoid" for h in hits):
        verdict = "avoid"
    elif hits:
        verdict = "caution"
    else:
        verdict = "looks safe"
    return {"verdict": verdict, "hits": hits, "ingredient_count": len(ingredients)}
