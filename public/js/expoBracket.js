// ============================================
// EXPO BRACKET & COMPETITION LOGIC
// Completely independent from the Official single-elimination system in
// bracket.js. Every player competes in exactly one match — no rounds, no
// advancement, no bronze. Winner = Gold, Runner-up = Silver. A player with
// no opponent (odd headcount) is automatically awarded Gold.
//
// Data lives entirely under its own Firebase RTDB paths:
//   expoPlayers/{id}, expoBrackets/{categoryKey}, expoMatchHistory/{categoryKey}/{matchId}
// bracket.js, players/, brackets/, and matchHistory/ are never read or written here.
// ============================================

const EXPO_BRACKET = {
  players: [],
  categories: {},
  currentCategory: null,
  currentBracket: null,
  currentFilter: 'all',
  currentGenderFilter: 'all',
  currentAgeCategoryFilter: 'all',
  currentWeightFilter: 'all',
  currentSearchTerm: '',
  categoryStatuses: {},
  categoriesRenderRequestId: 0,
  _initialized: false,
  _liveCourtNumber: null, // court this session registered live presence under, if any
  _lockedCourtNumber: null, // court that currently holds this session's exclusive bracketLocks/expo claim, if any
  bracketListener: null,
  categoriesListener: null,
  _weightCategoriesConfigCache: null, // admin's weightCategories config, cached once per session (see _getWeightCategoriesConfig)
  editMode: false,        // true while the Bracket Editor is open for currentCategory
  _editDraft: null,       // { activePlayers, byePool, hadStartedMatches } — edit-mode working copy
  _editPwModalDiv: null,  // DOM node for the edit-mode password prompt, if open

  // Initialize the Expo system (called lazily the first time the Expo tab is opened)
  async init() {
    await this.loadPlayers();
    this.categorizePlayers();
    await this.renderCategories();
    this.setupCategoriesListener();
    this._initialized = true;
    console.log('✅ Expo bracket initialized with categories:', Object.keys(this.categories).length);
  },

  // Load all Expo-eligible players (Expo or Official & Expo) from expoPlayers/
  async loadPlayers() {
    try {
      const snap = await dbGet(dbRef(database, 'expoPlayers'));
      this.players = [];
      if (snap.exists()) {
        snap.forEach(child => {
          this.players.push({ id: child.key, ...child.val() });
        });
      }
    } catch (error) {
      console.error('❌ Error loading expo players:', error);
    }
  },

  // Group Expo players by gender-ageCategory-weightCategory, same convention as Official
  categorizePlayers() {
    this.categories = {};
    this.players.forEach(player => {
      const ageCategory = player.ageCategory || player.categories?.[0];
      if (!ageCategory || !player.gender || !player.weightCategory) {
        console.warn(`⚠️ Skipping expo player ${player.id}: missing ageCategory, gender, or weightCategory`);
        return;
      }
      const categoryKey = `${player.gender}-${ageCategory}-${player.weightCategory}`;
      if (!this.categories[categoryKey]) {
        this.categories[categoryKey] = {
          gender: player.gender,
          ageCategory,
          weightCategory: player.weightCategory,
          players: []
        };
      }
      this.categories[categoryKey].players.push(player);
    });
  },

  // ── Small pure helpers (local copies — not imported from bracket.js) ──────
  compressPlayer(player) {
    if (!player) return null;
    return {
      id: player.id,
      playerName: player.playerName,
      centerName: player.centerName || player.teamName || '',
      teamName: player.teamName || player.centerName || '',
      teamId: player.teamId || null
    };
  },

  shuffleFisherYates(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  areSameTeam(p1, p2) {
    if (!p1 || !p2) return false;
    if (p1.teamId && p2.teamId) return p1.teamId === p2.teamId;
    return !!p1.teamName && p1.teamName === p2.teamName;
  },

  // ── Team-aware pairing (mirrors bracket.js's smart-seeding pipeline) ─────
  // Official avoids same-team matches by shuffling, spreading teams
  // round-robin across positions, then swapping any pair that still landed
  // on the same team. Expo uses the same three-step pipeline (local copy —
  // same algorithm, expo's own compressed player shape) so its single round
  // of matches gets the same avoidance behavior instead of a plain shuffle.

  // Stable team key for grouping — same precedence as areSameTeam() (teamId
  // first, then teamName/centerName string fallback).
  getPlayerTeamKey(player) {
    if (!player) return 'unknown';
    return player.teamId || (player.teamName || player.centerName || 'unknown').toLowerCase();
  },

  // Round-robin one player from each team in turn so consecutive positions
  // rarely land on the same team before pairing even starts.
  distributeTeamsRoundRobin(players) {
    if (players.length <= 2) return players;

    const teamGroups = {};
    players.forEach(p => {
      const teamKey = this.getPlayerTeamKey(p);
      if (!teamGroups[teamKey]) teamGroups[teamKey] = [];
      teamGroups[teamKey].push(p);
    });

    const teams = Object.keys(teamGroups);
    const teamQueues = {};
    teams.forEach(team => {
      teamQueues[team] = this.shuffleFisherYates(teamGroups[team]);
    });

    const result = [];
    while (result.length < players.length) {
      for (let i = 0; i < teams.length && result.length < players.length; i++) {
        const teamKey = teams[i];
        if (teamQueues[teamKey].length > 0) {
          result.push(teamQueues[teamKey].shift());
        }
      }
    }
    return result;
  },

  // Final pass over consecutive pairs (0-1, 2-3, ...): whenever a pair would
  // be same-team, swap one side with a nearby player from a different team so
  // the match-up changes without disturbing the overall shuffle. Falls back
  // to leaving the pair as-is (unavoidable conflict) when no swap works.
  finalizePositionsForPairing(players) {
    if (players.length <= 2) return players;

    const result = [...players];
    for (let i = 0; i < result.length - 1; i += 2) {
      if (!this.areSameTeam(result[i], result[i + 1])) continue;

      let swapped = false;
      for (let j = i + 2; j < Math.min(i + 4, result.length); j++) {
        if (!this.areSameTeam(result[i], result[j])) {
          [result[i + 1], result[j]] = [result[j], result[i + 1]];
          swapped = true;
          break;
        }
      }
      if (swapped) continue;

      for (let j = Math.max(0, i - 2); j < i; j++) {
        if (!this.areSameTeam(result[i], result[j])) {
          [result[i + 1], result[j]] = [result[j], result[i + 1]];
          break;
        }
      }
    }
    return result;
  },

  // Full pipeline: shuffle → spread teams round-robin → final swap pass to
  // avoid same-team pairs wherever the team composition allows it.
  smartSeedForMatching(players) {
    if (players.length <= 1) return players;
    const shuffled = this.shuffleFisherYates(players);
    const distributed = this.distributeTeamsRoundRobin(shuffled);
    return this.finalizePositionsForPairing(distributed);
  },

  // Weight-category ranges (admin-configurable, rarely change mid-tournament)
  // used only to sort the Weight filter dropdown and the result-sheet
  // export — cached once per session instead of re-reading Firebase on
  // every renderCategories() call (which fires on every filter change and
  // every live players/ update). Mirrors BRACKET's identical helper in
  // bracket.js.
  async _getWeightCategoriesConfig() {
    if (this._weightCategoriesConfigCache) return this._weightCategoriesConfigCache;
    this._weightCategoriesConfigCache = await CATEGORY_LOGIC.loadWeightCategories();
    return this._weightCategoriesConfigCache;
  },

  // ── Filters ────────────────────────────────────────────────────────────
  async filterByStatus(status) {
    this.currentFilter = status;
    document.querySelectorAll('.expo-status-tab').forEach(tab => tab.classList.remove('active'));
    const tab = document.querySelector(`.expo-status-tab[data-filter="${status}"]`);
    if (tab) tab.classList.add('active');
    await this.renderCategories();
  },

  async filterBySearch(term) {
    this.currentSearchTerm = (term || '').trim().toLowerCase();
    await this.renderCategories();
  },

  // ── Gender / Category / Weight filters ────────────────────────────────
  // Mirrors BRACKET's identical trio in bracket.js (see its comments for the
  // full rationale) — Gender → Category → Weight, combinable (AND'd),
  // applied to both the on-screen list and the "Download All Results"
  // export so a filtered download always matches what's on screen.
  _categoryMatchesActiveFilters(cat) {
    const matchesGender = this.currentGenderFilter === 'all' || cat.gender === this.currentGenderFilter;
    const matchesAge = this.currentAgeCategoryFilter === 'all' || cat.ageCategory === this.currentAgeCategoryFilter;
    const matchesWeight = this.currentWeightFilter === 'all' || cat.weightCategory === this.currentWeightFilter;
    return matchesGender && matchesAge && matchesWeight;
  },

  _activeFilterSummary() {
    const parts = [];
    if (this.currentGenderFilter !== 'all') parts.push(this.currentGenderFilter);
    if (this.currentAgeCategoryFilter !== 'all') parts.push(this.currentAgeCategoryFilter);
    if (this.currentWeightFilter !== 'all') parts.push(this.currentWeightFilter);
    return parts.join(' • ');
  },

  async filterByGender(gender) {
    this.currentGenderFilter = gender || 'all';
    await this.renderCategories();
  },

  async filterByAgeCategory(age) {
    this.currentAgeCategoryFilter = age || 'all';
    await this.renderCategories();
  },

  async filterByWeight(weight) {
    this.currentWeightFilter = weight || 'all';
    await this.renderCategories();
  },

  async clearAllFilters() {
    this.currentGenderFilter = 'all';
    this.currentAgeCategoryFilter = 'all';
    this.currentWeightFilter = 'all';
    await this.renderCategories();
  },

  syncGenderFilterControl() {
    const select = document.getElementById('expoGenderFilterSelect');
    if (!select) return;
    select.value = this.currentGenderFilter;
  },

  syncAgeCategoryFilterControl() {
    const select = document.getElementById('expoAgeCategoryFilterSelect');
    if (!select) return;

    const relevant = Object.values(this.categories)
      .filter(c => this.currentGenderFilter === 'all' || c.gender === this.currentGenderFilter);
    const ages = [...new Set(relevant.map(c => c.ageCategory))]
      .sort((a, b) => CATEGORY_LOGIC.ageCategorySortIndex(a) - CATEGORY_LOGIC.ageCategorySortIndex(b));

    if (this.currentAgeCategoryFilter !== 'all' && !ages.includes(this.currentAgeCategoryFilter)) {
      this.currentAgeCategoryFilter = 'all';
    }

    let html = '<option value="all">All Categories</option>';
    ages.forEach(age => { html += `<option value="${age}">${age}</option>`; });
    select.innerHTML = html;
    select.value = this.currentAgeCategoryFilter;
  },

  async syncWeightFilterControl() {
    const select = document.getElementById('expoWeightFilterSelect');
    if (!select) return;

    const relevant = Object.values(this.categories).filter(c =>
      (this.currentGenderFilter === 'all' || c.gender === this.currentGenderFilter) &&
      (this.currentAgeCategoryFilter === 'all' || c.ageCategory === this.currentAgeCategoryFilter));
    const weightCategoriesConfig = await this._getWeightCategoriesConfig();
    const weights = [...new Set(relevant.map(c => c.weightCategory))].sort((a, b) => {
      const ca = relevant.find(c => c.weightCategory === a);
      const cb = relevant.find(c => c.weightCategory === b);
      const ka = CATEGORY_LOGIC.weightCategorySortKey(ca.gender, ca.ageCategory, a, weightCategoriesConfig);
      const kb = CATEGORY_LOGIC.weightCategorySortKey(cb.gender, cb.ageCategory, b, weightCategoriesConfig);
      return ka !== kb ? ka - kb : a.localeCompare(b);
    });

    if (this.currentWeightFilter !== 'all' && !weights.includes(this.currentWeightFilter)) {
      this.currentWeightFilter = 'all';
    }

    let html = '<option value="all">All Weights</option>';
    weights.forEach(w => { html += `<option value="${w}">${w}</option>`; });
    select.innerHTML = html;
    select.value = this.currentWeightFilter;
  },

  // ── Category list rendering ────────────────────────────────────────────
  async renderCategories() {
    const container = document.getElementById('expoCategoriesList');
    if (!container) return;

    this.syncGenderFilterControl();
    this.syncAgeCategoryFilterControl();
    await this.syncWeightFilterControl();

    const renderRequestId = ++this.categoriesRenderRequestId;

    try {
      // Load-bearing for the whole categories list — stays outside any
      // try/catch that would swallow it silently.
      const bracketsSnap = await dbGet(dbRef(database, 'expoBrackets'));
      const allBrackets = bracketsSnap.exists() ? bracketsSnap.val() : {};

      // Who (if anyone) currently holds each category's exclusive court
      // lock — purely cosmetic, so a failure here must never take down the
      // rest of the categories list.
      let allLocks = {};
      try {
        const locksSnap = await dbGet(dbRef(database, 'bracketLocks/expo'));
        allLocks = locksSnap.exists() ? locksSnap.val() : {};
      } catch (lockErr) {
        console.warn('⚠️ Could not read Expo bracket locks (non-fatal — "Opened by" info unavailable):', lockErr.message);
      }

      // Referee court-assignment gate — admin/judge sessions are unaffected
      // (see bracket.js's identical block for the full explanation). Fail
      // closed (show nothing) for referees if this read itself fails.
      const role = sessionStorage.getItem('userRole');
      const isReferee = role === 'referee';
      const myCourt = String(sessionStorage.getItem('courtNumber') || '').trim();
      let allAssignments = {};
      try {
        const assignSnap = await dbGet(dbRef(database, 'bracketAssignments/expo'));
        allAssignments = assignSnap.exists() ? assignSnap.val() : {};
      } catch (assignErr) {
        console.warn('⚠️ Could not read Expo bracket assignments:', assignErr.message);
        if (isReferee) {
          if (renderRequestId !== this.categoriesRenderRequestId) return;
          container.innerHTML = '<div class="category-empty-state">Could not load your assigned brackets — please check your connection and try again.</div>';
          return;
        }
      }

      if (renderRequestId !== this.categoriesRenderRequestId) return;

      const cards = Object.keys(this.categories).map(key => {
        if (isReferee) {
          const assignment = allAssignments[key];
          if (!assignment || String(assignment.courtNumber).trim() !== myCourt) {
            return null;
          }
        }

        const cat = this.categories[key];
        const playerCount = cat.players.length;
        const bracketData = allBrackets[key];

        let status = 'Pending';
        if (bracketData) {
          if (bracketData.status === 'complete') status = 'Completed';
          else if (bracketData.status === 'live') status = 'Live';
        }
        this.categoryStatuses[key] = status;

        const statusLower = status.toLowerCase();
        const matchesStatus = this.currentFilter === 'all' || this.currentFilter === statusLower;
        const matchesSearch = !this.currentSearchTerm ||
          cat.gender.toLowerCase().includes(this.currentSearchTerm) ||
          cat.ageCategory.toLowerCase().includes(this.currentSearchTerm) ||
          cat.weightCategory.toLowerCase().includes(this.currentSearchTerm) ||
          cat.players.some(p => (p.playerName || '').toLowerCase().includes(this.currentSearchTerm));

        if (!matchesStatus || !this._categoryMatchesActiveFilters(cat) || !matchesSearch) return null;

        let statusColor = 'var(--text-gray)';
        if (status === 'Completed') statusColor = 'var(--success-green)';
        else if (status === 'Live') statusColor = 'var(--warning-orange)';
        else if (status === 'Pending') statusColor = 'var(--accent-cyan)';

        // Only shown while Live — whichever court currently holds the
        // exclusive lock on this category (see _acquireBracketLock).
        const lock = allLocks[key];
        const courtLine = (status === 'Live' && lock && lock.courtNumber)
          ? `<p class="court-label" style="margin:2px 0 0;font-size:0.85rem;color:var(--warning-orange);font-weight:700;">Opened by: Court ${lock.courtNumber}</p>`
          : '';

        return `
          <div class="category-card" onclick="EXPO_BRACKET.openCategory('${key}')">
            <h3>${cat.gender} ${cat.ageCategory}</h3>
            <p class="weight-label">${cat.weightCategory}</p>
            <p class="player-count">${playerCount} Player${playerCount !== 1 ? 's' : ''}</p>
            <div style="margin: 12px 0; padding: 8px; background: rgba(255, 255, 255, 0.05); border-radius: 6px; text-align: center;">
              <span style="color: ${statusColor}; font-weight: 700; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.5px;">${status === 'Live' ? '🔴 ' : ''}${status === 'Completed' ? '✅ ' : ''}${status === 'Pending' ? '🟡 ' : ''}${status}</span>
              ${courtLine}
            </div>
            <button class="btn-primary">View Expo Bracket</button>
          </div>
        `;
      });

      const visible = cards.filter(c => c !== null);

      if (visible.length === 0) {
        container.innerHTML = '<div class="category-empty-state">No Expo categories found for the selected filters.</div>';
        return;
      }

      container.innerHTML = `<div class="categories-grid">${visible.join('')}</div>`;
    } catch (error) {
      console.error('❌ Error rendering expo categories:', error);
    }
  },

  // ── Match generation ───────────────────────────────────────────────────
  // Consecutive pairing after team-aware seeding: [p0,p1], [p2,p3], ... —
  // same avoid-same-team pipeline as the Official bracket (smartSeedForMatching),
  // so two players from the same team only ever land in the same match when
  // team composition makes it truly unavoidable. A leftover unpaired player
  // becomes an automatic Gold (no match created).
  createExpoBracket(players) {
    const compressed = players.map(p => this.compressPlayer(p));
    const seeded = this.smartSeedForMatching(compressed);
    const matches = [];
    const byes = [];
    let matchCounter = 1;

    for (let i = 0; i + 1 < seeded.length; i += 2) {
      matches.push({
        matchId: `expo_m${matchCounter}`,
        player1: seeded[i],
        player2: seeded[i + 1],
        status: 'pending',
        winner: null,
        courtNumber: null,
        startTime: null,
        endTime: null
      });
      matchCounter++;
    }
    if (seeded.length % 2 === 1) {
      byes.push(seeded[seeded.length - 1]);
    }

    return {
      playerCount: seeded.length,
      status: matches.length === 0 ? 'complete' : 'pending',
      createdAt: new Date().toISOString(),
      matches,
      byes
    };
  },

  async saveBracket(categoryKey, bracket) {
    await dbSet(dbRef(database, `expoBrackets/${categoryKey}`), bracket);
  },

  async saveMatchToHistory(categoryKey, match) {
    try {
      await dbSet(dbRef(database, `expoMatchHistory/${categoryKey}/${match.matchId}`), match);
    } catch (error) {
      console.warn('⚠️ Could not save expo match history (non-fatal):', error.message);
    }
  },

  findMatch(matchId) {
    if (!this.currentBracket) return null;
    return (this.currentBracket.matches || []).find(m => m.matchId === matchId) || null;
  },

  // Real-time listener for the open bracket (multi-court sync — mirrors
  // bracket.js's setupBracketListeners so Expo behaves the same as Official:
  // any change another referee/admin makes to this category shows up here
  // immediately, without needing to close and reopen the bracket.
  setupBracketListeners(categoryKey) {
    this.stopBracketListeners();
    if (!categoryKey) return;

    const bracketRef = dbRef(database, `expoBrackets/${categoryKey}`);
    this.bracketListener = dbOnValue(bracketRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const rawBracket = snapshot.val();
      // Only re-render if the bracket actually changed
      if (JSON.stringify(this.currentBracket) !== JSON.stringify(rawBracket)) {
        this.currentBracket = rawBracket;
        // While the Bracket Editor is open, do NOT re-render over the
        // admin's in-progress drag session — a concurrent change from
        // another court/device would otherwise wipe out unsaved edits. The
        // editor's own draft is independent of currentBracket until Save, so
        // it stays intact; the fresh data is picked up next time
        // renderBracket() runs (edit mode exit, or the next real update).
        // Mirrors bracket.js's identical guard.
        if (this.editMode) {
          console.log('🔄 Expo bracket updated from Firebase (edit mode active — render deferred)');
          return;
        }
        console.log('🔄 Expo bracket updated from Firebase - re-rendering');
        this.renderBracket();
      }
    });
    console.log(`✅ Expo real-time listener active for ${categoryKey}`);
  },

  stopBracketListeners() {
    if (this.bracketListener) {
      this.bracketListener();
      this.bracketListener = null;
      console.log('✅ Expo bracket listener stopped');
    }
  },

  // Real-time listener on the expoBrackets node so ALL users see status
  // changes (Live / Pending / Completed) in the Expo categories list without
  // refreshing — mirrors bracket.js's setupCategoriesListener.
  //
  // ALSO listens on expoPlayers/ — same reasoning as bracket.js: the category
  // cards are grouped by each player's CURRENT weightCategory
  // (categorizePlayers()), computed once at page load. Without this, a
  // weight correction made elsewhere never gets picked up by an already-open
  // Bracket page, and the player keeps showing under their OLD Expo category
  // card until a manual reload — which looks like duplication when compared
  // against a fresh view. See bracket.js's setupCategoriesListener for the
  // full explanation of the debounce/recategorize coalescing below.
  setupCategoriesListener() {
    this.stopCategoriesListener();
    let debounceTimer = null;
    let needsRecategorize = false;

    const scheduleRefresh = (recategorize) => {
      if (recategorize) needsRecategorize = true;
      // Skip if the user is currently inside the bracket view
      const container = document.getElementById('expoBracketContainer');
      if (container && container.style.display === 'block') return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (needsRecategorize) {
          await this.loadPlayers();
          this.categorizePlayers();
          needsRecategorize = false;
        }
        this.renderCategories();
      }, 500);
    };

    const unsubBrackets = dbOnValue(dbRef(database, 'expoBrackets'), () => scheduleRefresh(false));
    const unsubPlayers = dbOnValue(dbRef(database, 'expoPlayers'), () => scheduleRefresh(true));
    // Court-lock changes (a court claiming/releasing a category) never
    // change who's registered in it, so this never needs a recategorize —
    // just re-render so the "Opened by: Court X" line updates live.
    const unsubLocks = dbOnValue(dbRef(database, 'bracketLocks/expo'), () => scheduleRefresh(false), (err) => {
      console.warn('⚠️ Expo bracketLocks listener error (non-fatal):', err.message);
    });
    // Assignment changes — see bracket.js's identical listener for the
    // full explanation (keeps a referee's list live without a manual refresh).
    const unsubAssignments = dbOnValue(dbRef(database, 'bracketAssignments/expo'), () => scheduleRefresh(false), (err) => {
      console.warn('⚠️ Expo bracketAssignments listener error (non-fatal):', err.message);
    });
    this.categoriesListener = () => { unsubBrackets(); unsubPlayers(); unsubLocks(); unsubAssignments(); };
    console.log('✅ Expo categories real-time listener active (expoBrackets + expoPlayers + locks + assignments)');
  },

  stopCategoriesListener() {
    if (this.categoriesListener) {
      this.categoriesListener();
      this.categoriesListener = null;
      console.log('✅ Expo categories listener stopped');
    }
  },

  // ── Open / close a category ────────────────────────────────────────────
  // Reliability notes — mirrors bracket.js's Official openCategory() exactly
  // (same intermittent "won't open" failure, same fix): a re-entrancy guard
  // against double-taps/slow-device double-fires, stopCategoriesListener()
  // moved to run BEFORE the slower Firebase work (closing the race window
  // where a concurrent players/ update rebuilds this.categories out from
  // under this.categories[this.currentCategory] by the time renderBracket()
  // reads it), a visible loading state, and a top-level try/catch so any
  // Firebase failure shows a clear message and returns to the categories
  // list instead of an unhandled rejection / blank screen.
  async openCategory(categoryKey) {
    if (this._openingCategory) return;
    this._openingCategory = true;

    try {
      const category = this.categories[categoryKey];
      if (!category) {
        if (typeof MODAL !== 'undefined') MODAL.error('Category not found');
        return;
      }

      if (!(await this._assertCategoryAssignedToMe(categoryKey))) {
        return;
      }

      this.currentCategory = categoryKey;

      if (!(await this._tryClaimCourtLock(categoryKey))) {
        this.currentCategory = null;
        return;
      }

      // Stop the categories-level listener BEFORE any slow work — see notes above.
      this.stopCategoriesListener();
      this._showBracketLoading();

      const snap = await dbGet(dbRef(database, `expoBrackets/${categoryKey}`));

      if (snap.exists()) {
        this.currentBracket = snap.val();
        // If the roster changed and nothing has started yet, regenerate matches
        const anyStarted = (this.currentBracket.matches || []).some(m => m.status !== 'pending');
        if (!anyStarted && this.currentBracket.playerCount !== category.players.length) {
          this.currentBracket = this.createExpoBracket(category.players);
          await this.saveBracket(categoryKey, this.currentBracket);
        }
      } else {
        this.currentBracket = this.createExpoBracket(category.players);
        await this.saveBracket(categoryKey, this.currentBracket);
      }

      // Mark as live the moment ANY referee opens this bracket — even before a
      // match is started — so other courts' categories list shows "Live" in
      // real time (matches bracket.js's Official behavior exactly).
      if (this.currentBracket.status === 'complete') {
        console.log(`✅ Expo bracket ${categoryKey} is COMPLETED`);
      } else {
        this.currentBracket.status = 'live';
        await this.saveBracket(categoryKey, this.currentBracket);
        console.log(`📍 Expo bracket ${categoryKey} marked as LIVE`);
      }

      // Start real-time sync for this specific bracket (multi-court sync,
      // matching the Official bracket's behavior).
      this.setupBracketListeners(categoryKey);

      // Bracket is now open for this referee's court — mark it active so the
      // Live Matches page shows the Upcoming Match immediately, even before any
      // score/timer starts. If a match is already live on this court (referee
      // resumed/refreshed mid-match), restore it as the active match right away.
      if (typeof LIVE_PRESENCE !== 'undefined') {
        const assignedCourt = String(sessionStorage.getItem('courtNumber') || '').trim();
        if (assignedCourt) {
          let resumedMatchId = null;
          (this.currentBracket.matches || []).forEach(match => {
            if (match && match.status === 'live' && String(match.courtNumber) === assignedCourt) {
              resumedMatchId = match.matchId;
            }
          });
          this._liveCourtNumber = assignedCourt;
          LIVE_PRESENCE.setCourtState(assignedCourt, {
            categoryKey,
            matchType: 'expo',
            activeMatchId: resumedMatchId
          });
        }
      }

      this.renderBracket();
    } catch (error) {
      console.error('❌ Error opening Expo bracket:', error);
      this.stopBracketListeners(); // in case setupBracketListeners() ran before a later step failed
      this.currentCategory = null;
      this.currentBracket = null;
      this._hideBracketLoading();
      this.setupCategoriesListener();
      const msg = 'Could not open this bracket — please check your connection and try again.';
      if (typeof MODAL !== 'undefined') MODAL.error(msg);
      else alert(msg);
    } finally {
      this._openingCategory = false;
    }
  },

  _showBracketLoading() {
    const listEl = document.getElementById('expoCategoriesList');
    const containerEl = document.getElementById('expoBracketContainer');
    if (listEl) listEl.style.display = 'none';
    if (containerEl) {
      containerEl.style.display = 'block';
      containerEl.innerHTML = `
        <div style="text-align:center;padding:80px 20px;">
          <div class="spinner"></div>
          <p>Loading bracket…</p>
        </div>
      `;
    }
  },

  _hideBracketLoading() {
    const listEl = document.getElementById('expoCategoriesList');
    const containerEl = document.getElementById('expoBracketContainer');
    if (containerEl) containerEl.style.display = 'none';
    if (listEl) listEl.style.display = 'block';
  },

  async closeCategory() {
    // Stop real-time listener for this bracket when leaving
    this.stopBracketListeners();

    // Referee is leaving the bracket entirely — the court disappears from
    // the Live Matches page (both Live and Upcoming) until reopened.
    if (typeof LIVE_PRESENCE !== 'undefined' && this._liveCourtNumber) {
      LIVE_PRESENCE.closeCourt(this._liveCourtNumber);
      this._liveCourtNumber = null;
    }

    // Release this court's exclusive claim on the category — whether the
    // bracket ended up Complete or reverted to Pending below, nobody should
    // still be "holding" it once this court has left.
    if (this._lockedCourtNumber && this.currentCategory) {
      await this._releaseBracketLock(this.currentCategory, this._lockedCourtNumber);
      this._lockedCourtNumber = null;
    }

    // Revert "Live" back to "Pending" for other courts' categories list once
    // no one is actively viewing this bracket anymore — unless it's already
    // fully complete (matches bracket.js's Official behavior).
    if (this.currentCategory && this.currentBracket && this.currentBracket.status !== 'complete') {
      const matches = this.currentBracket.matches || [];
      const isComplete = matches.length > 0 && matches.every(m => m.status === 'completed');
      this.currentBracket.status = isComplete ? 'complete' : 'pending';
      await this.saveBracket(this.currentCategory, this.currentBracket);
    }

    this.currentCategory = null;
    this.currentBracket = null;
    const listEl = document.getElementById('expoCategoriesList');
    const containerEl = document.getElementById('expoBracketContainer');
    if (containerEl) containerEl.style.display = 'none';
    if (listEl) listEl.style.display = 'block';

    // Refresh category list to update status display, then resume real-time
    // listening so any other user's bracket opens/closes appear immediately.
    this.renderCategories();
    this.setupCategoriesListener();
  },

  // ── Referee workflow ───────────────────────────────────────────────────
  async startMatch(matchId) {
    const match = this.findMatch(matchId);
    if (!match || !match.player1 || !match.player2) {
      console.log('❌ Expo match not found or missing players');
      return;
    }

    if (this.areSameTeam(match.player1, match.player2) && typeof MODAL !== 'undefined') {
      MODAL.warning(
        `⚠️ SAME-TEAM MATCH\n\n${match.player1.playerName} vs ${match.player2.playerName}\n\nBoth players are from ${match.player1.teamName}.`,
        'Match is proceeding'
      );
    }

    const courtSelect = document.getElementById(`expo_court_${matchId}`);
    match.status = 'live';
    match.startTime = new Date().toISOString();
    match.courtNumber = courtSelect ? (courtSelect.value || null) : null;
    match.winner = null;

    if (this.currentBracket.status !== 'complete') this.currentBracket.status = 'live';

    await this.saveBracket(this.currentCategory, this.currentBracket);
    this.renderBracket();
    this.renderCategories();

    // Flip this court's active match so it moves from Upcoming to Live on the
    // Live Matches page. Cleared back to null when the match is stopped below.
    if (match.courtNumber && typeof LIVE_PRESENCE !== 'undefined') {
      const courtKey = String(match.courtNumber);
      // Match started on a different court than the one this bracket session
      // opened under (e.g. admin picking a court manually) — release the old
      // court's presence so it doesn't keep showing a stale Upcoming Match.
      if (this._liveCourtNumber && this._liveCourtNumber !== courtKey) {
        LIVE_PRESENCE.closeCourt(this._liveCourtNumber);
      }
      this._liveCourtNumber = courtKey;
      LIVE_PRESENCE.setCourtState(match.courtNumber, {
        categoryKey: this.currentCategory,
        matchType: 'expo',
        activeMatchId: match.matchId
      });
    }
  },

  setWinner(matchId, playerId) {
    const match = this.findMatch(matchId);
    if (!match) return;
    match.winner = playerId; // staged; finalized in stopAndDeclareWinner
  },

  async stopAndDeclareWinner(matchId) {
    const match = this.findMatch(matchId);
    if (!match) return;
    if (!match.winner) {
      if (typeof MODAL !== 'undefined') MODAL.warning('Please select a winner before stopping the match.');
      return;
    }

    match.status = 'completed';
    match.endTime = new Date().toISOString();

    // Match finished but the bracket stays open — clear the active match only,
    // so Live disappears while Upcoming keeps showing the next scheduled match.
    if (match.courtNumber && typeof LIVE_PRESENCE !== 'undefined') {
      LIVE_PRESENCE.setCourtState(match.courtNumber, {
        categoryKey: this.currentCategory,
        matchType: 'expo',
        activeMatchId: null
      });
    }

    await this.saveMatchToHistory(this.currentCategory, match);

    // The real-time bracketListener (setupBracketListeners) can fire during
    // the await above and replace this.currentBracket with a fresher
    // Firebase snapshot from another court — one that doesn't yet know this
    // match just completed. Re-apply this match's finished fields onto the
    // (possibly swapped-in) bracket before checking completion/saving, so a
    // concurrent write from another referee can't silently erase this
    // result. Mirrors bracket.js's advanceWinner fix for the same race.
    const bracketMatch = (this.currentBracket.matches || []).find(m => m.matchId === matchId);
    if (bracketMatch) {
      bracketMatch.status = match.status;
      bracketMatch.winner = match.winner;
      bracketMatch.endTime = match.endTime;
    }

    const allDone = this.currentBracket.matches.every(m => m.status === 'completed');
    this.currentBracket.status = allDone ? 'complete' : 'live';

    await this.saveBracket(this.currentCategory, this.currentBracket);
    this.renderBracket();
    this.renderCategories();

    if (allDone && typeof MODAL !== 'undefined') {
      const proceed = await MODAL.showConfirm('🏆 All matches complete! Download the results Excel sheet?');
      if (proceed) this.exportResultsToExcel();
    }
  },

  // ── Rendering ───────────────────────────────────────────────────────────
  renderBracket() {
    const container = document.getElementById('expoBracketContainer');
    if (!container || !this.currentBracket) return;
    // this.categories can be transiently rebuilt by the categories-level
    // expoPlayers/ listener (categorizePlayers() does `this.categories = {}`
    // before repopulating) — openCategory() now stops that listener before
    // this ever runs, but this guard is defense-in-depth so a stale/missing
    // entry degrades gracefully instead of throwing.
    const category = this.categories[this.currentCategory];
    const categoryTitle = category
      ? `${category.gender} ${category.ageCategory} — ${category.weightCategory} (Expo)`
      : `${this.currentCategory || ''} (Expo)`;
    const matches = this.currentBracket.matches || [];
    const byes = this.currentBracket.byes || [];
    const isComplete = this.currentBracket.status === 'complete';
    const canEdit = this._canEditBracket() && !!category && category.players.length > 1;

    const matchesHtml = matches.map((m, idx) => this.renderMatch(m, idx + 1)).join('');
    const byesHtml = byes.map(p => `
      <div class="match completed bye-card">
        <div class="match-players">
          <div class="player player-blue winner">
            <span class="player-name">${p.playerName}</span>
            <span class="player-center">${p.centerName || ''}</span>
          </div>
        </div>
        <div class="match-completed-info">
          <span class="winner-badge">🥇 Gold — Won by Walkover</span>
        </div>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="bracket-header">
        <button class="btn-back" onclick="EXPO_BRACKET.closeCategory()">← Back to Categories</button>
        <h2 style="flex:1 1 320px;min-width:280px;word-break:normal;">${categoryTitle}</h2>
        <div style="display:flex;gap:10px;align-items:center;">
          ${canEdit ? `<button class="btn-secondary edit-bracket-btn" onclick="EXPO_BRACKET.promptEditPassword('${this.currentCategory}')" style="padding:8px 18px;font-size:0.95rem;border:1.5px dashed var(--border-gold);color:var(--border-gold);">✏️ Edit Bracket</button>` : ''}
          <button class="btn-secondary" onclick="EXPO_BRACKET.downloadFixturePDF()">📄 Download Fixture PDF</button>
          <button class="btn-secondary" onclick="EXPO_BRACKET.downloadPlayerListExcel()">📋 Download Player List (Excel)</button>
          ${isComplete ? `
            <button class="btn-secondary" onclick="EXPO_BRACKET.exportResultsToExcel()">📥 Export Results (Excel)</button>
            <button class="btn-secondary" onclick="EXPO_BRACKET.downloadResultsPDF()">📄 Download Results (PDF)</button>
          ` : ''}
        </div>
      </div>
      <div class="matches" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:16px;">
        ${matchesHtml}
        ${byesHtml}
      </div>
    `;
  },

  renderMatch(match, matchNumber) {
    const p1 = match.player1;
    const p2 = match.player2;
    const isPending = match.status === 'pending';
    const canStart = isPending && p1 && p2;
    const isLive = match.status === 'live';
    const isCompleted = match.status === 'completed';
    const isSameTeam = p1 && p2 && this.areSameTeam(p1, p2);

    // Referees have one fixed assigned court (set at login) — pre-select it here so
    // starting a match always records a courtNumber without an extra manual step.
    // Admin/judge sessions have no assigned court, so the dropdown still defaults blank for them.
    const _assignedCourt = String(sessionStorage.getItem('courtNumber') || '').trim();
    const _courtOption = (n) => `<option value="${n}"${_assignedCourt === String(n) ? ' selected' : ''}>Court ${n}</option>`;

    const renderSlot = (player, slotClass) => {
      const isWinner = isCompleted && match.winner === player?.id;
      const isLoser = isCompleted && player && match.winner && match.winner !== player.id;
      return `
        <div class="player ${slotClass} ${isWinner ? 'winner' : ''} ${isLoser ? 'eliminated' : ''}">
          <span class="player-name">${player ? player.playerName : '<span class="bye">TBD</span>'}</span>
          <span class="player-center">${player ? (player.centerName || '') : ''}</span>
        </div>`;
    };

    return `
      <div class="match ${match.status === 'live' ? 'in-progress' : match.status}${isSameTeam ? ' same-team-match' : ''}" data-match-id="${match.matchId}">
        <div class="match-number-badge">Match ${matchNumber}</div>
        <div class="match-players">
          ${renderSlot(p1, 'player-blue')}
          <div class="vs">VS</div>
          ${renderSlot(p2, 'player-red')}
        </div>

        ${isSameTeam ? `
          <div style="margin-top: 8px; padding: 8px 10px; background: rgba(255, 165, 0, 0.15); border: 1px solid #ffa500; border-radius: 6px; color: #ffa500; font-size: 0.85rem; font-weight: 600;">
            ⚠️ SAME-TEAM MATCH: Both players are from ${p1.teamName}
          </div>` : ''}

        ${canStart ? `
          <div style="margin-top: 12px;">
            <label style="display: block; font-size: 0.9rem; color: var(--accent-cyan); margin-bottom: 6px; font-weight: 700;">🏟️ Court Number</label>
            <select id="expo_court_${match.matchId}" style="width: 100%; padding: 8px 12px; background: var(--secondary-black); border: 1px solid var(--accent-cyan); color: var(--text-white); border-radius: 6px; font-size: 1rem; margin-bottom: 10px;">
              <option value="">Select Court</option>
              ${_courtOption(1)}
              ${_courtOption(2)}
              ${_courtOption(3)}
              ${_courtOption(4)}
              ${_courtOption(5)}
            </select>
            <button class="btn-start-match" onclick="EXPO_BRACKET.startMatch('${match.matchId}')">▶️ Start Match</button>
          </div>` : ''}

        ${isLive ? `
          <div class="match-controls">
            <div class="match-in-progress">⏱️ Match in Progress...${match.courtNumber ? ` &nbsp;|&nbsp; 🏟️ Court ${match.courtNumber}` : ''}</div>
            <div class="match-actions">
              <div class="winner-selection">
                <label class="selection-label">Select Winner:</label>
                <div class="selection-group">
                  <label class="radio-label">
                    <input type="radio" name="expo_winner_${match.matchId}" value="${p1.id}" onchange="EXPO_BRACKET.setWinner('${match.matchId}', '${p1.id}')">
                    ${p1.playerName}
                  </label>
                  <label class="radio-label">
                    <input type="radio" name="expo_winner_${match.matchId}" value="${p2.id}" onchange="EXPO_BRACKET.setWinner('${match.matchId}', '${p2.id}')">
                    ${p2.playerName}
                  </label>
                </div>
              </div>
              <button class="btn-stop-match" onclick="EXPO_BRACKET.stopAndDeclareWinner('${match.matchId}')">🛑 Stop Match &amp; Declare Winner</button>
            </div>
          </div>` : ''}

        ${isCompleted ? `
          <div class="match-completed-info">
            <span class="winner-badge">🥇 Gold: ${match.winner === p1.id ? p1.playerName : p2.playerName}</span>
            <span class="eliminated-badge">🥈 Silver: ${match.winner === p1.id ? p2.playerName : p1.playerName}</span>
          </div>` : ''}
      </div>`;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BRACKET EDITOR — password-gated drag-and-drop editing
  //
  // Mirrors bracket.js's Official Bracket Editor exactly (same password
  // gate, same drag-and-drop mechanics, same validation, same "edit a
  // lightweight draft, never touch this.currentBracket until Save" design),
  // adapted for Expo's flat schema: there are no rounds here — every player
  // competes in exactly one match — so "Round 1" becomes simply "Matches",
  // and the bye pool maps directly onto bracket.byes instead of a per-round
  // bye list. Editing works on a lightweight in-memory draft (this._editDraft),
  // never touching this.currentBracket until Save. Cancel just discards the
  // draft. Save rebuilds matches/byes from the draft and writes them through
  // the existing saveBracket() path unchanged, so every other module (Live
  // Matches, referee dashboard, medal calculation, PDF/Excel export) keeps
  // reading expoBrackets/{categoryKey} exactly as before.
  // ═══════════════════════════════════════════════════════════════════════

  // Admin/Judge only — referees can view Expo brackets on this same page but
  // never get an Edit Bracket button (mirrors bracket.js's identical gate).
  _canEditBracket() {
    const role = sessionStorage.getItem('userRole');
    return role === 'admin' || role === 'judge';
  },

  // Entry point: password-gate before flipping into edit mode. Reuses the
  // admin's own real Firebase Auth password via reauthentication — no new
  // secret to store or manage, and a wrong password leaves the bracket
  // exactly as read-only as before.
  promptEditPassword(categoryKey) {
    if (typeof auth === 'undefined' || !auth.currentUser || !auth.currentUser.email) {
      MODAL.error('You must be signed in as an admin or judge to edit the bracket.');
      return;
    }
    const modalHTML = `
      <div class="custom-modal-overlay" onclick="if(event.target===this) EXPO_BRACKET._closeEditPasswordModal()">
        <div class="custom-modal-content modal-warning">
          <div class="custom-modal-header">
            <h2>🔒 Confirm Password</h2>
            <button class="custom-modal-close" onclick="EXPO_BRACKET._closeEditPasswordModal()">✕</button>
          </div>
          <div class="custom-modal-body">
            <p>Enter your admin/judge password to enable Bracket Edit Mode for this category.</p>
            <div style="position:relative;margin-top:10px;">
              <input type="password" id="expoEditPwInput" autocomplete="current-password"
                     style="width:100%;box-sizing:border-box;padding:10px 40px 10px 12px;border-radius:8px;border:1.5px solid var(--accent-cyan);background:rgba(0,0,0,0.45);color:var(--text-white);font-size:0.95rem;" />
              <button type="button" onclick="EXPO_BRACKET._toggleEditPw(this)"
                      style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-gray);cursor:pointer;padding:4px;display:flex;">${this._eyeOpenSvg()}</button>
            </div>
            <div id="expoEditPwError" style="color:var(--accent-red);font-size:0.85rem;margin-top:8px;display:none;"></div>
          </div>
          <div class="custom-modal-footer">
            <button class="btn-secondary" onclick="EXPO_BRACKET._closeEditPasswordModal()">Cancel</button>
            <button class="btn-primary" onclick="EXPO_BRACKET._submitEditPassword('${categoryKey}')">Unlock Editing</button>
          </div>
        </div>
      </div>
    `;
    const div = document.createElement('div');
    div.innerHTML = modalHTML;
    document.body.appendChild(div);
    this._editPwModalDiv = div;
    setTimeout(() => {
      const input = document.getElementById('expoEditPwInput');
      if (!input) return;
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._submitEditPassword(categoryKey);
      });
    }, 50);
  },

  _eyeOpenSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  },
  _eyeClosedSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
  },
  _toggleEditPw(btn) {
    const input = document.getElementById('expoEditPwInput');
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.innerHTML = isHidden ? this._eyeClosedSvg() : this._eyeOpenSvg();
  },

  _closeEditPasswordModal() {
    if (this._editPwModalDiv) {
      this._editPwModalDiv.remove();
      this._editPwModalDiv = null;
    }
  },

  async _submitEditPassword(categoryKey) {
    const input = document.getElementById('expoEditPwInput');
    const errorDiv = document.getElementById('expoEditPwError');
    const password = input ? input.value : '';
    if (!password) {
      if (errorDiv) { errorDiv.textContent = 'Please enter your password.'; errorDiv.style.display = 'block'; }
      return;
    }
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
      await reauthenticateWithCredential(auth.currentUser, credential);
      this._closeEditPasswordModal();
      this.enterEditMode(categoryKey);
    } catch (err) {
      console.warn('Edit-mode password check failed:', err.code || err.message);
      if (errorDiv) {
        errorDiv.textContent = 'Incorrect password. Bracket remains read-only.';
        errorDiv.style.display = 'block';
      }
      if (input) { input.value = ''; input.focus(); }
    }
  },

  // Build the editable draft from the currently saved bracket's matches/byes
  // and switch into edit-mode rendering.
  enterEditMode(categoryKey) {
    const bracket = this.currentBracket;
    const category = this.categories[categoryKey];
    if (!bracket || !category) return;

    const matches = bracket.matches || [];
    const activePlayers = [];
    matches.forEach(m => {
      if (m.player1) activePlayers.push(m.player1);
      if (m.player2) activePlayers.push(m.player2);
    });
    const byePool = (bracket.byes || []).map(p => ({ ...p }));

    // Reconcile against the CURRENT roster: keep this bracket's existing
    // arrangement as the starting point, but if players were added/removed
    // since it was last saved, drop anyone no longer registered and add any
    // newly-registered player into the bye pool (least disruptive spot — the
    // admin can freely drag them into a match).
    const seenIds = new Set();
    const rosterIds = new Set(category.players.map(p => p.id));
    const filteredActive = [];
    activePlayers.forEach(p => {
      if (p && rosterIds.has(p.id) && !seenIds.has(p.id)) {
        seenIds.add(p.id);
        filteredActive.push(p);
      }
    });
    const filteredBye = [];
    byePool.forEach(p => {
      if (p && rosterIds.has(p.id) && !seenIds.has(p.id)) {
        seenIds.add(p.id);
        filteredBye.push(p);
      }
    });
    category.players.forEach(p => {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        filteredBye.push(this.compressPlayer(p));
      }
    });

    this._editDraft = {
      activePlayers: filteredActive,
      byePool: filteredBye,
      // Untouched iff no match has ever recorded a winner or left 'pending' —
      // same signal weigh-check-sync.js's _expoBracketIsUntouched() uses.
      hadStartedMatches: matches.some(m => m.winner || (m.status && m.status !== 'pending')),
      // Extra fully-empty match slots the admin has added via "+ Add Match"
      // (beyond what activePlayers.length implies) so a BYE-pool player can
      // be dragged back into a real match even when every existing match
      // slot is already full.
      extraEmptyMatches: 0
    };
    this.editMode = true;
    this.renderEditBracket();
  },

  // Full-screen edit-mode render — only the match list + the bye pool are
  // shown; everything is driven from this._editDraft, not this.currentBracket.
  renderEditBracket() {
    const container = document.getElementById('expoBracketContainer');
    if (!container || !this._editDraft) return;
    const draft = this._editDraft;
    const cat = this.categories[this.currentCategory];

    const totalPlayers = draft.activePlayers.length + draft.byePool.length;
    const matchCount = Math.ceil(draft.activePlayers.length / 2) + (draft.extraEmptyMatches || 0);

    let html = `
      <div class="bracket-header edit-mode-header">
        <button class="btn-back" onclick="EXPO_BRACKET.cancelEditBracket()">← Cancel</button>
        <h2 style="flex:1 1 320px;min-width:280px;word-break:normal;">🔧 EDIT MODE — ${cat.gender} ${cat.ageCategory} - ${cat.weightCategory} (Expo)</h2>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <span class="edit-mode-counts">${draft.activePlayers.length} in matches · ${draft.byePool.length} bye${draft.byePool.length === 1 ? '' : 's'} · ${totalPlayers} total</span>
          <button class="btn-secondary" onclick="EXPO_BRACKET.cancelEditBracket()">Cancel</button>
          <button class="btn-primary edit-save-btn" onclick="EXPO_BRACKET.saveEditBracket()">💾 Save Bracket</button>
        </div>
      </div>
      <div class="edit-mode-banner">🔧 EDIT MODE — drag a player onto another slot to swap or replace them, or drag them into the BYE pool. Nothing is saved until you click Save.</div>
      <div class="bracket-rounds">
        <div class="round edit-round">
          <h3 class="round-title">Matches (editable)</h3>
          <div class="matches">
    `;

    for (let i = 0; i < matchCount; i++) {
      html += this.renderEditMatchCard(draft, i);
    }

    html += `
            <button type="button" class="btn-secondary edit-add-match-btn" onclick="EXPO_BRACKET.addEmptyEditMatch()">➕ Add Match</button>
          </div>
        </div>
      </div>
      ${this.renderEditByePool(draft)}
    `;

    container.innerHTML = html;
    document.getElementById('expoCategoriesList').style.display = 'none';
    container.style.display = 'block';
  },

  renderEditMatchCard(draft, matchIndex) {
    const i1 = matchIndex * 2;
    const i2 = matchIndex * 2 + 1;
    const p1 = draft.activePlayers[i1] || null;
    const p2 = draft.activePlayers[i2] || null;
    const sameTeam = p1 && p2 && this.areSameTeam(p1, p2);

    const slot = (player, idx, side) => {
      if (player) {
        return `
          <div class="player player-${side} edit-slot"
               draggable="true"
               ondragstart="EXPO_BRACKET.editDragStart(event,'active',${idx})"
               ondragover="EXPO_BRACKET.editDragOver(event)"
               ondragleave="EXPO_BRACKET.editDragLeave(event)"
               ondrop="EXPO_BRACKET.editDrop(event,'active',${idx})">
            <span class="player-name">${player.playerName}</span>
            <span class="player-center">${player.centerName || ''}</span>
          </div>
        `;
      }
      return `
        <div class="player edit-slot drop-target"
             ondragover="EXPO_BRACKET.editDragOver(event)"
             ondragleave="EXPO_BRACKET.editDragLeave(event)"
             ondrop="EXPO_BRACKET.editDrop(event,'active',${idx})">
          <span class="player-center" style="opacity:.6;">Empty — drop a player here</span>
        </div>
      `;
    };

    return `
      <div class="match pending edit-match${sameTeam ? ' same-team-match' : ''}">
        <span class="match-number-badge">Match ${matchIndex + 1}</span>
        <div class="match-players">
          ${slot(p1, i1, 'blue')}
          <div class="vs">VS</div>
          ${slot(p2, i2, 'red')}
        </div>
        ${sameTeam ? `<div class="edit-warning">⚠️ Same team — allowed, but flagged</div>` : ''}
      </div>
    `;
  },

  renderEditByePool(draft) {
    const chips = draft.byePool.map((p, idx) => `
      <div class="bye-chip"
           draggable="true"
           ondragstart="EXPO_BRACKET.editDragStart(event,'bye',${idx})"
           ondragover="EXPO_BRACKET.editDragOver(event)"
           ondragleave="EXPO_BRACKET.editDragLeave(event)"
           ondrop="EXPO_BRACKET.editDrop(event,'bye',${idx})">
        <span class="player-name">${p.playerName}</span>
        <span class="player-center">${p.centerName || ''}</span>
      </div>
    `).join('');

    return `
      <div class="edit-bye-pool"
           ondragover="EXPO_BRACKET.editDragOver(event)"
           ondragleave="EXPO_BRACKET.editDragLeave(event)"
           ondrop="EXPO_BRACKET.editDrop(event,'bye',null)">
        <h3 class="round-title">🎫 BYE Pool — ${draft.byePool.length} player${draft.byePool.length === 1 ? '' : 's'} (drag here to give a walkover Gold)</h3>
        <div class="bye-pool-chips">
          ${chips || '<div class="bye-pool-empty">Drag a player here to assign a bye</div>'}
        </div>
      </div>
    `;
  },

  // Adds one extra fully-empty match slot after the last match so a
  // BYE-pool player can be dragged back into a real match even when every
  // existing match slot is already occupied. Purely a draft/UI addition —
  // it isn't persisted unless a player actually gets dropped into it.
  addEmptyEditMatch() {
    const draft = this._editDraft;
    if (!draft) return;
    draft.extraEmptyMatches = (draft.extraEmptyMatches || 0) + 1;
    this.renderEditBracket();
  },

  editDragStart(event, zone, index) {
    event.dataTransfer.setData('editZone', zone);
    event.dataTransfer.setData('editIndex', String(index));
    event.dataTransfer.effectAllowed = 'move';
  },

  editDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.add('drag-over');
  },

  editDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
  },

  // Swap-or-move: dropping onto an OCCUPIED slot swaps the two players in
  // place (covers "swap two players" and "replace one player with
  // another"); dropping onto an empty trailing match slot or the bye pool's
  // open background moves the player there instead. Because every chip
  // always has exactly one array "home" and moves/swaps never create or
  // delete an entry, duplicate/missing players are structurally impossible
  // from dragging alone.
  editDrop(event, targetZone, targetIndex) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('drag-over');

    const draft = this._editDraft;
    if (!draft) return;

    const srcZone = event.dataTransfer.getData('editZone');
    const srcIndexRaw = event.dataTransfer.getData('editIndex');
    if (!srcZone || srcIndexRaw === '') return;
    const srcIndex = parseInt(srcIndexRaw, 10);

    const srcArr = srcZone === 'bye' ? draft.byePool : draft.activePlayers;
    const dstArr = targetZone === 'bye' ? draft.byePool : draft.activePlayers;
    if (isNaN(srcIndex) || srcIndex < 0 || srcIndex >= srcArr.length) return;
    if (srcZone === targetZone && srcIndex === targetIndex) return;

    const movedPlayer = srcArr[srcIndex];

    if (targetIndex === null || targetIndex === undefined || targetIndex >= dstArr.length) {
      // Empty trailing slot or open pool background — move, no swap.
      srcArr.splice(srcIndex, 1);
      dstArr.push(movedPlayer);
    } else if (srcZone === targetZone) {
      const targetPlayer = srcArr[targetIndex];
      srcArr[srcIndex] = targetPlayer;
      srcArr[targetIndex] = movedPlayer;
    } else {
      const targetPlayer = dstArr[targetIndex];
      dstArr[targetIndex] = movedPlayer;
      srcArr[srcIndex] = targetPlayer;
    }

    this.renderEditBracket();
  },

  async cancelEditBracket() {
    const draft = this._editDraft;
    if (draft) {
      const originalMatches = this.currentBracket.matches || [];
      const originalActiveIds = [];
      originalMatches.forEach(m => {
        if (m.player1) originalActiveIds.push(m.player1.id);
        if (m.player2) originalActiveIds.push(m.player2.id);
      });
      const originalByeIds = (this.currentBracket.byes || []).map(p => p.id).sort();
      const draftActiveIds = draft.activePlayers.map(p => p.id);
      const draftByeIds = draft.byePool.map(p => p.id).sort();

      const changed = JSON.stringify(originalActiveIds) !== JSON.stringify(draftActiveIds) ||
        JSON.stringify(originalByeIds) !== JSON.stringify(draftByeIds);

      if (changed) {
        const confirmed = await MODAL.showConfirm('Discard unsaved bracket changes?');
        if (!confirmed) return;
      }
    }

    this.editMode = false;
    this._editDraft = null;
    this.renderBracket();
  },

  async saveEditBracket() {
    const draft = this._editDraft;
    if (!draft) return;

    const category = this.categories[this.currentCategory];
    const totalPlayers = draft.activePlayers.length + draft.byePool.length;

    // ── VALIDATION ────────────────────────────────────────────────────
    const allIds = [...draft.activePlayers.map(p => p.id), ...draft.byePool.map(p => p.id)];
    const idSet = new Set(allIds);
    if (idSet.size !== allIds.length) {
      MODAL.warning('A player appears more than once in the bracket. Please fix before saving.');
      return;
    }
    const missing = category.players.filter(p => !idSet.has(p.id));
    if (missing.length > 0) {
      MODAL.warning(`${missing.length} player(s) are missing from the bracket: ${missing.map(p => p.playerName).join(', ')}.`);
      return;
    }
    if (totalPlayers !== category.players.length) {
      MODAL.warning('The bracket player count does not match the category roster.');
      return;
    }
    if (draft.activePlayers.length % 2 !== 0) {
      MODAL.warning('An odd number of players are left in matches — move one more player to the BYE pool (or move one back out) before saving.');
      return;
    }
    if (totalPlayers > 1 && draft.byePool.length >= totalPlayers) {
      MODAL.warning('Every player cannot receive a bye — at least one real match is needed.');
      return;
    }

    // ── WARN IF THIS DISCARDS RECORDED PROGRESS ─────────────────────────
    if (draft.hadStartedMatches) {
      const confirmed = await MODAL.showConfirm(
        'This category already has match results recorded. Saving this edit will discard that progress and rebuild the matches from scratch. Continue?'
      );
      if (!confirmed) return;
    }

    // ── REBUILD MATCHES FROM THE DRAFT ──────────────────────────────────
    const bracket = this.currentBracket;
    const newMatches = [];
    let matchCounter = 1;
    for (let i = 0; i < draft.activePlayers.length; i += 2) {
      newMatches.push({
        matchId: `expo_m${matchCounter}`,
        player1: draft.activePlayers[i],
        player2: draft.activePlayers[i + 1],
        status: 'pending',
        winner: null,
        courtNumber: null,
        startTime: null,
        endTime: null
      });
      matchCounter++;
    }

    bracket.matches = newMatches;
    bracket.byes = draft.byePool;
    bracket.playerCount = totalPlayers;
    bracket.status = 'live';
    bracket.manuallyEdited = true;
    bracket.lastEditedAt = new Date().toISOString();
    bracket.editedBy = (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.email) || 'unknown';

    this.currentBracket = bracket;
    this.editMode = false;
    this._editDraft = null;

    await this.saveBracket(this.currentCategory, this.currentBracket);
    this.renderBracket();
    MODAL.success('Bracket saved! This edited layout is now the official match list.');
  },

  // ── Medals / rankings ───────────────────────────────────────────────────
  // buildRankings() reads the currently-open category; buildRankingsFor()
  // takes any bracket object directly, so the all-categories export (which
  // reads every category straight from Firebase, none of them "current")
  // can reuse the same medal logic.
  buildRankings() {
    return this.buildRankingsFor(this.currentBracket);
  },

  buildRankingsFor(bracket) {
    if (!bracket) return [];
    const rankings = [];
    (bracket.matches || []).forEach((m, idx) => {
      if (m.status !== 'completed' || !m.winner) return;
      const winner = m.winner === m.player1.id ? m.player1 : m.player2;
      const loser = m.winner === m.player1.id ? m.player2 : m.player1;
      rankings.push({ ...winner, medal: 'Gold', matchNumber: idx + 1 });
      rankings.push({ ...loser, medal: 'Silver', matchNumber: idx + 1 });
    });
    (bracket.byes || []).forEach(p => {
      rankings.push({ ...p, medal: 'Gold', note: 'Walkover (no opponent)' });
    });
    return rankings;
  },

  // ── ALL-CATEGORIES RESULTS EXPORT (Excel / PDF) ──────────────────────────
  // One flat file spanning every COMPLETED Expo category — Gold/Silver medal
  // winners only, grouped by category. Reads every expo bracket straight
  // from Firebase in one shot (mirrors BRACKET's equivalent in bracket.js
  // for the Official system) rather than relying on this.currentBracket,
  // which only ever holds the ONE category currently open.
  // Returns [{ category, gender, ageCategory, weightCategory,
  // rows: [{ playerName, medal, teamName }] }] — one group per COMPLETED
  // Expo category (= one bracket) that also passes the active Gender/
  // Category/Weight filters (see _categoryMatchesActiveFilters() — the
  // exact same check the on-screen category list uses, so a filtered
  // download always matches exactly what's currently visible), ordered
  // Gender → Age Category → Weight (ascending) so the result sheet reads
  // sequentially instead of plain alphabetically (mirrors BRACKET's
  // equivalent in bracket.js; see CATEGORY_LOGIC's *SortIndex/*SortKey
  // helpers in category-logic.js). With no filters active (all 'all'),
  // every completed category is included — unchanged from before. teamName
  // falls back to centerName the same way the rest of the app already does.
  async _collectAllCategoryMedalGroups() {
    const bracketsSnap = await dbGet(dbRef(database, 'expoBrackets'));
    const allBrackets = bracketsSnap.exists() ? bracketsSnap.val() : {};
    const weightCategoriesConfig = await this._getWeightCategoriesConfig();

    const categoryKeys = Object.keys(this.categories)
      .filter(key => this._categoryMatchesActiveFilters(this.categories[key]))
      .sort((a, b) => {
        const ca = this.categories[a], cb = this.categories[b];
        const genderDiff = CATEGORY_LOGIC.genderSortIndex(ca.gender) - CATEGORY_LOGIC.genderSortIndex(cb.gender);
        if (genderDiff !== 0) return genderDiff;
        const ageDiff = CATEGORY_LOGIC.ageCategorySortIndex(ca.ageCategory) - CATEGORY_LOGIC.ageCategorySortIndex(cb.ageCategory);
        if (ageDiff !== 0) return ageDiff;
        const weightDiff = CATEGORY_LOGIC.weightCategorySortKey(ca.gender, ca.ageCategory, ca.weightCategory, weightCategoriesConfig)
          - CATEGORY_LOGIC.weightCategorySortKey(cb.gender, cb.ageCategory, cb.weightCategory, weightCategoriesConfig);
        if (weightDiff !== 0) return weightDiff;
        return ca.weightCategory.localeCompare(cb.weightCategory); // stable tie-break for unmatched labels
      });

    const groups = [];
    categoryKeys.forEach(key => {
      const bracketData = allBrackets[key];
      if (!bracketData || bracketData.status !== 'complete') return;

      const cat = this.categories[key];
      const categoryLabel = `${cat.gender} ${cat.ageCategory} - ${cat.weightCategory}`;
      const medalRows = this.buildRankingsFor(bracketData)
        .filter(r => r.medal)
        .map(r => ({
          playerName: r.playerName,
          medal: r.medal,
          teamName: r.teamName || r.centerName || '',
        }));

      if (medalRows.length > 0) {
        groups.push({
          category: categoryLabel,
          gender: cat.gender,
          ageCategory: cat.ageCategory,
          weightCategory: cat.weightCategory,
          rows: medalRows,
        });
      }
    });

    return groups;
  },

  async downloadAllCategoriesResults(format) {
    this.closeDownloadAllMenu?.();

    if (format === 'excel' && typeof XLSX === 'undefined') {
      if (typeof MODAL !== 'undefined') MODAL.error('Excel library not loaded.');
      return;
    }
    if (format === 'pdf' && typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
      if (typeof MODAL !== 'undefined') MODAL.error('PDF library not loaded.');
      return;
    }

    let groups;
    try {
      groups = await this._collectAllCategoryMedalGroups();
    } catch (err) {
      console.error('❌ Error collecting all-category Expo results:', err);
      if (typeof MODAL !== 'undefined') MODAL.error('Error loading category results: ' + err.message);
      return;
    }

    const filterSummary = this._activeFilterSummary();

    if (groups.length === 0) {
      if (typeof MODAL !== 'undefined') {
        MODAL.warning(filterSummary
          ? `No completed Expo categories match the selected filters (${filterSummary}).`
          : 'No completed Expo categories with medal results yet.');
      }
      return;
    }

    const champTitle = document.title.replace(' - Bracket Management', '').trim() || 'Tournament';
    const dateStr = new Date().toISOString().slice(0, 10);
    // Only tag the filename/heading when a filter is actually active, so the
    // unfiltered "download everything" output is unchanged from before.
    const filterFileTag = filterSummary ? `_${filterSummary.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')}` : '';
    const filterHeadingTag = filterSummary ? ` — ${filterSummary}` : '';

    if (format === 'excel') {
      this._writeAllResultsWorkbook(groups, `All_Expo_Category_Results${filterFileTag}_${dateStr}.xlsx`, 'Expo Results', 'Expo');
      return;
    }

    this._writeAllResultsPDF(groups, champTitle, `All_Expo_Category_Results${filterFileTag}_${dateStr}.pdf`, `Expo Kyorugi Results${filterHeadingTag}`, 'Expo');
  },

  // Excel: ONE flat, filterable table (Match Type / Event / Gender /
  // Category / Weight-Division / Player Name / Medal / Team Name / Remark)
  // — every row repeats its group columns instead of merged category-
  // heading rows, so Excel's built-in AutoFilter/sort actually works
  // (merged cells + blank spacer rows break both). Rows stay in the exact
  // Match Type → Event → Gender → Category → Weight → bracket order
  // _collectAllCategoryMedalGroups() already sorted groups into; light
  // alternating shading bands each category group so it still reads as
  // "one category block after another" at a glance. Remark is left empty
  // for the tournament desk to fill in by hand. Mirrors
  // BRACKET._writeAllResultsWorkbook() in bracket.js — kept as a separate
  // copy since the two systems are intentionally independent.
  _writeAllResultsWorkbook(groups, fileName, sheetName, matchTypeLabel) {
    const WHITE = 'FFFFFF', LTGRAY = 'EDEFF2', BAND = 'DCE6F5';
    const fgFill = (hex) => ({ patternType: 'solid', fgColor: { rgb: hex } });
    const hdrStyle = { font: { bold: true, sz: 9, color: { rgb: WHITE } }, fill: fgFill('2C4A7C'), alignment: { horizontal: 'center', vertical: 'center' } };
    const cellStyle = (band) => ({ font: { sz: 9 }, fill: fgFill(band ? BAND : LTGRAY), alignment: { vertical: 'center' } });

    const ws = {};
    const HEADERS = ['Match Type', 'Event', 'Gender', 'Category', 'Weight / Division', 'Player Name', 'Medal', 'Team Name', 'Remark'];
    const COLS = HEADERS.length;
    let r = 0;
    const enc = (row, col) => XLSX.utils.encode_cell({ r: row, c: col });
    const setCell = (row, col, v, s) => { ws[enc(row, col)] = { v: v ?? '', t: typeof v === 'number' ? 'n' : 's', s: s || {} }; };

    HEADERS.forEach((h, c) => setCell(r, c, h, hdrStyle));
    r++;
    const dataStartRow = r;

    groups.forEach((group, gi) => {
      const band = gi % 2 === 1;
      group.rows.forEach(row => {
        setCell(r, 0, matchTypeLabel, cellStyle(band));
        setCell(r, 1, 'Kyorugi', cellStyle(band));
        setCell(r, 2, group.gender, cellStyle(band));
        setCell(r, 3, group.ageCategory, cellStyle(band));
        setCell(r, 4, group.weightCategory, cellStyle(band));
        setCell(r, 5, row.playerName, cellStyle(band));
        setCell(r, 6, row.medal, cellStyle(band));
        setCell(r, 7, row.teamName, cellStyle(band));
        setCell(r, 8, '', cellStyle(band)); // Remark — left blank
        r++;
      });
    });

    const lastRow = Math.max(r - 1, 0);
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: COLS - 1 } });
    ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 9 }, { wch: 14 }, { wch: 20 }, { wch: 28 }, { wch: 12 }, { wch: 28 }, { wch: 22 }];
    if (lastRow >= dataStartRow) {
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: COLS - 1 } }) };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
  },

  // PDF: one bordered table per category (Player Name / Medal / Team Name /
  // Remark), stacked one after another; a category whose table won't fit in
  // the remaining page space starts on a fresh page instead of splitting.
  // Each table's heading spells out Match Type • Event • Gender • Category •
  // Weight/Division so a category can never be mistaken for an adjacent one
  // while scanning the PDF. Long titles and long names/team names WRAP
  // within their own width (title within the page, each cell within its
  // column) rather than running off the page or overlapping the next
  // column — text is never shrunk or truncated, rows just grow taller to
  // fit. Mirrors BRACKET._writeAllResultsPDF() in bracket.js.
  _writeAllResultsPDF(groups, champTitle, fileName, headingSuffix, matchTypeLabel) {
    const { jsPDF: JsPDFCtor } = window.jspdf || window;
    const doc = new JsPDFCtor({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const ML = 40, MR = 40, PAGE_W = 595, BOTTOM = 800;
    const contentW = PAGE_W - ML - MR;
    const tableW = contentW;
    const colW = [tableW * 0.32, tableW * 0.16, tableW * 0.32, tableW * 0.20];
    const CELL_PAD = 6, LINE_H = 12, HEADER_H = 22, ROW_MIN_H = 20;
    let y = 44;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    const titleLines = doc.splitTextToSize(`${champTitle} — ${headingSuffix}`, contentW);
    titleLines.forEach(line => { doc.text(line, ML, y); y += 19; });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, ML, y);
    y += 26;

    const drawTable = (group, rows) => {
      const categoryLabel = `${matchTypeLabel} • Kyorugi • ${group.gender} • ${group.ageCategory} • ${group.weightCategory}`;
      // Pre-wrap every cell within its own column width so each row's
      // height (and the table's total height, needed for the page-break
      // check below) is known before anything is drawn.
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      const wrapped = rows.map(row => {
        const cellLines = [row.playerName, row.medal, row.teamName, ''].map((val, i) =>
          doc.splitTextToSize(String(val || ''), colW[i] - CELL_PAD * 2));
        const rowH = Math.max(ROW_MIN_H, Math.max(...cellLines.map(l => l.length)) * LINE_H + 8);
        return { cellLines, rowH };
      });
      const tableH = HEADER_H + wrapped.reduce((sum, w) => sum + w.rowH, 0);
      const headingLines = doc.splitTextToSize(categoryLabel, contentW);
      const neededH = headingLines.length * 15 + 6 + tableH; // category heading + table
      if (y + neededH > BOTTOM && y > 44) { doc.addPage(); y = 44; }

      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      headingLines.forEach(line => { doc.text(line, ML, y); y += 15; });
      y += 1;
      const tableTop = y;

      // Header row
      doc.setFillColor(23, 48, 94);
      doc.rect(ML, y, tableW, HEADER_H, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      let cx = ML;
      ['Player Name', 'Medal', 'Team Name', 'Remark'].forEach((h, i) => {
        doc.text(h, cx + CELL_PAD, y + HEADER_H / 2, { baseline: 'middle' });
        cx += colW[i];
      });
      doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.5);
      doc.rect(ML, y, tableW, HEADER_H);
      y += HEADER_H;

      // Data rows
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      wrapped.forEach((w, ri) => {
        if (ri % 2 === 1) { doc.setFillColor(240, 243, 248); doc.rect(ML, y, tableW, w.rowH, 'F'); }
        doc.setTextColor(20, 20, 20);
        cx = ML;
        w.cellLines.forEach((lines, i) => {
          lines.forEach((line, li) => {
            doc.text(line, cx + CELL_PAD, y + CELL_PAD + 6 + li * LINE_H);
          });
          cx += colW[i];
        });
        doc.setDrawColor(200, 200, 200);
        doc.rect(ML, y, tableW, w.rowH);
        y += w.rowH;
      });

      // Column separators for the whole table block
      doc.setDrawColor(150, 150, 150);
      let sepX = ML;
      colW.forEach(w => { sepX += w; doc.line(sepX, tableTop, sepX, y); });

      y += 24; // gap before next category
    };

    groups.forEach(group => drawTable(group, group.rows));

    doc.save(fileName);
  },

  // Small popover next to the status-filter tabs offering the two export
  // formats for downloadAllCategoriesResults() — mirrors BRACKET's version
  // in bracket.js, kept local rather than extending MODAL since it's just
  // a two-item menu anchored to a button.
  toggleDownloadAllMenu(event) {
    event?.stopPropagation();
    const menu = document.getElementById('expoDownloadAllMenu');
    if (!menu) return;
    const opening = menu.style.display === 'none' || !menu.style.display;
    menu.style.display = opening ? 'flex' : 'none';
    if (opening) {
      const closeOnOutsideClick = (e) => {
        if (!menu.contains(e.target)) {
          menu.style.display = 'none';
          document.removeEventListener('click', closeOnOutsideClick);
        }
      };
      setTimeout(() => document.addEventListener('click', closeOnOutsideClick), 0);
    }
  },

  closeDownloadAllMenu() {
    const menu = document.getElementById('expoDownloadAllMenu');
    if (menu) menu.style.display = 'none';
  },

  // ── Excel / PDF exports (self-contained — uses the XLSX/jsPDF globals
  //    already loaded by admin/bracket.html for the Official system) ──────
  exportResultsToExcel() {
    if (typeof XLSX === 'undefined') {
      if (typeof MODAL !== 'undefined') MODAL.error('Excel library not loaded.');
      return;
    }
    const category = this.categories[this.currentCategory];
    const rankings = this.buildRankings();
    const wsData = [['Medal', 'Player Name', 'Center', 'Match #', 'Note']];
    rankings.forEach(r => wsData.push([r.medal, r.playerName, r.centerName || '', r.matchNumber || '', r.note || '']));
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Expo Results');
    const fileName = `Expo_Results_${category.gender}_${category.ageCategory}_${category.weightCategory}.xlsx`.replace(/\s+/g, '_');
    XLSX.writeFile(wb, fileName);
  },

  // Simple player roster for every player in the currently open Expo
  // category — just Player Name / Center / Team, not the bracket/fixture
  // layout. Available regardless of bracket status. Mirrors
  // BRACKET.downloadPlayerListExcel() in bracket.js for the Official system.
  downloadPlayerListExcel() {
    if (typeof XLSX === 'undefined') {
      if (typeof MODAL !== 'undefined') MODAL.error('Excel library not loaded.');
      return;
    }
    const category = this.categories[this.currentCategory];
    if (!category || !category.players || category.players.length === 0) {
      if (typeof MODAL !== 'undefined') MODAL.warning('No players in this category.');
      return;
    }
    const categoryLabel = `${category.gender} ${category.ageCategory} - ${category.weightCategory}`;

    const rows = [['Player Name', 'Center / Club', 'Team']];
    [...category.players]
      .sort((a, b) => (a.playerName || '').localeCompare(b.playerName || ''))
      .forEach(p => {
        rows.push([p.playerName || '', p.centerName || '', p.teamName || '']);
      });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 20 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Players');

    const safeLabel = categoryLabel.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_');
    const fileName = `Players_${safeLabel}_Expo_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  },

  // Final Gold/Silver placements — only meaningful once every match is done.
  downloadResultsPDF() {
    const JsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || (typeof jsPDF !== 'undefined' ? jsPDF : null);
    if (!JsPDFCtor) {
      if (typeof MODAL !== 'undefined') MODAL.error('PDF library not loaded.');
      return;
    }
    const category = this.categories[this.currentCategory];
    const doc = new JsPDFCtor({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    let y = 40;
    doc.setFontSize(16);
    doc.text(`Expo Results - ${category.gender} ${category.ageCategory} (${category.weightCategory})`, 40, y);
    y += 30;
    doc.setFontSize(11);
    this.buildRankings().forEach(r => {
      doc.text(`${r.medal}: ${r.playerName}${r.centerName ? ' (' + r.centerName + ')' : ''}${r.note ? ' - ' + r.note : ''}`, 40, y);
      y += 20;
      if (y > 760) { doc.addPage(); y = 40; }
    });
    const fileName = `Expo_Results_${category.gender}_${category.ageCategory}_${category.weightCategory}.pdf`.replace(/\s+/g, '_');
    doc.save(fileName);
  },

  // Pre-match fixture as a PDF — available as soon as the Expo bracket is
  // generated, no completion required. Visually mirrors bracket.js's
  // bracket-tree PDF (seed boxes, player cells, connector arms, a colored
  // outcome box) but structured for Expo's rules: every match is its own
  // independent pair — no rounds, no advancement — so each pair connects
  // straight to a GOLD outcome box instead of feeding into further rounds.
  // A local, self-contained adaptation — does not call into bracket.js.
  downloadFixturePDF() {
    const JsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || (typeof jsPDF !== 'undefined' ? jsPDF : null);
    if (!JsPDFCtor) {
      if (typeof MODAL !== 'undefined') MODAL.error('PDF library not loaded.');
      return;
    }
    if (!this.currentBracket) {
      if (typeof MODAL !== 'undefined') MODAL.warning('No bracket loaded.');
      return;
    }

    const category = this.categories[this.currentCategory];
    const matches = this.currentBracket.matches || [];
    const byes = this.currentBracket.byes || [];
    const champTitle = document.title.replace(' - Bracket Management', '').trim() || 'Tournament';
    const categoryLabel = `${category.gender} ${category.ageCategory} - ${category.weightCategory} (Expo)`;

    const doc = new JsPDFCtor({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const PW = 297, PH = 210;
    const ML = 10, MT = 10, MB = 10;
    const W = PW - ML * 2;

    // Colors — same palette as bracket.js's fixture PDF for visual consistency
    const NAVY  = [23, 48, 94];
    const WHITE = [255, 255, 255];
    const LTBG  = [235, 240, 248];
    const GREEN = [21, 87, 36];
    const GOLD  = [201, 168, 76];
    const LINE  = [26, 58, 107];
    const GRAY  = [80, 80, 80];
    const BYEBG = [245, 240, 220];

    const sf = c => doc.setFillColor(c[0], c[1], c[2]);
    const ss = c => doc.setDrawColor(c[0], c[1], c[2]);
    const st = c => doc.setTextColor(c[0], c[1], c[2]);
    const ln = (x1, y1, x2, y2, lw, c) => {
      ss(c || LINE); doc.setLineWidth(lw || 0.3); doc.line(x1, y1, x2, y2);
    };
    const txt = (t, x, y, sz, bold, col, align) => {
      doc.setFontSize(sz || 9);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      st(col || [0, 0, 0]);
      doc.text(String(t), x, y, { align: align || 'left', baseline: 'middle' });
    };
    // Player cell: bg fill + 3-sided border (top, left, bottom — open right)
    const drawCell = (x, y, w, h, name, bg, bold) => {
      sf(bg || LTBG); doc.rect(x, y, w, h, 'F');
      ln(x, y, x + w, y, 0.35);
      ln(x, y, x, y + h, 0.35);
      ln(x, y + h, x + w, y + h, 0.35);
      if (name) {
        const s = doc.splitTextToSize(name, w - 3)[0];
        txt(s, x + 2, y + h / 2, 7.5, bold || false, [25, 25, 25], 'left');
      }
    };
    const drawSeed = (x, y, w, h, seed) => {
      sf(NAVY); doc.rect(x, y, w, h, 'F');
      if (seed != null) txt(String(seed), x + w / 2, y + h / 2, 6.5, true, WHITE, 'center');
    };
    const drawJunc = (cx, cy, sz, label) => {
      const hs = sz / 2;
      sf(NAVY); doc.rect(cx - hs, cy - hs, sz, sz, 'F');
      if (label != null) txt(String(label), cx, cy, 5, true, WHITE, 'center');
    };

    // ── LAYOUT ── one row per match: [SEED][PLAYER CELL][ARM]→[GOLD BOX]
    const HEADER_H = 18, GOLD_LINE_H = 0.8, LABEL_H = 7, FOOTER_H = 10;
    const CONTENT_TOP = MT + HEADER_H + GOLD_LINE_H + LABEL_H + 2;
    const CONTENT_H = PH - CONTENT_TOP - MB - FOOTER_H;
    const SEED_W = 7, ARM_W = 12, JUNC_SZ = 5, GOLD_W = 55;
    const ROUND_W = W - SEED_W - ARM_W - GOLD_W;
    const roundX = ML + SEED_W;
    const armCX = roundX + ROUND_W + ARM_W / 2;
    const goldX = armCX + JUNC_SZ / 2 + 3;
    const goldBoxW = GOLD_W - 6;

    const MATCH_H = 24; // fixed per-match block height — consistent sizing regardless of category size
    const rowsPerPage = Math.max(1, Math.floor(CONTENT_H / MATCH_H));

    const drawPageChrome = () => {
      sf(NAVY); doc.rect(ML, MT, W, HEADER_H, 'F');
      txt(champTitle.toUpperCase(), PW / 2, MT + HEADER_H * 0.37, 14, true, WHITE, 'center');
      txt(categoryLabel.toUpperCase(), PW / 2, MT + HEADER_H * 0.74, 9, false, [190, 205, 230], 'center');
      sf(GOLD); doc.rect(ML, MT + HEADER_H, W, GOLD_LINE_H, 'F');

      const labelY = MT + HEADER_H + GOLD_LINE_H + LABEL_H / 2 + 0.5;
      txt('PLAYERS (DIRECT MATCH)', roundX + ROUND_W / 2, labelY, 7.5, true, NAVY, 'center');
      txt('GOLD (WINNER)', goldX + goldBoxW / 2, labelY, 7.5, true, NAVY, 'center');
      ln(ML, MT + HEADER_H + GOLD_LINE_H + LABEL_H, ML + W,
        MT + HEADER_H + GOLD_LINE_H + LABEL_H, 0.25, [180, 180, 180]);

      const footerY = PH - FOOTER_H / 2 - 2;
      ln(ML, PH - FOOTER_H - 2, ML + W, PH - FOOTER_H - 2, 0.3, [150, 150, 150]);
      txt(`${champTitle}  |  ${categoryLabel}`, ML, footerY, 7, false, GRAY, 'left');
      txt(`Generated: ${new Date().toLocaleDateString('en-IN')}`, ML + W, footerY, 7, false, GRAY, 'right');
    };

    // Matches first, then byes (auto-Gold walkovers) — one flat ordered list
    // so both share the same page-break logic below.
    const blocks = matches.map((m, idx) => ({ type: 'match', match: m, num: idx + 1 }))
      .concat(byes.map((p, idx) => ({ type: 'bye', player: p, seed: matches.length * 2 + idx + 1 })));

    if (blocks.length === 0) {
      drawPageChrome();
      txt('No matches generated yet.', PW / 2, CONTENT_TOP + 10, 10, false, GRAY, 'center');
    }

    blocks.forEach((block, i) => {
      if (i % rowsPerPage === 0) {
        if (i > 0) doc.addPage();
        drawPageChrome();
      }
      const blockTop = CONTENT_TOP + (i % rowsPerPage) * MATCH_H;

      if (block.type === 'match') {
        const match = block.match;
        const pH = Math.min(MATCH_H * 0.34, 9.5);
        const gap = MATCH_H - 2 * pH;
        const yP1 = blockTop + gap * 0.25;
        const yP2 = yP1 + pH + gap * 0.5;
        const midY = (yP1 + pH + yP2) / 2;

        drawSeed(ML, yP1, SEED_W, pH, block.num * 2 - 1);
        drawSeed(ML, yP2, SEED_W, pH, block.num * 2);

        const n1 = match.player1 ? match.player1.playerName + (match.player1.centerName ? ` (${match.player1.centerName})` : '') : 'TBD';
        const n2 = match.player2 ? match.player2.playerName + (match.player2.centerName ? ` (${match.player2.centerName})` : '') : 'TBD';
        drawCell(roundX, yP1, ROUND_W, pH, n1);
        drawCell(roundX, yP2, ROUND_W, pH, n2);

        ln(roundX + ROUND_W, yP1 + pH / 2, armCX, yP1 + pH / 2);
        ln(roundX + ROUND_W, yP2 + pH / 2, armCX, yP2 + pH / 2);
        ln(armCX, yP1 + pH / 2, armCX, yP2 + pH / 2);
        drawJunc(armCX, midY, JUNC_SZ, block.num);

        const winner = match.status === 'completed' && match.winner
          ? (match.winner === match.player1?.id ? match.player1 : match.player2)
          : null;
        if (winner) {
          sf(GREEN); doc.rect(goldX, midY - 5, goldBoxW, 10, 'F');
          txt(winner.playerName, goldX + goldBoxW / 2, midY, 8, true, WHITE, 'center');
          ln(armCX + JUNC_SZ / 2, midY, goldX, midY, 0.3, GREEN);
        } else {
          ln(armCX + JUNC_SZ / 2, midY, goldX + goldBoxW, midY, 0.3, LINE);
        }
      } else {
        // BYE — single player, automatic Gold (no opponent to pair with)
        const pH = Math.min(MATCH_H * 0.34, 9.5);
        const y = blockTop + (MATCH_H - pH) / 2;
        const midY = y + pH / 2;

        drawSeed(ML, y, SEED_W, pH, block.seed);
        const name = block.player.playerName + (block.player.centerName ? ` (${block.player.centerName})` : '') + ' — BYE';
        drawCell(roundX, y, ROUND_W, pH, name, BYEBG, true);

        ln(roundX + ROUND_W, midY, armCX, midY);
        drawJunc(armCX, midY, JUNC_SZ, null);

        sf(GREEN); doc.rect(goldX, midY - 5, goldBoxW, 10, 'F');
        txt(block.player.playerName, goldX + goldBoxW / 2, midY, 8, true, WHITE, 'center');
      }
    });

    const safeKey = this.currentCategory.replace(/[^a-zA-Z0-9]/g, '_');
    doc.save(`Expo_Fixture_${safeKey}_${new Date().toISOString().slice(0, 10)}.pdf`);
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BRACKET STATUS & COURT ASSIGNMENT — exclusive per-court locking
  // Mirrors bracket.js's Official implementation exactly, using its own
  // isolated node (bracketLocks/expo/{categoryKey}) so an Official and an
  // Expo bracket that happen to share the same categoryKey string never
  // collide with each other's lock. See bracket.js for the full design
  // rationale (separate node so saveBracket()/archival need zero changes;
  // admin/judge bypass; transaction-based claim to avoid a same-instant
  // double-open race).
  // ═══════════════════════════════════════════════════════════════════════

  // Defense-in-depth court-assignment guard — mirrors bracket.js's
  // _assertCategoryAssignedToMe() exactly (see there for the full
  // rationale). Called before the lock claim in openCategory().
  async _assertCategoryAssignedToMe(categoryKey) {
    if (sessionStorage.getItem('userRole') !== 'referee') return true;
    const myCourt = String(sessionStorage.getItem('courtNumber') || '').trim();
    if (!myCourt) return true;

    try {
      const snap = await dbGet(dbRef(database, `bracketAssignments/expo/${categoryKey}`));
      const assignment = snap.exists() ? snap.val() : null;
      if (!assignment || String(assignment.courtNumber).trim() !== myCourt) {
        const msg = 'This bracket is not assigned to your court.';
        if (typeof MODAL !== 'undefined') MODAL.error(msg);
        else alert(msg);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('⚠️ Could not verify Expo bracket assignment (blocking, fail-closed):', err.message);
      const msg = 'Could not verify this bracket is assigned to you — please check your connection and try again.';
      if (typeof MODAL !== 'undefined') MODAL.error(msg);
      else alert(msg);
      return false;
    }
  },

  async _tryClaimCourtLock(categoryKey) {
    // Gate on an ACTUAL referee session, not merely a non-empty courtNumber
    // key — see bracket.js's _tryClaimCourtLock for the full explanation
    // (a tab that was a referee earlier and then logged into admin/judge in
    // the same tab without an explicit logout keeps its old courtNumber
    // sitting in storage, since login pages only ever add keys and never
    // sessionStorage.clear() first).
    if (sessionStorage.getItem('userRole') !== 'referee') return true;
    const assignedCourt = String(sessionStorage.getItem('courtNumber') || '').trim();
    if (!assignedCourt) return true;

    const lock = await this._acquireBracketLock(categoryKey, assignedCourt);
    if (!lock.granted) {
      const msg = `This bracket is currently being managed by Court ${lock.courtNumber}.`;
      if (typeof MODAL !== 'undefined') MODAL.error(msg);
      else alert(msg);
      return false;
    }
    this._lockedCourtNumber = assignedCourt;
    return true;
  },

  async _acquireBracketLock(categoryKey, courtNumber) {
    if (typeof dbRunTransaction !== 'function') {
      console.warn('⚠️ dbRunTransaction unavailable — Expo bracket lock not enforced this session.');
      return { granted: true };
    }
    try {
      const lockRef = dbRef(database, `bracketLocks/expo/${categoryKey}`);
      const result = await dbRunTransaction(lockRef, (current) => {
        if (current && current.courtNumber && current.courtNumber !== courtNumber) {
          return current; // someone else already holds it — commit a no-op, don't overwrite
        }
        return { courtNumber, openedAt: Date.now() };
      });
      const finalVal = result.snapshot.val();
      if (finalVal && finalVal.courtNumber && finalVal.courtNumber !== courtNumber) {
        return { granted: false, courtNumber: finalVal.courtNumber };
      }
      try { await dbOnDisconnect(lockRef).remove(); } catch (_) { /* non-fatal */ }
      return { granted: true };
    } catch (err) {
      console.warn('⚠️ Expo bracket lock check failed (non-fatal) — proceeding without it:', err.message);
      return { granted: true };
    }
  },

  async _releaseBracketLock(categoryKey, courtNumber) {
    try {
      const lockRef = dbRef(database, `bracketLocks/expo/${categoryKey}`);
      const snap = await dbGet(lockRef);
      if (snap.exists() && snap.val()?.courtNumber === courtNumber) {
        await dbRemove(lockRef);
      }
    } catch (err) {
      console.warn('⚠️ Could not release Expo bracket lock (non-fatal):', err.message);
    }
  },

  _releaseLockSync() {
    if (!this._lockedCourtNumber || !this.currentCategory) return;
    try {
      dbRemove(dbRef(database, `bracketLocks/expo/${this.currentCategory}`));
    } catch (_) { /* onDisconnect will handle it */ }
  }
};

window.EXPO_BRACKET = EXPO_BRACKET;

window.addEventListener('pagehide', () => EXPO_BRACKET._releaseLockSync());
window.addEventListener('beforeunload', () => EXPO_BRACKET._releaseLockSync());
