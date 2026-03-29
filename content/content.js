/* ============================================================
 *  content/content.js
 *  Content script injected into Komoot pages.
 *  Loads invader data ONLY when requested by the popup.
 *  Renders dots directly as a fixed overlay on the page.
 * ============================================================ */
(function () {
  "use strict";

  const MSG_PREFIX = "pnote-komoot";
  let enabled = true;
  let injectReady = false;
  let dataLoaded = false;
  let hideFound = false;
  let uid = "";

  let overlayEl = null;
  let tooltipEl = null;
  let currentGeoJSON = null;
  let urlPollTimer = null;
  let lastUrl = "";
  let cachedMapRect = null;
  let mapRectAge = 0;
  let debugMode = false;
  let debugEl = null;
  let manualOffsetX = 0; // manual sidebar offset from popup calibration slider

  // ── Inject the page-context script (for native map if possible) ──
  function injectPageScript() {
    const s = document.createElement("script");
    s.src = browser.runtime.getURL("content/inject.js");
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  function onDomReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  // ================================================================
  //  URL PARSING & WEB MERCATOR MATH
  // ================================================================

  function parseViewport() {
    const url = window.location.href;
    const m = url.match(/@([-\d.]+),([-\d.]+),([\d.]+)z/);
    if (!m) return null;
    return { lat: parseFloat(m[1]), lng: parseFloat(m[2]), zoom: parseFloat(m[3]) };
  }

  // Mapbox GL / Maplibre uses 512px at zoom 0 (not 256 like Leaflet/OSM)
  const TILE_SIZE = 512;

  function lngToWorldX(lng, zoom) {
    return ((lng + 180) / 360) * TILE_SIZE * Math.pow(2, zoom);
  }
  function latToWorldY(lat, zoom) {
    const r = lat * Math.PI / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE_SIZE * Math.pow(2, zoom);
  }

  function computeBounds(vp, mapRect) {
    const mapW = mapRect.width;
    const mapH = mapRect.height;
    const scale = TILE_SIZE * Math.pow(2, vp.zoom);
    const cx = ((vp.lng + 180) / 360) * scale;
    const latRad = vp.lat * Math.PI / 180;
    const cy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;

    function worldXToLng(x) { return (x / scale) * 360 - 180; }
    function worldYToLat(y) {
      const n = Math.PI - 2 * Math.PI * y / scale;
      return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    }
    const marginW = mapW * 0.3;
    const marginH = mapH * 0.3;
    return {
      north: worldYToLat(cy - (mapH / 2 + marginH)),
      south: worldYToLat(cy + (mapH / 2 + marginH)),
      west:  worldXToLng(cx - (mapW / 2 + marginW)),
      east:  worldXToLng(cx + (mapW / 2 + marginW))
    };
  }

  // ================================================================
  //  SIDEBAR DETECTION (elementFromPoint scanning)
  // ================================================================

  /**
   * Detect the width of Komoot's left sidebar by physically probing the screen.
   * Uses document.elementFromPoint() to scan from left to right:
   * the sidebar overlays the map canvas, so we look for the transition
   * from "sidebar element" to "canvas element".
   */
  function detectSidebarWidth() {
    // Hide our own overlays so they don't interfere with elementFromPoint
    const ownEls = [overlayEl, debugEl, tooltipEl].filter(Boolean);
    ownEls.forEach(el => el.style.display = "none");

    try {
      const midY = Math.round(window.innerHeight / 2);

      // Quick check: is a canvas at the very left edge? If so, no sidebar.
      const leftEl = document.elementFromPoint(20, midY);
      if (!leftEl || leftEl.tagName === "CANVAS") {
        console.log("[pnote-komoot] No sidebar (canvas at left edge)");
        return 0;
      }
      if (leftEl === document.body || leftEl === document.documentElement) {
        return 0;
      }

      // Walk up from the left-edge element to find its root sidebar container
      // (stop when the parent is wider than 70% of viewport = probably the page wrapper)
      let sidebarRoot = leftEl;
      while (sidebarRoot.parentElement &&
             sidebarRoot.parentElement !== document.body &&
             sidebarRoot.parentElement !== document.documentElement) {
        const pw = sidebarRoot.parentElement.getBoundingClientRect().width;
        if (pw > window.innerWidth * 0.7) break;
        sidebarRoot = sidebarRoot.parentElement;
      }

      const sidebarRect = sidebarRoot.getBoundingClientRect();
      if (sidebarRect.width > 100 && sidebarRect.width < 700 && sidebarRect.height > 200) {
        const rightEdge = Math.round(sidebarRect.left + sidebarRect.width);
        console.log(`[pnote-komoot] Sidebar detected via elementFromPoint: rightEdge=${rightEdge}px (${sidebarRoot.tagName}, class="${(sidebarRoot.className || "").toString().substring(0, 60)}")`);
        return rightEdge;
      }

      // Fallback: scan rightward for a canvas hit
      for (let x = 50; x < 800; x += 10) {
        const el = document.elementFromPoint(x, midY);
        if (el && el.tagName === "CANVAS") {
          console.log(`[pnote-komoot] Sidebar edge at x=${x} (canvas hit)`);
          return x > 50 ? x : 0;
        }
      }

      console.log("[pnote-komoot] No sidebar detected");
      return 0;
    } finally {
      ownEls.forEach(el => el.style.display = "");
    }
  }

  // ================================================================
  //  MAP RECTANGLE DETECTION
  // ================================================================

  function findMapRect() {
    const now = Date.now();
    if (cachedMapRect && (now - mapRectAge) < 2000) return cachedMapRect;

    const selectors = [
      ".mapboxgl-map", ".maplibregl-map",
      "[class*='mapboxgl']", "[class*='maplibre']",
      ".map-container", "[class*='MapContainer']",
      "[data-testid='map']",
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 200 && r.height > 200) {
            cachedMapRect = r; mapRectAge = now;
            return r;
          }
        }
      } catch (_) {}
    }

    // Largest canvas = map
    let best = null, bestArea = 0;
    for (const c of document.querySelectorAll("canvas")) {
      const r = c.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > bestArea) { bestArea = a; best = c; }
    }
    if (best && bestArea > 50000) {
      const r = best.getBoundingClientRect();
      cachedMapRect = r; mapRectAge = now;
      return r;
    }

    const fallback = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    cachedMapRect = fallback; mapRectAge = now;
    return fallback;
  }

  // ================================================================
  //  OVERLAY RENDERING
  // ================================================================

  function ensureOverlay() {
    if (overlayEl && document.body.contains(overlayEl)) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.id = "pnote-invaders-overlay";
    overlayEl.style.cssText =
      "position:fixed; top:0; left:0; width:100vw; height:100vh;" +
      "pointer-events:none; z-index:9999; overflow:hidden;";
    document.body.appendChild(overlayEl);

    // Instant tooltip element (shared, repositioned on hover)
    tooltipEl = document.createElement("div");
    tooltipEl.id = "pnote-tooltip";
    tooltipEl.style.cssText =
      "position:fixed; display:none; pointer-events:none; z-index:10001;" +
      "background:#1a1a2e; color:#fff; padding:6px 10px; border-radius:6px;" +
      "font:bold 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "box-shadow:0 2px 8px rgba(0,0,0,0.5); white-space:nowrap; max-width:280px;";
    document.body.appendChild(tooltipEl);

    return overlayEl;
  }

  function renderOverlay(geojson) {
    const ov = ensureOverlay();
    const vp = parseViewport();
    if (!vp) return;

    const mapRect = findMapRect();

    // Use manual offset if set, otherwise try auto-detection
    const sidebarW = manualOffsetX > 0 ? manualOffsetX : detectSidebarWidth();

    // The URL @lat,lng = center of the VISIBLE map area (with MapLibre padding).
    // Visible area = canvas minus sidebar on the left.
    const visibleLeft  = mapRect.left + sidebarW;
    const visibleWidth = mapRect.width - sidebarW;
    const mapCenterScreenX = visibleLeft + visibleWidth / 2;
    const mapCenterScreenY = mapRect.top + mapRect.height / 2;

    const cx = lngToWorldX(vp.lng, vp.zoom);
    const cy = latToWorldY(vp.lat, vp.zoom);

    ov.innerHTML = "";
    let rendered = 0;
    let skippedDestroyed = 0;

    for (const f of geojson.features) {
      const props = f.properties;
      const status = (props.status || "").toLowerCase();
      const isFound = props.found === true;

      // Skip destroyed invaders entirely
      if (status === "destroyed") { skippedDestroyed++; continue; }

      // Skip found invaders if hideFound is on
      if (hideFound && isFound) continue;

      const [lng, lat] = f.geometry.coordinates;
      const dx = lngToWorldX(lng, vp.zoom) - cx;
      const dy = latToWorldY(lat, vp.zoom) - cy;
      const px = mapCenterScreenX + dx;
      const py = mapCenterScreenY + dy;

      if (px < mapRect.left - 10 || py < mapRect.top - 10 ||
          px > mapRect.right + 10 || py > mapRect.bottom + 10) continue;

      // Color: green=found, orange=damaged, red=OK/default
      let color;
      if (isFound)              color = "#00cc66";
      else if (status === "damaged") color = "#ff9900";
      else                      color = "#ff3300";

      const tag = (props.id || "").toLowerCase().replace(/\s+/g, "");
      const instagramUrl = tag ? `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}` : "#";

      const dot = document.createElement("a");
      dot.href = instagramUrl;
      dot.target = "_blank";
      dot.rel = "noopener noreferrer";
      dot.draggable = false;
      dot.style.cssText =
        `position:absolute;left:${px.toFixed(1)}px;top:${py.toFixed(1)}px;` +
        "width:12px;height:12px;margin:-6px 0 0 -6px;" +
        `background:${color};border:2px solid #fff;border-radius:50%;` +
        "pointer-events:auto;cursor:pointer;opacity:0.9;" +
        "box-shadow:0 0 3px rgba(0,0,0,0.5);transition:transform .1s;" +
        "text-decoration:none;display:block;";

      // Build tooltip text
      const statusIcon = status === "damaged" ? "⚠️" : "";
      const foundBadge = isFound ? " ✅" : "";
      const tipText = `${props.id || "Invader"}${foundBadge} ${statusIcon}`;
      dot.dataset.tip = tipText;

      // Instant tooltip on mouseenter (no native title delay)
      dot.addEventListener("mouseenter", (e) => {
        dot.style.transform = "scale(2)";
        dot.style.zIndex = "10000";
        tooltipEl.textContent = dot.dataset.tip;
        tooltipEl.style.display = "block";
        tooltipEl.style.left = (e.clientX + 14) + "px";
        tooltipEl.style.top  = (e.clientY - 10) + "px";
      });
      dot.addEventListener("mousemove", (e) => {
        tooltipEl.style.left = (e.clientX + 14) + "px";
        tooltipEl.style.top  = (e.clientY - 10) + "px";
      });
      dot.addEventListener("mouseleave", () => {
        dot.style.transform = "scale(1)";
        dot.style.zIndex = "";
        tooltipEl.style.display = "none";
      });

      for (const evt of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
        dot.addEventListener(evt, (e) => {
          e.stopPropagation();
        });
      }
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        console.log(`[pnote-komoot] Dot clicked: ${props.id} -> ${instagramUrl}`);
      });

      ov.appendChild(dot);
      rendered++;
    }
    console.log(`[pnote-komoot] Overlay: ${rendered} dots rendered, ${skippedDestroyed} destroyed skipped`);

    if (debugMode) renderDebug(vp, mapRect, mapCenterScreenX, mapCenterScreenY, sidebarW);
  }

  // ================================================================
  //  DEBUG OVERLAY
  // ================================================================

  function renderDebug(vp, mapRect, centerX, centerY, sidebarW) {
    // Remove previous debug
    if (debugEl && debugEl.parentNode) debugEl.parentNode.removeChild(debugEl);

    debugEl = document.createElement("div");
    debugEl.id = "pnote-debug-overlay";
    debugEl.style.cssText =
      "position:fixed;top:0;left:0;width:100vw;height:100vh;" +
      "pointer-events:none;z-index:10002;overflow:hidden;";

    // 1. Full canvas rect — cyan dashed border
    const rectDiv = document.createElement("div");
    rectDiv.style.cssText =
      `position:absolute;` +
      `left:${mapRect.left}px;top:${mapRect.top}px;` +
      `width:${mapRect.width}px;height:${mapRect.height}px;` +
      "border:3px dashed cyan;box-sizing:border-box;" +
      "background:rgba(0,255,255,0.04);";
    debugEl.appendChild(rectDiv);

    // 2. Sidebar area — yellow shading
    if (sidebarW > 0) {
      const sidebarDiv = document.createElement("div");
      sidebarDiv.style.cssText =
        `position:absolute;` +
        `left:${mapRect.left}px;top:${mapRect.top}px;` +
        `width:${sidebarW}px;height:${mapRect.height}px;` +
        "background:rgba(255,255,0,0.15);border-right:3px solid yellow;box-sizing:border-box;";
      debugEl.appendChild(sidebarDiv);
    }

    // 3. Crosshair at computed center (where URL @lat,lng maps to)
    const crossH = document.createElement("div");
    crossH.style.cssText =
      `position:absolute;left:${mapRect.left}px;top:${centerY}px;` +
      `width:${mapRect.width}px;height:0;border-top:2px solid magenta;`;
    debugEl.appendChild(crossH);

    const crossV = document.createElement("div");
    crossV.style.cssText =
      `position:absolute;left:${centerX}px;top:${mapRect.top}px;` +
      `width:0;height:${mapRect.height}px;border-left:2px solid magenta;`;
    debugEl.appendChild(crossV);

    // 4. Center dot
    const centerDot = document.createElement("div");
    centerDot.style.cssText =
      `position:absolute;left:${centerX - 8}px;top:${centerY - 8}px;` +
      "width:16px;height:16px;background:magenta;border-radius:50%;opacity:0.8;";
    debugEl.appendChild(centerDot);

    // 5. Info panel
    const visibleLeft = mapRect.left + sidebarW;
    const visibleWidth = mapRect.width - sidebarW;
    const info = document.createElement("div");
    info.style.cssText =
      `position:absolute;left:${mapRect.left + sidebarW + 8}px;top:${mapRect.top + 8}px;` +
      "background:rgba(0,0,0,0.9);color:#0ff;padding:10px 14px;border-radius:6px;" +
      "font:11px/1.6 monospace;white-space:pre;pointer-events:auto;z-index:10003;";
    info.textContent =
      `URL center: ${vp.lat.toFixed(7)}, ${vp.lng.toFixed(7)}\n` +
      `URL zoom:   ${vp.zoom.toFixed(3)}\n` +
      `Tile size:  ${TILE_SIZE}px (MapLibre GL)\n` +
      `──────────────────────────────\n` +
      `Canvas:     L=${Math.round(mapRect.left)} T=${Math.round(mapRect.top)} W=${Math.round(mapRect.width)} H=${Math.round(mapRect.height)}\n` +
      `Sidebar:    ${Math.round(sidebarW)}px ${manualOffsetX > 0 ? "(MANUAL)" : "(auto)"}\n` +
      `Visible:    L=${Math.round(visibleLeft)} W=${Math.round(visibleWidth)}\n` +
      `Center px:  (${Math.round(centerX)}, ${Math.round(centerY)})\n` +
      `Window:     ${window.innerWidth} × ${window.innerHeight}\n` +
      `──────────────────────────────\n` +
      `🟣 magenta = URL @lat,lng\n` +
      `   Must be at map center!\n` +
      `   Adjust slider if off.\n` +
      `🟡 yellow  = sidebar offset\n` +
      `🔵 cyan    = canvas rect`;
    debugEl.appendChild(info);

    document.body.appendChild(debugEl);
  }

  function removeDebug() {
    if (debugEl && debugEl.parentNode) {
      debugEl.parentNode.removeChild(debugEl);
      debugEl = null;
    }
  }

  function toggleOverlay(show) {
    if (overlayEl) overlayEl.style.display = show ? "" : "none";
    if (tooltipEl && !show) tooltipEl.style.display = "none";
  }

  /** Poll URL to re-render when user pans/zooms */
  function startUrlPolling() {
    if (urlPollTimer) return;
    lastUrl = window.location.href;
    urlPollTimer = setInterval(() => {
      if (!currentGeoJSON || !enabled) return;
      const newUrl = window.location.href;
      if (newUrl !== lastUrl) {
        lastUrl = newUrl;
        renderOverlay(currentGeoJSON);
      }
    }, 400);
  }

  // ================================================================
  //  GEOJSON CACHE (browser.storage.local)
  // ================================================================

  async function saveGeoJSONCache(geojson, meta) {
    try {
      await browser.storage.local.set({
        pnoteCachedGeoJSON: geojson,
        pnoteCacheMeta: meta,
        pnoteCacheTime: Date.now()
      });
    } catch (e) {
      console.warn("[pnote-komoot] Failed to save cache:", e.message);
    }
  }

  async function loadGeoJSONCache() {
    try {
      const stored = await browser.storage.local.get(["pnoteCachedGeoJSON", "pnoteCacheMeta", "pnoteCacheTime"]);
      if (!stored.pnoteCachedGeoJSON) return null;
      const age = Date.now() - (stored.pnoteCacheTime || 0);
      // Cache valid for 24 hours
      if (age > 24 * 60 * 60 * 1000) return null;
      console.log(`[pnote-komoot] Loaded ${stored.pnoteCachedGeoJSON.features.length} invaders from cache (${Math.round(age/60000)}min old)`);
      return { geojson: stored.pnoteCachedGeoJSON, meta: stored.pnoteCacheMeta };
    } catch (e) {
      return null;
    }
  }

  // ================================================================
  //  INIT & MESSAGE HANDLING
  // ================================================================

  async function init() {
    const stored = await browser.storage.local.get(["pnoteUid", "pnoteHideFound", "pnoteOffsetX"]);
    uid = stored.pnoteUid || "";
    hideFound = stored.pnoteHideFound === true;
    manualOffsetX = stored.pnoteOffsetX !== undefined ? parseInt(stored.pnoteOffsetX) : 400;

    onDomReady(async () => {
      injectPageScript();
      console.log("[pnote-komoot] content.js initialised");

      // Auto-render from cache if available
      const cached = await loadGeoJSONCache();
      if (cached && cached.geojson) {
        currentGeoJSON = cached.geojson;
        dataLoaded = true;
        // Small delay to let the map render first
        setTimeout(() => {
          renderOverlay(currentGeoJSON);
          startUrlPolling();
          console.log("[pnote-komoot] Auto-rendered from cache");
        }, 1500);
      }
    });

    window.addEventListener("message", onPageMessage);
    browser.runtime.onMessage.addListener(onExtensionMessage);
  }

  function onPageMessage(event) {
    if (!event.data || event.data.source !== MSG_PREFIX) return;
    if (event.data.type === "INJECT_READY") {
      injectReady = true;
      console.log("[pnote-komoot] inject.js is ready");
    }
  }

  function onExtensionMessage(msg, sender, sendResponse) {
    if (msg.type === "LOAD_INVADERS") {
      console.log("[pnote-komoot] Load requested by popup");
      dataLoaded = true;
      enabled = true;
      uid = msg.uid || uid;
      hideFound = msg.hideFound === true;

      const vp = parseViewport();
      if (vp) {
        const mapRect = findMapRect();
        const bounds = computeBounds(vp, mapRect);
        console.log(`[pnote-komoot] Viewport: lat=${vp.lat}, lng=${vp.lng}, zoom=${vp.zoom}`);
        console.log(`[pnote-komoot] Map rect: ${Math.round(mapRect.left)},${Math.round(mapRect.top)} ${Math.round(mapRect.width)}×${Math.round(mapRect.height)}`);
        fetchAndUpdate(bounds);
      } else {
        console.error("[pnote-komoot] Cannot determine map bounds from URL");
      }
      sendResponse({ ok: true });
    }

    if (msg.type === "SET_ENABLED") {
      enabled = msg.enabled;
      toggleOverlay(enabled);
      sendResponse({ ok: true });
    }

    if (msg.type === "UPDATE_SETTINGS") {
      uid = msg.uid || "";
      hideFound = msg.hideFound === true;
      if (msg.offsetX !== undefined) manualOffsetX = parseInt(msg.offsetX) || 0;
      if (currentGeoJSON) renderOverlay(currentGeoJSON);
      sendResponse({ ok: true });
    }

    if (msg.type === "RERENDER") {
      // Re-read offset from storage and re-render
      browser.storage.local.get("pnoteOffsetX").then(s => {
        manualOffsetX = parseInt(s.pnoteOffsetX) || 0;
        if (currentGeoJSON) renderOverlay(currentGeoJSON);
      });
      sendResponse({ ok: true });
    }

    if (msg.type === "GET_STATUS") {
      sendResponse({ enabled, injectReady, dataLoaded, uid, hideFound, debugMode });
    }

    if (msg.type === "SET_DEBUG") {
      debugMode = msg.debug === true;
      console.log("[pnote-komoot] Debug mode:", debugMode);
      if (debugMode && currentGeoJSON) {
        // Re-render to show debug overlay
        renderOverlay(currentGeoJSON);
      } else {
        removeDebug();
      }
      sendResponse({ ok: true });
    }
  }

  async function fetchAndUpdate(bounds) {
    if (!enabled) return;
    try {
      console.log("[pnote-komoot] Fetching invaders…");
      const response = await browser.runtime.sendMessage({
        type: "FETCH_INVADERS",
        bounds,
        uid: uid || null
      });

      if (response && response.geojson) {
        currentGeoJSON = response.geojson;
        console.log(`[pnote-komoot] ✅ Total in DB: ${response.total}`);
        console.log(`[pnote-komoot] ✅ In view: ${response.visible}`);
        if (response.totalFound > 0) {
          console.log(`[pnote-komoot] ✅ Flashed (total): ${response.totalFound} | in view: ${response.foundInView} | remaining: ${response.visible - response.foundInView}`);
        }

        // Save to cache for instant reload
        saveGeoJSONCache(response.geojson, {
          total: response.total,
          visible: response.visible,
          totalFound: response.totalFound
        });

        renderOverlay(currentGeoJSON);
        startUrlPolling();
      } else if (response && response.error) {
        console.error("[pnote-komoot] Fetch error:", response.error);
      }
    } catch (e) {
      console.error("[pnote-komoot] sendMessage error", e);
    }
  }

  init();
})();
