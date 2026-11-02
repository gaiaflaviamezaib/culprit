"""Small SQLite store for products and daily skin check-ins."""

import json
import sqlite3

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    brand TEXT DEFAULT '',
    barcode TEXT DEFAULT '',
    category TEXT DEFAULT '',
    image TEXT DEFAULT '',
    ingredients TEXT NOT NULL,
    start_date TEXT NOT NULL,
    stop_date TEXT
);
CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    scores TEXT NOT NULL,
    skin_age INTEGER,
    photo TEXT,
    mock INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS shop_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    date TEXT NOT NULL,
    product TEXT DEFAULT '',
    verdict TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS barcode_cache (
    barcode TEXT PRIMARY KEY,
    data TEXT NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    columns = {r["name"] for r in conn.execute("PRAGMA table_info(products)")}
    if "image" not in columns:  # databases created before product photos existed
        conn.execute("ALTER TABLE products ADD COLUMN image TEXT DEFAULT ''")
    return conn


def list_products(conn) -> list[dict]:
    rows = conn.execute("SELECT * FROM products ORDER BY start_date, id").fetchall()
    return [{**dict(r), "ingredients": json.loads(r["ingredients"])} for r in rows]


def add_product(conn, name, brand, barcode, category, ingredients, start_date, image="") -> int:
    cur = conn.execute(
        "INSERT INTO products (name, brand, barcode, category, image, ingredients, start_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (name, brand, barcode, category, image, json.dumps(ingredients), start_date),
    )
    conn.commit()
    return cur.lastrowid


def stop_product(conn, product_id: int, stop_date: str) -> None:
    conn.execute("UPDATE products SET stop_date = ? WHERE id = ?", (stop_date, product_id))
    conn.commit()


def delete_product(conn, product_id: int) -> None:
    conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
    conn.commit()


def list_checkins(conn) -> list[dict]:
    rows = conn.execute("SELECT * FROM checkins ORDER BY date, id").fetchall()
    return [{**dict(r), "scores": json.loads(r["scores"]), "mock": bool(r["mock"])} for r in rows]


def add_checkin(conn, date, scores, skin_age=None, photo=None, mock=False) -> int:
    cur = conn.execute(
        "INSERT INTO checkins (date, scores, skin_age, photo, mock) VALUES (?, ?, ?, ?, ?)",
        (date, json.dumps(scores), skin_age, photo, int(mock)),
    )
    conn.commit()
    return cur.lastrowid


def cached_barcode(conn, barcode: str) -> dict | None:
    row = conn.execute("SELECT data FROM barcode_cache WHERE barcode = ?", (barcode,)).fetchone()
    return json.loads(row["data"]) if row else None


def cache_barcode(conn, barcode: str, data: dict) -> None:
    conn.execute("INSERT OR REPLACE INTO barcode_cache (barcode, data) VALUES (?, ?)", (barcode, json.dumps(data)))
    conn.commit()


def list_visits(conn) -> list[dict]:
    return [dict(r) for r in conn.execute("SELECT * FROM shop_visits ORDER BY date, id").fetchall()]


def add_visit(conn, store, lat, lng, date, product="", verdict="") -> int:
    cur = conn.execute(
        "INSERT INTO shop_visits (store, lat, lng, date, product, verdict) VALUES (?, ?, ?, ?, ?, ?)",
        (store, lat, lng, date, product, verdict),
    )
    conn.commit()
    return cur.lastrowid


def delete_visit(conn, visit_id: int) -> None:
    conn.execute("DELETE FROM shop_visits WHERE id = ?", (visit_id,))
    conn.commit()


def reset(conn) -> None:
    conn.executescript("DELETE FROM products; DELETE FROM checkins; DELETE FROM shop_visits;")
    conn.commit()
