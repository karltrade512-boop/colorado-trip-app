# Colorado trip PWA

Phone-first Progressive Web App for Karl’s Colorado photography trip (Buda TX → Colorado, 27 Sep–5 Oct 2026). **Not an itinerary.** Menus of hikes, food, and open calls. Hiking navigation is AllTrails, not this app. This app is the truck, the cabin, and home.

Public HTTPS URL (GitHub Pages on `main`):

**https://karltrade512-boop.github.io/colorado-trip-app/**

Enable Pages once: repo **Settings → Pages → Source = GitHub Actions**. The workflow `.github/workflows/pages.yml` tests, builds, and deploys from `main` after merge. Pull requests run the same test/build without deploying.

After merge, wait for the **GitHub Pages** workflow to finish, then open the HTTPS URL in Safari.

## Run locally

```bash
npm install
npm test
npm run dev
```

Then open the printed localhost URL on the phone (same Wi-Fi) or in Safari.

```bash
npm run build
npm run preview
```

## Replace the bundle

One-way contract: **engine → `trip-bundle.json` → this app.**

1. Copy the engine export to `public/trip-bundle.json`.
2. It must be schema `1.0.0` and load from **`/trip-bundle.json`** (Vite copies `public/` to the site root).
3. Redeploy / refresh. The app does **not** call eBird, OSRM, USGS, USNO, or AllTrails for trip facts.

The file in this repo is the recovered engine prefix (places, trip, runs, light for 2026-09-27 through 2026-10-02) plus **inventory names and stated gaps only**. It does not invent restaurant names, miles, elevations, trailhead pins, or webcam URLs. When you have the exact ~60KB engine file, overwrite `public/trip-bundle.json`.

## iPhone: Add to Home Screen

Safari only (Chrome on iOS cannot install a standalone PWA the same way):

1. Open the Pages HTTPS URL in **Safari**.
2. Tap **Share** (square with an arrow).
3. Scroll to **Add to Home Screen** → **Add**.
4. Open the icon from the home screen.

The app detects standalone (`navigator.standalone` / `display-mode: standalone`) and **does not nag** after install.

## Save for offline / cache vs live

- **More → Save for offline** caches the shell + `/trip-bundle.json` and shows progress. Then turn on **Airplane Mode** and reopen the Home Screen icon to prove it.
- Last-loaded bundle and last screen persist in **IndexedDB** so it opens with no bars. Cache age is shown on Today / More.
- A live fetch of the bundle is preferred when online; if that fails, the last IndexedDB copy is used and labeled as cached.
- Allowed live fetches (display only, stamped **fetched-at**, fail visibly): webcam and Brainard gate URLs **already in the bundle**, plus OSM Overpass extras on the driving screen (labeled **UNVERIFIED**, under trip stops, not gas, not ranked). A failed fetch is never “closed” or “no color”.
- No login. No credentials. No eBird key path. No Background Sync.

## Rules the UI follows

- No invented place, business, trail, distance, or time.
- Menus, not itineraries. Skip all is valid. Low-ranked groups fold; they are not dropped.
- Unknown stays unknown. Dog-rule unknown ≠ banned ≠ fine. Dogs-with-us is a **session** toggle: banned places fold under “not with the dogs”.
- Disagreeing sources both print (AllTrails vs agency miles). Never averaged.
- Print `elevation_display` strings. Drake pin unconfirmed; elevation is a range.
- `no_early_mornings` is a **sort key**, not a filter.
- GF and DF are separate. Missing tag does not hide a place. Unknown is not upgraded to safe.
- Bighorn are **not** in rut.
- Empty list ≠ “nothing here”. Gaps from the bundle stay visible (return after Oct 5, Sep 27 overnight, Drake pin, weather, bird silence, RMNP timed-entry).
