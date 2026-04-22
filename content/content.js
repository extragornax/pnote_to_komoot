/* ============================================================
 *  content/content.js
 *  Bridges the popup ⇄ background ⇄ inject.js.
 *  Rendering happens in inject.js using Komoot's native
 *  MapLibre instance, so zoom/pitch/rotation Just Work.
 * ============================================================ */
(function () {
  "use strict";

  const MSG_PREFIX = "pnote-komoot";

  let injectReady = false;
  let enabled = true;
  let hideFound = false;
  let uid = "";
  let currentGeoJSON = null;
  let currentMeta = null;

  // ── Inject the page-context script ───────────────────────
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

  // ── Post helpers ─────────────────────────────────────────
  function postToPage(msg) {
    window.postMessage(Object.assign({ source: MSG_PREFIX }, msg), "*");
  }

  function sendGeoJSONToPage() {
    if (!currentGeoJSON) return;
    postToPage({ type: "UPDATE_DATA", geojson: currentGeoJSON, hideFound });
  }

  // ── Storage cache (24h) ──────────────────────────────────
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  async function saveCache(geojson, meta) {
    try {
      await browser.storage.local.set({
        pnoteCachedGeoJSON: geojson,
        pnoteCacheMeta: meta || null,
        pnoteCacheTime: Date.now()
      });
    } catch (e) {
      console.warn("[pnote-komoot] cache save failed:", e.message);
    }
  }

  async function loadCache() {
    try {
      const s = await browser.storage.local.get(["pnoteCachedGeoJSON", "pnoteCacheMeta", "pnoteCacheTime"]);
      if (!s.pnoteCachedGeoJSON) return null;
      if (Date.now() - (s.pnoteCacheTime || 0) > CACHE_TTL_MS) return null;
      return { geojson: s.pnoteCachedGeoJSON, meta: s.pnoteCacheMeta };
    } catch (_) { return null; }
  }

  // ── Fetch flow ───────────────────────────────────────────
  async function fetchInvaders() {
    const resp = await browser.runtime.sendMessage({
      type: "FETCH_INVADERS",
      uid: uid || null
    });
    if (!resp) throw new Error("No response from background");
    if (resp.error) throw new Error(resp.error);
    return resp;
  }

  async function loadAndRender() {
    try {
      const resp = await fetchInvaders();
      currentGeoJSON = resp.geojson;
      currentMeta = {
        total: resp.total,
        totalFound: resp.totalFound
      };
      console.log(`[pnote-komoot] Loaded ${resp.total} invaders (${resp.totalFound} found)`);
      await saveCache(currentGeoJSON, currentMeta);
      sendGeoJSONToPage();
    } catch (e) {
      console.error("[pnote-komoot] load failed:", e.message);
    }
  }

  // ── Messages from inject.js (page context) ───────────────
  function onPageMessage(event) {
    if (!event.data || event.data.source !== MSG_PREFIX) return;
    const { type } = event.data;

    if (type === "INJECT_READY") {
      injectReady = true;
      console.log("[pnote-komoot] inject.js ready");
      // If we already have data (e.g. from cache), push it through.
      if (currentGeoJSON) sendGeoJSONToPage();
    }

    // MAP_MOVED / BOUNDS_RESULT are available for future use;
    // not needed now since we fetch the full dataset once.
  }

  // ── Messages from popup ──────────────────────────────────
  function onExtensionMessage(msg, sender, sendResponse) {
    if (msg.type === "LOAD_INVADERS") {
      uid = msg.uid || uid;
      hideFound = msg.hideFound === true;
      enabled = true;
      postToPage({ type: "SET_VISIBLE", visible: true });
      loadAndRender();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SET_ENABLED") {
      enabled = msg.enabled !== false;
      postToPage({ type: "SET_VISIBLE", visible: enabled });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "UPDATE_SETTINGS") {
      const newUid = msg.uid || "";
      const uidChanged = newUid !== uid;
      uid = newUid;
      hideFound = msg.hideFound === true;
      postToPage({ type: "SET_HIDE_FOUND", hideFound });
      if (uidChanged && currentGeoJSON) {
        // UID change affects found set — refetch.
        loadAndRender();
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "GET_STATUS") {
      sendResponse({
        enabled,
        injectReady,
        dataLoaded: !!currentGeoJSON,
        uid,
        hideFound
      });
      return;
    }
  }

  // ── Init ─────────────────────────────────────────────────
  async function init() {
    const stored = await browser.storage.local.get(["pnoteUid", "pnoteHideFound"]);
    uid = stored.pnoteUid || "";
    hideFound = stored.pnoteHideFound === true;

    window.addEventListener("message", onPageMessage);
    browser.runtime.onMessage.addListener(onExtensionMessage);

    onDomReady(async () => {
      injectPageScript();
      const cached = await loadCache();
      if (cached && cached.geojson) {
        currentGeoJSON = cached.geojson;
        currentMeta = cached.meta;
        console.log(`[pnote-komoot] Restored ${cached.geojson.features.length} invaders from cache`);
        if (injectReady) sendGeoJSONToPage();
      }
    });
  }

  init();
})();
