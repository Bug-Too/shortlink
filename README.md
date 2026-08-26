# Shortlink

Paste a link → get a short link and a QR code. Built for a phone, deployable anywhere.

![mobile](https://img.shields.io/badge/mobile-first-fe2c55) ![static](https://img.shields.io/badge/hosting-static-25f4ee)

## What it does

- **Shortens links** through public shorteners (no account, no key).
- **QR code for anything** — a link, Wi-Fi string, phone number, plain text — drawn in the browser as you type.
- **Cleans tracking junk** before shortening: `utm_*`, `fbclid`, `igshid`, and the pile TikTok
  adds to share links (`is_from_webapp`, `sender_device`, `web_id`, …). Toggle it off if you want the raw URL.
- **Story image, 1080×1920** — a ready-to-post "SCAN ME" card with the QR and the short link,
  laid out so the bottom stays clear of TikTok's own buttons.
- **Share sheet** on mobile: share the link or the QR image straight into any app.
- **Nothing is stored on a server.** Recent links live in the browser only, and clear with one tap.

## Run it locally

```bash
npm start
```

Opens on <http://localhost:5173>. To try it on your phone, hit `http://<your-computer-ip>:5173`
from the same Wi-Fi.

`serve.js` is only a local file server — the app itself is plain static files.

## Deploy it

There is no build step, no database and no environment variables. Upload the **`public/`** folder:

| Host | How |
| --- | --- |
| Netlify / Vercel | drag `public/` onto the dashboard, or point the project at it with no build command |
| Cloudflare Pages | build command: *(none)*, output directory: `public` |
| GitHub Pages | push `public/` as the site root (or `/docs`) |
| Any web server | copy `public/` into the web root |

Asset paths are relative, so it also works from a subfolder (`example.com/shortlink/`).

Serve it over **HTTPS** — the clipboard and share-sheet buttons need a secure origin.

## How the shortening works

The browser calls these in order and takes the first that answers:

1. [spoo.me](https://spoo.me)
2. [da.gd](https://da.gd)
3. [clck.ru](https://clck.ru)

All three are keyless and allow browser requests. The destination URL is sent to whichever
one answers — that is the one place a link leaves the device. Swap or reorder them in the
`PROVIDERS` array in `public/app.js`; each entry just needs to return a short URL string.

## Layout

```
public/
  index.html              the whole UI
  app.js                  shortening, QR, story image, on-device history
  styles.css              dark, mobile-first
  icon.svg                app icon
  manifest.webmanifest    add-to-home-screen
  vendor/qrcode.min.js    QR encoder, bundled locally (no CDN)
serve.js                  local preview server
```

Tweak points in `public/app.js`: `PALETTES` (QR colours), `JUNK_PARAMS` (what gets stripped),
`PROVIDERS` (shortening services), `MAX_HISTORY`.

To rebuild the vendored QR bundle after updating the library:

```bash
npm install && npm run build:vendor
```
