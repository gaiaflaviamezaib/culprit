"""Daily demo selfies for the photo diary.

Each demo day reuses a real selfie and adds redness on the cheeks, nose and chin and small
blemishes in proportion to that day's simulated scores. The selfies come from data/selfies/
(your own photos, imported with scripts/import_selfies.py and never committed); without them
one stock portrait (Unsplash, free licence) is used. The redness is labelled as simulated in
the app and these images are never sent to the YouCam API.
"""

import json
import random

from . import config

try:
    from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter
except ImportError:  # the demo still works without photos
    Image = None

BASE = config.ROOT / "static" / "demo" / "face.jpg"
SELFIES = config.DATA_DIR / "selfies"

# Face regions on the 600 x 800 base portrait: (centre x, centre y, radius x, radius y, weight).
REDNESS_ZONES = [
    (192, 405, 78, 68, 1.0),   # left cheek
    (408, 405, 78, 68, 1.0),   # right cheek
    (300, 360, 34, 48, 0.8),   # nose
    (300, 568, 62, 34, 0.55),  # chin
]
BLEMISH_AREA = [(150, 330, 250, 480), (350, 330, 450, 480), (240, 540, 360, 600), (230, 160, 370, 230)]


def available() -> bool:
    return Image is not None and BASE.exists()


def _selfies() -> dict:
    try:
        return json.loads((SELFIES / "zones.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _base_for(day: int):
    """The photo for one day with its redness zones and blemish areas."""
    selfies = _selfies()
    names = sorted(n for n in selfies if (SELFIES / n).exists())
    if not names:
        return Image.open(BASE), REDNESS_ZONES, BLEMISH_AREA
    # Shuffle once per pass through the set so the diary does not repeat in the same order.
    order = names[:]
    random.Random(day // len(names)).shuffle(order)
    name = order[day % len(names)]
    return Image.open(SELFIES / name), selfies[name]["zones"], selfies[name]["spots"]


def clear() -> None:
    """Remove the previous demo photos (generated files only)."""
    for old in config.PHOTO_DIR.glob("demo-*.jpg"):
        old.unlink(missing_ok=True)


def render(day: int, scores: dict, baseline: dict, stamp: str = "") -> str | None:
    """Save the selfie for one demo day and return its file name in the photo folder."""
    if not available():
        return None
    rng = random.Random(1000 + day)
    base, zones, spots_area = _base_for(day)
    base = base.convert("RGB")
    # Small day-to-day changes in light, like real selfies.
    base = ImageEnhance.Brightness(base).enhance(rng.uniform(0.96, 1.04))

    redness = max(0.0, min(1.2, (baseline["redness"] - scores["redness"]) / 16))
    if redness > 0.05:
        mask = Image.new("L", base.size, 0)
        draw = ImageDraw.Draw(mask)
        for x, y, rx, ry, weight in zones:
            draw.ellipse((x - rx, y - ry, x + rx, y + ry), fill=int(255 * min(0.62, redness * weight * 0.55)))
        mask = mask.filter(ImageFilter.GaussianBlur(38))
        flushed = ImageChops.multiply(base, Image.new("RGB", base.size, (255, 172, 178)))
        base = Image.composite(flushed, base, mask)

    # Only a real flare-up adds spots, not the normal day-to-day wobble.
    blemishes = int(round(max(0, baseline["acne"] - scores["acne"] - 2.5) * 1.1))
    if blemishes:
        spots = Image.new("L", base.size, 0)
        draw = ImageDraw.Draw(spots)
        for _ in range(blemishes):
            x1, y1, x2, y2 = rng.choice(spots_area)
            x, y, r = rng.randint(x1, x2), rng.randint(y1, y2), rng.uniform(3, 5.5)
            draw.ellipse((x - 2 * r, y - 2 * r, x + 2 * r, y + 2 * r), fill=45)  # inflamed halo
            draw.ellipse((x - r, y - r, x + r, y + r), fill=rng.randint(120, 160))
        spots = spots.filter(ImageFilter.GaussianBlur(2.5))
        base = Image.composite(Image.new("RGB", base.size, (178, 72, 76)), base, spots)

    # A new name on every reload so browsers never show a cached older version.
    name = f"demo-{stamp}day-{day:02d}.jpg"
    base.save(config.PHOTO_DIR / name, quality=84)
    return name
