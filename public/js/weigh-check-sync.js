// ============================================
// WEIGH-CHECK SYNC
// ============================================
// Propagates a referee/admin First Check weight correction into:
//   1. The player's own record (players/ or expoPlayers/) — the source of
//      truth Team Dashboard already reads weight/weightCategory from, so
//      updating it here is all Team Dashboard needs to reflect the change
//      (on its next load/refresh — it doesn't use a live listener for the
//      roster, same as the rest of this app's admin tables).
//   2. Any Official/Expo bracket for the OLD and NEW weight category, but
//      ONLY when that bracket genuinely has not started yet.
//
// Safety boundary (deliberate): a bracket that already has a recorded
// result — any match with a winner, any awarded bye, or (Official) any
// round beyond Round 1 — is NEVER auto-rewritten here. Retroactively
// changing who's in a bracket after real matches were fought would corrupt
// tournament history for the OTHER players in that bracket too, and that
// kind of surgery cannot be safely automated without a human's judgment
// call. In that case this reports a warning string instead of mutating
// anything, so the admin can act deliberately from the Tournament Bracket
// page.
//
// Also deliberately simpler than bracket.js's real generator: pairing here
// is a plain Fisher-Yates shuffle, without the same-team-avoidance pass the
// normal generator applies. That's a disclosed trade-off to keep this
// rarely-triggered correction path small enough to verify by hand, rather
// than duplicating that considerably more complex algorithm blind.
// ============================================

const WEIGH_CHECK_SYNC = {

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  _compressPlayer(player) {
    if (!player) return null;
    return {
      id: player.id,
      playerName: player.playerName || '',
      centerName: player.centerName || '',
      teamName: player.teamName || player.centerName || '',
      teamId: player.teamId || null
    };
  },

  // Mirrors bracket.js's createBracket() Round-1 construction (minus the
  // team-conflict-avoidance pass — see file header). Only ever called with
  // players.length > 0 by _syncOfficialCategory below.
  _buildOfficialRound1(players) {
    const shuffled = this._shuffle(players);
    const n = shuffled.length;

    const expectedRoundMatchCounts = [];
    let cur = n;
    while (cur > 1) {
      expectedRoundMatchCounts.push(Math.floor(cur / 2));
      cur = Math.ceil(cur / 2);
    }

    const bracket = {
      playerCount: n,
      rounds: [],
      byePlayers: {},
      byeHistory: {},
      expectedRoundMatchCounts,
      currentRound: 0,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    if (n === 1) {
      const soleChampion = this._compressPlayer(shuffled[0]);
      bracket.byePlayers['0'] = soleChampion;
      bracket.byeHistory[soleChampion.id] = 1;
      return bracket;
    }

    const round1 = [];
    const round1MatchCount = Math.ceil(n / 2);
    for (let i = 0; i < round1MatchCount; i++) {
      round1.push({
        matchId: `R1_M${i + 1}`,
        round: 1,
        player1: this._compressPlayer(shuffled[i * 2]),
        player2: (i * 2 + 1 < n) ? this._compressPlayer(shuffled[i * 2 + 1]) : null,
        winner: null,
        eliminated: null,
        status: 'pending',
        startTime: null,
        endTime: null
      });
    }
    round1.forEach(m => { if (m.player1 && !m.player2) m.pendingManualBye = true; });
    bracket.rounds.push(round1);
    return bracket;
  },

  // True only if the bracket genuinely has no recorded result yet.
  _officialBracketIsUntouched(bracket) {
    if (!bracket || !bracket.rounds || bracket.rounds.length === 0) return true; // no rounds built — safe
    if (bracket.rounds.length > 1) return false; // a round beyond Round 1 exists — something completed
    const round1 = bracket.rounds[0] || [];
    const anyPlayed = round1.some(m => m.winner || (m.status && m.status !== 'pending'));
    const anyBye = bracket.byePlayers && Object.keys(bracket.byePlayers).length > 0;
    return !anyPlayed && !anyBye;
  },

  // NOTE: unlike the Official bracket, an Expo bracket's `byes` entry is
  // assigned automatically at GENERATION time whenever the player count is
  // odd (see expoBracket.js createExpoBracket) — it is not evidence a match
  // was ever played, so it must NOT be treated as "already has a result"
  // here (that was the actual bug: it made almost every real Expo category,
  // since odd player counts are common, get silently skipped while the
  // Official bracket — whose bye semantics differ — synced fine). The only
  // real signal that this bracket has a recorded outcome is a match with a
  // winner or a non-pending status.
  _expoBracketIsUntouched(bracket) {
    if (!bracket) return true;
    return !(bracket.matches || []).some(m => m.winner || (m.status && m.status !== 'pending'));
  },

  // Every player CURRENTLY registered under categoryKey (gender-ageCategory-
  // weightCategory), read fresh from players/ + expoPlayers/ (deduped by id)
  // — the same live-recompute approach bracket.js's categorizePlayers() uses,
  // so this always reflects the current roster, never a stale snapshot.
  async _playersInCategory(categoryKey) {
    const [pSnap, epSnap] = await Promise.all([
      dbGet(dbRef(database, 'players')),
      dbGet(dbRef(database, 'expoPlayers'))
    ]);
    const seen = new Set();
    const list = [];
    const collect = (snap) => {
      if (!snap.exists()) return;
      Object.entries(snap.val()).forEach(([id, v]) => {
        if (seen.has(id)) return;
        if (!v.ageCategory || !v.gender || !v.weightCategory) return;
        if (`${v.gender}-${v.ageCategory}-${v.weightCategory}` !== categoryKey) return;
        seen.add(id);
        list.push({ id, ...v });
      });
    };
    collect(pSnap);
    collect(epSnap);
    return list;
  },

  // ── Official bracket sync for one category ──────────────────────────────
  async _syncOfficialCategory(categoryKey) {
    const bracketSnap = await dbGet(dbRef(database, `brackets/${categoryKey}`));
    if (!bracketSnap.exists()) return { touched: false, warning: null }; // nothing generated yet — a future generation reads current data naturally

    if (!this._officialBracketIsUntouched(bracketSnap.val())) {
      return { touched: false, warning: `Official bracket "${categoryKey}" already has results recorded — it was NOT auto-updated. Please adjust it manually from the Tournament Bracket page.` };
    }

    const players = await this._playersInCategory(categoryKey);
    if (players.length === 0) {
      await dbRemove(dbRef(database, `brackets/${categoryKey}`));
      return { touched: true, warning: null };
    }

    const newBracket = this._buildOfficialRound1(players);
    // Category metadata the bracket UI displays alongside rounds — read off
    // an actual member of the category rather than parsing categoryKey
    // (weightCategory labels like "45-50kg" contain hyphens themselves, so
    // splitting the key string back apart would be ambiguous).
    newBracket.gender = players[0].gender;
    newBracket.ageCategory = players[0].ageCategory;
    newBracket.weightCategory = players[0].weightCategory;

    await dbSet(dbRef(database, `brackets/${categoryKey}`), newBracket);
    return { touched: true, warning: null };
  },

  // ── Expo bracket sync for one category ───────────────────────────────────
  async _syncExpoCategory(categoryKey) {
    const bracketSnap = await dbGet(dbRef(database, `expoBrackets/${categoryKey}`));
    if (!bracketSnap.exists()) return { touched: false, warning: null };

    if (!this._expoBracketIsUntouched(bracketSnap.val())) {
      return { touched: false, warning: `Expo bracket "${categoryKey}" already has results recorded — it was NOT auto-updated. Please adjust it manually from the Tournament Bracket page.` };
    }

    const players = await this._playersInCategory(categoryKey);
    if (players.length === 0) {
      await dbRemove(dbRef(database, `expoBrackets/${categoryKey}`));
      return { touched: true, warning: null };
    }

    const shuffled = this._shuffle(players).map(p => this._compressPlayer(p));
    const matches = [];
    const byes = [];
    let matchCounter = 1;
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      matches.push({
        matchId: `expo_m${matchCounter}`,
        player1: shuffled[i],
        player2: shuffled[i + 1],
        status: 'pending',
        winner: null,
        courtNumber: null,
        startTime: null,
        endTime: null
      });
      matchCounter++;
    }
    if (shuffled.length % 2 === 1) byes.push(shuffled[shuffled.length - 1]);

    await dbSet(dbRef(database, `expoBrackets/${categoryKey}`), {
      playerCount: shuffled.length,
      status: matches.length === 0 ? 'complete' : 'pending',
      createdAt: new Date().toISOString(),
      matches,
      byes
    });
    return { touched: true, warning: null };
  },

  // ── Public entry point ───────────────────────────────────────────────────
  // Call after updating a player's weight/weightCategory. Syncs the OLD and
  // NEW category's Official + Expo brackets when it's safe to, and returns a
  // report the caller can show to the referee/admin.
  async syncCategoryChange(oldCategoryKey, newCategoryKey) {
    const result = { touched: [], warnings: [] };
    if (!oldCategoryKey || !newCategoryKey || oldCategoryKey === newCategoryKey) return result;

    for (const key of [oldCategoryKey, newCategoryKey]) {
      try {
        const off = await this._syncOfficialCategory(key);
        if (off.touched) result.touched.push(`Official: ${key}`);
        if (off.warning) result.warnings.push(off.warning);
      } catch (err) {
        console.error(`❌ WEIGH_CHECK_SYNC: Official bracket sync failed for ${key}:`, err);
        result.warnings.push(`Could not check the Official bracket for "${key}" — please verify it manually.`);
      }

      try {
        const exp = await this._syncExpoCategory(key);
        if (exp.touched) result.touched.push(`Expo: ${key}`);
        if (exp.warning) result.warnings.push(exp.warning);
      } catch (err) {
        console.error(`❌ WEIGH_CHECK_SYNC: Expo bracket sync failed for ${key}:`, err);
        result.warnings.push(`Could not check the Expo bracket for "${key}" — please verify it manually.`);
      }
    }
    return result;
  },

  // ── Player record correction (called by both the Referee and Admin pages) ──
  // Updates players/{id} AND/OR expoPlayers/{id} — weight + recomputed
  // weightCategory — the exact fields Team Dashboard already reads, so no
  // Team Dashboard changes were needed for a correction to show up there on
  // its next load/refresh. Then syncs Official/Expo brackets for the
  // old/new category (see syncCategoryChange above).
  //
  // A player registered "Official & Expo" is duplicated under BOTH players/
  // and expoPlayers/ with the SAME id (the same dedup convention used
  // throughout this app, e.g. the Team Player Counts table). Writing only to
  // `player.source` leaves the other copy stale — and since Expo bracket
  // categorization reads exclusively from expoPlayers/ (expoBracket.js
  // loadPlayers()), a stale expoPlayers/ copy means Expo keeps showing the
  // player's OLD weight category forever even after Official is fixed
  // correctly. So both paths are checked for existence and corrected —
  // never blindly writing to a path that doesn't already have this player,
  // which would create a phantom record instead.
  //
  // `player` must have { id, gender, ageCategory, weightCategory }. Returns:
  //   { weightCategory, categoryChanged, oldCategoryKey, newCategoryKey, bracketReport }
  // bracketReport is null when the category didn't change (nothing to sync).
  async applyWeightCorrection(player, newWeight) {
    const gender = player.gender;
    const ageCategory = player.ageCategory;
    const oldWeightCategory = player.weightCategory || '';

    let newWeightCategory = oldWeightCategory;
    if (gender && ageCategory && typeof CATEGORY_LOGIC !== 'undefined') {
      try {
        newWeightCategory = (await CATEGORY_LOGIC.getWeightCategory(gender, [ageCategory], newWeight)) || oldWeightCategory;
      } catch (err) {
        console.warn('⚠️ Could not recompute weight category (non-fatal):', err.message);
        newWeightCategory = oldWeightCategory;
      }
    }

    const fieldUpdates = { weight: newWeight, weightCategory: newWeightCategory };
    const [pSnap, epSnap] = await Promise.all([
      dbGet(dbRef(database, `players/${player.id}`)),
      dbGet(dbRef(database, `expoPlayers/${player.id}`))
    ]);
    const writes = [];
    if (pSnap.exists()) writes.push(dbUpdate(dbRef(database, `players/${player.id}`), fieldUpdates));
    if (epSnap.exists()) writes.push(dbUpdate(dbRef(database, `expoPlayers/${player.id}`), fieldUpdates));
    await Promise.all(writes);

    const canBuildKeys = !!(gender && ageCategory && oldWeightCategory && newWeightCategory);
    const oldCategoryKey = canBuildKeys ? `${gender}-${ageCategory}-${oldWeightCategory}` : null;
    const newCategoryKey = canBuildKeys ? `${gender}-${ageCategory}-${newWeightCategory}` : null;
    const categoryChanged = canBuildKeys && oldCategoryKey !== newCategoryKey;

    const bracketReport = categoryChanged
      ? await this.syncCategoryChange(oldCategoryKey, newCategoryKey)
      : null;

    return { weightCategory: newWeightCategory, categoryChanged, oldCategoryKey, newCategoryKey, bracketReport };
  }
};

window.WEIGH_CHECK_SYNC = WEIGH_CHECK_SYNC;
