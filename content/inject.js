/* ============================================================
 *  content/inject.js
 *  Injected into the PAGE context.
 *  Tries to access the Mapbox/Maplibre map instance.
 *  Falls back to an HTML overlay if the map instance
 *  cannot be found.
 * ============================================================ */
(function () {
  "use strict";

  const MSG_PREFIX   = "pnote-komoot";
  const SOURCE_ID    = "pnote-invaders-src";
  const LAYER_ID     = "pnote-invaders-dots";

  let mapInstance    = null;
  let useNativeMap   = false;
  let overlayEl      = null;
  let currentGeoJSON = null;
  let visible        = true;
  let hideFound      = false;
  let urlPollTimer   = null;
  let lastUrl        = "";

  // ================================================================
  //  MAP INSTANCE DETECTION (multiple strategies)
  // ================================================================

  function isMapInstance(obj) {
    try {
      return obj &&
        typeof obj === "object" &&
        typeof obj.getBounds === "function" &&
        typeof obj.addLayer  === "function" &&
        typeof obj.addSource === "function";
    } catch (_) { return false; }
  }

  /** Search an object's own keys (up to `depth` levels) */
  function deepSearch(obj, depth, visited) {
    if (depth <= 0 || !obj || typeof obj !== "object") return null;
    if (visited.has(obj)) return null;
    visited.add(obj);
    if (isMapInstance(obj)) return obj;
    try {
      for (const key of Object.keys(obj)) {
        try {
          const val = obj[key];
          if (val && typeof val === "object") {
            const found = deepSearch(val, depth - 1, visited);
            if (found) return found;
          }
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }

  /** Walk the React fiber tree from a DOM element looking for a map ref */
  function findMapViaReactFiber(container) {
    const fiberKey = Object.keys(container).find(k =>
      k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
    );
    if (!fiberKey) return null;

    let fiber = container[fiberKey];
    const visited = new Set();

    while (fiber && !visited.has(fiber)) {
      visited.add(fiber);

      // stateNode
      if (fiber.stateNode) {
        const found = deepSearch(fiber.stateNode, 3, new WeakSet());
        if (found) return found;
      }
      // memoizedProps
      if (fiber.memoizedProps) {
        const found = deepSearch(fiber.memoizedProps, 3, new WeakSet());
        if (found) return found;
      }
      // memoizedState (React hooks linked list)
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.memoizedState) {
          const found = deepSearch(hook.memoizedState, 3, new WeakSet());
          if (found) return found;
        }
        if (hook.queue && hook.queue.lastRenderedState) {
          const found = deepSearch(hook.queue.lastRenderedState, 3, new WeakSet());
          if (found) return found;
        }
        hook = hook.next;
      }

      fiber = fiber.return;
    }
    return null;
  }

  /** Try all detection strategies */
  function findMap() {
    // 1. Global variables
    for (const name of ["map", "_map", "komootMap"]) {
      try { if (isMapInstance(window[name])) return window[name]; } catch (_) {}
    }

    // 2. DOM containers → React fiber + direct properties
    const containers = document.querySelectorAll(
      ".mapboxgl-map, .maplibregl-map"
    );
    for (const c of containers) {
      // Direct properties
      for (const prop of ["_map", "__map", "map", "_mapboxgl_map"]) {
        try { if (isMapInstance(c[prop])) return c[prop]; } catch (_) {}
      }
      // All own keys
      for (const key of Object.keys(c)) {
        try { if (isMapInstance(c[key])) return c[key]; } catch (_) {}
      }
      // React fiber
      const fromFiber = findMapViaReactFiber(c);
      if (fromFiber) return fromFiber;
    }

    return null;
  }

  // ================================================================
  //  NATIVE MAP RENDERING (Mapbox addSource / addLayer)
  // ================================================================

  function nativeUpdate(geojson) {
    if (!mapInstance) return;
    try {
      // Filter out found invaders if hideFound is on
      const filteredGeoJSON = hideFound
        ? { ...geojson, features: geojson.features.filter(f => !f.properties.found) }
        : geojson;

      const src = mapInstance.getSource(SOURCE_ID);
      if (src) {
        src.setData(filteredGeoJSON);
      } else {
        mapInstance.addSource(SOURCE_ID, { type: "geojson", data: filteredGeoJSON });
        mapInstance.addLayer({
          id: LAYER_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"],
              5, 2, 10, 4, 14, 7, 18, 12],
            "circle-color": [
              "case",
              ["==", ["get", "found"], true], "#00cc66",  // green = already found
              "#ff3300"                                     // red = not yet found
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.5,
            "circle-opacity": 0.85
          }
        });
        mapInstance.on("click", LAYER_ID, onDotClick);
        mapInstance.on("mouseenter", LAYER_ID, () =>
          mapInstance.getCanvas().style.cursor = "pointer");
        mapInstance.on("mouseleave", LAYER_ID, () =>
          mapInstance.getCanvas().style.cursor = "");
      }
    } catch (e) {
      console.error("[pnote-komoot] nativeUpdate error", e);
    }
  }

  function onDotClick(e) {
    if (!e.features || !e.features.length) return;
    const p = e.features[0].properties;
    const tag = (p.id || "").toLowerCase().replace(/\s+/g, "");
    if (tag) window.open(`https://www.instagram.com/explore/tags/${tag}`, "_blank");
  }

  function nativeToggle(show) {
    if (!mapInstance) return;
    try {
      if (mapInstance.getLayer(LAYER_ID))
        mapInstance.setLayoutProperty(LAYER_ID, "visibility", show ? "visible" : "none");
    } catch (_) {}
  }

  function nativeGetBounds() {
    if (!mapInstance) return null;
    try {
      const b = mapInstance.getBounds();
      return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
    } catch (_) { return null; }
  }

  // ================================================================
  //  HTML OVERLAY FALLBACK (no map instance needed)
  // ================================================================

  /** Parse @lat,lng,zoomz from the current URL */
  function parseViewportFromUrl() {
    const m = window.location.href.match(/@([-\d.]+),([-\d.]+),([\d.]+)z/);
    if (!m) return null;
    return { lat: parseFloat(m[1]), lng: parseFloat(m[2]), zoom: parseFloat(m[3]) };
  }

  /** Web Mercator helpers */
  function lngToWorldX(lng, zoom) {
    return ((lng + 180) / 360) * 256 * Math.pow(2, zoom);
  }
  function latToWorldY(lat, zoom) {
    const r = lat * Math.PI / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * Math.pow(2, zoom);
  }

  /** Compute bounds from URL-parsed viewport + container size */
  function boundsFromUrl() {
    const vp = parseViewportFromUrl();
    if (!vp) return null;
    const container = document.querySelector(".mapboxgl-map, .maplibregl-map");
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const cx = lngToWorldX(vp.lng, vp.zoom);
    const cy = latToWorldY(vp.lat, vp.zoom);
    function worldXToLng(x) { return (x / (256 * Math.pow(2, vp.zoom))) * 360 - 180; }
    function worldYToLat(y) {
      const n = Math.PI - 2 * Math.PI * y / (256 * Math.pow(2, vp.zoom));
      return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    }
    return {
      north: worldYToLat(cy - rect.height / 2),
      south: worldYToLat(cy + rect.height / 2),
      west:  worldXToLng(cx - rect.width / 2),
      east:  worldXToLng(cx + rect.width / 2)
    };
  }

  /** Find the map container element — tries many strategies */
  function findMapContainer() {
    // 1. Known map library classes
    const knownSelectors = [
      ".mapboxgl-map",
      ".maplibregl-map",
      ".map-container",
      "[class*='mapboxgl']",
      "[class*='maplibre']",
      "[class*='MapContainer']",
      "[class*='map-canvas']",
    ];
    for (const sel of knownSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        console.log(`[pnote-komoot] Map container found via selector: ${sel}`, el);
        return el;
      }
    }

    // 2. Find the largest canvas on the page — almost certainly the map
    const canvases = document.querySelectorAll("canvas");
    let bestCanvas = null;
    let bestArea = 0;
    for (const c of canvases) {
      const rect = c.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        bestCanvas = c;
      }
    }
    if (bestCanvas && bestArea > 50000) { // at least ~224x224
      // Use the canvas's parent as the container
      const parent = bestCanvas.parentElement;
      console.log(`[pnote-komoot] Map container found via largest canvas (${Math.round(bestArea)}px²)`, parent);
      return parent;
    }

    console.warn("[pnote-komoot] Could not find any map container. DOM classes available:",
      [...new Set([...document.querySelectorAll("[class]")].flatMap(el => [...el.classList]))].filter(c => /map|canvas|gl/i.test(c))
    );
    return null;
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    const container = findMapContainer();
    if (!container) return null;
    overlayEl = document.createElement("div");
    overlayEl.id = "pnote-invaders-overlay";
    overlayEl.style.cssText =
      "position:absolute;top:0;left:0;right:0;bottom:0;" +
      "pointer-events:none;z-index:9999;overflow:hidden;";
    container.style.position = "relative";
    container.appendChild(overlayEl);
    return overlayEl;
  }

  function overlayUpdate(geojson) {
    const ov = ensureOverlay();
    if (!ov) { console.warn("[pnote-komoot] No map container found for overlay"); return; }
    const vp = parseViewportFromUrl();
    if (!vp) { console.warn("[pnote-komoot] Cannot parse viewport from URL"); return; }

    const container = ov.parentElement;
    const rect = container.getBoundingClientRect();
    const cx = lngToWorldX(vp.lng, vp.zoom);
    const cy = latToWorldY(vp.lat, vp.zoom);

    ov.innerHTML = "";
    let rendered = 0;
    for (const f of geojson.features) {
      const isFound = f.properties.found === true;

      // Skip found invaders if hideFound is on
      if (hideFound && isFound) continue;

      const [lng, lat] = f.geometry.coordinates;
      const wx = lngToWorldX(lng, vp.zoom);
      const wy = latToWorldY(lat, vp.zoom);
      const px = wx - cx + rect.width  / 2;
      const py = wy - cy + rect.height / 2;
      if (px < -20 || py < -20 || px > rect.width + 20 || py > rect.height + 20) continue;

      const color = isFound ? "#00cc66" : "#ff3300";
      const tag = (f.properties.id || "").toLowerCase().replace(/\s+/g, "");
      const dot = document.createElement("a");
      dot.className = "pnote-dot";
      dot.href = tag ? `https://www.instagram.com/explore/tags/${tag}` : "#";
      dot.target = "_blank";
      dot.rel = "noopener noreferrer";
      dot.draggable = false;
      dot.style.cssText =
        `position:absolute;left:${px}px;top:${py}px;` +
        "display:block;width:14px;height:14px;margin:-7px 0 0 -7px;" +
        `background:${color};border:1.5px solid #fff;border-radius:50%;` +
        "pointer-events:auto;cursor:pointer;opacity:0.9;" +
        "transition:transform .15s;text-decoration:none;";
      const badge = isFound ? " ✅" : "";
      dot.title = `${f.properties.id || "Invader"}${badge} — ${f.properties.status || ""}`;
      // Block ALL event propagation so the map never sees pointer/mouse events on dots
      for (const evt of ["pointerdown","pointerup","pointermove","mousedown","mouseup","touchstart","touchend"]) {
        dot.addEventListener(evt, (e) => { e.stopPropagation(); });
      }
      dot.addEventListener("mouseenter", () => dot.style.transform = "scale(1.8)");
      dot.addEventListener("mouseleave", () => dot.style.transform = "scale(1)");
      ov.appendChild(dot);
      rendered++;
    }
    console.log(`[pnote-komoot] Overlay: rendered ${rendered} dots`);
  }

  function overlayToggle(show) {
    if (overlayEl) overlayEl.style.display = show ? "" : "none";
  }

  /** Poll URL changes to re-render overlay when user pans/zooms */
  function startUrlPolling() {
    if (urlPollTimer) return;
    lastUrl = window.location.href;
    urlPollTimer = setInterval(() => {
      if (!currentGeoJSON || !visible) return;
      const newUrl = window.location.href;
      if (newUrl !== lastUrl) {
        lastUrl = newUrl;
        if (!useNativeMap) overlayUpdate(currentGeoJSON);
      }
    }, 600);
  }

  // ================================================================
  //  PUBLIC API (message-based)
  // ================================================================

  function tryNativeMap() {
    if (mapInstance) return true;
    mapInstance = findMap();
    if (mapInstance) {
      useNativeMap = true;
      console.log("[pnote-komoot] ✅ Native map instance found!");
      return true;
    }
    return false;
  }

  function handleUpdate(geojson, msgHideFound) {
    currentGeoJSON = geojson;
    if (msgHideFound !== undefined) hideFound = msgHideFound;
    tryNativeMap();
    if (useNativeMap) {
      nativeUpdate(geojson);
      console.log("[pnote-komoot] Rendered via native Mapbox layer");
    } else {
      overlayUpdate(geojson);
      startUrlPolling();
      console.log("[pnote-komoot] Rendered via HTML overlay fallback");
    }
  }

  function handleToggle(show) {
    visible = show;
    if (useNativeMap) nativeToggle(show);
    else overlayToggle(show);
  }

  function handleGetBounds() {
    tryNativeMap();
    let bounds = null;
    if (useNativeMap) bounds = nativeGetBounds();
    if (!bounds) bounds = boundsFromUrl();
    window.postMessage({ source: MSG_PREFIX, type: "BOUNDS_RESULT", bounds }, "*");
  }

  // ── Listen for commands from content script ──────────────────
  window.addEventListener("message", (event) => {
    if (!event.data || event.data.source !== MSG_PREFIX) return;
    switch (event.data.type) {
      case "UPDATE_LAYER": handleUpdate(event.data.geojson, event.data.hideFound); break;
      case "TOGGLE_LAYER": handleToggle(event.data.visible); break;
      case "GET_BOUNDS":   handleGetBounds(); break;
    }
  });

  // Notify content script that inject.js is ready
  window.postMessage({ source: MSG_PREFIX, type: "INJECT_READY" }, "*");
  console.log("[pnote-komoot] inject.js loaded");
})();
