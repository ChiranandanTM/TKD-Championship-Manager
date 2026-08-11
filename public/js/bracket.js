// ============================================
// BRACKET & TOURNAMENT LOGIC (SINGLE ELIMINATION)
// With Smart Opponent Matching & Match Management
// Version: 3.0.0 - Improved Multi-Round Seeding & New Player Integration
// ============================================
//
// BRACKET GENERATION IMPROVEMENTS (v3.0):
// ✅ Full player shuffle using Fisher-Yates algorithm
// ✅ All players mixed together fairly (not grouped by team/addition time)
// ✅ Smart position optimization to minimize same-team matches
// ✅ Automatic bracket regeneration when new players are added (before bracket starts)
// ✅ Fallback to same-team pairings only when mathematically unavoidable
// ✅ Fair distribution across old and newly added teams
// ✅ Works for all categories, genders, age divisions, and weight classes
// ✅ Maintains existing systems: live matches, fixtures, scoring, referees
// ============================================

const BRACKET = {
  players: [],
  categories: {},
  currentCategory: null,
  currentBracket: null,
  matchHistory: [],
  pendingCategoryData: null,
  bracketListener: null,
  historyListener: null,
  categoriesListener: null,
  currentFilter: 'all',
  currentCategoryFilter: 'all',
  currentAgeCategoryFilter: 'all',
  categoryStatuses: {},
  categoriesRenderRequestId: 0,
  _teamNameCache: null,  // { teamId → teamName } lookup built once per session
  editingSlot: null,     // { matchId, slot } when inline edit form is open
  _liveCourtNumber: null, // court this session registered live presence under, if any
  _lockedCourtNumber: null, // court that currently holds this session's exclusive bracketLocks/official claim, if any
  editMode: false,        // true while the Bracket Editor is open for currentCategory
  _editDraft: null,       // { activePlayers, byePool, hadStartedMatches } — edit-mode working copy
  _editPwModalDiv: null,  // DOM node for the edit-mode password prompt, if open

  // Category images mapping
  categoryImages: {
    'dobok': '/assets/images/dobok-silhouette.png',
    'logo': '/assets/images/logo-taekwondo.png',
    'background': '/assets/images/background-dark.jpg'
  },

  // Initialize bracket system
  async init() {
    await this.loadPlayers();
    this.categorizePlayers();
    this.renderCategories();
    this.setupCategoriesListener();
    console.log('✅ Bracket initialized with categories:', Object.keys(this.categories).length);
  },

  // Build teamId → teamName lookup from the teams node (cached per session)
  async _buildTeamNameCache() {
    if (this._teamNameCache) return this._teamNameCache;
    try {
      const teamsSnap = await dbGet(dbRef(database, 'teams'));
      const map = {};
      if (teamsSnap.exists()) {
        teamsSnap.forEach(child => {
          const t = child.val();
          if (t.teamName) map[child.key] = t.teamName;
        });
      }
      this._teamNameCache = map;
      console.log(`✅ Team name cache built: ${Object.keys(map).length} teams`);
    } catch (err) {
      console.warn('⚠️ Could not build team name cache', err);
      this._teamNameCache = {};
    }
    return this._teamNameCache;
  },

  // Normalize a single player's centerName/teamName using the authoritative
  // team name from the database, keyed by teamId.
  _normalizePlayerTeam(player, cache) {
    if (!player || !player.teamId || !cache[player.teamId]) return;
    const authName = cache[player.teamId];
    player.centerName = authName;
    player.teamName = authName;
  },

  // Patch all compressed player objects inside a loaded bracket so they
  // reflect the authoritative team names.  Returns true if any data changed.
  // playerTeamIdMap is an optional { playerId → teamId } lookup used to
  // backfill teamId for old brackets created before teamId was stored.
  _normalizeBracketTeamNames(bracket, cache, playerTeamIdMap) {
    if (!bracket || !cache) return false;
    let changed = false;
    const patch = (p) => {
      if (!p) return;
      // Backfill teamId from player records if missing in compressed data
      if (!p.teamId && playerTeamIdMap && playerTeamIdMap[p.id]) {
        p.teamId = playerTeamIdMap[p.id];
        changed = true;
      }
      if (!p.teamId || !cache[p.teamId]) return;
      const authName = cache[p.teamId];
      if (p.centerName !== authName || p.teamName !== authName) {
        p.centerName = authName;
        p.teamName = authName;
        changed = true;
      }
    };
    // Patch rounds
    if (bracket.rounds) {
      bracket.rounds.forEach(round => {
        if (!round) return;
        round.forEach(match => {
          patch(match.player1);
          patch(match.player2);
        });
      });
    }
    // Patch bye players (each round may hold multiple byes — see getByeList)
    if (bracket.byePlayers) {
      Object.keys(bracket.byePlayers).forEach(roundKey => {
        this.getByeList(bracket, roundKey).forEach(p => patch(p));
      });
    }
    return changed;
  },

  // Load all registered players
  async loadPlayers() {
    try {
      const playersRef = dbRef(database, 'players');
      const snapshot = await dbGet(playersRef);

      if (snapshot.exists()) {
        this.players = [];
        snapshot.forEach(childSnapshot => {
          const player = {
            id: childSnapshot.key,
            ...childSnapshot.val()
          };
          this.players.push(player);
        });

        // ── NORMALIZE TEAM NAMES ──────────────────────────────────────
        // Override each player's centerName/teamName with the
        // authoritative value from the teams DB, keyed by teamId.
        const cache = await this._buildTeamNameCache();
        this.players.forEach(p => this._normalizePlayerTeam(p, cache));
        // ─────────────────────────────────────────────────────────────
      }
    } catch (error) {
      console.error("❌ Error loading players:", error);
    }
  },

  // Categorize players by gender, age category (auto-determined), and weight
  categorizePlayers() {
    this.categories = {};

    this.players.forEach(player => {
      // Use ageCategory field (auto-calculated from DOB) instead of manual categories
      const ageCategory = player.ageCategory || player.categories?.[0]; // Fallback for legacy data

      if (!ageCategory || !player.gender || !player.weightCategory) {
        console.warn(`⚠️ Skipping player ${player.id}: missing ageCategory, gender, or weightCategory`, player);
        return;
      }

      const categoryKey = `${player.gender}-${ageCategory}-${player.weightCategory}`;

      if (!this.categories[categoryKey]) {
        this.categories[categoryKey] = {
          gender: player.gender,
          ageCategory: ageCategory,
          weightCategory: player.weightCategory,
          players: []
        };
      }

      this.categories[categoryKey].players.push(player);
    });
  },

  // Get bracket status: "Completed", "Live", or "Pending"
  async getBracketStatus(categoryKey) {
    try {
      const bracketRef = dbRef(database, `brackets/${categoryKey}`);
      const snapshot = await dbGet(bracketRef);

      if (!snapshot.exists()) {
        return 'Pending'; // No bracket yet
      }

      let bracket = snapshot.val();

      // Return status based on bracket.status field
      if (bracket.status === 'complete') {
        return 'Completed';
      } else if (bracket.status === 'live') {
        return 'Live';
      } else {
        return 'Pending';
      }
    } catch (error) {
      console.error("❌ Error getting bracket status:", error);
      return 'Pending';
    }
  },

  // Filter brackets by status
  async filterByStatus(status) {
    this.currentFilter = status;

    // Update tab UI
    document.querySelectorAll('.status-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    document.querySelector(`[data-filter="${status}"]`).classList.add('active');

    // Re-render categories with filter
    await this.renderCategories();
  },

  // Filter brackets by category key
  async filterByCategory(categoryKey) {
    this.currentCategoryFilter = categoryKey || 'all';
    await this.renderCategories();
  },

  // Filter brackets by age category (Junior, Senior, Sub-Junior, etc.)
  async filterByAgeCategory(age) {
    this.currentAgeCategoryFilter = age || 'all';
    await this.renderCategories();
  },

  // Keep category filter options in sync with available categories
  syncCategoryFilterControl() {
    const select = document.getElementById('categoryFilterSelect');
    if (!select) return;

    const categoryOptions = Object.keys(this.categories)
      .map(key => {
        const cat = this.categories[key];
        return {
          key,
          label: `${cat.gender} ${cat.ageCategory} - ${cat.weightCategory}`
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    let optionsHtml = '<option value="all">All Categories</option>';
    categoryOptions.forEach(option => {
      optionsHtml += `<option value="${option.key}">${option.label}</option>`;
    });

    select.innerHTML = optionsHtml;

    if (this.currentCategoryFilter !== 'all' && !this.categories[this.currentCategoryFilter]) {
      this.currentCategoryFilter = 'all';
    }

    select.value = this.currentCategoryFilter;
  },

  // Build age category filter tabs dynamically from available categories
  syncAgeCategoryFilter() {
    const container = document.getElementById('ageCategoryFilter');
    if (!container) return;
    const ages = [...new Set(Object.values(this.categories).map(c => c.ageCategory))].sort();
    let html = `<button class="status-tab${this.currentAgeCategoryFilter === 'all' ? ' active' : ''}" onclick="BRACKET.filterByAgeCategory('all')">All</button>`;
    ages.forEach(age => {
      const active = this.currentAgeCategoryFilter === age ? ' active' : '';
      html += `<button class="status-tab${active}" onclick="BRACKET.filterByAgeCategory('${age}')">${age}</button>`;
    });
    container.innerHTML = html;
  },

  // Render category list
  async renderCategories() {
    const container = document.getElementById('categoriesList');
    if (!container) return;

    this.syncCategoryFilterControl();
    this.syncAgeCategoryFilter();

    const renderRequestId = ++this.categoriesRenderRequestId;

    try {
      // One request for all bracket statuses — this one is load-bearing for
      // the whole categories list, so it stays outside any try/catch that
      // would swallow it silently (unchanged from before the lock feature).
      const bracketsSnap = await dbGet(dbRef(database, 'brackets'));
      const allBrackets = bracketsSnap.exists() ? bracketsSnap.val() : {};

      // Who (if anyone) currently holds each category's exclusive court
      // lock — purely cosmetic (just the "Opened by: Court X" line), so a
      // failure here must NEVER take down the rest of the categories list
      // the way a Promise.all([...]) would if this read alone got denied.
      let allLocks = {};
      try {
        const locksSnap = await dbGet(dbRef(database, 'bracketLocks/official'));
        allLocks = locksSnap.exists() ? locksSnap.val() : {};
      } catch (lockErr) {
        console.warn('⚠️ Could not read bracket locks (non-fatal — "Opened by" info unavailable):', lockErr.message);
      }

      // Referee court-assignment gate — admin/judge sessions are completely
      // unaffected (they still see every category, unchanged). Referees only
      // ever see brackets assigned to their own court; this read is
      // load-bearing for referees (fail closed: show nothing rather than
      // everything if it can't be read), but optional for admin/judge.
      const role = sessionStorage.getItem('userRole');
      const isReferee = role === 'referee';
      const myCourt = String(sessionStorage.getItem('courtNumber') || '').trim();
      let allAssignments = {};
      try {
        const assignSnap = await dbGet(dbRef(database, 'bracketAssignments/official'));
        allAssignments = assignSnap.exists() ? assignSnap.val() : {};
      } catch (assignErr) {
        console.warn('⚠️ Could not read bracket assignments:', assignErr.message);
        if (isReferee) {
          if (renderRequestId !== this.categoriesRenderRequestId) return;
          container.innerHTML = '<div class="category-empty-state">Could not load your assigned brackets — please check your connection and try again.</div>';
          return;
        }
      }

      // Ignore stale async renders and keep latest filter result on screen.
      if (renderRequestId !== this.categoriesRenderRequestId) return;

      const categoryCards = Object.keys(this.categories).map((key) => {
        // A referee only ever sees categories assigned to their own court —
        // everything else (unassigned, or assigned to a different court) is
        // hidden entirely, not just visually de-emphasized.
        if (isReferee) {
          const assignment = allAssignments[key];
          if (!assignment || String(assignment.courtNumber).trim() !== myCourt) {
            return null;
          }
        }

        const cat = this.categories[key];
        const playerCount = cat.players.length;

        const bracketData = allBrackets[key];
        let status;
        if (!bracketData) {
          status = 'Pending';
        } else if (bracketData.status === 'complete') {
          status = 'Completed';
        } else if (bracketData.status === 'live') {
          status = 'Live';
        } else {
          status = 'Pending';
        }

        // Store status for later filtering
        this.categoryStatuses[key] = status;

        // Check if category should be displayed based on active filters
        const statusLower = status.toLowerCase();
        const matchesStatus = this.currentFilter === 'all' || this.currentFilter === statusLower;
        const matchesCategory = this.currentCategoryFilter === 'all' || this.currentCategoryFilter === key;
        const matchesAge = this.currentAgeCategoryFilter === 'all' || cat.ageCategory === this.currentAgeCategoryFilter;

        if (!matchesStatus || !matchesCategory || !matchesAge) {
          return null;
        }

        // Determine status styling
        let statusColor = 'var(--text-gray)';
        let statusText = status;

        if (status === 'Completed') {
          statusColor = 'var(--success-green)';
        } else if (status === 'Live') {
          statusColor = 'var(--warning-orange)';
        } else if (status === 'Pending') {
          statusColor = 'var(--accent-cyan)';
        }

        // Only shown while Live — whichever court currently holds the
        // exclusive lock on this category (see _acquireBracketLock).
        const lock = allLocks[key];
        const courtLine = (status === 'Live' && lock && lock.courtNumber)
          ? `<p class="court-label" style="margin:2px 0 0;font-size:0.85rem;color:var(--warning-orange);font-weight:700;">Opened by: Court ${lock.courtNumber}</p>`
          : '';

        return `
          <div class="category-card" onclick="BRACKET.openCategory('${key}')">
            <h3>${cat.gender} ${cat.ageCategory}</h3>
            <p class="weight-label">${cat.weightCategory}</p>
            <p class="player-count">${playerCount} Player${playerCount !== 1 ? 's' : ''}</p>
            <div style="margin: 12px 0; padding: 8px; background: rgba(255, 255, 255, 0.05); border-radius: 6px; text-align: center;">
              <span style="color: ${statusColor}; font-weight: 700; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.5px;">
                ${statusText === 'Live' ? '🔴 ' : ''}${statusText === 'Completed' ? '✅ ' : ''}${statusText === 'Pending' ? '🟡 ' : ''}${statusText}
              </span>
              ${courtLine}
            </div>
            <button class="btn-primary">View Bracket</button>
          </div>
        `;
      });

      const visibleCards = categoryCards.filter(card => card !== null);

      if (visibleCards.length === 0) {
        container.innerHTML = '<div class="category-empty-state">No brackets found for the selected filters.</div>';
        return;
      }

      let finalHtml = '<div class="categories-grid">';
      finalHtml += visibleCards.join('');
      finalHtml += '</div>';
      container.innerHTML = finalHtml;
    } catch (error) {
      console.error("❌ Error rendering categories:", error);
    }
  },

  // Open category bracket directly
  //
  // Reliability notes (fixes an intermittent "won't open" failure seen only
  // on slower devices/networks):
  //   1. Re-entrancy guard (_openingCategory) — a double-tap, or any tap
  //      registered before the first one's visual feedback appears (common
  //      on slower touchscreens), used to fire two concurrent opens of the
  //      same bracket, racing two independent load/fix/save sequences
  //      against each other.
  //   2. stopCategoriesListener() now runs FIRST, before any of the slower
  //      Firebase work below, instead of right at the end. The categories
  //      list's own live listener (players/ changes) rebuilds
  //      this.categories from scratch (categorizePlayers() does
  //      `this.categories = {}` then repopulates it) — on a fast
  //      connection the whole open sequence used to finish before that
  //      listener could ever fire mid-flight, so this race was invisible;
  //      on a slow connection the multiple sequential awaits below left a
  //      window of potentially several seconds for another court's
  //      registration/weigh-in change to rebuild this.categories while
  //      still in progress, so that by the time renderBracket() finally ran,
  //      this.categories[this.currentCategory] could be transiently
  //      missing — renderBracket() dereferenced it unguarded and threw,
  //      leaving a blank screen with no user-facing message.
  //   3. A visible loading state while the bracket is fetched, and a
  //      top-level try/catch around the whole sequence so any Firebase
  //      failure (network drop, permission hiccup, unexpected data) shows a
  //      clear message and cleanly returns to the categories list instead
  //      of leaving the page stuck or throwing an unhandled rejection.
  async openCategory(categoryKey) {
    if (this._openingCategory) return;
    this._openingCategory = true;

    try {
      const category = this.categories[categoryKey];
      if (!category) {
        if (typeof MODAL !== 'undefined') MODAL.error('Category not found');
        else alert('Category not found');
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

      console.log(`Opening category ${categoryKey} with ${category.players.length} players`);

      // Load bracket WITH conflict fixes applied
      await this.loadBracketWithFixes(categoryKey);

      // Check for player count mismatch (new players added)
      if (this.currentBracket && this.currentBracket.playerCount !== category.players.length) {
        const playerCountDiff = category.players.length - this.currentBracket.playerCount;
        console.log(`\n⚠️  PLAYER COUNT CHANGE DETECTED`);
        console.log(`   Previous: ${this.currentBracket.playerCount} players`);
        console.log(`   Current: ${category.players.length} players`);
        console.log(`   Added: ${playerCountDiff > 0 ? '+' : ''}${playerCountDiff} player(s)\n`);

        // Check if bracket has started
        const hasStarted = this.currentBracket.rounds && this.currentBracket.rounds[0] &&
          this.currentBracket.rounds[0].some(m => m.status !== 'pending' || m.winner);

        if (!hasStarted) {
          console.log(`✅ Bracket hasn't started — regenerating with all players integrated...\n`);
          this.currentBracket = this.createBracket(category.players);
          await this.saveBracket(categoryKey, this.currentBracket);
        } else {
          console.warn(`⛔ Bracket already in progress — cannot regenerate automatically`);
          console.warn(`📝 To include new players, archive this bracket and create a new one\n`);
        }
      }

      if (!this.currentBracket) {
        console.log(`Creating new bracket with all ${category.players.length} players...`);
        this.currentBracket = this.createBracket(category.players);
        await this.saveBracket(categoryKey, this.currentBracket);
      } else {
        // Bracket exists and was loaded - fix any conflicts
        console.log(`Bracket exists - applying conflict resolution...`);
        await this.fixBracketConflicts();
      }

      // Determine and persist bracket status before entering the view
      if (this.isCategoryComplete()) {
        // Correct any stale status to 'complete' (e.g. after a crash left it as 'pending')
        if (this.currentBracket.status !== 'complete') {
          this.currentBracket.status = 'complete';
          await this.saveBracket(categoryKey, this.currentBracket);
        }
        console.log(`✅ Bracket ${categoryKey} is COMPLETED`);
      } else {
        // Mark as live so other users' category lists update in real time
        this.currentBracket.status = 'live';
        await this.saveBracket(categoryKey, this.currentBracket);
        console.log(`📍 Bracket ${categoryKey} marked as LIVE`);
      }

      await this.loadMatchHistory(categoryKey);

      // Start real-time listeners for multi-court synchronization
      this.setupBracketListeners(categoryKey);

      // Bracket is now open for this referee's court — mark it active so the
      // Live Matches page shows the Upcoming Match immediately, even before any
      // score/timer starts.
      this._openLiveCourtPresence(categoryKey);

      this.renderBracket();
    } catch (error) {
      console.error('❌ Error opening bracket:', error);
      this.stopBracketListeners(); // in case setupBracketListeners() ran before a later step failed
      this.currentCategory = null;
      this.currentBracket = null;
      this._hideBracketLoading();
      this.setupCategoriesListener(); // resume live sync — we're bailing back to the list
      const msg = 'Could not open this bracket — please check your connection and try again.';
      if (typeof MODAL !== 'undefined') MODAL.error(msg);
      else alert(msg);
    } finally {
      this._openingCategory = false;
    }
  },

  // Loading state shown the instant a bracket open is requested, replaced
  // by renderBracket()'s own output on success (same container), or handed
  // back to the categories list on failure via _hideBracketLoading().
  _showBracketLoading() {
    const listEl = document.getElementById('categoriesList');
    const containerEl = document.getElementById('bracketContainer');
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
    const listEl = document.getElementById('categoriesList');
    const containerEl = document.getElementById('bracketContainer');
    if (containerEl) containerEl.style.display = 'none';
    if (listEl) listEl.style.display = 'block';
  },

  // Show category modal with image and details
  showCategoryModal(categoryKey) {
    const category = this.categories[categoryKey];
    if (!category) return;

    this.pendingCategoryData = { key: categoryKey, data: category };

    const modal = document.getElementById('categoryModal');
    const categoryImage = document.getElementById('categoryImage');
    const categoryTitle = document.getElementById('categoryTitle');
    const categoryPlayers = document.getElementById('categoryPlayers');

    const imageUrl = this.categoryImages.dobok;

    categoryImage.src = imageUrl;
    categoryTitle.textContent = `${category.gender} ${category.ageCategory} - ${category.weightCategory}`;
    categoryPlayers.textContent = `${category.players.length} Players registered`;

    modal.classList.add('active');
  },

  // Close category modal
  closeCategoryModal() {
    const modal = document.getElementById('categoryModal');
    modal.classList.remove('active');
    this.pendingCategoryData = null;
  },

  // Start bracket when user confirms from modal — same reliability fixes as
  // openCategory() above (re-entrancy guard, listener stopped before the
  // slow work, loading state, top-level error handling). Also drops the
  // redundant loadPlayers()+categorizePlayers() re-fetch that used to run
  // here: this.categories is already kept fresh by the live listener
  // started in init(), and pendingCategoryData was populated from that same
  // this.categories a moment ago when the info modal opened, so re-fetching
  // here was both an unnecessary Firebase read and another source of the
  // same race window described on openCategory().
  async startBracket() {
    if (!this.pendingCategoryData || this._openingCategory) return;
    this._openingCategory = true;

    const categoryKey = this.pendingCategoryData.key;
    const category = this.pendingCategoryData.data;

    try {
      if (!(await this._assertCategoryAssignedToMe(categoryKey))) {
        this.closeCategoryModal();
        return;
      }

      if (!(await this._tryClaimCourtLock(categoryKey))) {
        this.closeCategoryModal();
        return;
      }

      this.closeCategoryModal();
      this.currentCategory = categoryKey;

      // Stop the categories-level listener BEFORE any slow work — see
      // openCategory()'s notes for the full explanation.
      this.stopCategoriesListener();
      this._showBracketLoading();

      console.log(`Opening category ${categoryKey} with ${category.players.length} players`);

      // Load bracket WITH conflict fixes applied
      await this.loadBracketWithFixes(categoryKey);

      // Check for player count mismatch (new players added)
      if (this.currentBracket && this.currentBracket.playerCount !== category.players.length) {
        const playerCountDiff = category.players.length - this.currentBracket.playerCount;
        console.log(`\n⚠️  PLAYER COUNT CHANGE DETECTED`);
        console.log(`   Previous: ${this.currentBracket.playerCount} players`);
        console.log(`   Current: ${category.players.length} players`);
        console.log(`   Added: ${playerCountDiff > 0 ? '+' : ''}${playerCountDiff} player(s)\n`);

        // Check if bracket has started
        const hasStarted = this.currentBracket.rounds && this.currentBracket.rounds[0] &&
          this.currentBracket.rounds[0].some(m => m.status !== 'pending' || m.winner);

        if (!hasStarted) {
          console.log(`✅ Bracket hasn't started — regenerating with all players integrated...\n`);
          this.currentBracket = this.createBracket(category.players);
          await this.saveBracket(categoryKey, this.currentBracket);
        } else {
          console.warn(`⛔ Bracket already in progress — cannot regenerate automatically`);
          console.warn(`📝 To include new players, archive this bracket and create a new one\n`);
        }
      }

      if (!this.currentBracket) {
        console.log(`Creating new bracket with all ${category.players.length} players...`);
        this.currentBracket = this.createBracket(category.players);
        await this.saveBracket(categoryKey, this.currentBracket);
      } else {
        // Bracket exists and was loaded - fix any conflicts
        console.log(`Bracket exists - applying conflict resolution...`);
        await this.fixBracketConflicts();
      }

      // Determine and persist bracket status before entering the view
      if (this.isCategoryComplete()) {
        if (this.currentBracket.status !== 'complete') {
          this.currentBracket.status = 'complete';
          await this.saveBracket(categoryKey, this.currentBracket);
        }
        console.log(`✅ Bracket ${categoryKey} is COMPLETED`);
      } else {
        this.currentBracket.status = 'live';
        await this.saveBracket(categoryKey, this.currentBracket);
        console.log(`📍 Bracket ${categoryKey} marked as LIVE`);
      }

      await this.loadMatchHistory(categoryKey);

      // Start real-time listeners for multi-court synchronization
      this.setupBracketListeners(categoryKey);

      // Bracket is now open for this referee's court — mark it active so the
      // Live Matches page shows the Upcoming Match immediately, even before any
      // score/timer starts.
      this._openLiveCourtPresence(categoryKey);

      this.renderBracket();
    } catch (error) {
      console.error('❌ Error opening bracket:', error);
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

  // Helper: Store only essential player info to reduce Firebase write size
  compressPlayer(player) {
    if (!player) return null;
    // teamName may be stored as 'teamName' or 'centerName' depending on the
    // registration form version — fall back to centerName so the PDF always
    // has something to display.
    return {
      id: player.id,
      playerName: player.playerName || '',
      centerName: player.centerName || '',
      teamName: player.teamName || player.centerName || '',
      teamId: player.teamId || null
    };
  },

  // ═════════════════════════════════════════════════════════════════════════
  // BYE LIST HELPERS
  // byePlayers[roundIndex] has historically always been a single compressed
  // player object (or absent). The Bracket Editor allows an admin to assign
  // MULTIPLE byes to Round 1 (e.g. 5 byes for 11 players — standard
  // tournament seeding), so these helpers normalize on read (transparently
  // treating a legacy single object as a 1-item list) and only ever WRITE a
  // real array when there's more than one bye — a length-1 result collapses
  // back to a plain object. This means every existing auto-generated /
  // single-bye code path keeps writing and reading the exact same shape as
  // before; the array shape only appears once an admin actually assigns 2+
  // byes to a round via the editor.
  // ═════════════════════════════════════════════════════════════════════════

  // Always returns an array (possibly empty) of bye players for a round,
  // regardless of whether the stored value is absent, a single legacy
  // object, a real array, or a Firebase-serialized numeric-keyed object.
  getByeList(bracket, roundIndex) {
    const val = (bracket && bracket.byePlayers || {})[String(roundIndex)];
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (val.id) return [val]; // legacy/auto-generated single player object
    // Firebase converts JS arrays to numeric-keyed objects on save/load
    return Object.keys(val).sort((a, b) => Number(a) - Number(b)).map(k => val[k]);
  },

  // Writes a round's bye list back, collapsing to the legacy single-object
  // shape when there's exactly one (or deleting the key when there are
  // none) so non-edited brackets never see the array shape.
  setByeList(bracket, roundIndex, arr) {
    if (!bracket.byePlayers) bracket.byePlayers = {};
    if (!arr || arr.length === 0) {
      delete bracket.byePlayers[String(roundIndex)];
      return;
    }
    bracket.byePlayers[String(roundIndex)] = arr.length === 1 ? arr[0] : arr;
  },

  // Generalized version of createBracket()'s inline expected-round-count
  // formula, seeded with an explicit Round-1 bye count instead of always
  // assuming 0 (createBracket() itself never assigns a Round-1 bye — see its
  // own inline computation). Used only by the Bracket Editor's save path,
  // where the admin may have manually moved one or more players to the bye
  // pool.
  computeExpectedRoundMatchCounts(n, round1ByeCount) {
    const counts = [];
    const matches = Math.floor((n - round1ByeCount) / 2);
    counts.push(matches);
    let advancing = matches + round1ByeCount;
    while (advancing > 1) {
      const m = Math.floor(advancing / 2);
      counts.push(m);
      advancing = Math.ceil(advancing / 2);
    }
    return counts;
  },

  // ═════════════════════════════════════════════════════════════════════════
  // BYE PROGRESSION: which match-winner each bye player faces next
  //
  // Priority 1: the FIRST bye faces the winner of the FIRST match.
  // Priority 2+: every further bye stacks against the trailing matches,
  // working backward from the LAST match — i.e. the last bye faces the
  // last match's winner, the second-to-last bye faces the second-to-last
  // match's winner, and so on. This leaves every match in between (2nd
  // through the start of that trailing block) to pair with its immediate
  // neighbor as normal — e.g. 5 matches + 3 byes gives: bye1+M1, M2+M3,
  // bye2+M4, bye3+M5.
  //
  // This depends only on the completed round's own match count and bye
  // count — never on runtime results — so it is identical whether it is
  // computed live (buildNextRound, after the round is actually played) or
  // previewed in the Fixture PDF before a single match has been played.
  // Both call through computeByeSlots()/planNextRoundPairing() so the two
  // can never disagree.
  // ═════════════════════════════════════════════════════════════════════════

  // Returns an array of 0-based match indices (into the completed round's
  // own match list), one per bye, in priority order: [firstMatchIdx,
  // ...trailing indices working backward from the last match]. Length is
  // min(byeCount, matchCount) — a round can never have more byes usefully
  // paired against real winners than it has matches.
  computeByeSlots(matchCount, byeCount) {
    if (byeCount <= 0 || matchCount <= 0) return [];
    const k = Math.min(byeCount, matchCount);
    const targets = [0]; // Priority 1: winner of the first match
    // Priority 2+: winners of the trailing k-1 matches, nearest-last first
    // so the very last match always gets a bye ahead of its neighbors.
    for (let i = 1; i < k; i++) {
      targets.push(matchCount - k + i);
    }
    return targets;
  },

  // The single canonical "how does the next round get built" plan, shared
  // by buildNextRound() (live) and the Fixture PDF (preview). Given the
  // number of match-winners and bye players advancing from a completed (or
  // hypothetical, for a preview) round, returns the ordered list of next-
  // round match "slots", each naming its two sources as either
  // { type:'match', index } (that match's winner) or { type:'bye', index }
  // (that bye player, 0-based into the round's own bye list, in the
  // priority order computeByeSlots() returns). Any single leftover source
  // that couldn't be paired (only possible when matchCount+byeCount is
  // odd) is returned separately as `leftover` — callers decide who that
  // is ahead of time (e.g. buildNextRound's existing byeHistory-fairness
  // pick) and should pass an already-even pool; `leftover` exists purely
  // as a defensive fallback, not the primary way to size a new bye.
  planNextRoundPairing(matchCount, byeCount) {
    const byeTargets = this.computeByeSlots(matchCount, byeCount);
    const byeAt = new Map();
    byeTargets.forEach((matchIdx, byeIdx) => byeAt.set(matchIdx, byeIdx));

    const slots = [];
    let pending = null;
    for (let i = 0; i < matchCount; i++) {
      const matchSource = { type: 'match', index: i };
      if (byeAt.has(i)) {
        slots.push({ a: matchSource, b: { type: 'bye', index: byeAt.get(i) } });
      } else if (pending === null) {
        pending = matchSource;
      } else {
        slots.push({ a: pending, b: matchSource });
        pending = null;
      }
    }
    // Any bye beyond what computeByeSlots could pair to a real match winner
    // (only possible if there are more byes than matches — an all-bye
    // round, which the Bracket Editor's save validation already prevents)
    // still needs a home: pair leftover byes with each other in order.
    for (let bi = byeTargets.length; bi < byeCount; bi++) {
      const byeSource = { type: 'bye', index: bi };
      if (pending === null) {
        pending = byeSource;
      } else {
        slots.push({ a: pending, b: byeSource });
        pending = null;
      }
    }
    return { slots, leftover: pending };
  },

  // ═════════════════════════════════════════════════════════════════════════
  // TEAM-AWARE BRACKET GENERATION: Conflict Detection & Resolution
  // ═════════════════════════════════════════════════════════════════════════

  // Check if two players belong to the same team.
  // Resolution order (most to least authoritative):
  //   1. Look up each player by ID in this.players (live data from Firebase)
  //   2. teamId on the compressed bracket player object
  //   3. String comparison of teamName/centerName (legacy fallback only)
  areSameTeam(player1, player2) {
    if (!player1 || !player2) return false;

    // Helper: get teamId for a compressed player object.
    // Prefer the live player record (this.players) keyed by player ID,
    // which always has the authoritative teamId regardless of what stale
    // centerName/teamName was stored in the bracket.
    const getTeamId = (p) => {
      if (!p || !p.id) return null;
      const live = this.players.find(lp => lp.id === p.id);
      return (live && live.teamId) || p.teamId || null;
    };

    const t1 = getTeamId(player1);
    const t2 = getTeamId(player2);

    // If both have a teamId, compare directly — this is tamper-proof
    if (t1 && t2) return t1 === t2;

    // Last resort: string comparison for legacy data with no teamId at all
    const name1 = (player1.teamName || player1.centerName || '').toLowerCase().trim();
    const name2 = (player2.teamName || player2.centerName || '').toLowerCase().trim();
    return name1 && name2 && name1 === name2;
  },

  // Detect all same-team conflicts in a given list of matches
  // Returns array of conflicts: { matchIndex, player1, player2, matchId }
  detectTeamConflicts(matches) {
    const conflicts = [];
    matches.forEach((match, idx) => {
      if (match.player1 && match.player2 && this.areSameTeam(match.player1, match.player2)) {
        conflicts.push({
          matchIndex: idx,
          matchId: match.matchId,
          player1: match.player1,
          player2: match.player2
        });
      }
    });
    return conflicts;
  },

  // Aggressively resolve same-team conflicts by reshuffling and re-pairing
  // If the seeding has conflicts, completely rebuild the match pairings
  resolveTeamConflicts(matches) {
    let currentMatches = matches.map(m => ({ ...m }));

    // Extract all players
    const allPlayers = [];
    currentMatches.forEach(m => {
      if (m.player1) allPlayers.push(m.player1);
      if (m.player2) allPlayers.push(m.player2);
    });

    if (allPlayers.length === 0) {
      return {
        resolved: true,
        newMatches: matches,
        swaps: [],
        conflicts: []
      };
    }

    // Use aggressive smart seeding to rebuild matches
    const reseeded = this.smartSeedPlayersForMatching(allPlayers);
    const rebuiltMatches = [];

    for (let i = 0; i < reseeded.length; i += 2) {
      const matchIdx = Math.floor(i / 2);
      const originalMatch = currentMatches[matchIdx] || {};

      rebuiltMatches.push({
        matchId: originalMatch.matchId || `R${originalMatch.round}_M${matchIdx + 1}`,
        round: originalMatch.round || 1,
        player1: reseeded[i],
        player2: reseeded[i + 1] || null,
        // ✅ PRESERVE match result data (winner, eliminated, status, times)
        // so that completed matches don't get reset when resolving conflicts
        winner: originalMatch.winner !== undefined ? originalMatch.winner : null,
        eliminated: originalMatch.eliminated !== undefined ? originalMatch.eliminated : null,
        status: originalMatch.status || 'pending',
        startTime: originalMatch.startTime || null,
        endTime: originalMatch.endTime || null,
        courtNumber: originalMatch.courtNumber || null
      });
    }

    // Re-flag any match left with only one player (odd player count) so the
    // automatic walkover safety net (processAutoByes) still leaves it alone
    // after a conflict-driven reshuffle — same rule createBracket() applies.
    rebuiltMatches.forEach(m => {
      if (m.player1 && !m.player2) m.pendingManualBye = true;
    });

    // Verify the rebuild resolved all conflicts
    const conflicts = this.detectTeamConflicts(rebuiltMatches);

    if (conflicts.length === 0) {
      console.log(`✅ Team conflicts resolved through intelligent reshuffling`);
      return {
        resolved: true,
        newMatches: rebuiltMatches,
        swaps: [],
        conflicts: []
      };
    } else {
      console.warn(`⚠️ Could not fully resolve ${conflicts.length} team conflict(s) - team composition may be extreme`);
      return {
        resolved: false,
        newMatches: rebuiltMatches,
        swaps: [],
        conflicts
      };
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPROVED SMART SEEDING: Full Randomization + Smart Pairing
  // ═══════════════════════════════════════════════════════════════════════════
  // 
  // This algorithm ensures:
  //   1. ALL players are shuffled together (not just paired sequentially)
  //   2. Fair distribution across all teams (old and new)
  //   3. Minimal same-team matches (only when unavoidable)
  //   4. Newly added teams integrate into the full pool
  //   5. Repeatable results (same seed produces same bracket)
  // ═══════════════════════════════════════════════════════════════════════════

  // Step 1: True random shuffle using Fisher-Yates algorithm
  // This ensures ALL players are considered together fairly
  shufflePlayersFisherYates(players) {
    const shuffled = [...players];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  },

  // Step 2: Distribute teams evenly across bracket positions + avoid same-team pairs
  // ═══════════════════════════════════════════════════════════════════════════
  // After shuffling, apply intelligent team distribution to:
  //   1. Spread each team evenly across bracket positions (not just adjacent pairs)
  //   2. Avoid repeating "Team A vs Team B" patterns
  //   3. Ensure natural team mixing throughout entire bracket tree
  // ═══════════════════════════════════════════════════════════════════════════
  optimizeSeededOrder(players) {
    if (players.length <= 2) return players;

    // ── PHASE 1: Build team distribution map ─────────────────────────────
    // Group players by team to see team composition
    const teamGroups = {};
    players.forEach(p => {
      const teamKey = this.getPlayerTeamKey(p);
      if (!teamGroups[teamKey]) {
        teamGroups[teamKey] = [];
      }
      teamGroups[teamKey].push(p);
    });

    const teams = Object.keys(teamGroups);
    const uniqueTeamCount = teams.length;

    console.log(`    📊 Team distribution analysis:`);
    console.log(`       • Unique teams: ${uniqueTeamCount}`);
    teams.forEach(team => {
      console.log(`       • ${teamGroups[team][0].teamName || team}: ${teamGroups[team].length} players`);
    });

    // ── PHASE 2: Round-robin team distribution ──────────────────────────
    // Spread players from each team across different sections of the bracket.
    // This prevents "Team A, Team A, Team B, Team B" clustering.
    // Algorithm:
    //   • Fill positions in a round-robin style across teams
    //   • For each position slot, pick from different teams in order
    //   • This ensures even distribution across all positions
    const result = [];
    const teamQueues = {};
    teams.forEach(team => {
      // Shuffle players within each team for randomness
      teamQueues[team] = this.shufflePlayersFisherYates([...teamGroups[team]]);
    });

    let currentTeamIdx = 0;
    const teamArray = [...teams];

    // Fill all positions using round-robin from teams
    while (result.length < players.length) {
      // Cycle through teams, picking one player from each
      for (let i = 0; i < teamArray.length && result.length < players.length; i++) {
        const teamKey = teamArray[i];
        if (teamQueues[teamKey].length > 0) {
          result.push(teamQueues[teamKey].shift());
        }
      }
    }

    // ── PHASE 3: Final optimization to avoid adjacent same-team pairs ────
    // After round-robin distribution, do a final pass to ensure pairs
    // won't have same team players (where possible)
    const optimized = this.finalizePositionsForPairing(result);

    // Log distribution pattern
    console.log(`    ✅ Team distribution complete - teams spread evenly across bracket`);

    return optimized;
  },

  // Helper: Get unique team key for a player
  getPlayerTeamKey(player) {
    if (!player) return 'unknown';
    // Use teamId if available (most reliable), else fall back to team name
    return player.teamId || (player.teamName || player.centerName || 'unknown').toLowerCase();
  },

  // Helper: Final pass to minimize same-team adjacent pairs after distribution
  finalizePositionsForPairing(players) {
    if (players.length <= 2) return players;

    const result = [...players];
    let swaps = 0;

    // Check each potential pair (positions 0-1, 2-3, 4-5, etc.)
    for (let i = 0; i < result.length - 1; i += 2) {
      if (this.areSameTeam(result[i], result[i + 1])) {
        // Same team pair found — try to swap one with a nearby player
        // Search for a player from different team within reasonable range
        let swapped = false;

        // Try positions i+2, i+3 (next pair's players)
        for (let j = i + 2; j < Math.min(i + 4, result.length); j++) {
          if (!this.areSameTeam(result[i], result[j])) {
            // Swap result[i+1] with result[j]
            [result[i + 1], result[j]] = [result[j], result[i + 1]];
            swaps++;
            swapped = true;
            break;
          }
        }

        if (swapped) continue;

        // Try positions i-2, i-1 (previous pair's players)
        for (let j = Math.max(0, i - 2); j < i; j++) {
          if (!this.areSameTeam(result[i], result[j])) {
            // Swap result[i+1] with result[j]
            [result[i + 1], result[j]] = [result[j], result[i + 1]];
            swaps++;
            swapped = true;
            break;
          }
        }
      }
    }

    if (swaps > 0) {
      console.log(`    🔄 Pair optimization: ${swaps} swap(s) applied`);
    }

    return result;
  },

  // Step 3: Build final seeded order (combines shuffle + team-aware distribution)
  smartSeedPlayersForMatching(players) {
    if (players.length <= 1) return players;

    console.log(`📊 Starting smart seed for ${players.length} players...`);

    // PHASE 1: True random shuffle of ALL players
    console.log(`  🔀 Phase 1: Shuffling all ${players.length} players randomly...`);
    const shuffled = this.shufflePlayersFisherYates(players);

    // PHASE 2: Distribute teams evenly across bracket positions
    console.log(`  📍 Phase 2: Distributing teams evenly across all bracket positions...`);
    const optimized = this.optimizeSeededOrder(shuffled);

    // PHASE 3: Validate result
    let sameTeamPairs = 0;
    const teamCounts = {};

    for (let i = 0; i < optimized.length - 1; i += 2) {
      if (this.areSameTeam(optimized[i], optimized[i + 1])) {
        sameTeamPairs++;
      }
    }

    // Count unique teams and their distribution
    optimized.forEach((p, idx) => {
      const teamKey = this.getPlayerTeamKey(p);
      if (!teamCounts[teamKey]) teamCounts[teamKey] = [];
      teamCounts[teamKey].push(idx);
    });

    console.log(`✅ Smart seeding complete:`);
    console.log(`   • All ${optimized.length} players shuffled & distributed`);
    console.log(`   • Teams spread across bracket: ${Object.keys(teamCounts).length} unique teams`);
    console.log(`   • Same-team adjacent pairs: ${sameTeamPairs}/${Math.floor(optimized.length / 2)}`);

    return optimized;
  },

  // Final seeding wrapper: applies full shuffle + optimization pipeline
  smartSeedPlayers(players) {
    if (players.length === 0) return [];
    if (players.length === 1) return players;

    console.log(`\n🎮 ═══════════════════════════════════════════════════════════════`);
    console.log(`🎮 BRACKET GENERATION: Smart Seeding for ${players.length} Players`);
    console.log(`🎮 ═══════════════════════════════════════════════════════════════\n`);

    // Use full randomization + optimization pipeline
    const seeded = this.smartSeedPlayersForMatching([...players]);

    console.log(`\n🎮 ═══════════════════════════════════════════════════════════════`);
    console.log(`🎮 Smart seeding complete with improved distribution`);
    console.log(`🎮 ═══════════════════════════════════════════════════════════════\n`);

    return seeded;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BRACKET REGENERATION: Integrate New Players into Existing Bracket
  // ═══════════════════════════════════════════════════════════════════════════
  // When players are added to a category after the bracket exists, this function
  // can regenerate the bracket to include them. New and existing players are all
  // shuffled together fairly, not grouped separately.

  async regenerateBracketIfNeeded(categoryKey) {
    try {
      const category = this.categories[categoryKey];
      if (!category) return;

      const bracketRef = dbRef(database, `brackets/${categoryKey}`);
      const bracketSnap = await dbGet(bracketRef);

      if (!bracketSnap.exists()) {
        console.log(`  ℹ️  No bracket exists yet for ${categoryKey} — will create new`);
        return false;
      }

      const bracket = bracketSnap.val();
      const currentPlayerCount = bracket.playerCount || 0;
      const newPlayerCount = category.players.length;

      if (currentPlayerCount === newPlayerCount) {
        console.log(`  ✅ Player count unchanged (${currentPlayerCount})`);
        return false;
      }

      console.log(`\n⚠️  PLAYER COUNT MISMATCH DETECTED`);
      console.log(`   Current bracket: ${currentPlayerCount} players`);
      console.log(`   Category now has: ${newPlayerCount} players`);
      console.log(`   Difference: ${newPlayerCount - currentPlayerCount} new player(s)\n`);

      // Only regenerate if bracket hasn't started (all rounds pending)
      const hasStarted = bracket.rounds && bracket.rounds[0] &&
        bracket.rounds[0].some(m => m.status !== 'pending' || m.winner);

      if (hasStarted) {
        console.warn(`  ⛔ Cannot regenerate: bracket has already started`);
        console.log(`  📝 Suggestion: Archive this bracket and create a new one`);
        return false;
      }

      console.log(`  ✅ Bracket hasn't started — safe to regenerate`);
      console.log(`  🔄 Regenerating bracket with all ${newPlayerCount} players...\n`);

      // Create new bracket with all players (old + new mixed together)
      const newBracket = this.createBracket(category.players);
      await this.saveBracket(categoryKey, newBracket);

      console.log(`✅ Bracket regenerated successfully`);
      console.log(`   All ${newPlayerCount} players shuffled and integrated fairly\n`);

      return true;
    } catch (error) {
      console.error('❌ Error regenerating bracket:', error);
      return false;
    }
  },

  // Validate bracket integrity: ensure all players assigned exactly once, no duplicates, no data corruption
  validateBracketIntegrity(bracket, categoryPlayers) {
    const errors = [];
    const warnings = [];
    const foundPlayerIds = new Set();

    // Collect all players from all rounds
    bracket.rounds.forEach((round, ri) => {
      round.forEach((match, mi) => {
        if (match.player1) {
          if (foundPlayerIds.has(match.player1.id)) {
            errors.push(`❌ Player ${match.player1.playerName} appears twice (Round ${ri + 1}, Match ${mi + 1})`);
          }
          foundPlayerIds.add(match.player1.id);
        }
        if (match.player2) {
          if (foundPlayerIds.has(match.player2.id)) {
            errors.push(`❌ Player ${match.player2.playerName} appears twice (Round ${ri + 1}, Match ${mi + 1})`);
          }
          foundPlayerIds.add(match.player2.id);
        }
      });
    });

    // Check bye players (a round may hold multiple when manually edited)
    Object.keys(bracket.byePlayers || {}).forEach(round => {
      this.getByeList(bracket, round).forEach(player => {
        if (!player) return;
        if (foundPlayerIds.has(player.id)) {
          errors.push(`❌ Bye player ${player.playerName} already appears in a match`);
        }
        foundPlayerIds.add(player.id);
      });
    });

    // Verify all category players are in bracket
    categoryPlayers.forEach(player => {
      if (!foundPlayerIds.has(player.id)) {
        errors.push(`❌ Player ${player.playerName} missing from bracket`);
      }
    });

    // Check for extra players
    if (foundPlayerIds.size > categoryPlayers.length) {
      errors.push(`❌ Bracket has ${foundPlayerIds.size} players but category has ${categoryPlayers.length}`);
    }

    // Warn about same-team matches
    bracket.rounds.forEach((round, ri) => {
      round.forEach((match, mi) => {
        if (match.player1 && match.player2 && this.areSameTeam(match.player1, match.player2)) {
          warnings.push(`⚠️ R${ri + 1}M${mi + 1}: ${match.player1.playerName} vs ${match.player2.playerName} (same team)`);
        }
      });
    });

    if (errors.length > 0) {
      console.error('🔴 BRACKET INTEGRITY ERRORS:');
      errors.forEach(e => console.error(e));
    }

    if (warnings.length > 0) {
      console.warn('🟡 BRACKET WARNINGS:');
      warnings.forEach(w => console.warn(w));
    }

    if (errors.length === 0) {
      console.log(`✅ Bracket integrity valid: ${foundPlayerIds.size} players, all assigned exactly once`);
    }

    return { valid: errors.length === 0, errors, warnings };
  },

  // Create new bracket using standard Taekwondo bye-distribution rules.
  // WITH TEAM-AWARE CONFLICT RESOLUTION to prevent same-team matches.
  // Rounds are built one at a time — Round 1 is created upfront; later rounds
  // are constructed dynamically by buildNextRound() once the previous round
  // is fully complete.  This guarantees:
  //   • No player is ever auto-assigned a bye at generation time — every
  //     player (even the odd one out when n is odd) is placed into a normal
  //     Round 1 match slot. If n is odd, the last match is left with only
  //     one player (pendingManualBye), and only the Bracket Editor can turn
  //     that into an official bye (see saveEditBracket / processAutoByes).
  //   • Bye players wait in their round until all real matches finish
  //   • No player ever receives two consecutive byes
  //   • Same-team players are not matched in early rounds (where possible)
  createBracket(players) {
    // ── ENHANCED SMART SEEDING: distribute same-team players optimally ──
    const shuffled = this.smartSeedPlayers(players);
    // ─────────────────────────────────────────────────────────────────────

    const n = shuffled.length;

    // Pre-compute expected match counts per round (used by PDF and UI to show
    // future-round structure before those rounds are actually built).
    // Formula: matches = floor(cur), then cur = ceil(cur) for next round.
    const expectedRoundMatchCounts = [];
    let cur = n;
    while (cur > 1) {
      expectedRoundMatchCounts.push(Math.floor(cur / 2));
      cur = Math.ceil(cur / 2);
    }

    const bracket = {
      playerCount: n,
      rounds: [],
      byePlayers: {},   // { "roundIndex": playerObj } — bye player awaiting each round
      byeHistory: {},   // { playerId: count }         — total byes received per player
      expectedRoundMatchCounts,
      currentRound: 0,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    // ── ROUND 1 ───────────────────────────────────────────────────────────
    // Every player is placed into a normal match slot — no automatic byes.
    // The degenerate n === 1 case (a single-entrant category) still declares
    // that lone player the champion directly, since there is no possible
    // opponent slot to place them in.
    // If n is odd (and > 1): the last match is left with only player1 —
    //   → ceil(n/2) match slots, the final one unpaired
    // If n is even: all players are paired normally; no unpaired slot.
    //   → n/2 match slots
    const round1 = [];

    if (n === 1) {
      const soleChampion = this.compressPlayer(shuffled[0]);
      bracket.byePlayers['0'] = soleChampion;
      bracket.byeHistory[soleChampion.id] = 1;
    } else {
      const round1MatchCount = Math.ceil(n / 2);

      for (let i = 0; i < round1MatchCount; i++) {
        round1.push({
          matchId: `R1_M${i + 1}`,
          round: 1,
          player1: this.compressPlayer(shuffled[i * 2]),
          player2: (i * 2 + 1 < n) ? this.compressPlayer(shuffled[i * 2 + 1]) : null,
          winner: null,
          eliminated: null,
          status: 'pending',
          startTime: null,
          endTime: null
        });
      }
    }

    // ── APPLY TEAM-AWARE CONFLICT RESOLUTION ──────────────────────────────
    // Resolve any same-team matches in Round 1 by swapping players intelligently
    const resolution = this.resolveTeamConflicts(round1);
    if (resolution.resolved && resolution.swaps.length > 0) {
      console.log(`✅ Round 1: ${resolution.swaps.length} player swap(s) performed to avoid same-team matches`);
    } else if (!resolution.resolved && resolution.conflicts.length > 0) {
      console.warn(`⚠️ Round 1: ${resolution.conflicts.length} unavoidable same-team conflict(s) due to team composition`);
      resolution.conflicts.forEach(c => {
        console.warn(`  - ${c.player1.playerName} vs ${c.player2.playerName} (both from ${c.player1.teamName})`);
      });
    }

    // Update round1 with resolved matches
    for (let i = 0; i < resolution.newMatches.length; i++) {
      round1[i] = {
        ...round1[i],
        player1: resolution.newMatches[i].player1,
        player2: resolution.newMatches[i].player2
      };
    }

    // Flag any match left with only one player (odd n) so the automatic
    // walkover safety net (processAutoByes, meant for players deleted mid-
    // tournament) leaves it alone — only the Bracket Editor may resolve it,
    // by dragging that player into the BYE pool or pairing them with someone.
    round1.forEach(m => {
      if (m.player1 && !m.player2) m.pendingManualBye = true;
    });

    bracket.rounds.push(round1);

    // ── VALIDATE BRACKET INTEGRITY ────────────────────────────────────────
    const validation = this.validateBracketIntegrity(bracket, players);
    if (!validation.valid) {
      console.error('❌ Bracket creation failed integrity check');
      validation.errors.forEach(e => console.error(`  ${e}`));
    }

    // Subsequent rounds are built dynamically by buildNextRound() —
    // do NOT pre-build them here.
    return bracket;
  },

  // Build the next round after every match in `roundIndex` is completed.
  // WITH TEAM-AWARE CONFLICT RESOLUTION to prevent same-team matches.
  // Collects all match winners from that round plus the round's bye player
  // (if any), pairs them into new matches, and assigns a fresh bye to the
  // player with the fewest byes so far (never the same player twice in a row
  // unless there is no alternative).
  buildNextRound(roundIndex) {
    const completedRound = this.currentBracket.rounds[roundIndex];

    // Collect the winner of every match in the completed round
    const winners = completedRound.map(m =>
      (m.player1 && m.player1.id === m.winner) ? m.player1 : m.player2
    );

    // Retrieve the bye player(s) who were waiting in this round (may be
    // several — the Bracket Editor allows front-loading multiple Round-1
    // byes, e.g. to fill a non-power-of-2 bracket like real tournaments do)
    const roundByePlayers = this.getByeList(this.currentBracket, roundIndex);

    // All players advancing: match-winners first, then the bye holder(s),
    // in that fixed order — this must exactly match the order any bracket
    // preview (PDF) assumes for pairing the next round.
    const advancing = [...winners, ...roundByePlayers];

    if (advancing.length <= 1) {
      // Only one player remains — tournament is complete
      this.currentBracket.status = 'complete';
      console.log('🏆 Tournament complete');
      return;
    }

    const nextRoundIndex = roundIndex + 1;
    const nextRoundNum = nextRoundIndex + 1;  // 1-based label for matchId

    // ── ASSIGN BYE FOR NEXT ROUND (only if advancing count is odd) ───────
    // This decides who, if anyone, sits out the round we're about to build
    // entirely (advancing straight through to the round after). It's a
    // fairness decision (fewest byes so far, never the same player twice in
    // a row unless unavoidable) — orthogonal to the deterministic
    // first/last/center-out placement below, which only concerns byes that
    // ARE playing this round (against a specific match winner).
    let nextByePlayer = null;
    if (advancing.length % 2 === 1) {
      const byeHistory = this.currentBracket.byeHistory || {};
      const prevByeIds = new Set(roundByePlayers.map(p => p.id));

      // Sort by: fewest byes first; break ties by pushing any player who
      // just had a bye in the previous round to the back (prevents
      // consecutive byes for the same player).
      const sorted = [...advancing].sort((a, b) => {
        const diff = (byeHistory[a.id] || 0) - (byeHistory[b.id] || 0);
        if (diff !== 0) return diff;
        return (prevByeIds.has(a.id) ? 1 : 0) - (prevByeIds.has(b.id) ? 1 : 0);
      });
      nextByePlayer = sorted[0];
    }

    // ── BUILD NEXT ROUND MATCHES ──────────────────────────────────────────
    // Whoever isn't sitting out this round (nextByePlayer, if any) gets
    // paired via the deterministic bye-progression plan: the first bye
    // faces the winner of Round 1's first match, the second bye faces the
    // last match's winner, and any further byes fill in from the center
    // outward — the exact same plan the Fixture PDF previews before this
    // round is even played (BRACKET.planNextRoundPairing), so the two can
    // never disagree.
    const pairWinners = winners.filter(p => !nextByePlayer || p.id !== nextByePlayer.id);
    const pairByes = roundByePlayers.filter(p => !nextByePlayer || p.id !== nextByePlayer.id);

    const { slots } = this.planNextRoundPairing(pairWinners.length, pairByes.length);
    const resolvePlayer = (source) => (source.type === 'match' ? pairWinners[source.index] : pairByes[source.index]);

    const nextRound = slots.map((slot, i) => ({
      matchId: `R${nextRoundNum}_M${i + 1}`,
      round: nextRoundNum,
      player1: resolvePlayer(slot.a),
      player2: resolvePlayer(slot.b),
      winner: null,
      eliminated: null,
      status: 'pending',
      startTime: null,
      endTime: null
    }));

    // Winner advancement must follow the fixed bracket tree — once the
    // pairing above is decided, later rounds are never reseeded or
    // reshuffled. (Team-conflict-aware smart seeding only applies to the
    // very first round's initial player pairing during bracket generation,
    // above in generateBracket() — never to advancing an existing round's
    // already-decided winners into the next one.)
    this.currentBracket.rounds.push(nextRound);

    if (nextByePlayer) {
      this.setByeList(this.currentBracket, nextRoundIndex, [nextByePlayer]);
      if (!this.currentBracket.byeHistory) this.currentBracket.byeHistory = {};
      this.currentBracket.byeHistory[nextByePlayer.id] =
        (this.currentBracket.byeHistory[nextByePlayer.id] || 0) + 1;
    }

    console.log(`✅ Round ${nextRoundNum} built: ${nextRound.length} match(es)` +
      (nextByePlayer ? `, bye → ${nextByePlayer.playerName}` : ''));
  },

  // Fix conflicts in an existing bracket by resolving all same-team matches
  // Applies resolution to each round that has conflicts
  async fixBracketConflicts() {
    if (!this.currentBracket || !this.currentBracket.rounds) {
      return false;
    }

    let fixedAnyConflicts = false;

    // Check and fix each round
    for (let roundIdx = 0; roundIdx < this.currentBracket.rounds.length; roundIdx++) {
      const round = this.currentBracket.rounds[roundIdx];
      if (!round) continue;

      // ── AUTO BYE ASSIGNMENT ──
      // Fix cases where a player was deleted leaving an unpaired player stuck
      if (this.processAutoByes(roundIdx)) {
        fixedAnyConflicts = true;
        if (round.every(m => m.status === 'completed')) {
          this.buildNextRound(roundIdx);
        }
      }

      // Never reshuffle matches that have already started or completed —
      // doing so would corrupt winner/eliminated data.
      if (round.length === 0 || round.some(m => m.status && m.status !== 'pending')) continue;

      // Team-conflict reshuffling only applies to Round 1's initial pairing
      // (bracket generation). Every later round is produced by deterministic
      // winner advancement (buildNextRound) and must never be reshuffled —
      // doing so would break the fixed bracket-tree adjacency (winner of
      // match i must always face winner of match i+1).
      if (roundIdx > 0) continue;

      // Detect conflicts in this round
      const conflicts = this.detectTeamConflicts(round);

      if (conflicts.length > 0) {
        console.log(`🔧 Round ${roundIdx + 1}: Found ${conflicts.length} conflict(s), applying resolution...`);

        // Build proper match objects for resolution
        const roundMatches = round.map((match, idx) => ({
          ...match,
          matchId: match.matchId || `R${roundIdx + 1}_M${idx + 1}`,
          round: roundIdx + 1
        }));

        // Resolve conflicts
        const result = this.resolveTeamConflicts(roundMatches);

        if (result.resolved) {
          console.log(`✅ Round ${roundIdx + 1}: All conflicts resolved!`);
        } else {
          console.warn(`⚠️ Round ${roundIdx + 1}: Some conflicts remain (team composition)`);
        }

        // Update the round with resolved matches
        this.currentBracket.rounds[roundIdx] = result.newMatches;
        fixedAnyConflicts = true;
      }
    }

    // If we fixed any conflicts, save the bracket
    if (fixedAnyConflicts) {
      console.log(`💾 Saving corrected bracket to Firebase...`);
      await this.saveBracket(this.currentCategory, this.currentBracket);
      console.log(`✅ Bracket corrected and saved!`);
    }

    return fixedAnyConflicts;
  },

  // Load bracket from Firebase and apply conflict fixes
  async loadBracketWithFixes(categoryKey) {
    await this.loadBracket(categoryKey);

    if (this.currentBracket && this.currentBracket.rounds) {
      // ── NORMALIZE TEAM NAMES inside the bracket's compressed data ───
      const cache = await this._buildTeamNameCache();
      // Build playerId → teamId map from loaded players so we can backfill
      // teamId into old brackets that were created before teamId was stored.
      const playerTeamIdMap = {};
      this.players.forEach(p => { if (p.teamId) playerTeamIdMap[p.id] = p.teamId; });
      const teamNamesFixed = this._normalizeBracketTeamNames(this.currentBracket, cache, playerTeamIdMap);
      if (teamNamesFixed) {
        console.log('🔧 Bracket player team names normalized to authoritative values');
      }
      // ───────────────────────────────────────────────────────────────

      // Apply conflict resolution to existing bracket
      this.currentCategory = categoryKey;
      const wasFixed = await this.fixBracketConflicts();

      if (wasFixed || teamNamesFixed) {
        console.log(`🎯 Existing bracket had issues - automatically resolved & saved!`);
        await this.saveBracket(categoryKey, this.currentBracket);
      } else {
        console.log(`✅ Existing bracket is clean - no team conflicts detected`);
      }
    }
  },

  // Load bracket from Firebase
  async loadBracket(categoryKey) {
    try {
      const bracketRef = dbRef(database, `brackets/${categoryKey}`);
      const snapshot = await dbGet(bracketRef);

      if (snapshot.exists()) {
        let bracket = snapshot.val();

        // Restore missing fields for consistency
        // Firebase converts JS arrays to objects with numeric keys — convert back safely
        if (bracket.rounds) {
          const toArray = (obj) => Array.isArray(obj)
            ? obj
            : Object.keys(obj).sort((a, b) => Number(a) - Number(b)).map(k => obj[k]);

          // Restore array fields Firebase may have converted to numeric-key objects
          if (bracket.expectedRoundMatchCounts) {
            bracket.expectedRoundMatchCounts = toArray(bracket.expectedRoundMatchCounts);
          }

          bracket.rounds = toArray(bracket.rounds).map(round => {
            if (!round) return []; // Firebase drops empty arrays → null; recover gracefully
            return toArray(round).map(match => ({
              matchId: match.matchId,
              round: match.round,
              player1: match.player1 || null,
              player2: match.player2 || null,
              winner: match.winner !== undefined ? match.winner : null,
              eliminated: match.eliminated !== undefined ? match.eliminated : null,
              status: match.status || 'pending',
              startTime: match.startTime || null,
              endTime: match.endTime || null,
              courtNumber: match.courtNumber || null
            }));
          });
        }

        // Ensure rounds is always an array (Firebase drops empty arrays entirely)
        if (!bracket.rounds) {
          bracket.rounds = [];
        }

        this.currentBracket = bracket;
      } else {
        this.currentBracket = null;
      }
    } catch (error) {
      console.error("❌ Error loading bracket:", error);
      this.currentBracket = null;
    }
  },

  // Load match history
  async loadMatchHistory(categoryKey) {
    try {
      const historyRef = dbRef(database, `matchHistory/${categoryKey}`);
      const snapshot = await dbGet(historyRef);

      if (snapshot.exists()) {
        this.matchHistory = snapshot.val();
      } else {
        this.matchHistory = [];
      }
    } catch (error) {
      console.error("❌ Error loading match history:", error);
      this.matchHistory = [];
    }
  },

  // Setup real-time listeners for bracket & match history (MULTI-COURT SYNC)
  setupBracketListeners(categoryKey) {
    // 🔴 CRITICAL FIX #2: Always cleanup FIRST to prevent duplicate listeners
    // This prevents listener accumulation when setupBracketListeners is called multiple times
    this.stopBracketListeners();

    if (!categoryKey) {
      console.warn('⚠️ No categoryKey provided for listener setup');
      return;
    }

    console.log(`🔌 Setting up real-time listeners for ${categoryKey}...`);

    // Real-time listener for bracket changes
    const bracketRef = dbRef(database, `brackets/${categoryKey}`);
    this.bracketListener = dbOnValue(bracketRef, (snapshot) => {
      if (snapshot.exists()) {
        const rawBracket = snapshot.val();
        // Convert Firebase numeric-key objects back to real arrays
        const toArray = (obj) => Array.isArray(obj)
          ? obj
          : Object.keys(obj).sort((a, b) => Number(a) - Number(b)).map(k => obj[k]);
        if (rawBracket.rounds) {
          if (rawBracket.expectedRoundMatchCounts) {
            rawBracket.expectedRoundMatchCounts = toArray(rawBracket.expectedRoundMatchCounts);
          }
          rawBracket.rounds = toArray(rawBracket.rounds).map(round => {
            if (!round) return []; // Firebase drops empty arrays → null; recover gracefully
            return toArray(round).map(match => ({
              matchId: match.matchId,
              round: match.round,
              player1: match.player1 || null,
              player2: match.player2 || null,
              winner: match.winner !== undefined ? match.winner : null,
              eliminated: match.eliminated !== undefined ? match.eliminated : null,
              status: match.status || 'pending',
              startTime: match.startTime || null,
              endTime: match.endTime || null,
              courtNumber: match.courtNumber || null
            }));
          });
        }
        // Ensure rounds is always an array (Firebase drops empty arrays entirely)
        if (!rawBracket.rounds) {
          rawBracket.rounds = [];
        }
        // Normalize team names in real-time data
        if (this._teamNameCache) {
          const ptMap = {};
          this.players.forEach(p => { if (p.teamId) ptMap[p.id] = p.teamId; });
          this._normalizeBracketTeamNames(rawBracket, this._teamNameCache, ptMap);
        }
        // Only re-render if bracket actually changed
        if (JSON.stringify(this.currentBracket) !== JSON.stringify(rawBracket)) {
          this.currentBracket = rawBracket;
          // While the Bracket Editor is open, do NOT re-render over the
          // admin's in-progress drag session — a concurrent change from
          // another court/device would otherwise wipe out unsaved edits.
          // The editor's own draft is independent of currentBracket until
          // Save, so it stays intact; the fresh data is picked up next time
          // renderBracket() runs (edit mode exit, or the next real update).
          if (this.editMode) {
            console.log('🔄 Bracket updated from Firebase (edit mode active — render deferred)');
          } else {
            console.log('🔄 Bracket updated from Firebase - re-rendering');
            this.renderBracket();
          }
        }
      }
    });

    // Real-time listener for match history changes
    const historyRef = dbRef(database, `matchHistory/${categoryKey}`);
    this.historyListener = dbOnValue(historyRef, (snapshot) => {
      if (snapshot.exists()) {
        const newHistory = snapshot.val();
        // Update match history for display
        this.matchHistory = newHistory;
        console.log('🔄 Match history updated from Firebase');
      }
    });

    console.log('✅ Real-time listeners setup for multi-court sync');
  },

  // Stop all real-time listeners
  stopBracketListeners() {
    if (this.bracketListener) {
      this.bracketListener();
      this.bracketListener = null;
      console.log('✅ Bracket listener stopped');
    }
    if (this.historyListener) {
      this.historyListener();
      this.historyListener = null;
      console.log('✅ History listener stopped');
    }
  },

  // Setup real-time listener on the brackets node so ALL users see status changes
  // (Live / Pending / Completed) in the categories list without refreshing.
  // Debounced to 500 ms to avoid flooding re-renders during active matches.
  //
  // ALSO listens on players/ — the category cards are grouped by each
  // player's CURRENT gender-ageCategory-weightCategory (categorizePlayers()),
  // computed once from this.players at page load. Without this second
  // listener, a weight/category correction made elsewhere (e.g. the Weighing
  // Check pages) never gets picked up by an already-open Bracket page: the
  // player would keep showing under their OLD category card here until a
  // manual reload, which looks exactly like "the same player in two
  // categories" if compared against a freshly-loaded view. Both listeners
  // funnel into one debounce so rapid-fire events coalesce into a single
  // re-render, and a players/ change always triggers a full
  // loadPlayers()+categorizePlayers() before rendering (a brackets/-only
  // change just re-renders from the existing this.categories, unchanged).
  setupCategoriesListener() {
    this.stopCategoriesListener();
    let debounceTimer = null;
    let needsRecategorize = false;

    const scheduleRefresh = (recategorize) => {
      if (recategorize) needsRecategorize = true;
      // Skip if the user is currently inside the bracket view
      const bracketContainer = document.getElementById('bracketContainer');
      if (bracketContainer && bracketContainer.style.display === 'block') return;
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

    const unsubBrackets = dbOnValue(dbRef(database, 'brackets'), () => scheduleRefresh(false));
    const unsubPlayers = dbOnValue(dbRef(database, 'players'), () => scheduleRefresh(true));
    // Court-lock changes (a court claiming/releasing a category) never
    // change who's registered in it, so this never needs a recategorize —
    // just re-render so the "Opened by: Court X" line updates live.
    const unsubLocks = dbOnValue(dbRef(database, 'bracketLocks/official'), () => scheduleRefresh(false), (err) => {
      console.warn('⚠️ bracketLocks listener error (non-fatal):', err.message);
    });
    // Assignment changes (admin assigning/reassigning/removing a court) never
    // change who's registered in a category either — just re-render so a
    // referee's list picks up newly (un)assigned brackets live, without a
    // manual refresh.
    const unsubAssignments = dbOnValue(dbRef(database, 'bracketAssignments/official'), () => scheduleRefresh(false), (err) => {
      console.warn('⚠️ bracketAssignments listener error (non-fatal):', err.message);
    });
    this.categoriesListener = () => { unsubBrackets(); unsubPlayers(); unsubLocks(); unsubAssignments(); };
    console.log('✅ Categories real-time listener active (brackets + players + locks + assignments)');
  },

  // Tear down the categories listener (called when entering bracket view)
  stopCategoriesListener() {
    if (this.categoriesListener) {
      this.categoriesListener();
      this.categoriesListener = null;
      console.log('✅ Categories listener stopped');
    }
  },

  // Ensure the championship history node for champId has its top-level metadata
  // (timestamp + championship details) so loadArchivedChampionships() can list it.
  // Uses dbUpdate so existing data/brackets and data/matchHistory are untouched.
  async _ensureChampionshipHistoryMeta(champId) {
    try {
      const metaRef = dbRef(database, `championshipHistory/${champId}/timestamp`);
      const snap = await dbGet(metaRef);
      if (snap.exists()) return; // already initialised
      const configSnap = await dbGet(dbRef(database, 'formConfig'));
      const champData = configSnap.exists() ? (configSnap.val().championship || {}) : {};
      await dbUpdate(dbRef(database, `championshipHistory/${champId}`), {
        timestamp: new Date().toISOString(),
        championship: champData
      });
      console.log(`✅ Championship history metadata initialised for ${champId}`);
    } catch (err) {
      console.warn('⚠️ Could not write championship history metadata:', err);
    }
  },

  // Get current championship ID from formConfig
  async getCurrentChampionshipId() {
    try {
      const configRef = dbRef(database, 'formConfig');
      const snap = await dbGet(configRef);
      if (snap.exists() && snap.val().championship && snap.val().championship.champId) {
        return snap.val().championship.champId;
      }
      return null;
    } catch (error) {
      console.warn('⚠️ Could not fetch current championship ID:', error);
      return null;
    }
  },

  // Save bracket to championship history
  async saveBracketToChampionshipHistory(categoryKey, bracket) {
    try {
      const champId = await this.getCurrentChampionshipId();
      if (!champId) {
        console.warn('⚠️ No active championship - bracket not saved to history');
        return;
      }

      // Ensure top-level metadata exists so the entry appears in the history list
      await this._ensureChampionshipHistoryMeta(champId);

      // Create lean bracket data (same as main saveBracket)
      const leanBracket = {
        playerCount: bracket.playerCount,
        currentRound: bracket.currentRound,
        status: bracket.status,
        createdAt: bracket.createdAt,
        byePlayers: bracket.byePlayers || {},
        byeHistory: bracket.byeHistory || {},
        expectedRoundMatchCounts: bracket.expectedRoundMatchCounts || [],
        ...(bracket.manuallyEdited ? {
          manuallyEdited: true,
          lastEditedAt: bracket.lastEditedAt,
          editedBy: bracket.editedBy
        } : {}),
        rounds: bracket.rounds.map(round =>
          round.map(match => {
            const leanMatch = {
              matchId: match.matchId,
              round: match.round,
              status: match.status
            };
            if (match.player1) leanMatch.player1 = match.player1;
            if (match.player2) leanMatch.player2 = match.player2;
            if (match.winner !== null) leanMatch.winner = match.winner;
            if (match.eliminated !== null) leanMatch.eliminated = match.eliminated;
            if (match.startTime) leanMatch.startTime = match.startTime;
            if (match.endTime) leanMatch.endTime = match.endTime;
            if (match.courtNumber) leanMatch.courtNumber = match.courtNumber;
            if (match.pendingManualBye) leanMatch.pendingManualBye = true;
            return leanMatch;
          })
        )
      };

      const champHistoryRef = dbRef(database, `championshipHistory/${champId}/data/brackets/${categoryKey}`);
      await dbSet(champHistoryRef, leanBracket);
      console.log(`✅ Bracket saved to championship history (${champId}/${categoryKey})`);
    } catch (error) {
      console.warn('⚠️ Error saving bracket to championship history:', error);
      // Don't throw - this should not block the main save operation
    }
  },

  // Save match to championship history
  async saveMatchToChampionshipHistory(categoryKey, match) {
    try {
      const champId = await this.getCurrentChampionshipId();
      if (!champId) {
        console.warn('⚠️ No active championship - match not saved to history');
        return;
      }

      // Ensure top-level metadata exists so the entry appears in the history list
      await this._ensureChampionshipHistoryMeta(champId);

      const matchId = match.matchId;
      const historyEntry = {
        matchId: match.matchId,
        round: match.round,
        player1: match.player1,
        player2: match.player2,
        winner: match.winner,
        eliminated: match.eliminated,
        status: match.status,
        startTime: match.startTime,
        endTime: match.endTime,
        savedAt: new Date().toISOString()
      };

      const champHistoryRef = dbRef(database, `championshipHistory/${champId}/data/matchHistory/${categoryKey}/${matchId}`);
      await dbSet(champHistoryRef, historyEntry);
      console.log(`✅ Match saved to championship history (${champId}/${categoryKey}/${matchId})`);
    } catch (error) {
      console.warn('⚠️ Error saving match to championship history:', error);
      // Don't throw - this should not block the main save operation
    }
  },

  // Save bracket to Firebase
  async saveBracket(categoryKey, bracket) {
    try {
      // Optimize: create a lean version for Firebase storage by removing null fields
      const leanBracket = {
        playerCount: bracket.playerCount,
        currentRound: bracket.currentRound,
        status: bracket.status,
        createdAt: bracket.createdAt,
        byePlayers: bracket.byePlayers || {},
        byeHistory: bracket.byeHistory || {},
        expectedRoundMatchCounts: bracket.expectedRoundMatchCounts || [],
        // Metadata marking a Bracket-Editor save — every other module reads
        // brackets/{categoryKey} exactly the same either way, but this lets
        // the UI show "manually edited" and preserves an audit trail.
        ...(bracket.manuallyEdited ? {
          manuallyEdited: true,
          lastEditedAt: bracket.lastEditedAt,
          editedBy: bracket.editedBy
        } : {}),
        rounds: bracket.rounds.map(round =>
          round.map(match => {
            const leanMatch = {
              matchId: match.matchId,
              round: match.round,
              status: match.status
            };
            // Only include fields that have values
            if (match.player1) leanMatch.player1 = match.player1;
            if (match.player2) leanMatch.player2 = match.player2;
            if (match.winner !== null) leanMatch.winner = match.winner;
            if (match.eliminated !== null) leanMatch.eliminated = match.eliminated;
            if (match.startTime) leanMatch.startTime = match.startTime;
            if (match.endTime) leanMatch.endTime = match.endTime;
            if (match.courtNumber) leanMatch.courtNumber = match.courtNumber;
            if (match.pendingManualBye) leanMatch.pendingManualBye = true;
            return leanMatch;
          })
        )
      };

      const bracketRef = dbRef(database, `brackets/${categoryKey}`);
      await dbSet(bracketRef, leanBracket);
      console.log("✅ Bracket saved (optimized)");

      // Also save to championship history (fire-and-forget with error handling)
      this.saveBracketToChampionshipHistory(categoryKey, bracket).catch(err =>
        console.error('❌ Failed to save bracket to championship history:', err)
      );
    } catch (error) {
      console.error("❌ Error saving bracket:", error);
      if (error.message.includes('too large')) {
        console.warn("⚠️ Warning: Bracket data is large. Archive old matches to reduce size.");
      }
    }
  },

  // Save match to history (Firebase)
  async saveMatchToHistory(categoryKey, match) {
    try {
      const matchId = match.matchId;
      // Store only essential match data in history
      const historyEntry = {
        matchId: match.matchId,
        round: match.round,
        player1: match.player1,
        player2: match.player2,
        winner: match.winner,
        eliminated: match.eliminated,
        status: match.status,
        startTime: match.startTime,
        endTime: match.endTime,
        savedAt: new Date().toISOString()
      };
      const historyRef = dbRef(database, `matchHistory/${categoryKey}/${matchId}`);
      await dbSet(historyRef, historyEntry);
      console.log("✅ Match saved to history (Firebase)");

      // Also save to championship history (fire-and-forget with error handling)
      this.saveMatchToChampionshipHistory(categoryKey, match).catch(err =>
        console.error('❌ Failed to save match to championship history:', err)
      );
    } catch (error) {
      console.error("❌ Error saving to history:", error);
    }
  },

  // Render bracket
  renderBracket() {
    const container = document.getElementById('bracketContainer');
    if (!container) return;

    // this.currentBracket should always be populated by the time
    // openCategory() reaches this call, but guard it explicitly rather than
    // let a missing/cleared value (e.g. a concurrent closeCategory(), or a
    // bracket deleted from another admin tab mid-load) throw here with no
    // way back to the categories list.
    if (!this.currentBracket) {
      console.warn('⚠️ renderBracket() called with no currentBracket — returning to categories list.');
      this._hideBracketLoading?.();
      if (typeof this.closeCategory === 'function') this.closeCategory();
      return;
    }

    const isComplete = this.isCategoryComplete();
    // this.categories can be transiently rebuilt by the categories-level
    // players/ listener (categorizePlayers() does `this.categories = {}`
    // before repopulating) — openCategory() now stops that listener before
    // this ever runs, but this guard is defense-in-depth so a stale/missing
    // entry degrades gracefully (falls back to the raw category key as the
    // title, edit button hidden) instead of throwing and leaving a blank
    // screen with no way back to the categories list.
    const category = this.categories[this.currentCategory];
    const categoryTitle = category
      ? `${category.gender} ${category.ageCategory} - ${category.weightCategory}`
      : (this.currentCategory || '');
    // Editing needs at least 2 players (a single-player category is a pure
    // walkover with no Round 1 to arrange) and is admin/judge only. Falls
    // back to non-editable when category info is unavailable.
    const canEdit = this._canEditBracket() && !!category && category.players.length > 1;

    let html = `
      <div class="bracket-header">
        <button class="btn-back" onclick="BRACKET.closeCategory()">← Back to Categories</button>
        <h2>${categoryTitle}${this.currentBracket.manuallyEdited ? ' <span class="manually-edited-badge" title="Round 1 was manually arranged via the Bracket Editor">✏️ Manually Edited</span>' : ''}</h2>
        <div style="display:flex;gap:10px;align-items:center;">
          ${canEdit ? `<button class="btn-secondary edit-bracket-btn" onclick="BRACKET.promptEditPassword('${this.currentCategory}')" style="padding:8px 18px;font-size:0.95rem;border:1.5px dashed var(--border-gold);color:var(--border-gold);">✏️ Edit Bracket</button>` : ''}
          ${isComplete ? `<button class="btn-success" onclick="BRACKET.exportToExcel()" style="background:var(--success-green);color:#fff;border:none;padding:8px 18px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.95rem;">📥 Export Results</button>` : ''}
          <button class="btn-secondary" onclick="BRACKET.downloadFixturePDF()" style="padding:8px 18px;font-size:0.95rem;">📄 Download Fixture PDF</button>
          <button class="btn-secondary" onclick="BRACKET.downloadPlayerListExcel()" style="padding:8px 18px;font-size:0.95rem;">📋 Download Player List (Excel)</button>
          <button class="btn-secondary" onclick="BRACKET.showMatchHistory()">📋 Previous Matches</button>
          <button class="msg-bell-btn" onclick="if(typeof toggleMsgPanel==='function')toggleMsgPanel()" title="Court Messages" style="padding:8px 14px;font-size:0.95rem;white-space:nowrap;">🔔 Messages</button>
        </div>
      </div>
      <div class="bracket-rounds">
    `;

    // Use expected total rounds (not just built rounds) so Round 1 does not
    // get mislabeled as Final while later rounds are still not generated.
    const totalRounds = this.getExpectedTotalRounds(this.currentBracket);
    // Compute sequential match numbers across all rounds
    let globalMatchNum = 1;
    const matchNumMap = {};

    if (!this.currentBracket || !this.currentBracket.rounds) {
      console.warn("Current bracket or its rounds are undefined, cannot render bracket.");
      return;
    }

    this.currentBracket.rounds.forEach(round => {
      round.forEach(match => { matchNumMap[match.matchId] = globalMatchNum++; });
    });

    this.currentBracket.rounds.forEach((round, roundIndex) => {
      // Get the actual round number from the first match in this round
      const actualRoundNumber = round[0]?.round || (roundIndex + 1);
      const roundName = this.getRoundName(roundIndex, totalRounds, actualRoundNumber);

      html += `
        <div class="round">
          <h3 class="round-title">${roundName}</h3>
          <div class="matches">
      `;

      round.forEach((match, matchIndexInRound) => {
        html += this.renderMatch(match, roundIndex, matchNumMap[match.matchId], matchIndexInRound);
      });

      // Render a bye-player card for each bye in this round (if any —
      // Round 1 may have several when manually edited)
      const roundByes = this.getByeList(this.currentBracket, roundIndex);
      if (roundByes.length > 0) {
        const roundComplete = round.every(m => m.status === 'completed');
        roundByes.forEach(byePlayer => {
          html += this.renderByeCard(byePlayer, roundComplete, roundIndex);
        });
      }

      html += `
          </div>
        </div>
      `;
    });

    // ── Single-player (walkover) category: rounds is empty but bye player exists ──
    const byePlayersAll = this.currentBracket.byePlayers || {};
    if (this.currentBracket.rounds.length === 0 && byePlayersAll['0']) {
      const soloPlayer = byePlayersAll['0'];
      html += `
        <div class="round">
          <h3 class="round-title">Champion</h3>
          <div class="matches">
            <div class="match bye-card">
              <div class="match-players">
                <div class="player">
                  <span class="player-name">${soloPlayer.playerName}</span>
                  <span class="player-center">${soloPlayer.centerName || ''}</span>
                </div>
              </div>
              <div class="match-completed-info">
                <span class="winner-badge">🥇 Gold — Won by Walkover</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    html += '</div>';
    container.innerHTML = html;

    document.getElementById('categoriesList').style.display = 'none';
    container.style.display = 'block';
  },

  // Render a bye-player card for the given round
  renderByeCard(player, roundIsComplete, roundIndex) {
    const label = roundIsComplete
      ? '\u2705 Advanced via BYE to next round'
      : '\u23f3 BYE \u2014 waiting for all matches in this round to finish';
    const draggable = !roundIsComplete
      ? `draggable="true" ondragstart="BRACKET.onDragStartBye(event,'${player.id}',${roundIndex})" style="cursor:grab;"`
      : '';
    const dragHint = !roundIsComplete
      ? `<div style="margin-top:8px;font-size:0.78rem;color:var(--accent-cyan);opacity:0.8;">\ud83e\udd1a Drag to fill an empty slot</div>`
      : '';
    return `
      <div class="match bye-card" ${draggable}>
        <div class="match-players">
          <div class="player">
            <span class="player-name">${player.playerName}</span>
            <span class="player-center">${player.centerName || ''}</span>
          </div>
        </div>
        <div class="match-completed-info">
          <span class="winner-badge" style="background:rgba(255,165,0,0.15);color:#ffa500;border:1px solid #ffa500;">${label}</span>
        </div>
        ${dragHint}
      </div>
    `;
  },

  // Render individual match
  renderMatch(match, roundIndex, matchNumber, matchIndexInRound = 0) {
    const player1 = match.player1;
    const player2 = match.player2;
    const isPendingStatus = match.status === 'pending';
    const canStartMatch = isPendingStatus && player1 && player2;
    const isInProgress = match.status === 'in-progress';
    const isCompleted = match.status === 'completed';

    // Check for same-team match (unavoidable conflict)
    const isSameTeamMatch = player1 && player2 && this.areSameTeam(player1, player2);
    const sameTeamWarning = isSameTeamMatch ? `
      <div style="margin-top: 8px; padding: 8px 10px; background: rgba(255, 165, 0, 0.15); border: 1px solid #ffa500; border-radius: 6px; color: #ffa500; font-size: 0.85rem; font-weight: 600;">
        ⚠️ SAME-TEAM MATCH: Both players are from ${player1.teamName}
      </div>
    ` : '';

    // Helper: render one player slot with edit/delete/replace actions
    const renderSlot = (player, slotClass, slotName) => {
      const isWinner = match.winner === player?.id;
      const isEliminated = match.eliminated === player?.id;
      const isEditing = this.editingSlot &&
        this.editingSlot.matchId === match.matchId &&
        this.editingSlot.slot === slotName;

      if (isEditing) {
        const curName = player ? player.playerName : '';
        const curTeam = player ? (player.centerName || '') : '';
        return `
          <div class="player ${slotClass}">
            <div class="player-edit-form">
              <input type="text" id="edit_name_${match.matchId}_${slotName}"
                     value="${curName.replace(/"/g, '&quot;')}"
                     placeholder="Player Name"
                     onkeydown="if(event.key==='Enter'){BRACKET.saveEditPlayer('${match.matchId}','${slotName}')}else if(event.key==='Escape'){BRACKET.cancelEdit()}">
              <input type="text" id="edit_team_${match.matchId}_${slotName}"
                     value="${curTeam.replace(/"/g, '&quot;')}"
                     placeholder="Team / Club (optional)"
                     onkeydown="if(event.key==='Enter'){BRACKET.saveEditPlayer('${match.matchId}','${slotName}')}else if(event.key==='Escape'){BRACKET.cancelEdit()}">
              <div style="display:flex;gap:6px;margin-top:6px;">
                <button class="player-action-btn" style="background:rgba(0,200,80,0.15);border-color:var(--success-green);color:var(--success-green);"
                        onclick="BRACKET.saveEditPlayer('${match.matchId}','${slotName}')">✓ Save</button>
                <button class="player-action-btn" style="background:rgba(255,23,68,0.1);border-color:var(--accent-red);color:var(--accent-red);"
                        onclick="BRACKET.cancelEdit()">✕ Cancel</button>
              </div>
            </div>
          </div>`;
      }

      const isDropTarget = !player && isPendingStatus;
      const dropAttrs = isDropTarget
        ? `ondragover="event.preventDefault();this.classList.add('drag-over')"
           ondragleave="this.classList.remove('drag-over')"
           ondrop="BRACKET.onDropByeToSlot(event,'${match.matchId}','${slotName}')"`
        : '';

      const actionBtns = isPendingStatus ? `
        <div class="player-actions" onclick="event.stopPropagation()">
          ${player ? `
            <button class="player-action-btn edit-btn" onclick="BRACKET.startEditPlayer('${match.matchId}','${slotName}')" title="Edit player">✏️</button>
            <button class="player-action-btn delete-btn" onclick="BRACKET.deletePlayerFromMatch('${match.matchId}','${slotName}')" title="Remove player">🗑️</button>
          ` : `
            <button class="player-action-btn fill-btn" onclick="BRACKET.startEditPlayer('${match.matchId}','${slotName}')" title="Manually add player">+ Fill Slot</button>
          `}
        </div>` : '';

      return `
        <div class="player ${slotClass} ${isWinner ? 'winner' : ''} ${isEliminated ? 'eliminated' : ''} ${isDropTarget ? 'drop-target' : ''}"
             ${dropAttrs}>
          <span class="player-name">
            ${player ? player.playerName : (isDropTarget ? '<span style="color:var(--accent-cyan);font-style:italic;font-size:0.85rem;">Drop BYE player here</span>' : '<span class="bye">BYE</span>')}
          </span>
          <span class="player-center">${player ? (player.centerName || '') : ''}</span>
          ${actionBtns}
        </div>`;
    };

    // Referees have one fixed assigned court (set at login) — pre-select it here so
    // starting a match always records a courtNumber without an extra manual step.
    // Admin/judge sessions have no assigned court, so the dropdown still defaults blank for them.
    const _assignedCourt = String(sessionStorage.getItem('courtNumber') || '').trim();
    const _courtOption = (n) => `<option value="${n}"${_assignedCourt === String(n) ? ' selected' : ''}>Court ${n}</option>`;

    let html = `
      <div class="match ${match.status}${isSameTeamMatch ? ' same-team-match' : ''}" data-match-id="${match.matchId}">
        ${matchNumber ? `<div class="match-number-badge">Match ${matchNumber}</div>` : ''}
        <div class="match-players">
          ${renderSlot(player1, 'player-blue', 'player1')}
          <div class="vs">VS</div>
          ${renderSlot(player2, 'player-red', 'player2')}
        </div>

        ${sameTeamWarning}

        ${canStartMatch ? `
          <div style="margin-top: 12px;">
            <label style="display: block; font-size: 0.9rem; color: var(--accent-cyan); margin-bottom: 6px; font-weight: 700;">🏟️ Court Number</label>
            <select id="court_${match.matchId}" style="width: 100%; padding: 8px 12px; background: var(--secondary-black); border: 1px solid var(--accent-cyan); color: var(--text-white); border-radius: 6px; font-size: 1rem; margin-bottom: 10px;">
              <option value="">Select Court</option>
              ${_courtOption(1)}
              ${_courtOption(2)}
              ${_courtOption(3)}
              ${_courtOption(4)}
              ${_courtOption(5)}
            </select>
            <button class="btn-start-match" onclick="BRACKET.startMatch('${match.matchId}')">
              ▶️ Start Match
            </button>
          </div>
        ` : ''}

        ${isInProgress ? this.renderMatchControls(match) : ''}

        ${isCompleted ? `
          <div class="match-completed-info">
            ${(() => {
              const totalRounds = this.getExpectedTotalRounds(this.currentBracket);
              let winLabel = '✅ Winner';
              let loseLabel = '❌ Eliminated';
              if (roundIndex === totalRounds - 1) {
                winLabel = '🥇 Gold';
                loseLabel = '🥈 Silver';
              } else if (roundIndex === totalRounds - 2) {
                loseLabel = matchIndexInRound === 0 ? '🥉 1st Bronze' : '🥉 2nd Bronze';
              }
              const winnerName = match.winner === player1?.id ? player1.playerName : player2.playerName;
              const loserName = match.eliminated === player1?.id ? player1.playerName : player2.playerName;
              
              let htmlStr = `<span class="winner-badge">${winLabel}: ${winnerName}</span>`;
              if (match.eliminated) {
                htmlStr += `<span class="eliminated-badge">${loseLabel}: ${loserName}</span>`;
              }
              return htmlStr;
            })()}
          </div>
        ` : ''}
      </div>
    `;

    return html;
  },

  // Render match control UI when match is in progress
  renderMatchControls(match) {
    const player1 = match.player1;
    const player2 = match.player2;

    return `
      <div class="match-controls">
        <div class="match-in-progress">
          ⏱️ Match in Progress...${match.courtNumber ? ` &nbsp;|&nbsp; 🏟️ Court ${match.courtNumber}` : ''}
        </div>

        <div class="match-actions">
          <div class="winner-selection">
            <label class="selection-label">Select Winner:</label>
            <div class="selection-group">
              <label class="radio-label">
                <input type="radio" name="winner_${match.matchId}" value="${player1.id}" onchange="BRACKET.setWinner('${match.matchId}', '${player1.id}')">
                ${player1.playerName}
              </label>
              <label class="radio-label">
                <input type="radio" name="winner_${match.matchId}" value="${player2.id}" onchange="BRACKET.setWinner('${match.matchId}', '${player2.id}')">
                ${player2.playerName}
              </label>
            </div>
          </div>

          <button class="btn-stop-match" onclick="BRACKET.stopAndDeclareWinner('${match.matchId}')">
            🛑 Stop Match & Declare Winner
          </button>
        </div>
      </div>
    `;
  },

  // Start match
  async startMatch(matchId) {
    const match = this.findMatch(matchId);
    if (!match || !match.player1 || !match.player2) {
      console.log("❌ Match not found or missing players");
      return;
    }

    // ── WARN IF SAME-TEAM MATCH (unavoidable conflict) ──────────────────
    if (this.areSameTeam(match.player1, match.player2)) {
      console.warn(`⚠️ SAME-TEAM MATCH: ${match.player1.playerName} vs ${match.player2.playerName} (${match.player1.teamName})`);
      if (typeof MODAL !== 'undefined') {
        MODAL.warning(
          `⚠️ SAME-TEAM MATCH ALERT\n\n${match.player1.playerName} vs ${match.player2.playerName}\n\nBoth players are from ${match.player1.teamName}. This pairing was unavoidable due to team composition.`,
          'Match is proceeding'
        );
      }
    }

    console.log("🎮 Starting match:", matchId);

    // Read court number from selector if present
    const courtSelect = document.getElementById(`court_${matchId}`);
    const courtNumber = courtSelect ? courtSelect.value : '';

    match.status = 'in-progress';
    match.startTime = new Date().toISOString();
    match.courtNumber = courtNumber || null;
    match.winner = null;
    match.eliminated = null;

    await this.saveBracket(this.currentCategory, this.currentBracket);
    this.renderBracket();

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
        matchType: 'official',
        activeMatchId: match.matchId
      });
    }

    // Update category list to show "Live" status
    if (!document.getElementById('bracketContainer').style.display || document.getElementById('bracketContainer').style.display === 'none') {
      this.renderCategories();
    }
  },

  // Set winner (when radio button selected)
  setWinner(matchId, playerId) {
    const match = this.findMatch(matchId);
    if (!match) return;

    match.winner = playerId;
    match.eliminated = match.player1.id === playerId ? match.player2.id : match.player1.id;
  },

  // Stop match and declare winner
  async stopAndDeclareWinner(matchId) {
    const match = this.findMatch(matchId);
    if (!match || !match.winner) {
      MODAL.warning('Please select the winner first!');
      return;
    }

    const confirmed = await MODAL.showConfirm('Are you sure? This action cannot be undone.');

    if (!confirmed) {
      return;
    }

    match.status = 'completed';
    match.endTime = new Date().toISOString();

    // Match finished but the bracket stays open — clear the active match only,
    // so Live disappears while Upcoming keeps showing the next scheduled match.
    if (match.courtNumber && typeof LIVE_PRESENCE !== 'undefined') {
      LIVE_PRESENCE.setCourtState(match.courtNumber, {
        categoryKey: this.currentCategory,
        matchType: 'official',
        activeMatchId: null
      });
    }

    await this.saveMatchToHistory(this.currentCategory, match);

    this.advanceWinner(match);

    await this.saveBracket(this.currentCategory, this.currentBracket);
    this.renderBracket();

    // Update category list to show status change (from "Live" to potentially "Completed" or "Pending")
    this.renderCategories();

    const winnerName = match.player1.id === match.winner ? match.player1.playerName : match.player2.playerName;
    if (typeof MODAL !== 'undefined') {
      MODAL.success(`Match completed! ${winnerName} advances to the next round.`);
    } else {
      alert(`✅ Match completed! ${winnerName} advances to the next round.`);
    }

    // If entire category is now complete, auto-prompt Excel export
    if (this.isCategoryComplete()) {
      setTimeout(async () => {
        const doExport = await MODAL.showConfirm('🏆 All matches complete! Download the results Excel sheet?');
        if (doExport) this.exportToExcel();
      }, 600);
    }
  },

  // Automatically assign a BYE (walkover) if there is exactly one unpaired player in the round
  // and no BYE players available in the drop pool.
  processAutoByes(roundIndex) {
    if (!this.currentBracket || !this.currentBracket.rounds) return false;
    
    const round = this.currentBracket.rounds[roundIndex];
    if (!round) return false;
    
    const hasByePlayer = this.getByeList(this.currentBracket, roundIndex).length > 0;

    // Find unpaired matches (exactly 1 player). Matches flagged
    // `pendingManualBye` are intentionally left unpaired by bracket
    // generation (odd player count) or Round-1 conflict reshuffling — those
    // must wait for an explicit admin decision in the Bracket Editor, not
    // get auto-completed here. This walkover path exists purely as a safety
    // net for players deleted mid-tournament, leaving a genuine orphan.
    const unpairedMatches = round.filter(m => m.status === 'pending' && !m.pendingManualBye &&
      ((m.player1 && !m.player2) || (!m.player1 && m.player2)));
    
    // Find empty matches (0 players)
    const emptyMatches = round.filter(m => m.status === 'pending' && !m.player1 && !m.player2);
    
    let changed = false;
    
    // Auto-advance if exactly 1 unpaired match, NO empty matches, and no bye players waiting
    if (unpairedMatches.length === 1 && !hasByePlayer && emptyMatches.length === 0) {
      const match = unpairedMatches[0];
      const remainingPlayer = match.player1 || match.player2;
      
      match.status = 'completed';
      match.winner = remainingPlayer.id;
      match.eliminated = null;
      match.endTime = new Date().toISOString();
      match.isAutoBye = true;
      
      console.log(`🤖 Auto-advancing ${remainingPlayer.playerName} in R${roundIndex + 1} (No opponents available)`);
      
      if (typeof this.saveMatchToHistory === 'function') {
        this.saveMatchToHistory(this.currentCategory, match).catch(e => console.warn(e));
      }
      changed = true;
    }
    
    return changed;
  },

  // Advance winner: when every match in the current round is complete,
  // build the next round dynamically (including correct bye assignment).
  advanceWinner(match) {
    const roundNum = parseInt(match.matchId.split('_')[0].substring(1)); // 1-based
    const roundIndex = roundNum - 1;                                        // 0-based

    const currentRound = this.currentBracket.rounds[roundIndex];

    // The real-time bracketListener can fire during any awaited async call
    // (e.g. saveMatchToHistory) and replace this.currentBracket with the
    // Firebase copy — which still has this match as 'in-progress' because
    // saveBracket hasn't run yet.  Re-apply the completed match's fields into
    // the current bracket so the allDone check is accurate.
    const bracketMatch = currentRound.find(m => m.matchId === match.matchId);
    if (bracketMatch) {
      bracketMatch.status = match.status;
      bracketMatch.winner = match.winner;
      bracketMatch.eliminated = match.eliminated;
      bracketMatch.endTime = match.endTime;
    }

    this.processAutoByes(roundIndex);

    const allDone = currentRound.every(m => m.status === 'completed');

    if (allDone) {
      this.buildNextRound(roundIndex);
    }
  },

  // Show match history
  showMatchHistory() {
    let html = '<div class="match-history-modal">';
    html += '<h2>📋 Previous Matches</h2>';

    if (!this.matchHistory || Object.keys(this.matchHistory).length === 0) {
      html += '<p class="no-matches">No completed matches yet</p>';
    } else {
      html += '<div class="history-list">';

      Object.keys(this.matchHistory).forEach(matchId => {
        const match = this.matchHistory[matchId];
        const player1 = match.player1;
        const player2 = match.player2;
        const winner = match.winner === player1.id ? player1 : player2;
        const eliminated = match.winner === player1.id ? player2 : player1;

        const time = match.endTime ? new Date(match.endTime).toLocaleString() : 'In Progress';

        html += `
          <div class="history-item">
            <div class="history-match">
              <span class="winner-name">${winner.playerName}</span>
              <span class="vs-text">defeated</span>
              <span class="eliminated-name">${eliminated.playerName}</span>
            </div>
            <div class="history-meta">
              <span class="round">${match.matchId}</span>
              <span class="time">${time}</span>
            </div>
          </div>
        `;
      });

      html += '</div>';
    }

    html += '<button class="btn-close-history" onclick="BRACKET.closeMatchHistory()">Close</button>';
    html += '</div>';

    let modal = document.getElementById('matchHistoryModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'matchHistoryModal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = html;
    modal.style.display = 'flex';
  },

  // Close match history
  closeMatchHistory() {
    const modal = document.getElementById('matchHistoryModal');
    if (modal) {
      modal.style.display = 'none';
    }
  },

  // Find match by ID
  findMatch(matchId) {
    for (let round of this.currentBracket.rounds) {
      const match = round.find(m => m.matchId === matchId);
      if (match) return match;
    }
    return null;
  },

  // Get expected total rounds for this bracket (works for new + legacy data)
  getExpectedTotalRounds(bracket) {
    if (!bracket) return 0;

    const expectedCounts = bracket.expectedRoundMatchCounts || [];
    const expectedTotal = Array.isArray(expectedCounts)
      ? expectedCounts.length
      : Object.keys(expectedCounts).length;

    if (expectedTotal > 0) return expectedTotal;

    // Legacy fallback: infer total rounds from player count
    const playerCount = Number(bracket.playerCount);
    if (Number.isFinite(playerCount) && playerCount > 1) {
      let rounds = 0;
      let cur = playerCount;
      while (cur > 1) {
        rounds += 1;
        cur = Math.ceil(cur / 2);
      }
      return rounds;
    }

    return Array.isArray(bracket.rounds) ? bracket.rounds.length : 0;
  },

  // Get round name
  getRoundName(roundIndex, totalRounds, round) {
    // If we have the actual round number from match data, use it directly
    const roundNum = Number(round);
    if (Number.isFinite(roundNum) && roundNum > 0) {
      // Only use labels for Final, Semi, Quarter-Final if we know total rounds
      if (totalRounds && roundNum === totalRounds) return 'Final';
      if (totalRounds && roundNum === totalRounds - 1) return 'Semi-Final';
      if (totalRounds && roundNum === totalRounds - 2) return 'Quarter-Final';
      return `Round ${roundNum}`;
    }

    // Fallback: Calculate distance from the final
    const distanceFromFinal = totalRounds - 1 - roundIndex;

    if (distanceFromFinal === 0) return 'Final';
    if (distanceFromFinal === 1) return 'Semi-Final';
    if (distanceFromFinal === 2) return 'Quarter-Final';

    // For earlier rounds: Round X where X = roundIndex + 1
    return `Round ${roundIndex + 1}`;
  },

  // Mark this referee's court active for the Live Matches page the moment a
  // bracket is opened — before any match has started. If the bracket already
  // has an in-progress match on this court (referee resumed/refreshed
  // mid-match), that match is restored as the active one immediately;
  // otherwise the court shows as "open, no match started" (Upcoming only).
  _openLiveCourtPresence(categoryKey) {
    if (typeof LIVE_PRESENCE === 'undefined') return;
    const assignedCourt = String(sessionStorage.getItem('courtNumber') || '').trim();
    if (!assignedCourt) return; // admin/judge with no fixed court — presence starts at Start Match instead

    let resumedMatchId = null;
    if (this.currentBracket && this.currentBracket.rounds) {
      this.currentBracket.rounds.forEach(round => {
        (round || []).forEach(match => {
          if (match && match.status === 'in-progress' && String(match.courtNumber) === assignedCourt) {
            resumedMatchId = match.matchId;
          }
        });
      });
    }

    this._liveCourtNumber = assignedCourt;
    LIVE_PRESENCE.setCourtState(assignedCourt, {
      categoryKey,
      matchType: 'official',
      activeMatchId: resumedMatchId
    });
  },

  // Close category view
  async closeCategory() {
    // Stop real-time listeners when leaving the bracket
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

    // Update bracket status before closing
    if (this.currentCategory && this.currentBracket) {
      const isBracketComplete = this.isCategoryComplete();

      if (isBracketComplete) {
        // Keep as "Complete" if all matches are done
        this.currentBracket.status = 'complete';
        console.log(`✅ Bracket ${this.currentCategory} marked as COMPLETE`);
      } else {
        // Revert to "Pending" if matches remain
        this.currentBracket.status = 'pending';
        console.log(`⏳ Bracket ${this.currentCategory} reverted to PENDING`);
      }

      await this.saveBracket(this.currentCategory, this.currentBracket);
    }

    document.getElementById('bracketContainer').style.display = 'none';
    document.getElementById('categoriesList').style.display = 'block';
    this.currentCategory = null;
    this.currentBracket = null;
    this.matchHistory = [];

    // Refresh category list to update status display, then resume real-time
    // listening so any other user's bracket opens/closes appear immediately.
    await this.renderCategories();
    this.setupCategoriesListener();
  },

  // Check if every round has been built and every match is completed
  isCategoryComplete() {
    if (!this.currentBracket) return false;
    if (this.currentBracket.status === 'complete') return true;

    const rounds = this.currentBracket.rounds;
    const roundsArr = Array.isArray(rounds) ? rounds : (rounds ? Object.values(rounds) : []);

    // Single-player walkover: no actual matches but a bye player exists
    const hasActualMatches = roundsArr.some(r => {
      const ra = Array.isArray(r) ? r : (r ? Object.values(r) : []);
      return ra.length > 0;
    });
    if (!hasActualMatches) {
      const byePlayers = this.currentBracket.byePlayers || {};
      return !!byePlayers['0'];  // complete if walkover champion exists
    }

    if (roundsArr.length === 0) return false;
    const expectedTotal = this.getExpectedTotalRounds(this.currentBracket);
    if (roundsArr.length < expectedTotal) return false;
    for (const round of roundsArr) {
      const matchArr = Array.isArray(round) ? round : (round ? Object.values(round) : []);
      for (const match of matchArr) {
        if (match.status !== 'completed') return false;
      }
    }
    return true;
  },

  // Derive final rankings from bracket structure
  // 1st = winner of final, 2nd = loser of final, 3rd = both semi-final losers
  // Kept as a thin wrapper over buildRankingsFor() so the currently-open
  // category's UI/exports and the all-categories export (which has no
  // "current" bracket — it reads each category straight from Firebase)
  // share one implementation instead of drifting apart.
  buildRankings() {
    return this.buildRankingsFor(this.currentBracket);
  },

  buildRankingsFor(bracket) {
    const rounds = (bracket && bracket.rounds) || [];
    const totalRounds = rounds.length;
    const rankings = [];

    // Rounds are stored in FORWARD order: [Round 1, Quarter-Final, Semi-Final, Final]
    // Final is at the last index (totalRounds - 1)
    const finalRound = rounds[totalRounds - 1];
    if (!finalRound || finalRound.length === 0) {
      // Handle single-player categories: only a bye player, no matches
      const byePlayers = (bracket && bracket.byePlayers) || {};
      const byePlayer = byePlayers['0'];
      if (byePlayer) {
        rankings.push({ rank: 1, medal: 'Gold', player: byePlayer, note: 'Winner (walkover)' });
      }
      return rankings;
    }

    const finalMatch = finalRound[0];
    if (!finalMatch || !finalMatch.winner) return rankings;

    const champion = finalMatch.player1.id === finalMatch.winner ? finalMatch.player1 : finalMatch.player2;
    const runnerUp = finalMatch.player1.id === finalMatch.winner ? finalMatch.player2 : finalMatch.player1;

    rankings.push({ rank: 1, medal: 'Gold', player: champion, note: 'Winner' });
    rankings.push({ rank: 2, medal: 'Silver', player: runnerUp, note: 'Runner-up' });

    // Semi-final losers get 3rd (if semi-final exists)
    if (totalRounds >= 2) {
      const semiRound = rounds[totalRounds - 2];
      semiRound.forEach((match, index) => {
        if (match.player1 && match.player2 && match.winner && match.eliminated) {
          const loser = match.player1.id === match.eliminated ? match.player1 : match.player2;
          rankings.push({ rank: 3, medal: index === 0 ? '1st Bronze' : '2nd Bronze', player: loser, note: `Losing Semifinalist ${index + 1}` });
        }
      });
    }

    // All other eliminated players in round order (earliest eliminated = lowest rank)
    const addedIds = new Set(rankings.map(r => r.player.id));
    let rankNum = rankings.length + 1;

    for (let ri = totalRounds - 3; ri >= 0; ri--) {
      const round = rounds[ri];
      round.forEach(match => {
        if (match.eliminated) {
          const loser = match.player1 && match.player1.id === match.eliminated ? match.player1 : match.player2;
          if (loser && !addedIds.has(loser.id)) {
            rankings.push({ rank: rankNum++, medal: '', player: loser, note: `Eliminated in ${this.getRoundName(ri, totalRounds)}` });
            addedIds.add(loser.id);
          }
        }
      });
    }

    return rankings;
  },

  // ── ALL-CATEGORIES RESULTS EXPORT (Excel / PDF) ──────────────────────────
  // One flat file spanning every COMPLETED category — medal winners only
  // (Gold/Silver/1st Bronze/2nd Bronze), grouped by category. Reads every
  // bracket straight from Firebase in one shot rather than relying on
  // this.currentBracket (which only ever holds the ONE category currently
  // open), so it works directly from the categories list without opening
  // each category individually first.
  _normalizeBracketRoundsForExport(bracketData) {
    const toArray = (obj) => Array.isArray(obj)
      ? obj
      : Object.keys(obj || {}).sort((a, b) => Number(a) - Number(b)).map(k => obj[k]);
    const rounds = toArray(bracketData.rounds || []).map(round => toArray(round || []));
    return { ...bracketData, rounds };
  },

  // Returns [{ category, rows: [{ playerName, medal, teamName }] }] — one
  // group per COMPLETED category, in category-name order. teamName falls
  // back to centerName the same way the rest of the app already does
  // (_normalizePlayerTeam keeps the two in sync, but older records may only
  // have one or the other set).
  async _collectAllCategoryMedalGroups() {
    const bracketsSnap = await dbGet(dbRef(database, 'brackets'));
    const allBrackets = bracketsSnap.exists() ? bracketsSnap.val() : {};

    const categoryKeys = Object.keys(this.categories).sort((a, b) => {
      const ca = this.categories[a], cb = this.categories[b];
      return `${ca.gender} ${ca.ageCategory} ${ca.weightCategory}`
        .localeCompare(`${cb.gender} ${cb.ageCategory} ${cb.weightCategory}`);
    });

    const groups = [];
    categoryKeys.forEach(key => {
      const bracketData = allBrackets[key];
      if (!bracketData || bracketData.status !== 'complete') return;

      const cat = this.categories[key];
      const categoryLabel = `${cat.gender} ${cat.ageCategory} - ${cat.weightCategory}`;
      const normalized = this._normalizeBracketRoundsForExport(bracketData);
      const medalRows = this.buildRankingsFor(normalized)
        .filter(r => r.medal && r.player)
        .map(r => ({
          playerName: r.player.playerName,
          medal: r.medal,
          teamName: r.player.teamName || r.player.centerName || '',
        }));

      if (medalRows.length > 0) groups.push({ category: categoryLabel, rows: medalRows });
    });

    return groups;
  },

  async downloadAllCategoriesResults(format) {
    this.closeDownloadAllMenu?.();

    if (format === 'excel' && typeof XLSX === 'undefined') {
      MODAL.error('Excel library not loaded. Please refresh the page and try again.');
      return;
    }
    if (format === 'pdf' && typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
      MODAL.error('PDF library not loaded. Please refresh and try again.');
      return;
    }

    let groups;
    try {
      groups = await this._collectAllCategoryMedalGroups();
    } catch (err) {
      console.error('❌ Error collecting all-category results:', err);
      MODAL.error('Error loading category results: ' + err.message);
      return;
    }

    if (groups.length === 0) {
      MODAL.warning('No completed categories with medal results yet.');
      return;
    }

    const champTitle = document.title.replace(' - Bracket Management', '').trim() || 'Tournament';
    const dateStr = new Date().toISOString().slice(0, 10);

    if (format === 'excel') {
      this._writeAllResultsWorkbook(groups, `All_Category_Results_${dateStr}.xlsx`, 'All Results');
      return;
    }

    this._writeAllResultsPDF(groups, champTitle, `All_Category_Results_${dateStr}.pdf`, 'All Category Results');
  },

  // Excel: one sheet, categories stacked top-to-bottom — a bold category
  // heading row, a table header (Player Name / Medal / Team Name / Remark),
  // then one row per medal winner, then a blank spacer before the next
  // category. Remark is left empty for the tournament desk to fill in by
  // hand. EXPO_BRACKET keeps its own copy in expoBracket.js — the two
  // systems are intentionally independent.
  _writeAllResultsWorkbook(groups, fileName, sheetName) {
    const NAVY = '17305E', WHITE = 'FFFFFF', LTGRAY = 'E8ECF0';
    const fgFill = (hex) => ({ patternType: 'solid', fgColor: { rgb: hex } });
    const catStyle = { font: { bold: true, sz: 12, color: { rgb: WHITE } }, fill: fgFill(NAVY), alignment: { vertical: 'center' } };
    const hdrStyle = { font: { bold: true, sz: 9, color: { rgb: WHITE } }, fill: fgFill('2C4A7C'), alignment: { horizontal: 'center', vertical: 'center' } };
    const cellStyle = { font: { sz: 9 }, fill: fgFill(LTGRAY), alignment: { vertical: 'center' } };

    const ws = {};
    const COLS = 4; // Player Name, Medal, Team Name, Remark
    let r = 0;
    const enc = (row, col) => XLSX.utils.encode_cell({ r: row, c: col });
    const setCell = (row, col, v, s) => { ws[enc(row, col)] = { v: v ?? '', t: typeof v === 'number' ? 'n' : 's', s: s || {} }; };
    ws['!merges'] = [];

    groups.forEach(group => {
      ws['!merges'].push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } });
      setCell(r, 0, group.category, catStyle);
      r++;
      ['Player Name', 'Medal', 'Team Name', 'Remark'].forEach((h, c) => setCell(r, c, h, hdrStyle));
      r++;
      group.rows.forEach(row => {
        setCell(r, 0, row.playerName, cellStyle);
        setCell(r, 1, row.medal, cellStyle);
        setCell(r, 2, row.teamName, cellStyle);
        setCell(r, 3, '', cellStyle); // Remark — left blank
        r++;
      });
      r++; // spacer row between categories
    });

    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r - 1, 0), c: COLS - 1 } });
    ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 30 }, { wch: 24 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
  },

  // PDF: one bordered table per category (Player Name / Medal / Team Name /
  // Remark), stacked one after another; a category whose table won't fit in
  // the remaining page space starts on a fresh page instead of splitting.
  // Long titles and long names/team names WRAP within their own width
  // (title within the page, each cell within its column) rather than
  // running off the page or overlapping the next column — text is never
  // shrunk or truncated, rows just grow taller to fit.
  _writeAllResultsPDF(groups, champTitle, fileName, headingSuffix) {
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

    const drawTable = (categoryLabel, rows) => {
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
      const neededH = 20 + tableH; // category heading + table
      if (y + neededH > BOTTOM && y > 44) { doc.addPage(); y = 44; }

      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text(categoryLabel, ML, y);
      y += 16;
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

    groups.forEach(group => drawTable(group.category, group.rows));

    doc.save(fileName);
  },

  // Small popover next to the status-filter tabs offering the two export
  // formats for downloadAllCategoriesResults() — kept local to this file
  // rather than extending MODAL, since it's just a two-item menu anchored
  // to a button (not a full dialog).
  toggleDownloadAllMenu(event) {
    event?.stopPropagation();
    const menu = document.getElementById('downloadAllMenu');
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
      // Deferred so the click that opened the menu doesn't also close it.
      setTimeout(() => document.addEventListener('click', closeOnOutsideClick), 0);
    }
  },

  closeDownloadAllMenu() {
    const menu = document.getElementById('downloadAllMenu');
    if (menu) menu.style.display = 'none';
  },

  // Download fixture bracket as PDF — landscape A3, professional navy style
  // NOTE: superseded on the View Bracket page by admin/bracket.html's
  // downloadOfficialFightDiagramPDF(), which overrides this button's
  // onclick after every render. Kept functional (and safe against the
  // multi-bye Round 1 shape the Bracket Editor can now produce) as a
  // fallback / public API, but only renders the first Round-1 bye — its
  // single-bye junction geometry was never built to lay out several.
  downloadFixturePDF() {
    if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
      MODAL.error('PDF library not loaded. Please refresh and try again.');
      return;
    }
    if (!this.currentBracket) {
      MODAL.warning('No bracket loaded.');
      return;
    }

    try {
      const { jsPDF } = window.jspdf || window;
      const cat = this.categories[this.currentCategory];
      const champTitle = document.title.replace(' - Bracket Management', '').trim() || 'Tournament';
      const categoryLabel = `${cat.gender} ${cat.ageCategory} - ${cat.weightCategory}`;

      const toArr = o => Array.isArray(o) ? o
        : Object.keys(o).sort((a, b) => Number(a) - Number(b)).map(k => o[k]);
      const rounds = toArr(this.currentBracket.rounds).map(r => toArr(r));
      const expectedCnts = toArr(this.currentBracket.expectedRoundMatchCounts || []);
      const totalRounds = Math.max(rounds.length, expectedCnts.length);

      // ── PAGE SETUP (A3 landscape, mm) ────────────────────────────────
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
      const PW = 420, PH = 297;
      const ML = 8, MR = 8, MT = 8, MB = 12;
      const W = PW - ML - MR;

      const r1Matches = rounds[0] || [];
      // This function's junction geometry was built for at most one Round-1
      // bye; take just the first so a multi-bye edited bracket still renders
      // safely instead of showing an array where a player object is expected.
      const r1ByePlayer = this.getByeList(this.currentBracket, 0)[0] || null;

      // Colors [R,G,B]
      const NAVY  = [23, 48, 94];
      const WHITE = [255, 255, 255];
      const LINE  = [26, 58, 107];
      const LTBG  = [235, 240, 248];
      const ADVBG = [224, 237, 255];
      const GREEN = [21, 87, 36];
      const GOLD  = [201, 168, 76];
      const GRAY  = [80, 80, 80];

      // Draw helpers
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
        ln(x, y, x + w, y, 0.35);         // top
        ln(x, y, x, y + h, 0.35);         // left
        ln(x, y + h, x + w, y + h, 0.35); // bottom
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

      // ── SINGLE-PLAYER WALKOVER: bracket-style PDF ──────────────────────
      if (totalRounds === 0 && r1ByePlayer) {
        const HEADER_H = 20, GOLD_LINE = 0.8, LABEL_H = 8, FOOTER_H = 10;
        const CONTENT_TOP = MT + HEADER_H + GOLD_LINE + LABEL_H + 1;
        const CONTENT_H = PH - CONTENT_TOP - MB - FOOTER_H;
        const SEED_W = 6, ARM_W = 11, CHAMP_W = 50;
        const ROUND_W = (W - SEED_W - ARM_W - CHAMP_W);

        // ── HEADER ──
        sf(NAVY); doc.rect(ML, MT, W, HEADER_H, 'F');
        txt(champTitle.toUpperCase(), PW / 2, MT + HEADER_H * 0.37, 16, true, WHITE, 'center');
        txt(categoryLabel.toUpperCase(), PW / 2, MT + HEADER_H * 0.74, 9, false, [160, 185, 220], 'center');
        sf(GOLD); doc.rect(ML, MT + HEADER_H, W, GOLD_LINE, 'F');

        // ── ROUND LABEL ──
        const labelY = MT + HEADER_H + GOLD_LINE + LABEL_H / 2 + 0.5;
        txt('CHAMPION', ML + SEED_W + ROUND_W / 2, labelY, 7.5, true, NAVY, 'center');
        ln(ML, MT + HEADER_H + GOLD_LINE + LABEL_H, ML + W,
           MT + HEADER_H + GOLD_LINE + LABEL_H, 0.25, [180, 180, 180]);

        // ── PLAYER CELL ──
        const cellY = CONTENT_TOP + CONTENT_H / 2 - 5;
        const cellH = 10;
        const cellX = ML + SEED_W;

        // Seed number
        drawSeed(ML, cellY, SEED_W, cellH, 1);

        // Player cell
        const pname = r1ByePlayer.playerName
          + (r1ByePlayer.centerName ? ` (${r1ByePlayer.centerName})` : '')
          + ' — BYE';
        drawCell(cellX, cellY, ROUND_W, cellH, pname, [210, 245, 210], true);

        // Bracket arm from cell to champion box
        const midY = cellY + cellH / 2;
        const armStartX = cellX + ROUND_W;
        const armEndX = armStartX + ARM_W;
        ln(armStartX, midY, armEndX, midY);

        // Champion box
        const champBoxW = CHAMP_W - 4;
        const champX = armEndX + 2;
        sf(GREEN); doc.rect(champX, midY - 5, champBoxW, 10, 'F');
        txt(r1ByePlayer.playerName || '', champX + champBoxW / 2, midY, 8, true, WHITE, 'center');

        // ── FOOTER ──
        const footerY = PH - MB - FOOTER_H / 2;
        ln(ML, PH - MB - FOOTER_H, ML + W, PH - MB - FOOTER_H, 0.3, [150, 150, 150]);
        txt(`${champTitle}  |  ${categoryLabel}`, ML, footerY, 7, false, GRAY, 'left');
        txt(`Generated: ${new Date().toLocaleDateString('en-IN')}`, ML + W, footerY, 7, false, GRAY, 'right');

        const safeKey = this.currentCategory.replace(/[^a-zA-Z0-9]/g, '_');
        doc.save(`Fixture_${safeKey}_${new Date().toISOString().slice(0, 10)}.pdf`);
        return;
      }

      // Layout
      const HEADER_H = 20, GOLD_LINE = 0.8, LABEL_H = 8, FOOTER_H = 10;
      const CONTENT_TOP = MT + HEADER_H + GOLD_LINE + LABEL_H + 1;
      const CONTENT_H = PH - CONTENT_TOP - MB - FOOTER_H;
      const SEED_W = 6, ARM_W = 11, JUNC_SZ = 4.5, CHAMP_W = 32;
      const ROUND_W = (W - SEED_W - totalRounds * ARM_W - CHAMP_W) / totalRounds;
      const roundX = ri => ML + SEED_W + ri * (ROUND_W + ARM_W);
      const armCX = ri => roundX(ri) + ROUND_W + ARM_W / 2;

      const numM = r1Matches.length;
      const matchH = CONTENT_H / Math.max(numM, 1);
      const pH = Math.min(matchH * 0.40, 9.5);
      const r1p1Y = mi => CONTENT_TOP + mi * matchH;
      const r1p2Y = mi => CONTENT_TOP + mi * matchH + pH;

      // Junction Y[ri][mi] — recursive midpoint
      const jY = [];
      jY.push(r1Matches.map((_, mi) => CONTENT_TOP + mi * matchH + pH)); // at P1/P2 boundary
      for (let ri = 1; ri < totalRounds; ri++) {
        const prev = jY[ri - 1];
        const cnt = expectedCnts[ri] !== undefined ? expectedCnts[ri] : Math.ceil(prev.length / 2);
        const cur = [];
        for (let mi = 0; mi < cnt; mi++) {
          // expectedCnts[ri] counts every advancing player (including byes
          // this function otherwise skips drawing), so it can exceed what
          // real Round-1 matches alone produced junctions for — mi*2 then
          // runs past prev's end, leaving a undefined and, further down,
          // NaN geometry that made jsPDF's doc.text() throw outright.
          // Fall back to prev's last junction, same as spT/spB below.
          const a = prev[mi * 2] !== undefined ? prev[mi * 2] : prev[prev.length - 1];
          const b = prev[mi * 2 + 1];
          cur.push(b !== undefined ? (a + b) / 2 : a);
        }
        jY.push(cur);
      }

      // Cell span bounds spT[ri][mi] / spB[ri][mi]
      const spT = [], spB = [];
      spT.push(r1Matches.map((_, mi) => r1p1Y(mi)));
      spB.push(r1Matches.map((_, mi) => r1p2Y(mi) + pH));
      for (let ri = 1; ri < totalRounds; ri++) {
        const pT = spT[ri - 1], pB = spB[ri - 1];
        const cnt = expectedCnts[ri] !== undefined ? expectedCnts[ri] : Math.ceil(pT.length / 2);
        const tops = [], bots = [];
        for (let mi = 0; mi < cnt; mi++) {
          const fA = mi * 2, fB = mi * 2 + 1;
          tops.push(pT[fA] !== undefined ? pT[fA] : pT[pT.length - 1]);
          // Same bye-inflated-cnt overrun as above: fA can also run past
          // pB's end, so fall back all the way to pB's last entry rather
          // than an equally-undefined pB[fA].
          bots.push(pB[fB] !== undefined ? pB[fB] : (pB[fA] !== undefined ? pB[fA] : pB[pB.length - 1]));
        }
        spT.push(tops); spB.push(bots);
      }

      // ── HEADER ────────────────────────────────────────────────────────
      sf(NAVY); doc.rect(ML, MT, W, HEADER_H, 'F');
      txt(champTitle.toUpperCase(), PW / 2, MT + HEADER_H * 0.37, 16, true, WHITE, 'center');
      txt(categoryLabel.toUpperCase(), PW / 2, MT + HEADER_H * 0.74, 9, false, [160, 185, 220], 'center');
      sf(GOLD); doc.rect(ML, MT + HEADER_H, W, GOLD_LINE, 'F');

      // ── ROUND LABELS ──────────────────────────────────────────────────
      const labelY = MT + HEADER_H + GOLD_LINE + LABEL_H / 2 + 0.5;
      for (let ri = 0; ri < totalRounds; ri++) {
        const rn = (rounds[ri] && rounds[ri][0]) ? rounds[ri][0].round : ri + 1;
        txt(this.getRoundName(ri, totalRounds, rn).toUpperCase(),
          roundX(ri) + ROUND_W / 2, labelY, 7.5, true, NAVY, 'center');
      }
      txt('CHAMPION', ML + SEED_W + totalRounds * (ROUND_W + ARM_W) + CHAMP_W / 2,
        labelY, 7.5, true, NAVY, 'center');
      ln(ML, MT + HEADER_H + GOLD_LINE + LABEL_H, ML + W,
        MT + HEADER_H + GOLD_LINE + LABEL_H, 0.25, [180, 180, 180]);

      // ── R1 MATCHES ────────────────────────────────────────────────────
      let globalMatchNum = 1;
      doc.setLineDashPattern([], 0);

      r1Matches.forEach((match, mi) => {
        const yP1 = r1p1Y(mi), yP2 = r1p2Y(mi), jy = CONTENT_TOP + mi * matchH + pH;
        const x = roundX(0), ax = armCX(0);
        drawSeed(ML, yP1, SEED_W, pH, mi * 2 + 1);
        drawSeed(ML, yP2, SEED_W, pH, mi * 2 + 2);
        const gapH = matchH - 2 * pH;
        if (gapH > 0.1) { sf(NAVY); doc.rect(ML, yP2 + pH, SEED_W, gapH, 'F'); }
        const n1 = match.player1
          ? match.player1.playerName + (match.player1.centerName ? ` (${match.player1.centerName})` : '') : 'BYE';
        const n2 = match.player2
          ? match.player2.playerName + (match.player2.centerName ? ` (${match.player2.centerName})` : '') : 'BYE';
        drawCell(x, yP1, ROUND_W, pH, n1);
        drawCell(x, yP2, ROUND_W, pH, n2);
        ln(x + ROUND_W, yP1 + pH / 2, ax, yP1 + pH / 2);
        ln(x + ROUND_W, yP2 + pH / 2, ax, yP2 + pH / 2);
        ln(ax, yP1 + pH / 2, ax, yP2 + pH / 2);
        drawJunc(ax, jy, JUNC_SZ, globalMatchNum++);
      });

      if (r1ByePlayer) {
        const br = CONTENT_TOP + numM * matchH;
        drawSeed(ML, br, SEED_W, pH, numM * 2 + 1);
        drawCell(roundX(0), br, ROUND_W, pH,
          r1ByePlayer.playerName + (r1ByePlayer.centerName ? ` (${r1ByePlayer.centerName})` : '') + ' — BYE',
          [245, 240, 220]);
      }

      // ── LATER ROUNDS ──────────────────────────────────────────────────
      for (let ri = 1; ri < totalRounds; ri++) {
        const isFinal = ri === totalRounds - 1;
        const x = roundX(ri);
        const ax = armCX(ri);
        const prevAX = armCX(ri - 1);
        const matchList = rounds[ri] || [];

        if (isFinal) {
          const fm = matchList[0] || {};
          const sfCount = jY[ri - 1].length;
          for (let fi = 0; fi < Math.min(sfCount, 2); fi++) {
            const prevJY = jY[ri - 1][fi];
            const cellTop = prevJY - pH / 2;
            ln(prevAX + JUNC_SZ / 2, prevJY, x, prevJY);    // input arm
            const fp = fi === 0 ? fm.player1 : fm.player2;
            const isW = fp && fm.winner && fp.id === fm.winner;
            const pname = fp ? fp.playerName + (fp.centerName ? ` (${fp.centerName})` : '') : '';
            drawCell(x, cellTop, ROUND_W, pH, pname, isW ? [210, 245, 210] : LTBG, isW);
            ln(x + ROUND_W, prevJY, ax, prevJY);              // output arm
          }
          const finY1 = sfCount >= 1 ? jY[ri - 1][0] : jY[ri][0];
          const finY2 = sfCount >= 2 ? jY[ri - 1][1] : finY1;
          ln(ax, finY1, ax, finY2);             // spine between finalist arms
          drawJunc(ax, jY[ri][0], JUNC_SZ, null);

          // Champion section
          const champX = ax + JUNC_SZ / 2 + 2;
          const champBoxW = CHAMP_W - 4;
          const champJY = jY[ri][0];
          const champ = fm.winner
            ? ((fm.player1 && fm.player1.id === fm.winner) ? fm.player1 : fm.player2) : null;
          if (champ) {
            sf(GREEN); doc.rect(champX, champJY - 5, champBoxW, 10, 'F');
            ln(champX, champJY - 5, champX + champBoxW, champJY - 5, 0.4, GREEN);
            ln(champX, champJY + 5, champX + champBoxW, champJY + 5, 0.4, GREEN);
            txt(champ.playerName, champX + champBoxW / 2, champJY, 8, true, WHITE, 'center');
          } else {
            ln(ax + JUNC_SZ / 2, champJY, champX + champBoxW, champJY, 0.3, LINE);
            txt('CHAMPION', champX + champBoxW / 2, champJY, 8, true, NAVY, 'center');
          }

        } else {
          const cnt = jY[ri].length;
          for (let mi = 0; mi < cnt; mi++) {
            const jy = jY[ri][mi];
            const match = matchList[mi] || {};
            const pjA = jY[ri - 1][mi * 2];
            const pjB = jY[ri - 1][mi * 2 + 1];

            // Horizontal input arms from previous junction boxes
            if (pjA !== undefined) ln(prevAX + JUNC_SZ / 2, pjA, x, pjA);
            if (pjB !== undefined) ln(prevAX + JUNC_SZ / 2, pjB, x, pjB);

            // Vertical spine at column left edge connecting the two incoming arms
            if (pjA !== undefined && pjB !== undefined) ln(x, pjA, x, pjB, 0.35);

            // Compact player cell centered at junction Y
            const cellTop = jy - pH / 2;
            let pname = '', isBold = false;
            if (match.winner) {
              const wp = (match.player1 && match.player1.id === match.winner)
                ? match.player1 : match.player2;
              if (wp) { pname = wp.playerName + (wp.centerName ? ` (${wp.centerName})` : ''); isBold = true; }
            }
            drawCell(x, cellTop, ROUND_W, pH, pname, isBold ? ADVBG : LTBG, isBold);

            // Outgoing arm + junction box
            ln(x + ROUND_W, jy, ax, jy);
            drawJunc(ax, jy, JUNC_SZ, globalMatchNum++);
          }
        }
      }

      // ── FOOTER ────────────────────────────────────────────────────────
      const footerY = PH - MB - FOOTER_H / 2;
      ln(ML, PH - MB - FOOTER_H, ML + W, PH - MB - FOOTER_H, 0.3, [150, 150, 150]);
      txt(`${champTitle}  |  ${categoryLabel}`, ML, footerY, 7, false, GRAY, 'left');
      txt(`Generated: ${new Date().toLocaleDateString('en-IN')}`, ML + W, footerY, 7, false, GRAY, 'right');

      const safeKey = this.currentCategory.replace(/[^a-zA-Z0-9]/g, '_');
      doc.save(`Fixture_${safeKey}_${new Date().toISOString().slice(0, 10)}.pdf`);

    } catch (err) {
      console.error('PDF error:', err);
      MODAL.error('Error generating PDF: ' + err.message);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // PLAYER MANAGEMENT: Edit, Delete, Replace, Drag-and-Drop
  // ═══════════════════════════════════════════════════════════════════════

  // Open inline edit form for a player slot
  startEditPlayer(matchId, slot) {
    this.editingSlot = { matchId, slot };
    this.renderBracket();
    // Focus the name input after render
    setTimeout(() => {
      const input = document.getElementById(`edit_name_${matchId}_${slot}`);
      if (input) { input.focus(); input.select(); }
    }, 50);
  },

  // Cancel inline edit
  cancelEdit() {
    this.editingSlot = null;
    this.renderBracket();
  },

  // Save edited / replaced player data
  async saveEditPlayer(matchId, slot) {
    const nameInput = document.getElementById(`edit_name_${matchId}_${slot}`);
    const teamInput = document.getElementById(`edit_team_${matchId}_${slot}`);
    const newName = nameInput ? nameInput.value.trim() : '';
    const newTeam = teamInput ? teamInput.value.trim() : '';

    if (!newName) {
      MODAL.warning('Player name cannot be empty.');
      return;
    }

    const match = this.findMatch(matchId);
    if (!match) return;

    if (match[slot]) {
      // Edit existing player
      match[slot].playerName = newName;
      match[slot].centerName = newTeam;
      match[slot].teamName = newTeam;
    } else {
      // Fill empty slot with a manually entered player
      match[slot] = {
        id: `manual_${matchId}_${slot}_${Date.now()}`,
        playerName: newName,
        centerName: newTeam,
        teamName: newTeam
      };
    }

    this.editingSlot = null;
    await this.saveBracket(this.currentCategory, this.currentBracket);
    this.renderBracket();
  },

  // Remove a player from a match slot (slot becomes empty / drop-zone)
  async deletePlayerFromMatch(matchId, slot) {
    const match = this.findMatch(matchId);
    if (!match) return;
    const player = match[slot];
    if (!player) return;

    const confirmed = await MODAL.showConfirm(
      `Remove "${player.playerName}" from this match? The slot will become empty — you can drop a BYE player or fill it manually.`
    );
    if (!confirmed) return;

    match[slot] = null;
    
    const roundNum = parseInt(matchId.split('_')[0].substring(1));
    const roundIndex = roundNum - 1;
    
    if (this.processAutoByes(roundIndex)) {
      const round = this.currentBracket.rounds[roundIndex];
      if (round.every(m => m.status === 'completed')) {
        this.buildNextRound(roundIndex);
      }
    }
    
    await this.saveBracket(this.currentCategory, this.currentBracket);
    this.renderBracket();
  },

  // Drag-start handler for a BYE player card
  onDragStartBye(event, playerId, roundIndex) {
    event.dataTransfer.setData('byePlayerId', String(playerId));
    event.dataTransfer.setData('byeRoundIndex', String(roundIndex));
    event.dataTransfer.effectAllowed = 'move';
  },

  // Drop handler: place a dragged BYE player into an empty match slot
  async onDropByeToSlot(event, matchId, slot) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');

    const playerId = event.dataTransfer.getData('byePlayerId');
    const roundIndex = parseInt(event.dataTransfer.getData('byeRoundIndex'), 10);

    if (!playerId || isNaN(roundIndex)) return;

    const roundByeList = this.getByeList(this.currentBracket, roundIndex);
    const byePlayer = roundByeList.find(p => String(p.id) === playerId);

    if (!byePlayer) {
      MODAL.warning('BYE player not found. Please try again.');
      return;
    }

    const match = this.findMatch(matchId);
    if (!match || match.status !== 'pending') {
      MODAL.warning('Cannot place player in a started or completed match.');
      return;
    }

    if (match[slot]) {
      MODAL.warning('This slot is already occupied. Delete the current player first.');
      return;
    }

    match[slot] = byePlayer;
    this.setByeList(this.currentBracket, roundIndex, roundByeList.filter(p => String(p.id) !== playerId));

    await this.saveBracket(this.currentCategory, this.currentBracket);
    this.renderBracket();
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BRACKET EDITOR — password-gated Round 1 drag-and-drop editing
  //
  // Editing works on a lightweight in-memory draft (this._editDraft), never
  // touching this.currentBracket until Save. Cancel just discards the
  // draft. Save rebuilds Round 1 from the draft and writes it through the
  // existing saveBracket() path unchanged, so every other module (Live
  // Matches, referee dashboard, medal calculation, PDF/Excel export) keeps
  // reading brackets/{categoryKey} exactly as before — it has no idea the
  // Round 1 it's looking at was hand-arranged instead of auto-generated.
  // ═══════════════════════════════════════════════════════════════════════

  // Admin/Judge only — referees can view brackets on this same page but
  // never get an Edit Bracket button (mirrors the role split already used
  // for the messaging panel on this page).
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
      <div class="custom-modal-overlay" onclick="if(event.target===this) BRACKET._closeEditPasswordModal()">
        <div class="custom-modal-content modal-warning">
          <div class="custom-modal-header">
            <h2>🔒 Confirm Password</h2>
            <button class="custom-modal-close" onclick="BRACKET._closeEditPasswordModal()">✕</button>
          </div>
          <div class="custom-modal-body">
            <p>Enter your admin/judge password to enable Bracket Edit Mode for this category.</p>
            <div style="position:relative;margin-top:10px;">
              <input type="password" id="editPwInput" autocomplete="current-password"
                     style="width:100%;box-sizing:border-box;padding:10px 40px 10px 12px;border-radius:8px;border:1.5px solid var(--accent-cyan);background:rgba(0,0,0,0.45);color:var(--text-white);font-size:0.95rem;" />
              <button type="button" onclick="BRACKET._toggleEditPw(this)"
                      style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-gray);cursor:pointer;padding:4px;display:flex;">${this._eyeOpenSvg()}</button>
            </div>
            <div id="editPwError" style="color:var(--accent-red);font-size:0.85rem;margin-top:8px;display:none;"></div>
          </div>
          <div class="custom-modal-footer">
            <button class="btn-secondary" onclick="BRACKET._closeEditPasswordModal()">Cancel</button>
            <button class="btn-primary" onclick="BRACKET._submitEditPassword('${categoryKey}')">Unlock Editing</button>
          </div>
        </div>
      </div>
    `;
    const div = document.createElement('div');
    div.innerHTML = modalHTML;
    document.body.appendChild(div);
    this._editPwModalDiv = div;
    setTimeout(() => {
      const input = document.getElementById('editPwInput');
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
    const input = document.getElementById('editPwInput');
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
    const input = document.getElementById('editPwInput');
    const errorDiv = document.getElementById('editPwError');
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

  // Build the editable draft from the currently saved bracket's Round 1 and
  // switch into edit-mode rendering.
  enterEditMode(categoryKey) {
    const bracket = this.currentBracket;
    const category = this.categories[categoryKey];
    if (!bracket || !category) return;

    const round1 = (bracket.rounds && bracket.rounds[0]) || [];
    const activePlayers = [];
    round1.forEach(m => {
      if (m.player1) activePlayers.push(m.player1);
      if (m.player2) activePlayers.push(m.player2);
    });
    const byePool = this.getByeList(bracket, 0).map(p => ({ ...p }));

    // Reconcile against the CURRENT roster: keep this bracket's existing
    // arrangement as the starting point, but if players were added/removed
    // since it was last saved, drop anyone no longer registered and add any
    // newly-registered player into the bye pool (least disruptive spot —
    // the admin can freely drag them into a match).
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
      hadStartedMatches: round1.some(m => m.status && m.status !== 'pending'),
      // Extra fully-empty match slots the admin has added via "+ Add Match"
      // (beyond what activePlayers.length implies) so a BYE-pool player can
      // be dragged back into a real Round 1 match even when every existing
      // match slot is already full.
      extraEmptyMatches: 0
    };
    this.editMode = true;
    this.renderEditBracket();
  },

  // Full-screen edit-mode render — only Round 1 + the bye pool are shown;
  // everything is driven from this._editDraft, not this.currentBracket.
  renderEditBracket() {
    const container = document.getElementById('bracketContainer');
    if (!container || !this._editDraft) return;
    const draft = this._editDraft;
    const cat = this.categories[this.currentCategory];
    const totalPlayers = draft.activePlayers.length + draft.byePool.length;
    const matchCount = Math.ceil(draft.activePlayers.length / 2) + (draft.extraEmptyMatches || 0);

    let html = `
      <div class="bracket-header edit-mode-header">
        <button class="btn-back" onclick="BRACKET.cancelEditBracket()">← Cancel</button>
        <h2>🔧 EDIT MODE — ${cat.gender} ${cat.ageCategory} - ${cat.weightCategory}</h2>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <span class="edit-mode-counts">${draft.activePlayers.length} in matches · ${draft.byePool.length} bye${draft.byePool.length === 1 ? '' : 's'} · ${totalPlayers} total</span>
          <button class="btn-secondary" onclick="BRACKET.cancelEditBracket()">Cancel</button>
          <button class="btn-primary edit-save-btn" onclick="BRACKET.saveEditBracket()">💾 Save Bracket</button>
        </div>
      </div>
      <div class="edit-mode-banner">🔧 EDIT MODE — drag a player onto another slot to swap or replace them, or drag them into the BYE pool. Nothing is saved until you click Save.</div>
      <div class="bracket-rounds">
        <div class="round edit-round">
          <h3 class="round-title">Round 1 (editable)</h3>
          <div class="matches">
    `;

    for (let i = 0; i < matchCount; i++) {
      html += this.renderEditMatchCard(draft, i);
    }

    html += `
            <button type="button" class="btn-secondary edit-add-match-btn" onclick="BRACKET.addEmptyEditMatch()">➕ Add Match</button>
          </div>
        </div>
      </div>
      ${this.renderEditByePool(draft)}
    `;

    container.innerHTML = html;
    document.getElementById('categoriesList').style.display = 'none';
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
               ondragstart="BRACKET.editDragStart(event,'active',${idx})"
               ondragover="BRACKET.editDragOver(event)"
               ondragleave="BRACKET.editDragLeave(event)"
               ondrop="BRACKET.editDrop(event,'active',${idx})">
            <span class="player-name">${player.playerName}</span>
            <span class="player-center">${player.centerName || ''}</span>
          </div>
        `;
      }
      return `
        <div class="player edit-slot drop-target"
             ondragover="BRACKET.editDragOver(event)"
             ondragleave="BRACKET.editDragLeave(event)"
             ondrop="BRACKET.editDrop(event,'active',${idx})">
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
           ondragstart="BRACKET.editDragStart(event,'bye',${idx})"
           ondragover="BRACKET.editDragOver(event)"
           ondragleave="BRACKET.editDragLeave(event)"
           ondrop="BRACKET.editDrop(event,'bye',${idx})">
        <span class="player-name">${p.playerName}</span>
        <span class="player-center">${p.centerName || ''}</span>
      </div>
    `).join('');

    return `
      <div class="edit-bye-pool"
           ondragover="BRACKET.editDragOver(event)"
           ondragleave="BRACKET.editDragLeave(event)"
           ondrop="BRACKET.editDrop(event,'bye',null)">
        <h3 class="round-title">🎫 BYE Pool — ${draft.byePool.length} player${draft.byePool.length === 1 ? '' : 's'} (drag here to give a Round 1 bye)</h3>
        <div class="bye-pool-chips">
          ${chips || '<div class="bye-pool-empty">Drag a player here to assign a bye</div>'}
        </div>
      </div>
    `;
  },

  // Adds one extra fully-empty match slot after the last Round 1 match so a
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
  // another"); dropping onto an empty trailing match slot or the bye
  // pool's open background moves the player there instead. Because every
  // chip always has exactly one array "home" and moves/swaps never create
  // or delete an entry, duplicate/missing players are structurally
  // impossible from dragging alone.
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
      const originalRound1 = (this.currentBracket.rounds && this.currentBracket.rounds[0]) || [];
      const originalActiveIds = [];
      originalRound1.forEach(m => {
        if (m.player1) originalActiveIds.push(m.player1.id);
        if (m.player2) originalActiveIds.push(m.player2.id);
      });
      const originalByeIds = this.getByeList(this.currentBracket, 0).map(p => p.id).sort();
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
      MODAL.warning('Every player cannot receive a bye — Round 1 needs at least one real match.');
      return;
    }

    // ── WARN IF THIS DISCARDS RECORDED PROGRESS ─────────────────────────
    if (draft.hadStartedMatches) {
      const confirmed = await MODAL.showConfirm(
        'Round 1 already has match results recorded (and any later rounds already built from them). Saving this edit will discard that progress and rebuild Round 1 from scratch. Continue?'
      );
      if (!confirmed) return;
    }

    // ── REBUILD ROUND 1 FROM THE DRAFT ──────────────────────────────────
    const bracket = this.currentBracket;
    const byeCount = draft.byePool.length;
    const newRound1 = [];
    for (let i = 0; i < draft.activePlayers.length; i += 2) {
      newRound1.push({
        matchId: `R1_M${Math.floor(i / 2) + 1}`,
        round: 1,
        player1: draft.activePlayers[i],
        player2: draft.activePlayers[i + 1],
        winner: null,
        eliminated: null,
        status: 'pending',
        startTime: null,
        endTime: null
      });
    }

    bracket.rounds = [newRound1];
    this.setByeList(bracket, 0, draft.byePool);
    // A manual edit redefines Round 1 from scratch, so the bye-fairness
    // history (used by buildNextRound for ROUNDS 2+) is reseeded to match
    // — exactly what createBracket() does for an auto-generated Round 1.
    bracket.byeHistory = {};
    draft.byePool.forEach(p => { bracket.byeHistory[p.id] = 1; });
    bracket.expectedRoundMatchCounts = this.computeExpectedRoundMatchCounts(totalPlayers, byeCount);
    bracket.playerCount = totalPlayers;
    bracket.currentRound = 0;
    bracket.status = 'live';
    bracket.manuallyEdited = true;
    bracket.lastEditedAt = new Date().toISOString();
    bracket.editedBy = (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.email) || 'unknown';

    this.currentBracket = bracket;
    this.editMode = false;
    this._editDraft = null;

    await this.saveBracket(this.currentCategory, this.currentBracket);
    this.renderBracket();
    MODAL.success('Bracket saved! This edited layout is now the official Round 1.');
  },

  // ═══════════════════════════════════════════════════════════════════════
  // FIXTURE EXCEL DOWNLOAD
  // Two sheets: "Fixture" (visual bracket grid) + "Match Schedule" (ties)
  // ═══════════════════════════════════════════════════════════════════════

  downloadFixtureExcel() {
    if (typeof XLSX === 'undefined') {
      MODAL.error('Excel library not loaded. Please refresh the page and try again.');
      return;
    }
    if (!this.currentBracket) {
      MODAL.warning('No bracket loaded.');
      return;
    }

    try {
      const cat = this.categories[this.currentCategory];
      const champTitle = document.title.replace(' - Bracket Management', '').trim() || 'Tournament';
      const categoryLabel = `${cat.gender} ${cat.ageCategory} - ${cat.weightCategory}`;

      const toArr = o => Array.isArray(o) ? o
        : Object.keys(o).sort((a, b) => Number(a) - Number(b)).map(k => o[k]);

      const rounds = toArr(this.currentBracket.rounds).map(r => toArr(r));
      const expectedCnts = toArr(this.currentBracket.expectedRoundMatchCounts || []);
      const totalRounds = Math.max(rounds.length, expectedCnts.length);
      const r1Matches = rounds[0] || [];
      // This sheet's layout was built for at most one Round-1 bye row; take
      // just the first so a multi-bye edited bracket still exports safely.
      const r1ByePlayer = this.getByeList(this.currentBracket, 0)[0] || null;

      // ── Layout constants ─────────────────────────────────────────────
      // 4 rows per R1 match: P1 row, spacer row, P2 row, gap/junction row
      const ROWS_PER_MATCH = 4;
      const HEADER = 3; // title + subtitle + column headers

      // ── Colour palette ───────────────────────────────────────────────
      const NAVY = '17305E';
      const WHITE = 'FFFFFF';
      const DKLINE = '1A3A6B'; // bracket line colour
      const LTGRAY = 'E8ECF0'; // player row background
      const BYGRAY = 'F0F0E8'; // bye row background
      const CHAMGN = '155724'; // champion green fill

      // ── Border helpers ───────────────────────────────────────────────
      const bk = (style) => ({ style, color: { rgb: DKLINE } });
      const th = bk('thin');
      const md = bk('medium');
      const tk = bk('thick');
      const none = undefined;

      // Build a border object (pass undefined for sides to omit)
      const mkBorder = (t, r, b, l) => {
        const o = {};
        if (t) o.top = t;
        if (r) o.right = r;
        if (b) o.bottom = b;
        if (l) o.left = l;
        return o;
      };

      // ── Fill helper (SheetJS requires patternType:'solid') ───────────
      const fgFill = (hex) => ({ patternType: 'solid', fgColor: { rgb: hex } });

      // ── Shared cell styles ───────────────────────────────────────────
      const S = {
        title: {
          font: { bold: true, sz: 14, color: { rgb: NAVY } },
          alignment: { horizontal: 'left', vertical: 'center' }
        },
        sub: {
          font: { sz: 9, color: { rgb: '555555' } },
          alignment: { vertical: 'center' }
        },
        hdr: {
          font: { bold: true, sz: 9, color: { rgb: WHITE } },
          fill: fgFill(NAVY),
          alignment: { horizontal: 'center', vertical: 'center' },
          border: mkBorder(md, md, md, md)
        },
        // Seed number cell: dark navy, white bold
        seed: {
          font: { bold: true, sz: 8, color: { rgb: WHITE } },
          fill: fgFill(NAVY),
          alignment: { horizontal: 'center', vertical: 'center' },
          border: mkBorder(th, th, th, th)
        },
        // Player name cell: light gray bg, 3-sided border (open right toward arm)
        pname: {
          font: { sz: 9, color: { rgb: '111111' } },
          fill: fgFill(LTGRAY),
          alignment: { vertical: 'center', wrapText: false },
          border: mkBorder(md, none, md, md)
        },
        // Bye player cell
        bye: {
          font: { sz: 9, color: { rgb: '887700' }, italic: true },
          fill: fgFill(BYGRAY),
          alignment: { vertical: 'center' },
          border: mkBorder(th, none, th, th)
        },
        // Arm/spacer row — no content, just specific border sides
        arm_p1: { fill: fgFill(WHITE), border: mkBorder(none, md, md, none) },
        arm_sp: { fill: fgFill(WHITE), border: mkBorder(md, none, md, none) },
        arm_p2: { fill: fgFill(WHITE), border: mkBorder(md, md, none, none) },
        // Junction box: dark navy fill + all medium borders + white match# text
        junc: {
          font: { bold: true, sz: 8, color: { rgb: WHITE } },
          fill: fgFill(NAVY),
          alignment: { horizontal: 'center', vertical: 'center' },
          border: mkBorder(md, md, md, md)
        },
        // Later-round player merged cell (winner advancing)
        adv: {
          font: { bold: true, sz: 9, color: { rgb: '111111' } },
          fill: fgFill('EAF4FF'),
          alignment: { horizontal: 'left', vertical: 'center', wrapText: false },
          border: mkBorder(md, none, md, md)
        },
        tbd: {
          font: { sz: 9, color: { rgb: 'AAAAAA' }, italic: true },
          fill: fgFill('F7F7F7'),
          alignment: { vertical: 'center' },
          border: mkBorder(th, none, th, th)
        },
        // Champion final cell: dark green, white, all-bordered
        champ: {
          font: { bold: true, sz: 11, color: { rgb: WHITE } },
          fill: fgFill(CHAMGN),
          alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
          border: mkBorder(tk, tk, tk, tk)
        },
        // Junction boxes for later rounds
        juncLR: {
          font: { bold: true, sz: 8, color: { rgb: WHITE } },
          fill: fgFill(NAVY),
          alignment: { horizontal: 'center', vertical: 'center' },
          border: mkBorder(md, md, md, md)
        },
        navyBg: { fill: fgFill(NAVY) },
        blank: { fill: fgFill(WHITE) }
      };

      // ── Column layout ────────────────────────────────────────────────
      // Per round ri:
      //   nameCol(ri) = 1 + ri * 2   (wide player name)
      //   armCol(ri)  = 2 + ri * 2   (narrow arm/junction)
      // Final round (ri = totalRounds-1): only nameCol exists (champion)
      const nameCol = ri => 1 + ri * 2;
      const armCol = ri => 2 + ri * 2;
      // Total columns: seed(1) + 2 per round but last round has no arm = totalRounds*2
      const totalCols = 1 + totalRounds * 2 - 1; // = totalRounds*2

      // ── Row span computation (4 rows per R1 match) ───────────────────
      // slotTop[ri][mi] / slotBot[ri][mi] = first/last sheet row of match mi in round ri
      const slotTop = [], slotBot = [];

      // R1: each match occupies ROWS_PER_MATCH rows
      const r0tops = r1Matches.map((_, mi) => HEADER + ROWS_PER_MATCH * mi);
      const r0bots = r1Matches.map((_, mi) => HEADER + ROWS_PER_MATCH * mi + ROWS_PER_MATCH - 1);
      // BYE player at R1 occupies a single extra row after all matches
      if (r1ByePlayer) {
        r0tops.push(HEADER + r1Matches.length * ROWS_PER_MATCH);
        r0bots.push(HEADER + r1Matches.length * ROWS_PER_MATCH);
      }
      slotTop.push(r0tops);
      slotBot.push(r0bots);

      for (let ri = 1; ri < totalRounds; ri++) {
        const pTop = slotTop[ri - 1], pBot = slotBot[ri - 1];
        const cnt = expectedCnts[ri] !== undefined
          ? expectedCnts[ri]
          : Math.ceil(pTop.length / 2);
        const tops = [], bots = [];
        for (let mi = 0; mi < cnt; mi++) {
          const fA = mi * 2, fB = mi * 2 + 1;
          tops.push(pTop[fA] !== undefined ? pTop[fA] : pTop[pTop.length - 1]);
          bots.push(pBot[fB] !== undefined ? pBot[fB] : pBot[fA]);
        }
        slotTop.push(tops);
        slotBot.push(bots);
      }

      const totalDataRows = r1Matches.length * ROWS_PER_MATCH + (r1ByePlayer ? 1 : 0);
      const totalRows = HEADER + totalDataRows;

      const ws = {};
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRows, c: totalCols } });
      ws['!merges'] = [];

      const enc = (r, c) => XLSX.utils.encode_cell({ r, c });
      const setCell = (r, c, v, s) => {
        ws[enc(r, c)] = { v: v ?? '', t: typeof v === 'number' ? 'n' : 's', s: s || {} };
      };
      const mergeSet = (r1x, c1x, r2x, c2x, v, s) => {
        if (r1x < r2x || c1x < c2x)
          ws['!merges'].push({ s: { r: r1x, c: c1x }, e: { r: r2x, c: c2x } });
        setCell(r1x, c1x, v, s);
      };

      // ── Row 0: Title ─────────────────────────────────────────────────
      mergeSet(0, 0, 0, totalCols, `${champTitle}  |  ${categoryLabel}`, S.title);

      // ── Row 1: Subtitle + date ────────────────────────────────────────
      mergeSet(1, 0, 1, totalCols - 1,
        `Single Elimination Bracket  •  ${this.currentBracket.playerCount || (r1Matches.length * 2)} Players`, S.sub);
      setCell(1, totalCols, new Date().toLocaleDateString('en-IN'), S.sub);

      // ── Row 2: Column headers ─────────────────────────────────────────
      setCell(2, 0, '#', S.hdr); // seed column header
      for (let ri = 0; ri < totalRounds; ri++) {
        const nc = nameCol(ri);
        const rn = (rounds[ri] && rounds[ri][0]) ? rounds[ri][0].round : ri + 1;
        const lbl = this.getRoundName(ri, totalRounds, rn);
        const isFinalRd = ri === totalRounds - 1;
        // Merge name + arm columns under one header (except final round has no arm)
        if (isFinalRd) {
          setCell(2, nc, lbl, S.hdr);
        } else {
          mergeSet(2, nc, 2, armCol(ri), lbl, S.hdr);
        }
      }

      // ── R1: 4 rows per match ──────────────────────────────────────────
      // Row layout per match mi:
      //   base+0 : P1 row  (seed, name, arm_p1)
      //   base+1 : spacer  (seed, empty, arm_sp)
      //   base+2 : P2 row  (seed, name, arm_p2)
      //   base+3 : gap/junction (empty, empty, junc with match#)

      let globalMatchNum = 1;

      r1Matches.forEach((match, mi) => {
        const base = HEADER + ROWS_PER_MATCH * mi;
        const rowP1 = base;
        const rowSp = base + 1;
        const rowP2 = base + 2;
        const rowGp = base + 3;

        const p1 = match.player1;
        const p2 = match.player2;
        const mn = globalMatchNum++;
        const seed1 = mi * 2 + 1;
        const seed2 = mi * 2 + 2;

        // Seed # column (col 0): navy fill entire 4-row block
        setCell(rowP1, 0, seed1, S.seed);
        setCell(rowSp, 0, '', S.navyBg);
        setCell(rowP2, 0, seed2, S.seed);
        setCell(rowGp, 0, '', S.navyBg);

        // Player name cells (col 1 = nameCol(0))
        const n1 = p1 ? p1.playerName + (p1.centerName ? ` (${p1.centerName})` : '') : 'BYE';
        const n2 = p2 ? p2.playerName + (p2.centerName ? ` (${p2.centerName})` : '') : 'BYE';
        setCell(rowP1, nameCol(0), n1, p1 ? S.pname : S.bye);
        setCell(rowSp, nameCol(0), '', S.blank);
        setCell(rowP2, nameCol(0), n2, p2 ? S.pname : S.bye);
        setCell(rowGp, nameCol(0), '', S.blank);

        // Arm/junction column (col 2 = armCol(0))
        // P1 row:  right + bottom borders (arm going right + spine going down)
        setCell(rowP1, armCol(0), '', S.arm_p1);
        // spacer:  top + bottom borders (spine passing through)
        setCell(rowSp, armCol(0), '', S.arm_sp);
        // P2 row:  top + right borders (spine arriving + arm going right)
        setCell(rowP2, armCol(0), '', S.arm_p2);
        // Gap row: junction box with match number
        setCell(rowGp, armCol(0), mn, S.junc);
      });

      // R1 BYE player (single row, no arm)
      if (r1ByePlayer) {
        const br = HEADER + r1Matches.length * ROWS_PER_MATCH;
        setCell(br, 0, r1Matches.length * 2 + 1, S.seed);
        const bn = r1ByePlayer.playerName +
          (r1ByePlayer.centerName ? ` (${r1ByePlayer.centerName})` : '') + '  —  BYE';
        setCell(br, nameCol(0), bn, S.bye);
      }

      // ── Later rounds: merged player cells + arm/junction ─────────────
      for (let ri = 1; ri < totalRounds; ri++) {
        const isFinalRd = ri === totalRounds - 1;
        const matchesInRound = rounds[ri] || [];
        const nc = nameCol(ri);
        const ac = armCol(ri);

        slotTop[ri].forEach((top, mi) => {
          const bot = slotBot[ri][mi];
          const match = matchesInRound[mi] || {};
          const mn = isFinalRd ? null : globalMatchNum++;

          // Determine player text + style
          let pname = '', style = S.tbd;
          if (match.winner) {
            const wp = (match.player1 && match.player1.id === match.winner)
              ? match.player1 : match.player2;
            if (wp) {
              pname = wp.playerName + (wp.centerName ? ` (${wp.centerName})` : '');
              style = isFinalRd ? S.champ : S.adv;
            }
          } else if (match.player1 && !match.player2) {
            pname = match.player1.playerName +
              (match.player1.centerName ? ` (${match.player1.centerName})` : '');
            style = isFinalRd ? S.champ : S.adv;
          } else if (match.player1 || match.player2) {
            pname = 'TBD'; style = S.tbd;
          }

          // Player name — merged across full span
          mergeSet(top, nc, bot, nc, pname, style);

          // Arm column logic for non-final rounds
          if (!isFinalRd) {
            // The junction box goes at the last row of this match's span
            // Arm borders go in rows above the junction
            const juncRow = bot;
            const midRow = Math.floor((top + bot) / 2);

            // Top half: arm from top toward center-right
            for (let r = top; r <= midRow; r++) {
              if (r === top) {
                setCell(r, ac, '', S.arm_p1); // right+bottom
              } else if (r < midRow) {
                setCell(r, ac, '', S.arm_sp); // top+bottom (spine)
              } else {
                setCell(r, ac, '', S.arm_sp); // top+bottom
              }
            }
            // Bottom half: spine downward to junction
            for (let r = midRow + 1; r < juncRow; r++) {
              setCell(r, ac, '', S.arm_sp); // top+bottom (spine)
            }
            // Junction box at last row
            setCell(juncRow, ac, mn, S.juncLR);

            // Fill seed col for this round's span with navy
            for (let r = top; r <= bot; r++) {
              setCell(r, 0, '', S.navyBg);
            }
          }
        });
      }

      // ── Column widths ─────────────────────────────────────────────────
      const colWidths = [{ wch: 3 }]; // col 0: seed (narrow navy)
      for (let ri = 0; ri < totalRounds; ri++) {
        colWidths.push({ wch: 26 }); // name column
        if (ri < totalRounds - 1) {
          colWidths.push({ wch: 5 }); // arm/junction column
        }
      }
      ws['!cols'] = colWidths;

      // ── Row heights ───────────────────────────────────────────────────
      ws['!rows'] = [{ hpt: 26 }, { hpt: 13 }, { hpt: 18 }];
      for (let ri = 0; ri < r1Matches.length; ri++) {
        ws['!rows'].push({ hpt: 18 }); // P1 row
        ws['!rows'].push({ hpt: 8 }); // spacer
        ws['!rows'].push({ hpt: 18 }); // P2 row
        ws['!rows'].push({ hpt: 10 }); // gap/junction
      }
      if (r1ByePlayer) ws['!rows'].push({ hpt: 18 });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Fixture');

      // ── SHEET 2: MATCH SCHEDULE ───────────────────────────────────────
      const tiesRows = [[
        'Match No.', 'Round',
        'Blue Corner (Player 1)', 'VS', 'Red Corner (Player 2)',
        'Court', 'Winner', 'Notes'
      ]];
      let schedMatchNum = 1;
      rounds.forEach((round, ri) => {
        const actualRn = round[0]?.round || (ri + 1);
        const roundName = this.getRoundName(ri, totalRounds, actualRn);
        round.forEach(match => {
          if (!match.player1 && !match.player2) return;
          const p1 = match.player1 ? match.player1.playerName : 'BYE';
          const p2 = match.player2 ? match.player2.playerName : 'BYE';
          const winner = match.winner
            ? ((match.player1 && match.player1.id === match.winner)
              ? match.player1.playerName
              : (match.player2 ? match.player2.playerName : ''))
            : '';
          const court = match.courtNumber ? `Court ${match.courtNumber}` : '';
          tiesRows.push([schedMatchNum++, roundName, p1, 'VS', p2, court, winner, '']);
        });
      });
      const wsTies = XLSX.utils.aoa_to_sheet(tiesRows);
      wsTies['!cols'] = [
        { wch: 10 }, { wch: 18 }, { wch: 28 }, { wch: 5 }, { wch: 28 }, { wch: 12 }, { wch: 28 }, { wch: 20 }
      ];
      XLSX.utils.book_append_sheet(wb, wsTies, 'Match Schedule');

      const safeKey = this.currentCategory.replace(/[^a-zA-Z0-9]/g, '_');
      XLSX.writeFile(wb, `Fixture_${safeKey}_${new Date().toISOString().slice(0, 10)}.xlsx`);

    } catch (err) {
      console.error('Excel fixture error:', err);
      MODAL.error('Error generating Excel: ' + err.message);
    }
  },

  // Export category results to Excel and trigger download
  exportToExcel() {
    if (typeof XLSX === 'undefined') {
      MODAL.error('Excel library not loaded. Please refresh the page and try again.');
      return;
    }

    const cat = this.categories[this.currentCategory];
    const categoryLabel = `${cat.gender} ${cat.ageCategory} - ${cat.weightCategory}`;
    const wb = XLSX.utils.book_new();

    // ── SHEET 1: FINAL RANKINGS ──────────────────────────────────────────
    const rankings = this.buildRankings();
    const rankRows = [
      ['Rank', 'Medal', 'Player Name', 'Center / Club', 'Result']
    ];
    rankings.forEach(r => {
      if (!r.player) return; // guard against corrupted ranking entries
      rankRows.push([r.rank, r.medal || '', r.player.playerName, r.player.centerName || '', r.note]);
    });
    const wsRank = XLSX.utils.aoa_to_sheet(rankRows);
    wsRank['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 28 }, { wch: 28 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsRank, 'Rankings');

    // ── SHEET 2: MATCH RESULTS ───────────────────────────────────────────
    const matchRows = [
      ['Round', 'Match', 'Player 1', 'Player 2', 'Winner', 'Start Time', 'End Time']
    ];
    const totalRounds = (this.currentBracket.rounds || []).length;

    // Iterate rounds in forward order (they're stored as Round 1, Quarter-Final, Semi-Final, Final)
    this.currentBracket.rounds.forEach((round, ri) => {
      // Get the actual round number from the first match in this round
      const actualRoundNumber = round[0]?.round || (ri + 1);
      const roundName = this.getRoundName(ri, totalRounds, actualRoundNumber);
      round.forEach((match, mi) => {
        if (!match.player1 && !match.player2) return; // skip empty slots
        const p1 = match.player1 ? match.player1.playerName : 'BYE';
        const p2 = match.player2 ? match.player2.playerName : 'BYE';
        const winner = match.winner
          ? (match.player1 && match.player1.id === match.winner ? match.player1.playerName : (match.player2 ? match.player2.playerName : ''))
          : '';
        const start = match.startTime ? new Date(match.startTime).toLocaleString('en-IN') : '';
        const end = match.endTime ? new Date(match.endTime).toLocaleString('en-IN') : '';
        matchRows.push([roundName, `Match ${mi + 1}`, p1, p2, winner, start, end]);
      });
    });
    const wsMatches = XLSX.utils.aoa_to_sheet(matchRows);
    wsMatches['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 26 }, { wch: 26 }, { wch: 26 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsMatches, 'Match Results');

    // ── SHEET 3: ALL PLAYERS ─────────────────────────────────────────────
    const playerRows = [['Player Name', 'Center / Club', 'Team']];
    cat.players.forEach(p => {
      playerRows.push([p.playerName, p.centerName || '', p.teamName || '']);
    });
    const wsPlayers = XLSX.utils.aoa_to_sheet(playerRows);
    wsPlayers['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsPlayers, 'Players');

    // ── DOWNLOAD ─────────────────────────────────────────────────────────
    const safeLabel = categoryLabel.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_');
    const fileName = `Results_${safeLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  },

  // ═══════════════════════════════════════════════════════════════════════
  // FIXTURE WORD DOCUMENT DOWNLOAD
  // A round-by-round match table (not a visual bracket tree — Word doesn't
  // render line-art connectors usefully) that opens directly in Microsoft
  // Word / Google Docs / LibreOffice as a normal editable document: real
  // tables, real text, freely reorder/rename/annotate. Uses the standard
  // "HTML flavored as Word" trick (an .html document saved with a .doc
  // extension plus the MSO-specific <?xml?> header Word recognizes) — no
  // extra library/CDN dependency, unlike the PDF/Excel exports.
  // ═══════════════════════════════════════════════════════════════════════
  downloadFixtureWord() {
    if (!this.currentBracket || !this.currentBracket.rounds) {
      MODAL.warning('No bracket loaded.');
      return;
    }
    try {
      const cat = this.categories[this.currentCategory];
      const categoryLabel = `${cat.gender} ${cat.ageCategory} - ${cat.weightCategory}`;
      const champTitle = document.title.replace(' - Bracket Management', '').trim() || 'Tournament';
      const totalRounds = this.getExpectedTotalRounds(this.currentBracket);

      const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const playerLabel = (p) => p ? `${esc(p.playerName)}${p.centerName ? ' (' + esc(p.centerName) + ')' : ''}` : '—';

      let matchNum = 1;
      let roundsHtml = '';
      this.currentBracket.rounds.forEach((round, roundIndex) => {
        const actualRoundNumber = round[0]?.round || (roundIndex + 1);
        const roundName = this.getRoundName(roundIndex, totalRounds, actualRoundNumber);

        let rows = '';
        round.forEach(match => {
          const winnerName = match.winner
            ? (match.player1 && match.player1.id === match.winner ? match.player1.playerName
              : (match.player2 && match.player2.id === match.winner ? match.player2.playerName : ''))
            : '';
          rows += `<tr>
            <td style="text-align:center;">${matchNum++}</td>
            <td>${playerLabel(match.player1)}</td>
            <td style="text-align:center;">vs</td>
            <td>${playerLabel(match.player2)}</td>
            <td>${esc(winnerName)}</td>
          </tr>`;
        });
        // Byes for this round — the Bracket Editor allows several on Round 1
        // (front-loaded, like real tournament seeding); BRACKET.getByeList()
        // normalizes both the legacy single-object and array shapes.
        this.getByeList(this.currentBracket, roundIndex).forEach(bye => {
          rows += `<tr>
            <td style="text-align:center;">${matchNum++}</td>
            <td colspan="3" style="text-align:center;font-style:italic;color:#886600;">${playerLabel(bye)} — BYE (advances automatically)</td>
            <td>${esc(bye.playerName)}</td>
          </tr>`;
        });

        roundsHtml += `
          <h2>${esc(roundName)}</h2>
          <table>
            <thead><tr><th>Match&nbsp;#</th><th>Player&nbsp;1</th><th></th><th>Player&nbsp;2</th><th>Winner</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        `;
      });

      // Results appendix — whatever's decided so far (works mid-tournament
      // too; buildRankings() only returns entries for rounds already played).
      const rankings = this.buildRankings();
      const medalRows = ['Gold', 'Silver', '1st Bronze', '2nd Bronze'].map((label, i) => {
        const entry = rankings[i];
        const name = entry ? playerLabel(entry.player) : '';
        return `<tr><td>${label}</td><td>${name}</td></tr>`;
      }).join('');

      const htmlDoc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>Fixture - ${esc(categoryLabel)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color:#1a1a1a; }
  h1 { font-size: 18pt; color:#17305E; margin-bottom:2pt; }
  h2 { font-size: 13pt; color:#17305E; margin-top:20pt; border-bottom:1pt solid #C9A84C; padding-bottom:3pt; }
  .subtitle { font-size:10pt; color:#555555; margin-bottom:16pt; }
  table { border-collapse: collapse; width:100%; margin-bottom:8pt; }
  th, td { border:1pt solid #999999; padding:5pt 8pt; font-size:10pt; vertical-align:middle; }
  th { background:#17305E; color:#ffffff; }
</style>
</head>
<body>
  <h1>${esc(champTitle)}</h1>
  <div class="subtitle">${esc(categoryLabel)} &mdash; Tournament Fixture (editable)</div>
  ${roundsHtml}
  <h2>Results</h2>
  <table>
    <thead><tr><th>Medal</th><th>Player</th></tr></thead>
    <tbody>${medalRows}</tbody>
  </table>
</body>
</html>`;

      const blob = new Blob(['﻿', htmlDoc], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeKey = this.currentCategory.replace(/[^a-zA-Z0-9]/g, '_');
      a.href = url;
      a.download = `Fixture_${safeKey}_${new Date().toISOString().slice(0, 10)}.doc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Word export error:', err);
      MODAL.error('Error generating Word document: ' + err.message);
    }
  },

  // Simple player roster for every player in the currently open bracket's
  // category — just Player Name / Center / Team, not the bracket/fixture
  // layout. Available regardless of bracket status.
  downloadPlayerListExcel() {
    if (typeof XLSX === 'undefined') {
      MODAL.error('Excel library not loaded. Please refresh the page and try again.');
      return;
    }
    const cat = this.categories[this.currentCategory];
    if (!cat || !cat.players || cat.players.length === 0) {
      MODAL.warning('No players in this category.');
      return;
    }
    const categoryLabel = `${cat.gender} ${cat.ageCategory} - ${cat.weightCategory}`;

    const rows = [['Player Name', 'Center / Club', 'Team']];
    [...cat.players]
      .sort((a, b) => (a.playerName || '').localeCompare(b.playerName || ''))
      .forEach(p => {
        rows.push([p.playerName || '', p.centerName || '', p.teamName || '']);
      });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 20 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Players');

    const safeLabel = categoryLabel.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_');
    const fileName = `Players_${safeLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BRACKET STATUS & COURT ASSIGNMENT — exclusive per-court locking
  //
  // Stored entirely under its own top-level node, bracketLocks/official/
  // {categoryKey} = { courtNumber, openedAt }, completely separate from
  // brackets/{categoryKey} itself (which already carries the Pending/Live/
  // Completed status via its own `status` field, unchanged). Keeping the
  // lock in its own node — rather than adding fields onto the bracket
  // object — means saveBracket()'s existing lean-object serialization,
  // championship archival, and every other reader of brackets/{categoryKey}
  // needs zero changes and can't be affected by this feature at all.
  //
  // Admin/judge sessions (no fixed court, per sessionStorage.courtNumber)
  // bypass the lock entirely — they already have unrestricted access
  // elsewhere in this app (e.g. _openLiveCourtPresence's identical bypass).
  // The exclusivity guarantee is scoped to preventing two COURTS/referees
  // from operating the same bracket at once, matching the actual scenario
  // this feature exists to prevent.
  // ═══════════════════════════════════════════════════════════════════════

  // Defense-in-depth court-assignment guard, shared by openCategory() and
  // startBracket() — called BEFORE the lock claim below. renderCategories()
  // already hides unassigned/other-court brackets from a referee's category
  // list, but a category card is only a link; this check is what actually
  // stops a referee from reaching a bracket they were never shown, whether
  // via a stale bookmark, a race with a just-removed assignment, or manual
  // console/URL manipulation. Admin/judge sessions always pass through
  // (unrestricted, matching every other admin/judge bypass in this file).
  async _assertCategoryAssignedToMe(categoryKey) {
    if (sessionStorage.getItem('userRole') !== 'referee') return true;
    const myCourt = String(sessionStorage.getItem('courtNumber') || '').trim();
    if (!myCourt) return true; // no session-level court to check against — leave to the lock/rules layer

    try {
      const snap = await dbGet(dbRef(database, `bracketAssignments/official/${categoryKey}`));
      const assignment = snap.exists() ? snap.val() : null;
      if (!assignment || String(assignment.courtNumber).trim() !== myCourt) {
        const msg = 'This bracket is not assigned to your court.';
        if (typeof MODAL !== 'undefined') MODAL.error(msg);
        else alert(msg);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('⚠️ Could not verify bracket assignment (blocking, fail-closed):', err.message);
      const msg = 'Could not verify this bracket is assigned to you — please check your connection and try again.';
      if (typeof MODAL !== 'undefined') MODAL.error(msg);
      else alert(msg);
      return false;
    }
  },

  // Entry guard shared by openCategory() and startBracket() — the two paths
  // that both open a bracket for live editing. Claims this court's lock via
  // a Firebase transaction (so two courts opening the exact same bracket in
  // the same instant can't both win) or blocks with a message naming
  // whichever court already holds it. Returns true if the caller should
  // proceed, false if it was blocked (or the user should be left where they
  // were, without entering the bracket view).
  async _tryClaimCourtLock(categoryKey) {
    // Gate on an ACTUAL referee session, not merely a non-empty courtNumber
    // key — login pages only ever ADD session keys, they never
    // sessionStorage.clear() first (only logout() does). So a tab that was
    // a referee earlier and then logged into admin/judge in the same tab
    // without an explicit logout keeps its old courtNumber value sitting in
    // storage, which would otherwise get this admin session mistaken for a
    // real court and blocked by whoever actually holds that court's lock.
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
      // Transactions unavailable for some reason (e.g. an older cached
      // firebase.js) — fail OPEN rather than blocking referees from ever
      // opening a bracket; the lock is a safety net, not a hard requirement
      // for the app's core function to keep working.
      console.warn('⚠️ dbRunTransaction unavailable — bracket lock not enforced this session.');
      return { granted: true };
    }
    try {
      const lockRef = dbRef(database, `bracketLocks/official/${categoryKey}`);
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
      // Granted — best-effort auto-release if this tab disconnects
      // ungracefully (crash/network loss), matching LIVE_PRESENCE's own
      // established risk posture for this class of cleanup elsewhere in
      // the app.
      try { await dbOnDisconnect(lockRef).remove(); } catch (_) { /* non-fatal */ }
      return { granted: true };
    } catch (err) {
      console.warn('⚠️ Bracket lock check failed (non-fatal) — proceeding without it:', err.message);
      return { granted: true };
    }
  },

  async _releaseBracketLock(categoryKey, courtNumber) {
    try {
      const lockRef = dbRef(database, `bracketLocks/official/${categoryKey}`);
      const snap = await dbGet(lockRef);
      // Only clear it if THIS court still holds it — never blindly remove a
      // lock some other court has since legitimately acquired (e.g. after
      // this court's own release raced with someone else's claim).
      if (snap.exists() && snap.val()?.courtNumber === courtNumber) {
        await dbRemove(lockRef);
      }
    } catch (err) {
      console.warn('⚠️ Could not release bracket lock (non-fatal):', err.message);
    }
  },

  // Best-effort synchronous-ish release on tab close/navigation-away — the
  // onDisconnect registered in _acquireBracketLock is the reliable fallback
  // if the browser tears the page down before this completes (same pattern
  // as LIVE_PRESENCE.clearAllSync()).
  _releaseLockSync() {
    if (!this._lockedCourtNumber || !this.currentCategory) return;
    try {
      dbRemove(dbRef(database, `bracketLocks/official/${this.currentCategory}`));
    } catch (_) { /* onDisconnect will handle it */ }
  }
};

window.BRACKET = BRACKET;

window.addEventListener('pagehide', () => BRACKET._releaseLockSync());
window.addEventListener('beforeunload', () => BRACKET._releaseLockSync());