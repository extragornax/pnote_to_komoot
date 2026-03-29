/* ============================================================
 *  popup/popup.js
 *  Controls the popup UI: load, toggle, uid, hide-found, refresh.
 * ============================================================ */
(function () {
  "use strict";

  const loadBtn        = document.getElementById("load");
  const toggleEl       = document.getElementById("toggle");
  const toggleLabel    = document.getElementById("toggle-label");
  const statusEl       = document.getElementById("status");
  const uidInput       = document.getElementById("uid");
  const hideFoundEl    = document.getElementById("hide-found");
  const hideFoundLabel = document.getElementById("hide-found-label");
  const foundInfoEl    = document.getElementById("found-info");
  const refreshBtn     = document.getElementById("refresh");
  const debugEl        = document.getElementById("debug");
  const offsetXEl      = document.getElementById("offset-x");
  const offsetXVal     = document.getElementById("offset-x-val");

  // ── Helpers ─────────────────────────────────────────────────
  async function getActiveTab() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function sendToTab(msg) {
    const tab = await getActiveTab();
    if (!tab) throw new Error("No active tab");
    return browser.tabs.sendMessage(tab.id, msg);
  }

  // ── Load saved settings ─────────────────────────────────────
  async function loadState() {
    // Restore settings from storage
    const stored = await browser.storage.local.get(["pnoteUid", "pnoteHideFound", "pnoteOffsetX"]);
    uidInput.value = stored.pnoteUid || "";
    hideFoundEl.checked = stored.pnoteHideFound === true;
    hideFoundLabel.textContent = hideFoundEl.checked ? "Hide found" : "Show found";
    offsetXEl.value = stored.pnoteOffsetX !== undefined ? stored.pnoteOffsetX : 400;
    offsetXVal.textContent = offsetXEl.value;

    // Ask content script for live status
    try {
      const resp = await sendToTab({ type: "GET_STATUS" });
      if (resp) {
        toggleEl.checked = resp.enabled;
        toggleLabel.textContent = resp.enabled ? "Visible" : "Hidden";
        if (resp.uid && !uidInput.value) uidInput.value = resp.uid;
        if (resp.debugMode) debugEl.checked = true;
        if (resp.dataLoaded) {
          statusEl.textContent = "✅ Invaders loaded on map";
        } else if (resp.injectReady) {
          statusEl.textContent = "🟢 Ready — click Load Invaders";
        } else {
          statusEl.textContent = "⏳ Waiting for Komoot map…";
        }
      }
    } catch (_) {
      statusEl.textContent = "⚠️ Open a Komoot map page first";
      loadBtn.disabled = true;
    }
  }

  // ── Save settings to storage ────────────────────────────────
  async function saveSettings() {
    const uid = uidInput.value.trim();
    const hideFound = hideFoundEl.checked;
    const offsetX = parseInt(offsetXEl.value) || 0;
    await browser.storage.local.set({ pnoteUid: uid, pnoteHideFound: hideFound, pnoteOffsetX: offsetX });
    // Notify content script
    try { await sendToTab({ type: "UPDATE_SETTINGS", uid, hideFound, offsetX }); } catch (_) {}
  }

  // ── Load Invaders button ────────────────────────────────────
  loadBtn.addEventListener("click", async () => {
    loadBtn.disabled = true;
    loadBtn.textContent = "⏳ Loading…";
    statusEl.textContent = "Fetching invader data…";

    // Save settings first
    await saveSettings();

    try {
      const uid = uidInput.value.trim();
      const hideFound = hideFoundEl.checked;
      await sendToTab({ type: "LOAD_INVADERS", uid, hideFound });

      setTimeout(() => {
        statusEl.textContent = "✅ Invaders loaded! Check the map.";
        foundInfoEl.textContent = "🔴 OK  🟠 damaged  🟢 flashed  ⬛ destroyed=hidden";
        loadBtn.textContent = "📍 Reload Invaders";
        loadBtn.disabled = false;
      }, 2000);
    } catch (e) {
      statusEl.textContent = "❌ Error: " + e.message;
      loadBtn.textContent = "📍 Load Invaders";
      loadBtn.disabled = false;
    }
  });

  // ── Toggle visibility ───────────────────────────────────────
  toggleEl.addEventListener("change", async () => {
    const enabled = toggleEl.checked;
    toggleLabel.textContent = enabled ? "Visible" : "Hidden";
    try { await sendToTab({ type: "SET_ENABLED", enabled }); } catch (_) {}
  });

  // ── Hide found toggle ──────────────────────────────────────
  hideFoundEl.addEventListener("change", async () => {
    hideFoundLabel.textContent = hideFoundEl.checked ? "Hide found" : "Show found";
    await saveSettings();
  });

  // ── UID input — save on change ─────────────────────────────
  uidInput.addEventListener("change", saveSettings);

  // ── Refresh: clear cache and reload ─────────────────────────
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "⏳ Clearing…";
    try {
      await browser.runtime.sendMessage({ type: "INVALIDATE_CACHE" });
      await saveSettings();
      const uid = uidInput.value.trim();
      const hideFound = hideFoundEl.checked;
      await sendToTab({ type: "LOAD_INVADERS", uid, hideFound });
      statusEl.textContent = "✅ Cache cleared & data reloaded";
    } catch (e) {
      statusEl.textContent = "⚠️ " + e.message;
    }
    refreshBtn.disabled = false;
    refreshBtn.textContent = "🔄 Clear cache & reload";
  });

  // ── Offset slider — live update ───────────────────────────────
  offsetXEl.addEventListener("input", () => {
    offsetXVal.textContent = offsetXEl.value;
  });
  offsetXEl.addEventListener("change", async () => {
    await saveSettings();
    // Immediately re-render with new offset
    try { await sendToTab({ type: "RERENDER" }); } catch (_) {}
  });

  // ── Debug toggle ─────────────────────────────────────────────
  debugEl.addEventListener("change", async () => {
    try { await sendToTab({ type: "SET_DEBUG", debug: debugEl.checked }); } catch (_) {}
  });

  // ── Init ────────────────────────────────────────────────────
  loadState();
})();
