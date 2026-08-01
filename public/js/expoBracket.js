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
  currentCategoryFilter: 'all',
  currentAgeCategoryFilter: 'all',
  currentSearchTerm: '',
  categoryStatuses: {},
  categoriesRenderRequestId: 0,
  _initialized: false,
  _liveCourtNumber: null, // court this session registered live presence under, if any
  bracketListener: null,
  categoriesListener: null,

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

  // ── Filters ────────────────────────────────────────────────────────────
  async filterByStatus(status) {
    this.currentFilter = status;
    document.querySelectorAll('.expo-status-tab').forEach(tab => tab.classList.remove('active'));
    const tab = document.querySelector(`.expo-status-tab[data-filter="${status}"]`);
    if (tab) tab.classList.add('active');
    await this.renderCategories();
  },

  async filterByCategory(categoryKey) {
    this.currentCategoryFilter = categoryKey || 'all';
    await this.renderCategories();
  },

  async filterByAgeCategory(age) {
    this.currentAgeCategoryFilter = age || 'all';
    await this.renderCategories();
  },

  async filterBySearch(term) {
    this.currentSearchTerm = (term || '').trim().toLowerCase();
    await this.renderCategories();
  },

  syncCategoryFilterControl() {
    const select = document.getElementById('expoCategoryFilterSelect');
    if (!select) return;
    const options = Object.keys(this.categories)
      .map(key => ({ key, label: `${this.categories[key].gender} ${this.categories[key].ageCategory} - ${this.categories[key].weightCategory}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
    let html = '<option value="all">All Categories</option>';
    options.forEach(o => { html += `<option value="${o.key}">${o.label}</option>`; });
    select.innerHTML = html;
    if (this.currentCategoryFilter !== 'all' && !this.categories[this.currentCategoryFilter]) {
      this.currentCategoryFilter = 'all';
    }
    select.value = this.currentCategoryFilter;
  },

  syncAgeCategoryFilter() {
    const container = document.getElementById('expoAgeCategoryFilter');
    if (!container) return;
    const ages = [...new Set(Object.values(this.categories).map(c => c.ageCategory))].sort();
    let html = `<button class="status-tab${this.currentAgeCategoryFilter === 'all' ? ' active' : ''}" onclick="EXPO_BRACKET.filterByAgeCategory('all')">All</button>`;
    ages.forEach(age => {
      const active = this.currentAgeCategoryFilter === age ? ' active' : '';
      html += `<button class="status-tab${active}" onclick="EXPO_BRACKET.filterByAgeCategory('${age}')">${age}</button>`;
    });
    container.innerHTML = html;
  },

  // ── Category list rendering ────────────────────────────────────────────
  async renderCategories() {
    const container = document.getElementById('expoCategoriesList');
    if (!container) return;

    this.syncCategoryFilterControl();
    this.syncAgeCategoryFilter();

    const renderRequestId = ++this.categoriesRenderRequestId;

    try {
      const bracketsSnap = await dbGet(dbRef(database, 'expoBrackets'));
      const allBrackets = bracketsSnap.exists() ? bracketsSnap.val() : {};

      if (renderRequestId !== this.categoriesRenderRequestId) return;

      const cards = Object.keys(this.categories).map(key => {
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
        const matchesCategory = this.currentCategoryFilter === 'all' || this.currentCategoryFilter === key;
        const matchesAge = this.currentAgeCategoryFilter === 'all' || cat.ageCategory === this.currentAgeCategoryFilter;
        const matchesSearch = !this.currentSearchTerm ||
          cat.gender.toLowerCase().includes(this.currentSearchTerm) ||
          cat.ageCategory.toLowerCase().includes(this.currentSearchTerm) ||
          cat.weightCategory.toLowerCase().includes(this.currentSearchTerm) ||
          cat.players.some(p => (p.playerName || '').toLowerCase().includes(this.currentSearchTerm));

        if (!matchesStatus || !matchesCategory || !matchesAge || !matchesSearch) return null;

        let statusColor = 'var(--text-gray)';
        if (status === 'Completed') statusColor = 'var(--success-green)';
        else if (status === 'Live') statusColor = 'var(--warning-orange)';
        else if (status === 'Pending') statusColor = 'var(--accent-cyan)';

        return `
          <div class="category-card" onclick="EXPO_BRACKET.openCategory('${key}')">
            <h3>${cat.gender} ${cat.ageCategory}</h3>
            <p class="weight-label">${cat.weightCategory}</p>
            <p class="player-count">${playerCount} Player${playerCount !== 1 ? 's' : ''}</p>
            <div style="margin: 12px 0; padding: 8px; background: rgba(255, 255, 255, 0.05); border-radius: 6px; text-align: center;">
              <span style="color: ${statusColor}; font-weight: 700; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.5px;">${status === 'Live' ? '🔴 ' : ''}${status === 'Completed' ? '✅ ' : ''}${status === 'Pending' ? '⏳ ' : ''}${status}</span>
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
  // Consecutive pairing after a shuffle: [p0,p1], [p2,p3], ... A leftover
  // unpaired player becomes an automatic Gold (no match created).
  createExpoBracket(players) {
    const shuffled = this.shuffleFisherYates(players).map(p => this.compressPlayer(p));
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
    if (shuffled.length % 2 === 1) {
      byes.push(shuffled[shuffled.length - 1]);
    }

    return {
      playerCount: shuffled.length,
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
  setupCategoriesListener() {
    this.stopCategoriesListener();
    let debounceTimer = null;
    const bracketsRef = dbRef(database, 'expoBrackets');
    this.categoriesListener = dbOnValue(bracketsRef, () => {
      // Skip if the user is currently inside the bracket view
      const container = document.getElementById('expoBracketContainer');
      if (container && container.style.display === 'block') return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => this.renderCategories(), 500);
    });
    console.log('✅ Expo categories real-time listener active');
  },

  stopCategoriesListener() {
    if (this.categoriesListener) {
      this.categoriesListener();
      this.categoriesListener = null;
      console.log('✅ Expo categories listener stopped');
    }
  },

  // ── Open / close a category ────────────────────────────────────────────
  async openCategory(categoryKey) {
    this.currentCategory = categoryKey;
    const category = this.categories[categoryKey];
    if (!category) {
      if (typeof MODAL !== 'undefined') MODAL.error('Category not found');
      return;
    }

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

    const listEl = document.getElementById('expoCategoriesList');
    const containerEl = document.getElementById('expoBracketContainer');
    if (listEl) listEl.style.display = 'none';
    if (containerEl) containerEl.style.display = 'block';

    // Pause the categories-level listener — we no longer need it while inside
    // the bracket view — and start real-time sync for this specific bracket
    // (multi-court sync, matching the Official bracket's behavior).
    this.stopCategoriesListener();
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
    const category = this.categories[this.currentCategory];
    const matches = this.currentBracket.matches || [];
    const byes = this.currentBracket.byes || [];
    const isComplete = this.currentBracket.status === 'complete';

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
        <h2>${category.gender} ${category.ageCategory} — ${category.weightCategory} (Expo)</h2>
        <button class="btn-back" onclick="EXPO_BRACKET.closeCategory()">← Back to Categories</button>
        <button class="btn-secondary" onclick="EXPO_BRACKET.downloadFixturePDF()">📄 Download Fixture PDF</button>
        <button class="btn-secondary" onclick="EXPO_BRACKET.downloadPlayerListExcel()">📋 Download Player List (Excel)</button>
        ${isComplete ? `
          <button class="btn-secondary" onclick="EXPO_BRACKET.exportResultsToExcel()">📥 Export Results (Excel)</button>
          <button class="btn-secondary" onclick="EXPO_BRACKET.downloadResultsPDF()">📄 Download Results (PDF)</button>
        ` : ''}
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

  // ── Medals / rankings ───────────────────────────────────────────────────
  buildRankings() {
    if (!this.currentBracket) return [];
    const rankings = [];
    (this.currentBracket.matches || []).forEach((m, idx) => {
      if (m.status !== 'completed' || !m.winner) return;
      const winner = m.winner === m.player1.id ? m.player1 : m.player2;
      const loser = m.winner === m.player1.id ? m.player2 : m.player1;
      rankings.push({ ...winner, medal: 'Gold', matchNumber: idx + 1 });
      rankings.push({ ...loser, medal: 'Silver', matchNumber: idx + 1 });
    });
    (this.currentBracket.byes || []).forEach(p => {
      rankings.push({ ...p, medal: 'Gold', note: 'Walkover (no opponent)' });
    });
    return rankings;
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
  }
};

window.EXPO_BRACKET = EXPO_BRACKET;
