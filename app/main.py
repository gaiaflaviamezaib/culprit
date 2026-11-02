"""Culprit web app: FastAPI backend serving the API and the single-page frontend."""

import uuid
from datetime import date

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import analysis, config, db, demo, youcam
from .ingredients import FAMILIES, families_of, lookup_barcode, parse_ingredients

app = FastAPI(title="Culprit")
STATIC = config.ROOT / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.mount("/photos", StaticFiles(directory=config.PHOTO_DIR), name="photos")


class ProductIn(BaseModel):
    name: str
    brand: str = ""
    barcode: str = ""
    category: str = ""
    ingredients_text: str = ""
    image: str = ""
    start_date: str | None = None


class StopIn(BaseModel):
    stop_date: str | None = None


class VisitIn(BaseModel):
    store: str
    lat: float
    lng: float
    date: str | None = None
    product: str = ""
    verdict: str = ""


class CheckIn(BaseModel):
    barcode: str = ""
    ingredients_text: str = ""


def _state(conn) -> dict:
    products = db.list_products(conn)
    checkins = db.list_checkins(conn)
    evaluations = {p["id"]: analysis.evaluate_product(p, checkins, products) for p in products}
    for c in checkins:
        c["irritation"] = analysis.irritation_index(c["scores"])
    for p in products:
        p["evaluation"] = evaluations[p["id"]]
        p["flagged"] = sorted({f for i in p["ingredients"] for f in families_of(i)})
        p["ingredient_families"] = {i: families_of(i) for i in p["ingredients"] if families_of(i)}
    return {
        "mock": config.MOCK,
        "today": date.today().isoformat(),
        "products": products,
        "checkins": checkins,
        "culprits": analysis.find_culprits(products, evaluations),
        "visits": db.list_visits(conn),
        "family_notes": {name: info.get("note", "") for name, info in FAMILIES.items()},
    }


async def _resolve_barcode(conn, barcode: str) -> dict | None:
    barcode = barcode.strip()
    if not barcode:
        return None
    found = demo.shop_product(barcode) or db.cached_barcode(conn, barcode)
    if found and (found.get("source") != "Open Beauty Facts" or "image" in found):
        return found
    found = await lookup_barcode(barcode)
    if found and found["ingredients"]:
        db.cache_barcode(conn, barcode, found)
    return found


@app.get("/")
def landing():
    return FileResponse(STATIC / "landing.html")


@app.get("/app")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/record")
def recorder():
    return FileResponse(STATIC / "recorder.html")


@app.get("/api/state")
def state():
    with db.connect() as conn:
        return _state(conn)


@app.post("/api/checkins")
async def create_checkin(photo: UploadFile = File(...), day: str = Form("")):
    image = await photo.read()
    if not image:
        raise HTTPException(400, "Empty photo")
    if len(image) > 10 * 1024 * 1024:
        raise HTTPException(400, "Photo is too large (max 10 MB)")
    if not config.MOCK and photo.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(400, "YouCam accepts JPG or PNG photos only.")
    try:
        result = await youcam.analyze_skin(image, photo.content_type or "image/jpeg", photo.filename or "selfie.jpg")
    except youcam.YouCamError as err:
        raise HTTPException(502, str(err))
    ext = (photo.filename or "x.jpg").rsplit(".", 1)[-1].lower()
    name = f"{uuid.uuid4().hex}.{ext if ext in ('jpg', 'jpeg', 'png', 'webp') else 'jpg'}"
    (config.PHOTO_DIR / name).write_bytes(image)
    with db.connect() as conn:
        db.add_checkin(conn, day or date.today().isoformat(), result["scores"], result.get("skin_age"), name, result["mock"])
        return _state(conn)


@app.post("/api/products")
async def create_product(item: ProductIn):
    ingredients = parse_ingredients(item.ingredients_text)
    name, brand, image = item.name.strip(), item.brand.strip(), item.image.strip()
    with db.connect() as conn:
        if not ingredients and item.barcode:
            found = await _resolve_barcode(conn, item.barcode)
            if found:
                ingredients = found["ingredients"]
                name = name or found["name"]
                brand = brand or found["brand"]
                image = image or found.get("image", "")
        if not ingredients:
            raise HTTPException(400, "No ingredients found. Paste the ingredient list from the label.")
        if not name:
            raise HTTPException(400, "Give the product a name.")
        db.add_product(conn, name, brand, item.barcode.strip(), item.category, ingredients, item.start_date or date.today().isoformat(), image)
        return _state(conn)


@app.post("/api/products/{product_id}/stop")
def stop(product_id: int, body: StopIn):
    with db.connect() as conn:
        db.stop_product(conn, product_id, body.stop_date or date.today().isoformat())
        return _state(conn)


@app.delete("/api/products/{product_id}")
def delete(product_id: int):
    with db.connect() as conn:
        db.delete_product(conn, product_id)
        return _state(conn)


@app.get("/api/lookup/{barcode}")
async def lookup(barcode: str):
    with db.connect() as conn:
        found = await _resolve_barcode(conn, barcode)
    if not found:
        raise HTTPException(404, "Product not found. You can paste the ingredient list instead.")
    return found


@app.post("/api/check")
async def shop_check(body: CheckIn):
    with db.connect() as conn:
        product = None
        if body.ingredients_text.strip():
            product = {"name": "Pasted label", "brand": "", "ingredients": parse_ingredients(body.ingredients_text), "source": "Label"}
        elif body.barcode.strip():
            product = await _resolve_barcode(conn, body.barcode)
        if not product or not product["ingredients"]:
            raise HTTPException(404, "Product not found. Paste the ingredient list from the label instead.")
        culprits = _state(conn)["culprits"]
    return {"product": product, **analysis.check_product(product["ingredients"], culprits)}


@app.post("/api/visits")
def create_visit(visit: VisitIn):
    if not visit.store.strip():
        raise HTTPException(400, "Give the store a name.")
    if not (-90 <= visit.lat <= 90 and -180 <= visit.lng <= 180):
        raise HTTPException(400, "Invalid location.")
    with db.connect() as conn:
        db.add_visit(conn, visit.store.strip(), visit.lat, visit.lng, visit.date or date.today().isoformat(),
                     visit.product.strip(), visit.verdict.strip())
        return _state(conn)


@app.delete("/api/visits/{visit_id}")
def delete_visit(visit_id: int):
    with db.connect() as conn:
        db.delete_visit(conn, visit_id)
        return _state(conn)


@app.post("/api/demo")
def load_demo():
    with db.connect() as conn:
        demo.seed(conn)
        return _state(conn)


@app.post("/api/reset")
def reset():
    with db.connect() as conn:
        db.reset(conn)
        return _state(conn)
