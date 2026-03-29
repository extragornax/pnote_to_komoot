# 🎮 Pnote Invaders on Komoot

A Firefox extension that overlays [Space Invader](https://www.space-invaders.com/) street art locations from [pnote.eu](https://pnote.eu/projects/invaders/map) onto [Komoot](https://www.komoot.com) maps.

## Features

- **Live overlay** – Red dots appear on the Komoot map showing nearby Space Invader locations
- **Auto-refresh** – Markers update automatically as you pan/zoom the Komoot map
- **Toggle on/off** – Click the extension icon to show/hide the overlay
- **Click for details** – Click any dot to see the invader name, status, and points
- **Refresh cache** – Force-reload data from pnote.eu via the popup

## Installation (Temporary / Development)

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on…"**
3. Select the `manifest.json` file from this folder
4. Navigate to [komoot.com](https://www.komoot.com) and open a map view
5. Click the extension icon (red circle) in the toolbar to toggle the overlay

## How it works

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  popup   │────▶│ content.js   │────▶│  inject.js   │
│ (toggle) │     │ (Komoot tab) │     │ (page context)│
└──────────┘     └──────┬───────┘     └──────┬───────┘
                        │                     │
                        ▼                     ▼
                 ┌──────────────┐     Mapbox GL JS map
                 │background.js │     (adds GeoJSON layer)
                 │ (fetch API)  │
                 └──────┬───────┘
                        │
                        ▼
                 pnote.eu/projects/
                 invaders/api/
```

1. **inject.js** is injected into the Komoot page context to access the Mapbox GL JS map instance
2. When the map moves, it sends the visible bounds to **content.js**
3. **content.js** relays the bounds to **background.js** which fetches invader locations from pnote.eu
4. The filtered GeoJSON is sent back through to **inject.js** which renders the dots on the map

## Upcoming

- 🔑 **Token authentication** – Use your personal invader API token to filter out already-found invaders
- 🎨 **Color coding** – Different colors for found vs. not-found invaders
- 📊 **Stats** – Show count of invaders in current view

## Project Structure

```
pnote_to_komoot/
├── manifest.json          # Firefox extension manifest (V2)
├── background/
│   └── background.js      # Fetches & caches invader data from pnote.eu
├── content/
│   ├── content.js         # Content script orchestrating communication
│   └── inject.js          # Page-context script accessing Mapbox GL
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.js           # Popup logic (toggle, refresh)
│   └── popup.css          # Popup styles
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

## Notes

- The extension uses **Manifest V2** for maximum Firefox compatibility
- Data is fetched from `pnote.eu` via the background script to avoid CORS issues
- The invader dataset is cached in memory and only re-fetched when you click "Refresh"
- Markers are filtered client-side to only show those within the visible map bounds

