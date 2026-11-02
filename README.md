# Culprit

Find the skincare ingredient your skin reacts to.

People who break out or turn red after a new product rarely find out why. Labels list 20 to 40 ingredients, so the same irritant ends up in the next product they buy. Dermatologists narrow this down by comparing ingredient lists across products a patient reacted to and products they tolerated. Culprit does that comparison automatically, using daily skin measurements instead of memory.

## How it works

1. **Daily check-in.** A selfie is sent to the YouCam AI Skin Analysis API, which returns scores for redness, acne, texture, pores, oiliness and moisture.
2. **Products.** Each product is added by barcode (ingredients come from Open Beauty Facts) or by pasting the label, with the date it was started.
3. **Reaction detection.** For each product, Culprit compares an irritation index (weighted redness, acne and texture) in the 10 days before and after the start date. Products are labelled reaction, tolerated, unclear, or not enough data. Products started within 4 days of each other are flagged as hard to separate.
4. **Suspect ranking.** Ingredients found in reaction products and absent from tolerated products become suspects. An ingredient used safely in another product is cleared, except concentration-dependent irritants (acids, retinoids, drying alcohols). Ingredients are also grouped into known irritant families such as fragrance allergens and isothiazolinone preservatives.
5. **Shop check.** Scanning a product in a store compares its label with the current suspects and returns avoid, caution, or looks safe.

Culprit is a tracking tool, not a diagnosis. A dermatologist patch test is the way to confirm an allergy.

## Run it

Requires Python 3.11 or newer.

```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8765
```

Open http://localhost:8765 for the project page, or http://localhost:8765/app for the app. Click **Load 6-week demo** in the app to see a full example.

The demo photo diary uses a stock portrait by default. To use your own selfies instead, run `python scripts/import_selfies.py <folder>` (needs `opencv-python-headless`); the photos are cropped, blurred and kept in `data/`, which is never committed. A small screen recorder for demo videos is at http://localhost:8765/record.

Without an API key the app runs in demo mode with simulated skin scores. To use the real API, copy `.env.example` to `.env` and add your key from the YouCam API console:

```
YOUCAM_API_KEY=your_key_here
```

## Run with Docker

```bash
docker compose up --build
```

Then open http://localhost:8765. The build runs the unit tests first, and the SQLite database and photos are kept in a Docker volume (`culprit-data`), so they survive restarts. If a `.env` file exists, its API key is passed to the container; otherwise the app runs in demo mode.

Without Compose:

```bash
docker build -t culprit .
docker run -p 8765:8765 -v culprit-data:/app/data culprit
```

## Tests

```bash
python -m unittest discover -s tests -t .
```

## Project structure

```
app/
  main.py         FastAPI routes
  youcam.py       YouCam Skin Analysis client (upload, task, polling) and demo mode
  analysis.py     reaction detection and suspect ranking
  ingredients.py  label parsing, synonyms, irritant families, Open Beauty Facts lookup
  db.py           SQLite storage
  demo.py         six-week demo scenario and demo shop catalog
static/           single-page frontend (vanilla JS, Chart.js)
tests/            unit tests for the analysis logic
```

## Data sources

- Skin analysis: [YouCam API](https://yce.perfectcorp.com/ai-api) by Perfect Corp.
- Ingredients: [Open Beauty Facts](https://world.openbeautyfacts.org), open database under the ODbL license.

## License

All rights reserved. The code is public so it can be viewed and evaluated; see [LICENSE](LICENSE).
