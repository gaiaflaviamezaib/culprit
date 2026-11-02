"""Ingredient parsing, normalization, irritant families, and barcode lookup."""

import re

import httpx

# Different labels for the same ingredient.
SYNONYMS = {
    "aqua": "water",
    "eau": "water",
    "water/aqua": "water",
    "aqua/water": "water",
    "parfum": "fragrance",
    "perfume": "fragrance",
    "parfum/fragrance": "fragrance",
    "fragrance/parfum": "fragrance",
    "aroma": "fragrance",
    "alcohol denat.": "alcohol denat",
    "sd alcohol": "alcohol denat",
    "sd alcohol 40": "alcohol denat",
    "ethanol": "alcohol",
    "vitamin e": "tocopherol",
    "vitamin c": "ascorbic acid",
}

# Ingredient groups that are common causes of skin irritation or contact allergy.
# Grouping matters: a person who reacts to "fragrance" often reacts to the
# individual fragrance allergens listed separately on the label.
FAMILIES = {
    "Fragrance and fragrance allergens": {
        "exact": {
            "fragrance", "linalool", "limonene", "d-limonene", "citronellol", "geraniol", "eugenol",
            "isoeugenol", "coumarin", "citral", "hexyl cinnamal", "amyl cinnamal", "benzyl salicylate",
            "benzyl benzoate", "benzyl cinnamate", "cinnamal", "cinnamyl alcohol", "farnesol",
            "hydroxycitronellal", "alpha-isomethyl ionone", "butylphenyl methylpropional",
            "anise alcohol", "evernia prunastri extract", "evernia furfuracea extract",
            "amylcinnamyl alcohol", "methyl 2-octynoate",
        },
        "contains": [],
        "note": "The most common cause of cosmetic contact allergy.",
    },
    "Essential oils": {
        "exact": set(),
        "contains": [
            "lavandula", "lavender oil", "citrus aurantium", "citrus limon", "citrus sinensis",
            "citrus bergamia", "mentha piperita", "peppermint oil", "eucalyptus", "melaleuca",
            "tea tree", "rosmarinus", "rosa damascena flower oil", "cymbopogon", "ylang",
        ],
        "note": "Natural, but packed with fragrance allergens.",
    },
    "Isothiazolinone preservatives": {
        "exact": {"methylisothiazolinone", "methylchloroisothiazolinone"},
        "contains": ["isothiazolinone"],
        "note": "Strong sensitizers, restricted in leave-on products in the EU.",
    },
    "Formaldehyde releasers": {
        "exact": {
            "dmdm hydantoin", "imidazolidinyl urea", "diazolidinyl urea", "quaternium-15",
            "2-bromo-2-nitropropane-1,3-diol", "sodium hydroxymethylglycinate", "bronopol",
        },
        "contains": [],
        "note": "Preservatives that slowly release formaldehyde.",
    },
    "Parabens": {"exact": set(), "contains": ["paraben"], "note": "Rarely a problem, but some people react."},
    "Drying alcohols": {
        "exact": {"alcohol denat", "alcohol", "isopropyl alcohol"},
        "contains": [],
        "note": "Can dry out and irritate sensitive skin.",
    },
    "Chemical exfoliants (acids)": {
        "exact": {"glycolic acid", "lactic acid", "salicylic acid", "mandelic acid", "gluconolactone"},
        "contains": [],
        "note": "Irritating when overused or combined.",
    },
    "Retinoids": {
        "exact": {"retinol", "retinal", "retinaldehyde", "retinyl palmitate", "hydroxypinacolone retinoate"},
        "contains": [],
        "note": "Redness and peeling are common in the first weeks.",
    },
    "Sulfate surfactants": {
        "exact": {"sodium lauryl sulfate", "sodium laureth sulfate", "ammonium lauryl sulfate"},
        "contains": [],
        "note": "Harsh cleansers that can strip the skin barrier.",
    },
    "Lanolin": {"exact": {"lanolin", "lanolin alcohol"}, "contains": [], "note": "Wool wax, a known allergen."},
    "Propylene glycol": {"exact": {"propylene glycol"}, "contains": [], "note": "Irritant for some people."},
    "Cocamidopropyl betaine": {"exact": {"cocamidopropyl betaine"}, "contains": [], "note": "Mild surfactant, occasional allergen."},
}

_LABEL = re.compile(r"^\s*(ingredients|ingr[eé]dients|composition|inci)\s*:?", re.IGNORECASE)


def normalize(name: str) -> str:
    name = name.lower().strip()
    name = re.sub(r"\([^)]*\)", " ", name)  # "avena sativa (oat) kernel" -> "avena sativa kernel"
    name = re.sub(r"[*•†‡]|\d+([.,]\d+)?\s*%", " ", name)
    name = re.sub(r"\s+", " ", name).strip(" .;:-")
    return SYNONYMS.get(name, name)


def parse_ingredients(text: str) -> list[str]:
    """Split a label's ingredient text into a clean, de-duplicated list."""
    if not text:
        return []
    text = _LABEL.sub("", text.strip())
    # Some labels end with "may contain (+/-): CI 77491, ..." which we keep as normal ingredients.
    text = re.sub(r"may contain\s*(\(\+/-\))?\s*:?", ",", text, flags=re.IGNORECASE)
    parts = re.split(r",|;|\n| - | • |•", text)
    seen, result = set(), []
    for part in parts:
        name = normalize(part)
        if len(name) < 2 or len(name) > 70 or sum(ch.isdigit() for ch in name) > len(name) / 2:
            continue
        if name not in seen:
            seen.add(name)
            result.append(name)
    return result


def families_of(ingredient: str) -> list[str]:
    found = []
    for family, rule in FAMILIES.items():
        if ingredient in rule["exact"] or any(word in ingredient for word in rule["contains"]):
            found.append(family)
    return found


def family_note(family: str) -> str:
    return FAMILIES.get(family, {}).get("note", "")


async def lookup_barcode(barcode: str) -> dict | None:
    """Look a product up in Open Beauty Facts (free, open database)."""
    url = f"https://world.openbeautyfacts.org/api/v2/product/{barcode}.json"
    params = {"fields": "product_name,brands,ingredients_text,ingredients_text_en,ingredients_text_fr,image_front_url,image_front_small_url"}
    try:
        async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "Culprit/0.1 (hackathon project)"}) as client:
            data = (await client.get(url, params=params)).json()
    except (httpx.HTTPError, ValueError):
        return None
    if data.get("status") != 1:
        return None
    product = data.get("product", {})
    text = product.get("ingredients_text_en") or product.get("ingredients_text") or product.get("ingredients_text_fr") or ""
    return {
        "name": product.get("product_name") or "Unknown product",
        "brand": (product.get("brands") or "").split(",")[0].strip(),
        "barcode": barcode,
        "ingredients": parse_ingredients(text),
        "image": product.get("image_front_url") or product.get("image_front_small_url") or "",
        "source": "Open Beauty Facts",
    }
