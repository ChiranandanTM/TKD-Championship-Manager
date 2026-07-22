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

  // Initialize the Expo system (called lazily the first time the Expo tab is opened)
  async init() {
    await this.loadPlayers();
    this.categorizePlayers();
    await this.renderCategories();
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

    const listEl = document.getElementById('expoCategoriesList');
    const containerEl = document.getElementById('expoBracketContainer');
    if (listEl) listEl.style.display = 'none';
    if (containerEl) containerEl.style.display = 'block';

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

  closeCategory() {
    // Referee is leaving the bracket entirely — the court disappears from
    // the Live Matches page (both Live and Upcoming) until reopened.
    if (typeof LIVE_PRESENCE !== 'undefined' && this._liveCourtNumber) {
      LIVE_PRESENCE.closeCourt(this._liveCourtNumber);
      this._liveCourtNumber = null;
    }

    this.currentCategory = null;
    this.currentBracket = null;
    const listEl = document.getElementById('expoCategoriesList');
    const containerEl = document.getElementById('expoBracketContainer');
    if (containerEl) containerEl.style.display = 'none';
    if (listEl) listEl.style.display = 'block';
    this.renderCategories();
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
        <button class="btn-secondary" onclick="EXPO_BRACKET.downloadFixtureExcel()">📥 Download Fixture (Excel)</button>
        ${isComplete ? `
          <button class="btn-secondary" onclick="EXPO_BRACKET.exportResultsToExcel()">📥 Export Results (Excel)</button>
          <button class="btn-secondary" onclick="EXPO_BRACKET.downloadFixturePDF()">📄 Download Results (PDF)</button>
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

  downloadFixtureExcel() {
    if (typeof XLSX === 'undefined') {
      if (typeof MODAL !== 'undefined') MODAL.error('Excel library not loaded.');
      return;
    }
    const category = this.categories[this.currentCategory];
    const matches = this.currentBracket.matches || [];
    const byes = this.currentBracket.byes || [];
    const wsData = [['Match #', 'Player 1', 'Center 1', 'Player 2', 'Center 2', 'Court']];
    matches.forEach((m, idx) => wsData.push([idx + 1, m.player1?.playerName || '', m.player1?.centerName || '', m.player2?.playerName || '', m.player2?.centerName || '', m.courtNumber || '']));
    byes.forEach(p => wsData.push(['BYE (Auto-Gold)', p.playerName, p.centerName || '', '', '', '']));
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Expo Fixture');
    const fileName = `Expo_Fixture_${category.gender}_${category.ageCategory}_${category.weightCategory}.xlsx`.replace(/\s+/g, '_');
    XLSX.writeFile(wb, fileName);
  },

  downloadFixturePDF() {
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
  }
};

window.EXPO_BRACKET = EXPO_BRACKET;
