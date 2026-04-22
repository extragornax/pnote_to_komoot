# Privacy Policy — Pnote Invaders on Komoot

_Last updated: 2026-04-22_

This document describes what data the **Pnote Invaders on Komoot** Firefox extension
("the extension") processes, where it goes, and what is stored.

## Short version

The extension does **not** collect, transmit, or store any personal data on any
server operated by the developer. There is no analytics, no telemetry, and no
tracking. All user-specific data stays on your device, except for requests that
you explicitly trigger to third-party services listed below.

## Data the extension handles

### Stored locally on your device

The extension uses `browser.storage.local` to remember:

| Stored item | Purpose |
|---|---|
| Flash Invaders API UID (if you choose to enter one) | Passed to the Flash Invaders API to fetch your gallery of flashed invaders |
| "Hide found" preference | Remembers your last-chosen toggle state |
| Cached invader dataset (GeoJSON) | Lets markers reappear quickly on reload without refetching from pnote.eu |
| Cache timestamp | Used to expire the cache after 24 hours |

Local storage is never read or transmitted by the developer. You can clear it at
any time via **Clear cache & reload** in the popup, or by removing the extension.

### Data read from the active Komoot tab

When you open a Komoot map and click **Load Invaders**, the extension reads the
current map viewport (latitude, longitude, zoom) from the Komoot page in order
to know where to render markers. This data stays on your device. It is not
sent anywhere except as described below.

## Network requests made by the extension

The extension sends HTTP requests only to the following third-party services,
and only when you explicitly click **Load Invaders** or **Clear cache & reload**:

### 1. `https://pnote.eu`
- **Endpoint:** `https://pnote.eu/projects/invaders/map/invaders.json`
- **Purpose:** Fetch the public dataset of Space Invader locations and statuses.
- **Data sent:** A standard `GET` request. No user identifier is attached. The
  request contains only a cache-busting timestamp parameter.

### 2. `https://api.space-invaders.com` (optional — only if you entered a UID)
- **Endpoint:** `https://api.space-invaders.com/flashinvaders_v3_pas_trop_predictif/api/gallery?uid=<your_uid>`
- **Purpose:** Retrieve the list of invaders that your Flash Invaders account
  has flashed, so matching markers on the map can be shown in green.
- **Data sent:** The UID you typed into the popup. Nothing else.
- **Who receives it:** Space Invaders (the operator of the Flash Invaders app
  and its public API). This is the same endpoint that the official Flash
  Invaders mobile app uses. The developer of this extension does not receive,
  proxy, or store your UID.
- **Opt-out:** Leave the UID field empty. The extension will continue to work,
  showing all invaders as not-found.

## Third-party links

Clicking a marker opens `https://www.instagram.com/explore/tags/<invader_id>`
in a new tab. Instagram receives the standard browser request for that URL.
The extension does not attach any user identifier to that request.

## Data shared with the developer

**None.** The extension does not include any telemetry, crash reporting,
analytics, or remote logging. The developer has no server that receives any
data from users of the extension.

## Permissions requested

| Permission | Why it is needed |
|---|---|
| `storage` | To persist your UID, preferences, and the local invader cache |
| `activeTab` | To render the overlay on the Komoot tab you are currently viewing |
| `https://pnote.eu/*` | To fetch the public invader dataset |
| `https://api.space-invaders.com/*` | To fetch your Flash Invaders gallery (only if you provide a UID) |
| Content-script match on `www.komoot.com / .fr / .de` | To inject the overlay rendering code into Komoot map pages |

## Children

The extension is not directed at children and does not knowingly process any
data from children.

## Changes to this policy

If the behavior of the extension changes in a way that affects this policy,
this document will be updated and the version number in `manifest.json` will
be bumped. The latest version of this policy is always available in the
repository of the extension.

## Contact

Questions about this policy or about how the extension handles data can be
directed to the developer via the repository issue tracker.
