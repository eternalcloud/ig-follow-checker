# IG Follow Tracker — PWA (Local-Only)

A lightweight, installable web app to compare Instagram followers/following using your **official Instagram export (JSON)**. No servers; all data stays on your device via IndexedDB.

## How to deploy
1. Host the folder on any static host (GitHub Pages, Netlify, Vercel, S3/CloudFront, etc.).
2. Open the URL on your phone.
3. "Add to Home Screen" to install.
4. Get your data: Accounts Center → Your information & permissions → **Export your information** → Followers & Following → **JSON** → Download ZIP.
5. Import:
   - **Android:** Share the ZIP → choose **IG Follow Tracker**.
   - **iOS:** Open the PWA → tap **Upload ZIP** and pick the ZIP from Files.

> First run needs network to fetch the unzip library (fflate) once; after that it is cached offline.

## What it shows
- **Unfollowers (since last snapshot)** — users who were in previous followers but not current.
- **You follow / they don’t** — users you follow but who aren’t in your current followers; shows the date you followed (if present in export).

## Personalise / tweak
1. **App name & colors**
   - `manifest.json`: `"name"`, `"short_name"`, `"theme_color"`, `"background_color"`.
   - `index.html`: `<title>` and `<meta name="theme-color">`.
   - `styles.css`: edit the CSS variables at the top: `--bg`, `--card`, `--text`, `--accent`, etc.

2. **Icons**
   - Replace `icons/icon-192.png` and `icons/icon-512.png` with your own (keep sizes).
   - For Android/iOS better results, keep `"purpose": "maskable"` in `manifest.json`.

3. **Share Target (Android share-to-app)**
   - `manifest.json` → `"share_target"."action"`: If you deploy under a subpath (e.g., `/ig`), change to `"/ig/share-target"`.
   - `service-worker.js` contains the matching handler for `'/share-target'`. Update the path there too if you change it.

4. **UI text & copy**
   - Edit any labels/sentences in `index.html` and `app.js` status messages.

5. **Storage / retention**
   - Everything is in **IndexedDB** on-device.
   - To change snapshot behaviour (e.g., keep only last N snapshots), modify `saveSnapshot` to delete older rows after insert.

6. **CSV filenames**
   - In `app.js`, search for `'unfollowers.csv'` and `'not_following_back.csv'` to rename.

## Notes / Limitations
- **No scraping or private APIs**: This app only parses your official Instagram export ZIP (JSON). It does not log in to or crawl Instagram.
- Requires a network once to cache `fflate` from jsDelivr; afterwards works offline.
- Unfollowers are computed between the latest 2 snapshots.
- iOS Safari does not support PWA Share Target; use the Upload button in-app.

## Dev tips (optional)
- You can run locally by opening `index.html` in a simple HTTP server (avoid `file://`):
  - Python: `python -m http.server 8080`
  - Node: `npx http-server -p 8080`
- Ensure your host serves `manifest.json` and `service-worker.js` with correct MIME types.
