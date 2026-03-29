/* ============================================================
 *  background/background.js
 *  Handles cross-origin fetches to pnote.eu and the Flash
 *  Invaders API on behalf of the content script.
 * ============================================================ */

// In-memory caches
let invadersCache = null;
let fetchPromise = null;
let foundCache = null;       // Set of found invader names (e.g. "PA_593")
let foundFetchPromise = null;

// ================================================================
//  PNOTE.EU — All invader locations
// ================================================================

async function fetchAllInvaders() {
  if (invadersCache) return invadersCache;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const res = await fetch(
        "https://pnote.eu/projects/invaders/map/invaders.json?nocache=" + Date.now()
      );
      if (!res.ok) {
        console.error("[pnote-komoot] HTTP error", res.status);
        return [];
      }
      const data = await res.json();
      invadersCache = normalizeData(data);
      console.log(`[pnote-komoot] Loaded ${invadersCache.length} invaders from pnote.eu`);
      return invadersCache;
    } catch (e) {
      console.error("[pnote-komoot] Fetch failed", e);
      return [];
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

function normalizeData(raw) {
  if (!raw || typeof raw !== "object") {
    console.warn("[pnote-komoot] Unexpected data format", raw);
    return [];
  }
  const entries = Array.isArray(raw) ? raw : Object.values(raw);
  return entries
    .map(item => ({
      lat: item.obf_lat ?? item.lat,
      lng: item.obf_lng ?? item.lng,
      id: item.id || "",
      status: item.status || "",
      hint: item.hint || null,
      instagramUrl: item.instagramUrl || ""
    }))
    .filter(inv => inv.lat != null && inv.lng != null);
}

// ================================================================
//  FLASH INVADERS API — Found invaders for a user
// ================================================================

async function fetchFoundInvaders(uid) {
  if (!uid) return null;
  if (foundCache) return foundCache;
  if (foundFetchPromise) return foundFetchPromise;

  foundFetchPromise = (async () => {
    try {
      const url = `https://api.space-invaders.com/flashinvaders_v3_pas_trop_predictif/api/gallery?uid=${encodeURIComponent(uid)}`;
      console.log("[pnote-komoot] Fetching found invaders from Flash Invaders API…");
      const res = await fetch(url);
      if (!res.ok) {
        console.error("[pnote-komoot] Flash Invaders API HTTP error", res.status);
        return null;
      }
      const data = await res.json();

      // Extract found invader names into a Set
      const foundSet = new Set();
      const invaders = data.invaders;

      if (Array.isArray(invaders)) {
        // Array of objects like [ { "PA_593": { name: "PA_593", ... } }, ... ]
        for (const entry of invaders) {
          if (entry && typeof entry === "object") {
            for (const key of Object.keys(entry)) {
              foundSet.add(key.toUpperCase());
              const inner = entry[key];
              if (inner && inner.name) foundSet.add(inner.name.toUpperCase());
            }
          }
        }
      } else if (invaders && typeof invaders === "object") {
        // Object keyed by name: { "PA_593": { name: "PA_593", ... }, ... }
        for (const key of Object.keys(invaders)) {
          foundSet.add(key.toUpperCase());
          const inner = invaders[key];
          if (inner && inner.name) foundSet.add(inner.name.toUpperCase());
        }
      }

      foundCache = foundSet;
      console.log(`[pnote-komoot] Found ${foundSet.size} flashed invaders for this user`);
      return foundSet;
    } catch (e) {
      console.error("[pnote-komoot] Flash Invaders API fetch failed", e);
      return null;
    } finally {
      foundFetchPromise = null;
    }
  })();

  return foundFetchPromise;
}

// ================================================================
//  Filtering & GeoJSON conversion
// ================================================================

function filterByBounds(invaders, bounds) {
  const { north, south, east, west } = bounds;
  return invaders.filter(inv => {
    if (inv.lat == null || inv.lng == null) return false;
    const latOk = inv.lat >= south && inv.lat <= north;
    let lngOk;
    if (west <= east) {
      lngOk = inv.lng >= west && inv.lng <= east;
    } else {
      lngOk = inv.lng >= west || inv.lng <= east;
    }
    return latOk && lngOk;
  });
}

function toGeoJSON(invaders, foundSet) {
  return {
    type: "FeatureCollection",
    features: invaders.map(inv => {
      const found = foundSet ? foundSet.has(inv.id.toUpperCase()) : false;
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [inv.lng, inv.lat]
        },
        properties: {
          id: inv.id,
          status: inv.status,
          hint: inv.hint,
          instagramUrl: inv.instagramUrl,
          found: found
        }
      };
    })
  };
}

// ================================================================
//  Message listener
// ================================================================

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "FETCH_INVADERS") {
    (async () => {
      try {
        const all = await fetchAllInvaders();

        // Fetch found invaders if uid provided
        let foundSet = null;
        if (msg.uid) {
          foundSet = await fetchFoundInvaders(msg.uid);
        }

        const visible = filterByBounds(all, msg.bounds);
        const geojson = toGeoJSON(visible, foundSet);

        const foundCount = foundSet
          ? visible.filter(inv => foundSet.has(inv.id.toUpperCase())).length
          : 0;

        console.log(`[pnote-komoot] Returning ${visible.length}/${all.length} invaders (${foundCount} found)`);

        sendResponse({
          geojson,
          total: all.length,
          visible: visible.length,
          foundInView: foundCount,
          totalFound: foundSet ? foundSet.size : 0
        });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === "INVALIDATE_CACHE") {
    invadersCache = null;
    foundCache = null;
    sendResponse({ ok: true });
    return false;
  }
});
