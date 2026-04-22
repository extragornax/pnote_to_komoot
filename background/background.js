/* ============================================================
 *  background/background.js
 *  Cross-origin fetcher for pnote.eu + Flash Invaders API.
 *  Returns the full dataset as GeoJSON; MapLibre renders
 *  only what's on screen, so no bounds filtering is needed.
 * ============================================================ */

let invadersCache = null;
let fetchPromise = null;

let foundCache = new Map();     // uid → Set<string>
let foundFetchPromise = new Map();

// ── pnote.eu: all invaders ───────────────────────────────────

async function fetchAllInvaders() {
  if (invadersCache) return invadersCache;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const res = await fetch(
        "https://pnote.eu/projects/invaders/map/invaders.json?nocache=" + Date.now()
      );
      if (!res.ok) {
        console.error("[pnote-komoot] pnote HTTP", res.status);
        return [];
      }
      const data = await res.json();
      invadersCache = normalize(data);
      console.log(`[pnote-komoot] Loaded ${invadersCache.length} invaders from pnote.eu`);
      return invadersCache;
    } catch (e) {
      console.error("[pnote-komoot] pnote fetch failed:", e);
      return [];
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

function normalize(raw) {
  if (!raw || typeof raw !== "object") return [];
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
    .filter(i => i.lat != null && i.lng != null);
}

// ── Flash Invaders: user's flashed invaders ──────────────────

async function fetchFoundInvaders(uid) {
  if (!uid) return null;
  if (foundCache.has(uid)) return foundCache.get(uid);
  if (foundFetchPromise.has(uid)) return foundFetchPromise.get(uid);

  const p = (async () => {
    try {
      const url = `https://api.space-invaders.com/flashinvaders_v3_pas_trop_predictif/api/gallery?uid=${encodeURIComponent(uid)}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error("[pnote-komoot] Flash Invaders HTTP", res.status);
        return null;
      }
      const data = await res.json();
      const set = new Set();
      const invaders = data.invaders;
      if (Array.isArray(invaders)) {
        for (const entry of invaders) {
          if (!entry || typeof entry !== "object") continue;
          for (const k of Object.keys(entry)) {
            set.add(k.toUpperCase());
            const inner = entry[k];
            if (inner && inner.name) set.add(String(inner.name).toUpperCase());
          }
        }
      } else if (invaders && typeof invaders === "object") {
        for (const k of Object.keys(invaders)) {
          set.add(k.toUpperCase());
          const inner = invaders[k];
          if (inner && inner.name) set.add(String(inner.name).toUpperCase());
        }
      }
      foundCache.set(uid, set);
      console.log(`[pnote-komoot] Flash Invaders: ${set.size} flashed for uid=${uid.substring(0,6)}…`);
      return set;
    } catch (e) {
      console.error("[pnote-komoot] Flash Invaders fetch failed:", e);
      return null;
    } finally {
      foundFetchPromise.delete(uid);
    }
  })();

  foundFetchPromise.set(uid, p);
  return p;
}

// ── GeoJSON conversion ───────────────────────────────────────

function toGeoJSON(invaders, foundSet) {
  return {
    type: "FeatureCollection",
    features: invaders.map(inv => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [inv.lng, inv.lat] },
      properties: {
        id: inv.id,
        status: inv.status,
        hint: inv.hint,
        instagramUrl: inv.instagramUrl,
        found: foundSet ? foundSet.has(String(inv.id).toUpperCase()) : false
      }
    }))
  };
}

// ── Message handler ──────────────────────────────────────────

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_INVADERS") {
    (async () => {
      try {
        const all = await fetchAllInvaders();
        const foundSet = msg.uid ? await fetchFoundInvaders(msg.uid) : null;
        const geojson = toGeoJSON(all, foundSet);
        sendResponse({
          geojson,
          total: all.length,
          totalFound: foundSet ? foundSet.size : 0
        });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === "INVALIDATE_CACHE") {
    invadersCache = null;
    foundCache.clear();
    sendResponse({ ok: true });
    return false;
  }
});
