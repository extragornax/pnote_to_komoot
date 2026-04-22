# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-04-22

### Added
- `inject.js` is now the primary renderer. It binds to Komoot's native MapLibre instance and adds a GeoJSON source + circle layer with data-driven styling. Markers now zoom, pan, rotate, and pitch with the map natively.
- Expression-based layer filter that always drops `destroyed` invaders and optionally drops `found` ones.
- Hover tooltip implemented via native MapLibre `mouseenter` / `mouseleave` handlers.
- Privacy policy (`PRIVACY.md`) covering third-party network requests and local storage.
- `browser_specific_settings.gecko.data_collection_permissions.required = ["none"]` declared in the manifest — the add-on transmits nothing to the developer.

### Changed
- **Manifest upgraded from V2 to V3.**
  - `browser_action` → `action`
  - Host patterns moved from `permissions` to `host_permissions`
  - `web_accessible_resources` reshaped to the MV3 `{ resources, matches }` form and scoped to Komoot origins only
  - Non-persistent background page (the MV3 default); `persistent: false` removed
  - Added `browser_specific_settings.gecko.id` and `strict_min_version: "115.0"`
- `content.js` reduced to a thin bridge between the popup, the background script, and the page-context renderer. All Web Mercator math, URL polling, sidebar detection, and HTML overlay code removed.
- `background.js` returns the full invader dataset in one shot; bounds filtering is no longer performed server-side since MapLibre only paints what is on screen.
- Flash Invaders found-set cache is now keyed per UID rather than a single global cache.

### Fixed
- **Marker drift at different zoom levels.** The previous implementation mixed a 512 px tile size (MapLibre) in `content.js` with a 256 px tile size (Leaflet/OSM convention) in `inject.js`, and projected through a URL center that is offset by Komoot's sidebar padding. Switching to the native map projection eliminates all three sources of drift.
- Markers no longer misalign after rotating or pitching the map.
- Layer visibility toggling now uses `setLayoutProperty("visibility", …)` instead of removing/re-adding the HTML overlay.

### Removed
- **Calibration slider** — no longer needed now that marker positions come from the native map.
- **Debug overlay** — the sidebar/canvas/URL-center visualisation existed to help tune the calibration slider, which is gone.
- All `@lat,lng,zoom` URL polling. Re-renders are driven by the map, not by string-matching URLs.

## [1.0.0] — 2025

### Added
- Initial version.
- Fetch invaders from `pnote.eu` and render them as an HTML overlay on Komoot maps.
- Optional Flash Invaders UID support to mark found invaders green.
- Local cache of the fetched GeoJSON in `browser.storage.local`.
- Popup UI with load, visibility toggle, UID input, hide-found toggle, calibration slider, and debug overlay.

[1.1.0]: #110--2026-04-22
[1.0.0]: #100--2025
