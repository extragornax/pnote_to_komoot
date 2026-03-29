# 🎮 Pnote Invaders on Komoot

A Firefox extension that overlays [Space Invader](https://www.space-invaders.com/) locations from [pnote.eu](https://pnote.eu/projects/invaders/map) on top of [Komoot](https://www.komoot.com) map views.

It is designed to help you quickly see which invaders are around your current Komoot map viewport, optionally compare them with your **Flash Invaders** gallery, and jump to Instagram tag searches for each invader.

## Features

- **Komoot overlay** – draws invader markers directly over the Komoot map
- **Visible-area filtering** – only invaders inside the current map area are displayed
- **Auto-refresh while moving** – markers reposition as you pan / zoom the map
- **Optional Flash Invaders UID support** – load your found invaders from the Flash Invaders gallery API
- **Hide found invaders** – optionally hide invaders already flashed with your UID
- **Status colors**
  - 🔴 `OK`
  - 🟠 `damaged`
  - 🟢 `found` / flashed
  - `destroyed` invaders are not shown
- **Fast hover tooltip** – shows the invader name immediately on hover
- **Instagram shortcut** – clicking a dot opens the Instagram hashtag search for that invader
- **Local cache** – recently fetched GeoJSON is cached so markers can be shown again quickly on reload

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
4. Pan / zoom the map as needed
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
│ settings │      │ Komoot tab   │      │ fetch logic  │
└──────────┘      └──────┬───────┘      └──────┬───────┘
                         │                     │
                         │                     ├── pnote.eu invaders.json
                         │                     └── Flash Invaders gallery API
                         ▼
                  Overlay rendered over Komoot
```

### Current runtime flow

1. The popup sends settings such as visibility, UID and hide-found preference
2. `content/content.js` reads the Komoot URL viewport (`@lat,lng,zoomz`)
3. It computes the visible bounds and asks `background/background.js` for invaders in range
4. `background/background.js` fetches the full invader dataset from `pnote.eu`
5. If a UID is present, it also fetches your flashed invaders from the Flash Invaders API
6. Matching invaders are converted to GeoJSON with a `found` flag
7. `content/content.js` renders the overlay and updates it as the map moves

`content/inject.js` is still injected into the page context for map inspection / native integration experiments, but the current visible overlay is rendered by `content/content.js`.

## Project Structure

```text
pnote_to_komoot/
├── manifest.json          # Firefox extension manifest
├── background/
│   └── background.js      # Fetches and filters pnote.eu + Flash Invaders API data
├── content/
│   ├── content.js         # Main Komoot overlay renderer and page logic
│   └── inject.js          # Page-context helper for map/native integration attempts
├── popup/
│   ├── popup.html         # Popup UI (load, visibility, UID, debug, calibration)
│   ├── popup.js           # Popup behavior and saved settings
│   └── popup.css          # Popup styles
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

## Notes

- The extension is currently tested as a Firefox temporary add-on
- Data is fetched in the background script to avoid page-level CORS issues
- Invader locations come from:
  - `https://pnote.eu/projects/invaders/map/invaders.json?nocache=...`
- Found invaders are optionally retrieved from:
  - `https://api.space-invaders.com/flashinvaders_v3_pas_trop_predictif/api/gallery?uid=...`
- The extension caches the last GeoJSON payload in `browser.storage.local` for faster redisplay
- Overlay alignment can be adjusted with the popup calibration slider if Komoot’s layout shifts the visible map area

