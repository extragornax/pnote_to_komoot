/* ============================================================
 *  content/inject.js
 *  Runs in the PAGE context so it can reach Komoot's
 *  MapLibre/Mapbox GL map instance. Adds a native GeoJSON
 *  source + layer — MapLibre handles zoom/pitch/rotation.
 * ============================================================ */
(function () {
  "use strict";

  const MSG_PREFIX = "pnote-komoot";
  const SOURCE_ID  = "pnote-invaders-src";
  const LAYER_ID   = "pnote-invaders-dots";

  let map = null;
  let ready = false;
  let currentGeoJSON = { type: "FeatureCollection", features: [] };
  let hideFound = false;

  // ── Map instance detection ───────────────────────────────

  function looksLikeMap(obj) {
    try {
      return obj && typeof obj === "object"
        && typeof obj.getBounds === "function"
        && typeof obj.addLayer  === "function"
        && typeof obj.addSource === "function"
        && typeof obj.project   === "function";
    } catch (_) { return false; }
  }

  function deepSearch(obj, depth, visited) {
    if (depth <= 0 || !obj || typeof obj !== "object") return null;
    if (visited.has(obj)) return null;
    visited.add(obj);
    if (looksLikeMap(obj)) return obj;
    try {
      for (const key of Object.keys(obj)) {
        try {
          const v = obj[key];
          if (v && typeof v === "object") {
            const found = deepSearch(v, depth - 1, visited);
            if (found) return found;
          }
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }

  function findViaReactFiber(container) {
    const fiberKey = Object.keys(container).find(k =>
      k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
    );
    if (!fiberKey) return null;
    let fiber = container[fiberKey];
    const seen = new Set();
    while (fiber && !seen.has(fiber)) {
      seen.add(fiber);
      for (const field of ["stateNode", "memoizedProps", "memoizedState"]) {
        const node = fiber[field];
        if (node) {
          const found = deepSearch(node, 4, new WeakSet());
          if (found) return found;
        }
      }
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.memoizedState) {
          const found = deepSearch(hook.memoizedState, 4, new WeakSet());
          if (found) return found;
        }
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function findMap() {
    for (const g of ["map", "_map", "komootMap", "mbMap"]) {
      try { if (looksLikeMap(window[g])) return window[g]; } catch (_) {}
    }
    const containers = document.querySelectorAll(".mapboxgl-map, .maplibregl-map");
    for (const c of containers) {
      for (const p of ["_map", "__map", "map", "_mapboxgl_map"]) {
        try { if (looksLikeMap(c[p])) return c[p]; } catch (_) {}
      }
      for (const k of Object.keys(c)) {
        try { if (looksLikeMap(c[k])) return c[k]; } catch (_) {}
      }
      const viaFiber = findViaReactFiber(c);
      if (viaFiber) return viaFiber;
    }
    return null;
  }

  // ── Layer management ─────────────────────────────────────

  function buildFilter() {
    // Always drop destroyed; optionally drop found.
    const base = ["all",
      ["!=", ["get", "status"], "destroyed"]
    ];
    if (hideFound) {
      base.push(["!=", ["get", "found"], true]);
    }
    return base;
  }

  function ensureLayer() {
    if (!map) return;
    const src = map.getSource(SOURCE_ID);
    if (src) {
      src.setData(currentGeoJSON);
      if (map.getLayer(LAYER_ID)) {
        map.setFilter(LAYER_ID, buildFilter());
      }
      return;
    }
    map.addSource(SOURCE_ID, { type: "geojson", data: currentGeoJSON });
    map.addLayer({
      id: LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: buildFilter(),
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          5, 2, 10, 4, 14, 7, 18, 12
        ],
        "circle-color": [
          "case",
          ["==", ["get", "found"],  true],     "#00cc66",
          ["==", ["get", "status"], "damaged"], "#ff9900",
          "#ff3300"
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
        "circle-opacity": 0.9
      }
    });

    map.on("click", LAYER_ID, onDotClick);
    map.on("mouseenter", LAYER_ID, onMouseEnter);
    map.on("mouseleave", LAYER_ID, onMouseLeave);
  }

  let tooltipEl = null;
  function getTooltip() {
    if (tooltipEl && document.body.contains(tooltipEl)) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.id = "pnote-tooltip";
    tooltipEl.style.cssText =
      "position:fixed;display:none;pointer-events:none;z-index:10001;" +
      "background:#1a1a2e;color:#fff;padding:6px 10px;border-radius:6px;" +
      "font:bold 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "box-shadow:0 2px 8px rgba(0,0,0,0.5);white-space:nowrap;max-width:280px;";
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function onMouseEnter(e) {
    if (!map || !e.features || !e.features[0]) return;
    map.getCanvas().style.cursor = "pointer";
    const p = e.features[0].properties;
    const badge = p.found === true || p.found === "true" ? " ✅" : "";
    const warn  = p.status === "damaged" ? " ⚠️" : "";
    const tip = getTooltip();
    tip.textContent = `${p.id || "Invader"}${badge}${warn}`;
    tip.style.display = "block";
    tip.style.left = (e.originalEvent.clientX + 14) + "px";
    tip.style.top  = (e.originalEvent.clientY - 10) + "px";
  }

  function onMouseLeave() {
    if (!map) return;
    map.getCanvas().style.cursor = "";
    if (tooltipEl) tooltipEl.style.display = "none";
  }

  function onDotClick(e) {
    if (!e.features || !e.features[0]) return;
    const p = e.features[0].properties;
    const tag = (p.id || "").toLowerCase().replace(/\s+/g, "");
    if (tag) window.open(`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}`, "_blank");
  }

  function setVisible(show) {
    if (!map || !map.getLayer(LAYER_ID)) return;
    map.setLayoutProperty(LAYER_ID, "visibility", show ? "visible" : "none");
  }

  // ── Map readiness ────────────────────────────────────────

  function whenStyleReady(fn) {
    if (!map) return;
    if (map.isStyleLoaded && map.isStyleLoaded()) { fn(); return; }
    map.once("load", fn);
  }

  function onMoveEnd() {
    try {
      const b = map.getBounds();
      window.postMessage({
        source: MSG_PREFIX,
        type: "MAP_MOVED",
        bounds: { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
        zoom: map.getZoom()
      }, "*");
    } catch (_) {}
  }

  function announceReady() {
    try {
      const b = map.getBounds();
      ready = true;
      window.postMessage({
        source: MSG_PREFIX,
        type: "INJECT_READY",
        bounds: { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
        zoom: map.getZoom()
      }, "*");
      console.log("[pnote-komoot] inject.js: native map bound");
    } catch (e) {
      console.warn("[pnote-komoot] inject.js: getBounds failed", e);
    }
  }

  function bindMap(found) {
    map = found;
    whenStyleReady(() => {
      ensureLayer();
      map.on("moveend", onMoveEnd);
      announceReady();
    });
  }

  // Poll until the map appears — Komoot's SPA may mount it after inject.js loads.
  let pollTimer = null;
  function startPollingForMap() {
    let tries = 0;
    pollTimer = setInterval(() => {
      if (map) { clearInterval(pollTimer); pollTimer = null; return; }
      const m = findMap();
      if (m) { clearInterval(pollTimer); pollTimer = null; bindMap(m); return; }
      tries++;
      if (tries > 120) { // ~60s
        clearInterval(pollTimer); pollTimer = null;
        console.warn("[pnote-komoot] inject.js: map instance not found after 60s");
      }
    }, 500);
  }

  // ── Message handling from content script ────────────────

  window.addEventListener("message", (event) => {
    if (!event.data || event.data.source !== MSG_PREFIX) return;
    const { type } = event.data;

    if (type === "UPDATE_DATA") {
      currentGeoJSON = event.data.geojson || { type: "FeatureCollection", features: [] };
      if (event.data.hideFound !== undefined) hideFound = event.data.hideFound === true;
      if (!map) return;
      whenStyleReady(ensureLayer);
      return;
    }

    if (type === "SET_VISIBLE") {
      setVisible(event.data.visible !== false);
      return;
    }

    if (type === "SET_HIDE_FOUND") {
      hideFound = event.data.hideFound === true;
      if (map && map.getLayer(LAYER_ID)) map.setFilter(LAYER_ID, buildFilter());
      return;
    }

    if (type === "GET_BOUNDS") {
      if (!map) return;
      try {
        const b = map.getBounds();
        window.postMessage({
          source: MSG_PREFIX,
          type: "BOUNDS_RESULT",
          requestId: event.data.requestId,
          bounds: { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
          zoom: map.getZoom()
        }, "*");
      } catch (_) {}
      return;
    }
  });

  // ── Kickoff ───────────────────────────────────────────────

  const initial = findMap();
  if (initial) bindMap(initial);
  else startPollingForMap();

  console.log("[pnote-komoot] inject.js loaded");
})();
