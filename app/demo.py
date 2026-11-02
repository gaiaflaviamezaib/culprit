"""A realistic 6-week demo story so the app can be shown without weeks of real check-ins.

Story: three routine products are fine. A vitamin C serum and later a rose night cream
both cause redness. Both contain fragrance and linalool; everything else they share is
also in products she tolerates, so the detective narrows it down to the fragrance.
"""

import random
import time
from datetime import date, timedelta

from . import db, demo_photos
from .ingredients import parse_ingredients

PRODUCTS = [
    # name, brand, category, start day, stop day, ingredients
    ("Gentle Cream Cleanser", "Demo Basics", "Cleanser", -60, None,
     "Water, Glycerin, Sodium Cocoyl Isethionate, Cocamidopropyl Betaine, Cetearyl Alcohol, Panthenol, "
     "Xanthan Gum, Citric Acid, Phenoxyethanol"),
    ("Barrier Repair Moisturizer", "Demo Basics", "Moisturizer", -60, None,
     "Aqua, Glycerin, Caprylic/Capric Triglyceride, Cetearyl Alcohol, Dimethicone, Niacinamide, Ceramide NP, "
     "Sodium Hyaluronate, Tocopherol, Phenoxyethanol, Ethylhexylglycerin, Carbomer"),
    ("Mineral Sunscreen SPF 50", "Demo Basics", "Sunscreen", -60, None,
     "Zinc Oxide 18%, Caprylic/Capric Triglyceride, Water, Glycerin, Dimethicone, Tocopherol, Cetearyl Alcohol, "
     "Xanthan Gum, Phenoxyethanol"),
    ("Glow Vitamin C Serum", "Radiance Lab", "Serum", 7, 15,
     "Water, Ascorbic Acid, Glycerin, Propanediol, Ferulic Acid, Tocopherol, Phenoxyethanol, Parfum (Fragrance), "
     "Linalool, Limonene, Citric Acid, Xanthan Gum"),
    ("10% Niacinamide Serum", "Plain Actives", "Serum", 20, None,
     "Aqua (Water), Niacinamide, Zinc PCA, Glycerin, Propanediol, Xanthan Gum, Phenoxyethanol, Ethylhexylglycerin"),
    ("Hydrating Toner", "Plain Actives", "Toner", 26, None,
     "Water, Glycerin, Alcohol Denat., Panthenol, Sodium Hyaluronate, Allantoin, Phenoxyethanol"),
    ("Rose Night Cream", "Maison Petale", "Moisturizer", 33, 39,
     "Aqua, Caprylic/Capric Triglyceride, Glycerin, Cetearyl Alcohol, Butyrospermum Parkii (Shea) Butter, "
     "Dimethicone, Rosa Damascena Flower Water, Parfum, Citronellol, Geraniol, Linalool, Phenoxyethanol, "
     "Ethylhexylglycerin, Xanthan Gum, Tocopherol"),
]

# Worsening of ui_score (points) at full effect, per reactive product.
REACTIONS = {
    "Glow Vitamin C Serum": {"redness": 16, "acne": 7, "texture": 6},
    "Rose Night Cream": {"redness": 14, "acne": 5, "texture": 8},
}

BASELINE = {"redness": 74, "acne": 76, "texture": 71, "pore": 68, "oiliness": 66, "moisture": 70}
DAYS = 44
SKIPPED = {12, 23, 30, 41}  # real people miss days

# Products for the in-store "Shop check" demo (fictional barcodes).
SHOP_CATALOG = {
    "DEMO-LAVENDER": ("Lavender Calm Body Lotion", "Fields & Co",
                      "Water, Glycerin, Cetearyl Alcohol, Shea Butter, Lavandula Angustifolia (Lavender) Oil, "
                      "Fragrance, Linalool, Phenoxyethanol"),
    "DEMO-FRAGFREE": ("Fragrance-Free Barrier Cream", "Plain Actives",
                      "Water, Glycerin, Dimethicone, Ceramide NP, Panthenol, Sodium Hyaluronate, Phenoxyethanol"),
    "DEMO-FACEOIL": ("Botanical Face Oil (no added perfume)", "Herbier",
                     "Squalane, Simmondsia Chinensis (Jojoba) Seed Oil, Tocopherol, Linalool"),
}


# Shop checks pinned on the store map (fictional stores around New York).
VISITS = [
    ("Pharmacy, SoHo", 40.7233, -74.0030, -30, "Lavender Calm Body Lotion", "avoid"),
    ("Beauty store, Williamsburg", 40.7081, -73.9571, -22, "Fragrance-Free Barrier Cream", "looks safe"),
    ("Drugstore, Upper West Side", 40.7870, -73.9754, -16, "Botanical Face Oil (no added perfume)", "caution"),
    ("Pharmacy, Astoria", 40.7644, -73.9235, -9, "Rose Body Mist", "avoid"),
    ("Organic shop, Park Slope", 40.6710, -73.9814, -4, "Unscented Mineral Sunscreen", "looks safe"),
]


def shop_product(barcode: str) -> dict | None:
    item = SHOP_CATALOG.get(barcode.upper())
    if not item:
        return None
    name, brand, text = item
    category = {"DEMO-LAVENDER": "Body care", "DEMO-FRAGFREE": "Moisturizer", "DEMO-FACEOIL": "Serum"}[barcode.upper()]
    return {"name": name, "brand": brand, "barcode": barcode.upper(), "category": category,
            "ingredients": parse_ingredients(text), "source": "Demo catalog"}


def _effect(day: int, start: int, stop: int | None) -> float:
    """Reaction strength: builds over 3 days, fades over 4 days after stopping."""
    if day <= start:
        return 0.0
    ramp = min(1.0, (day - start) * 0.4)
    if stop is not None and day > stop:
        ramp *= max(0.0, 1 - (day - stop) / 4)
    return ramp


def seed(conn) -> None:
    db.reset(conn)
    day0 = date.today() - timedelta(days=DAYS)
    for name, brand, category, start, stop, text in PRODUCTS:
        pid = db.add_product(conn, name, brand, "", category, parse_ingredients(text), (day0 + timedelta(days=start)).isoformat())
        if stop is not None:
            db.stop_product(conn, pid, (day0 + timedelta(days=stop)).isoformat())

    demo_photos.clear()
    stamp = f"{int(time.time()):x}-"
    rng = random.Random(7)
    timing = {name: (start, stop) for name, _, _, start, stop, _ in PRODUCTS}
    for day in range(DAYS + 1):
        if day in SKIPPED:
            continue
        scores = {}
        for concern, base in BASELINE.items():
            value = base + rng.uniform(-2.2, 2.2)
            for product, hit in REACTIONS.items():
                value -= hit.get(concern, 0) * _effect(day, *timing[product])
            scores[concern] = int(round(value))
        photo = demo_photos.render(day, scores, BASELINE, stamp)
        db.add_checkin(conn, (day0 + timedelta(days=day)).isoformat(), scores, skin_age=27 + rng.randint(-1, 1), photo=photo, mock=True)
    for store, lat, lng, offset, product, verdict in VISITS:
        db.add_visit(conn, store, lat, lng, (date.today() + timedelta(days=offset)).isoformat(), product, verdict)
