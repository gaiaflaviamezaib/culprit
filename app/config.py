"""Settings loaded from environment variables or a local .env file."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
PHOTO_DIR = DATA_DIR / "photos"
DB_PATH = DATA_DIR / "culprit.db"


def _load_dotenv() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()

YOUCAM_API_KEY = os.environ.get("YOUCAM_API_KEY", "").strip()
# Mock mode runs the whole app without a key, using simulated skin scores.
MOCK = os.environ.get("CULPRIT_MOCK", "").strip() == "1" or not YOUCAM_API_KEY

PHOTO_DIR.mkdir(parents=True, exist_ok=True)
