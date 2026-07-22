// ============================================
// LIVE COURT PRESENCE
// Tracks each court's bracket-session state so the Live Matches page can tell
// apart three things per court, independent of a match's own status field:
//   - no entry at all           -> court has no bracket open (show nothing)
//   - entry, activeMatchId null -> bracket open, no match started yet
//                                   (show Upcoming only)
//   - entry, activeMatchId set  -> a specific match is being scored right now
//                                   (show Live, and Upcoming = whatever's next)
//
// Written to: liveCourts/{courtNumber} = { categoryKey, matchType, activeMatchId, updatedAt }
// Removed automatically when the tab disconnects (crash, tab close, network
// drop) via Firebase's onDisconnect, and eagerly on graceful navigation/logout
// via pagehide/beforeunload — whichever fires first wins, both are safe to
// call more than once.
// ============================================

const LIVE_PRESENCE = {
  _entries: new Map(), // courtNumber (string) -> ref

  _ready() {
    return typeof database !== 'undefined' &&
      typeof dbRef !== 'undefined' &&
      typeof dbSet !== 'undefined' &&
      typeof dbRemove !== 'undefined' &&
      typeof dbOnDisconnect !== 'undefined';
  },

  _waitUntilReady() {
    return new Promise((resolve) => {
      const check = () => {
        if (this._ready()) resolve();
        else setTimeout(check, 80);
      };
      check();
    });
  },

  // Create/refresh a court's bracket-session state. Call this both when a
  // bracket is opened (activeMatchId: null) and when a match starts/stops on
  // it (activeMatchId: matchId / null) — always a full overwrite of the
  // court's entry, since the caller already knows the complete desired state.
  async setCourtState(courtNumber, { categoryKey, matchType, activeMatchId }) {
    if (!courtNumber) return;
    const key = String(courtNumber);
    await this._waitUntilReady();
    const liveRef = dbRef(database, `liveCourts/${key}`);
    try {
      await dbOnDisconnect(liveRef).remove();
      await dbSet(liveRef, {
        categoryKey,
        matchType,
        activeMatchId: activeMatchId || null,
        updatedAt: Date.now()
      });
      this._entries.set(key, liveRef);
    } catch (err) {
      console.warn('⚠️ Could not update live court presence:', err);
    }
  },

  // Referee left the bracket entirely — the court disappears from the Live
  // Matches page (both Live and Upcoming) until a bracket is opened again.
  async closeCourt(courtNumber) {
    if (!courtNumber) return;
    const key = String(courtNumber);
    let liveRef = this._entries.get(key);
    if (!liveRef && this._ready()) {
      liveRef = dbRef(database, `liveCourts/${key}`);
    }
    this._entries.delete(key);
    if (!liveRef) return;
    try {
      await dbRemove(liveRef);
    } catch (err) {
      console.warn('⚠️ Could not clear live court presence:', err);
    }
  },

  // Best-effort synchronous-ish cleanup for every court this tab has open —
  // used on page unload. onDisconnect is the reliable fallback if the browser
  // tears the page down before this completes.
  clearAllSync() {
    this._entries.forEach((liveRef) => {
      try { dbRemove(liveRef); } catch (err) { /* onDisconnect will handle it */ }
    });
    this._entries.clear();
  }
};

window.LIVE_PRESENCE = LIVE_PRESENCE;

window.addEventListener('pagehide', () => LIVE_PRESENCE.clearAllSync());
window.addEventListener('beforeunload', () => LIVE_PRESENCE.clearAllSync());
