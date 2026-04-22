/* ============================================================
 *  popup/popup.js
 *  Load / toggle / uid / hide-found / refresh controls.
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

  async function getActiveTab() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function sendToTab(msg) {
    const tab = await getActiveTab();
    if (!tab) throw new Error("No active tab");
    return browser.tabs.sendMessage(tab.id, msg);
  }

  async function loadState() {
    const stored = await browser.storage.local.get(["pnoteUid", "pnoteHideFound"]);
    uidInput.value = stored.pnoteUid || "";
    hideFoundEl.checked = stored.pnoteHideFound === true;
    hideFoundLabel.textContent = hideFoundEl.checked ? "Hide found" : "Show found";

    try {
      const resp = await sendToTab({ type: "GET_STATUS" });
      if (!resp) return;
      toggleEl.checked = resp.enabled;
      toggleLabel.textContent = resp.enabled ? "Visible" : "Hidden";
      if (resp.uid && !uidInput.value) uidInput.value = resp.uid;
      if (resp.dataLoaded) {
        statusEl.textContent = "✅ Invaders loaded on map";
        foundInfoEl.textContent = "🔴 OK  🟠 damaged  🟢 flashed";
      } else if (resp.injectReady) {
        statusEl.textContent = "🟢 Ready — click Load Invaders";
      } else {
        statusEl.textContent = "⏳ Waiting for Komoot map…";
      }
    } catch (_) {
      statusEl.textContent = "⚠️ Open a Komoot map page first";
      loadBtn.disabled = true;
    }
  }

  async function saveSettings() {
    const uid = uidInput.value.trim();
    const hideFound = hideFoundEl.checked;
    await browser.storage.local.set({ pnoteUid: uid, pnoteHideFound: hideFound });
    try { await sendToTab({ type: "UPDATE_SETTINGS", uid, hideFound }); } catch (_) {}
  }

  loadBtn.addEventListener("click", async () => {
    loadBtn.disabled = true;
    loadBtn.textContent = "⏳ Loading…";
    statusEl.textContent = "Fetching invader data…";
    await saveSettings();
    try {
      await sendToTab({
        type: "LOAD_INVADERS",
        uid: uidInput.value.trim(),
        hideFound: hideFoundEl.checked
      });
      statusEl.textContent = "✅ Invaders loaded! Check the map.";
      foundInfoEl.textContent = "🔴 OK  🟠 damaged  🟢 flashed";
      loadBtn.textContent = "📍 Reload Invaders";
    } catch (e) {
      statusEl.textContent = "❌ " + e.message;
      loadBtn.textContent = "📍 Load Invaders";
    } finally {
      loadBtn.disabled = false;
    }
  });

  toggleEl.addEventListener("change", async () => {
    const enabled = toggleEl.checked;
    toggleLabel.textContent = enabled ? "Visible" : "Hidden";
    try { await sendToTab({ type: "SET_ENABLED", enabled }); } catch (_) {}
  });

  hideFoundEl.addEventListener("change", async () => {
    hideFoundLabel.textContent = hideFoundEl.checked ? "Hide found" : "Show found";
    await saveSettings();
  });

  uidInput.addEventListener("change", saveSettings);

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "⏳ Clearing…";
    try {
      await browser.runtime.sendMessage({ type: "INVALIDATE_CACHE" });
      await browser.storage.local.remove(["pnoteCachedGeoJSON", "pnoteCacheMeta", "pnoteCacheTime"]);
      await saveSettings();
      await sendToTab({
        type: "LOAD_INVADERS",
        uid: uidInput.value.trim(),
        hideFound: hideFoundEl.checked
      });
      statusEl.textContent = "✅ Cache cleared & data reloaded";
    } catch (e) {
      statusEl.textContent = "⚠️ " + e.message;
    }
    refreshBtn.disabled = false;
    refreshBtn.textContent = "🔄 Clear cache & reload";
  });

  loadState();
})();
