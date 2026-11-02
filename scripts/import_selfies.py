"""Turn your own selfies into the base photos for the demo photo diary.

    python scripts/import_selfies.py <folder with .jpg/.png selfies>

Each photo is cropped to 3:4 around the face, blurred so you cannot be recognised, and saved to data/selfies/ (git-ignored, so
your face never ends up in the repository), with the cheek, nose and chin positions in
zones.json. The demo then draws its simulated redness on those zones.
Needs opencv-python-headless (only for this script, not for the app).
"""

import json
import sys
from pathlib import Path

import cv2
from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "selfies"
W, H = 600, 800
BLUR, EYE_BLUR = 6, 16
FACE_SHARE = 0.6  # face width as a share of the crop, close to YouCam's framing guidance


def face_box(path):
    gray = cv2.cvtColor(cv2.imread(str(path)), cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = cascade.detectMultiScale(gray, 1.1, 6, minSize=(250, 250))
    return max(faces, key=lambda f: f[2]) if len(faces) else None


def crop(path, box):
    image = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    x, y, w, h = (int(v) for v in box)
    # Gallery screenshots can have black bars above and below the photo.
    gray = image.convert("L")
    rows = [gray.crop((0, r, image.width, r + 1)).getextrema()[1] for r in range(image.height)]
    first = next(r for r in range(image.height) if rows[r] > 30)
    last = next(r for r in range(image.height - 1, -1, -1) if rows[r] > 30)
    image = image.crop((0, first + 2, image.width, last - 1))
    y -= first + 2
    cw = min(image.width, w / FACE_SHARE)
    ch = min(image.height, cw * H / W)
    cw = ch * W / H
    left = min(max(0, x + w / 2 - cw / 2), image.width - cw)
    top = min(max(0, y - 0.24 * ch), image.height - ch)
    scale = W / cw
    out = image.crop((left, top, left + cw, top + ch)).resize((W, H), Image.LANCZOS)
    # The face box in the 600 x 800 crop, then the redness zones relative to it.
    fx, fy, fw = (x - left) * scale, (y - top) * scale, w * scale

    def at(rx, ry, sx, sy, weight):
        return [round(fx + rx * fw), round(fy + ry * fw), round(sx * fw), round(sy * fw), weight]

    # Blur the face so the demo does not show who you are; the eyes get the strongest blur.
    out = out.filter(ImageFilter.GaussianBlur(BLUR))
    eyes = (round(fx), round(fy + 0.2 * fw), round(fx + fw), round(fy + 0.5 * fw))
    out.paste(out.crop(eyes).filter(ImageFilter.GaussianBlur(EYE_BLUR)), eyes[:2])

    zones = [at(0.27, 0.62, 0.17, 0.14, 1.0), at(0.73, 0.62, 0.17, 0.14, 1.0),
             at(0.5, 0.5, 0.08, 0.12, 0.8), at(0.5, 0.93, 0.15, 0.08, 0.55)]
    spots = [[round(fx + a * fw), round(fy + b * fw), round(fx + c * fw), round(fy + d * fw)]
             for a, b, c, d in [(0.18, 0.52, 0.38, 0.75), (0.62, 0.52, 0.82, 0.75),
                                (0.38, 0.86, 0.62, 0.97)]]
    return out, {"zones": zones, "spots": spots}


def main(folder):
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {}
    files = sorted(p for p in Path(folder).rglob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    for i, path in enumerate(files):
        box = face_box(path)
        if box is None:
            print("no face found, skipped:", path.name)
            continue
        image, info = crop(path, box)
        name = f"selfie-{i:02d}.jpg"
        image.save(OUT / name, quality=88)
        meta[name] = info
        print(name, "<-", path.name)
    (OUT / "zones.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1])
