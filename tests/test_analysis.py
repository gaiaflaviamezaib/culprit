import unittest
from datetime import date, timedelta

from app import analysis
from app.ingredients import families_of, parse_ingredients


def checkins(start: date, values: list[int]) -> list[dict]:
    """values = redness ui_scores per day; other concerns stay flat."""
    return [
        {"date": (start + timedelta(days=i)).isoformat(), "scores": {"redness": v, "acne": 75, "texture": 70}}
        for i, v in enumerate(values)
    ]


class ParseTests(unittest.TestCase):
    def test_label_cleanup_and_synonyms(self):
        text = "Ingredients: Aqua (Water), Glycerin, Parfum*, Zinc Oxide 18%, Alcohol Denat., Glycerin"
        self.assertEqual(parse_ingredients(text), ["water", "glycerin", "fragrance", "zinc oxide", "alcohol denat"])

    def test_families(self):
        self.assertIn("Fragrance and fragrance allergens", families_of("linalool"))
        self.assertIn("Parabens", families_of("methylparaben"))
        self.assertIn("Essential oils", families_of("lavandula angustifolia oil"))


class EvaluateTests(unittest.TestCase):
    def setUp(self):
        self.day0 = date(2026, 9, 1)

    def product(self, pid, start_day, ingredients, stop_day=None):
        return {
            "id": pid,
            "name": f"P{pid}",
            "ingredients": ingredients,
            "start_date": (self.day0 + timedelta(days=start_day)).isoformat(),
            "stop_date": (self.day0 + timedelta(days=stop_day)).isoformat() if stop_day else None,
        }

    def test_reaction_detected(self):
        p = self.product(1, 7, ["fragrance"])
        data = checkins(self.day0, [75] * 8 + [55] * 8)
        result = analysis.evaluate_product(p, data, [p])
        self.assertEqual(result["verdict"], "reaction")

    def test_tolerated(self):
        p = self.product(1, 7, ["water"])
        data = checkins(self.day0, [75, 74, 76, 75, 75, 74, 76, 75, 75, 76, 74, 75, 75, 76])
        self.assertEqual(analysis.evaluate_product(p, data, [p])["verdict"], "tolerated")

    def test_not_enough_data(self):
        p = self.product(1, 7, ["water"])
        data = checkins(self.day0, [75] * 9)
        self.assertEqual(analysis.evaluate_product(p, data, [p])["verdict"], "not enough data")

    def test_overlap_lowers_confidence(self):
        a = self.product(1, 7, ["fragrance"])
        b = self.product(2, 8, ["water"])
        data = checkins(self.day0, [75] * 8 + [55] * 8)
        result = analysis.evaluate_product(a, data, [a, b])
        self.assertEqual(result["confidence"], "low")
        self.assertEqual(result["overlapping"], ["P2"])


class CulpritTests(unittest.TestCase):
    def test_shared_ingredient_is_cleared_by_tolerated_product(self):
        products = [
            {"id": 1, "name": "A", "ingredients": ["water", "glycerin", "fragrance"]},
            {"id": 2, "name": "B", "ingredients": ["water", "fragrance", "linalool"]},
            {"id": 3, "name": "C", "ingredients": ["water", "glycerin"]},
        ]
        evaluations = {
            1: {"verdict": "reaction", "overlapping": []},
            2: {"verdict": "reaction", "overlapping": []},
            3: {"verdict": "tolerated", "overlapping": []},
        }
        result = analysis.find_culprits(products, evaluations)
        names = {row["name"]: row["level"] for row in result["ingredients"]}
        self.assertEqual(names["fragrance"], "strong")
        self.assertEqual(names["linalool"], "possible")
        self.assertNotIn("water", names)
        self.assertNotIn("glycerin", names)

        check = analysis.check_product(["water", "fragrance"], result)
        self.assertEqual(check["verdict"], "avoid")
        self.assertEqual(analysis.check_product(["water", "glycerin"], result)["verdict"], "looks safe")


if __name__ == "__main__":
    unittest.main()
