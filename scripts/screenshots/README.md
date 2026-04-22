# Regenerating the README screenshots

Two small scripts rebuild the three PNGs under `docs/screenshots/`:

1. `build_db_html.sh` — queries Postgres and writes a styled
   `db_preview.html` used as the source for the database screenshot.
2. `capture.js` — uses Playwright (headless Chromium) to screenshot:
   - the frontend home page at `http://localhost:5173`
   - the FastAPI docs at `http://localhost:8000/docs`
   - the `db_preview.html` file from step 1

## Prerequisites

- All three services running (see `LOCAL_SETUP.md` sections 3–6).
- `psql` on PATH (`brew install libpq && brew link --force libpq`).
- Node 18+ and npm. Playwright + a bundled Chromium are installed on
  first run via `npm install` in this folder.

## Run

```bash
cd scripts/screenshots
npm install                       # first time only (installs playwright)
npx playwright install chromium   # first time only (downloads browser)
./build_db_html.sh                # refresh db_preview.html from Postgres
node capture.js                   # write the three PNGs
```

After a run, commit the updated `docs/screenshots/*.png` files. The
intermediate `db_preview.html` and `node_modules/` are gitignored.
