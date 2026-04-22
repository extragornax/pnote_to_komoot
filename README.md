# 🎮 Pnote Invaders on Komoot

A Firefox extension that overlays [Space Invader](https://www.space-invaders.com/) locations from [pnote.eu](https://pnote.eu/projects/invaders/map) on top of [Komoot](https://www.komoot.com) map views.

It is designed to help you quickly see which invaders are around your current Komoot map viewport, optionally compare them with your **Flash Invaders** gallery, and jump to Instagram tag searches for each invader.

## Features

- **Native Komoot overlay** – markers are drawn on the Komoot MapLibre map, so they zoom, pan, rotate, and pitch with the map natively
- **Optional Flash Invaders UID support** – load your found invaders from the Flash Invaders gallery API
- **Hide found invaders** – optionally hide invaders already flashed with your UID
- **Status colors**
  - 🔴 `OK`
  - 🟠 `damaged`
  - 🟢 `found` / flashed
  - `destroyed` invaders are not shown
- **Hover tooltip** – shows the invader name and status flags on hover
- **Instagram shortcut** – clicking a dot opens the Instagram hashtag search for that invader
- **Local cache** – the fetched invader dataset is cached for 24h so markers appear instantly on reload

## Installation (Temporary / Development)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select the `manifest.json` file from this repository
4. Open a Komoot planning map, for example `https://www.komoot.com/fr-fr/plan/...`
5. Click the extension icon
6. Press **Load Invaders**

## Usage

### Basic usage

1. Open a Komoot map
2. Open the extension popup
3. Click **Load Invaders**
4. Pan / zoom the map – markers stay glued to their geographic locations
5. Use the **Visible** toggle to temporarily show or hide the overlay

### Flash Invaders UID / token support

The popup includes an **API UID** field.

This value is your Flash Invaders gallery identifier and is used to request the list of invaders you have already flashed.

Current API used by the extension:

```text
https://api.space-invaders.com/flashinvaders_v3_pas_trop_predictif/api/gallery?uid=<your_uid>
```

When a UID is provided:

- the extension fetches your flashed invaders from the Flash Invaders API
- matching invaders on the map are marked as **found**
- found invaders are shown in **green**
- you can enable **Hide found** to only keep remaining invaders visible

When no UID is provided:

- the extension still works normally
- invaders are loaded only from `pnote.eu`
- no found/not-found comparison is applied

## Instagram behavior

Each marker is clickable.

Clicking a dot opens the Instagram hashtag search associated with the invader id, for example:

```text
PA_801 -> https://www.instagram.com/explore/tags/pa_801
```

This is useful for quickly checking photos, confirmations, or historical posts related to a specific invader.

## How it works

```text
┌──────────┐      ┌──────────────┐      ┌──────────────┐
│  popup   │ ───▶ │ content.js   │ ───▶ │background.js │
│ settings │      │   bridge     │      │ fetch logic  │
└──────────┘      └──────┬───────┘      └──────┬───────┘
                         │                     │
                         ▼                     ├── pnote.eu invaders.json
                  ┌──────────────┐              └── Flash Invaders gallery API
                  │  inject.js   │
                  │  (page ctx)  │
                  │ native map   │
                  │  + layer     │
                  └──────────────┘
                         ▼
              Overlay rendered on Komoot's
                native MapLibre instance
```

### Runtime flow

1. The popup sends settings (visibility, UID, hide-found) to the content script.
2. `content/content.js` relays **Load Invaders** to `background/background.js`.
3. `background/background.js` fetches the full invader dataset from `pnote.eu`. If a UID is provided, it also fetches your flashed invaders from the Flash Invaders API and tags each feature with `found: true/false`.
4. The GeoJSON result is cached locally (24h TTL) and pushed to `content/inject.js`.
5. `content/inject.js`, running in the **page context**, reaches into Komoot's MapLibre instance and renders the markers as a native GeoJSON layer with expression-based styling (green = found, orange = damaged, red = default; destroyed is filtered out).

Because rendering goes through MapLibre's own coordinate system, markers stay aligned at any zoom, pitch, or rotation with no manual calibration.

## Project Structure

```text
pnote_to_komoot/
├── manifest.json          # Firefox extension manifest (MV3)
├── background/
│   └── background.js      # Fetches pnote.eu + Flash Invaders API data
├── content/
│   ├── content.js         # Thin bridge: popup ⇄ background ⇄ inject.js
│   └── inject.js          # Page-context renderer; owns the native map layer
├── popup/
│   ├── popup.html         # Popup UI (load, visibility, UID, hide-found)
│   ├── popup.js           # Popup behavior and saved settings
│   └── popup.css          # Popup styles
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── PRIVACY.md             # Privacy policy
├── CHANGELOG.md           # Release notes
└── README.md
```

## Privacy

See [PRIVACY.md](./PRIVACY.md). In short: no telemetry, no analytics, no data sent to the developer. The extension only talks to `pnote.eu` (anonymous) and — only if you explicitly provide a UID — to the Flash Invaders API.

## Building / publishing

```bash
npm install -g web-ext
web-ext lint
web-ext sign --api-key=$AMO_JWT_ISSUER --api-secret=$AMO_JWT_SECRET --channel=listed
```

Every `web-ext sign` run requires a new `version` in `manifest.json`; bump it before re-submitting.

## Notes

- Built against Manifest V3 (Firefox 115+)
- Data is fetched in the background script to avoid page-level CORS issues
- Invader locations come from:
  - `https://pnote.eu/projects/invaders/map/invaders.json?nocache=...`
- Found invaders are optionally retrieved from:
  - `https://api.space-invaders.com/flashinvaders_v3_pas_trop_predictif/api/gallery?uid=...`
- The extension caches the last GeoJSON payload in `browser.storage.local` for faster redisplay
