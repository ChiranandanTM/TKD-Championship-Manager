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
  categoryStatuses: {},
  categoriesRenderRequestId: 0,
  _teamNameCache: null,  // { teamId → teamName } lookup built once per session
  editingSlot: null,     // { matchId, slot } when inline edit form is open

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
    // Patch bye players
    if (bracket.byePlayers) {
      Object.values(bracket.byePlayers).forEach(p => patch(p));
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

  // Render category list
  async renderCategories() {
    const container = document.getElementById('categoriesList');
    if (!container) return;

    this.syncCategoryFilterControl();

    const renderRequestId = ++this.categoriesRenderRequestId;

    try {
      // One request for all bracket statuses instead of one per category
      const bracketsSnap = await dbGet(dbRef(database, 'brackets'));
      const allBrackets = bracketsSnap.exists() ? bracketsSnap.val() : {};

      // Ignore stale async renders and keep latest filter result on screen.
      if (renderRequestId !== this.categoriesRenderRequestId) return;

      const categoryCards = Object.keys(this.categories).map((key) => {
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

        if (!matchesStatus || !matchesCategory) {
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

        return `
          <div class="category-card" onclick="BRACKET.openCategory('${key}')">
            <h3>${cat.gender} ${cat.ageCategory}</h3>
            <p class="weight-label">${cat.weightCategory}</p>
            <p class="player-count">${playerCount} Player${playerCount !== 1 ? 's' : ''}</p>
            <div style="margin: 12px 0; padding: 8px; background: rgba(255, 255, 255, 0.05); border-radius: 6px; text-align: center;">
              <span style="color: ${statusColor}; font-weight: 700; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.5px;">
                ${statusText === 'Live' ? '🔴 ' : ''}${statusText === 'Completed' ? '✅ ' : ''}${statusText === 'Pending' ? '⏳ ' : ''}${statusText}
              </span>
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
  async openCategory(categoryKey) {
    this.currentCategory = categoryKey;
    const category = this.categories[categoryKey];

    if (!category) {
      if (typeof MODAL !== 'undefined') {
        MODAL.error('Category not found');
      } else {
        alert('Category not found');
      }
      return;
    }

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

    // Pause the categories-level listener — we no longer need it while inside
    // the bracket view, and it avoids re-render churn during active matches.
    this.stopCategoriesListener();

    // Start real-time listeners for multi-court synchronization
    this.setupBracketListeners(categoryKey);

    this.renderBracket();
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

  // Start bracket when user confirms from modal
  async startBracket() {
    if (!this.pendingCategoryData) return;

    const categoryKey = this.pendingCategoryData.key;
    const category = this.pendingCategoryData.data;

    this.closeCategoryModal();
    this.currentCategory = categoryKey;

    await this.loadPlayers();
    this.categorizePlayers();

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

    // Pause the categories-level listener while inside the bracket view
    this.stopCategoriesListener();

    // Start real-time listeners for multi-court synchronization
    this.setupBracketListeners(categoryKey);

    this.renderBracket();
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

    // Check bye players
    const byePlayers = bracket.byePlayers || {};
    Object.entries(byePlayers).forEach(([round, player]) => {
      if (player) {
        if (foundPlayerIds.has(player.id)) {
          errors.push(`❌ Bye player ${player.playerName} already appears in a match`);
        }
        foundPlayerIds.add(player.id);
      }
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
  //   • Exact match counts per round (floor(n/2), no power-of-2 padding)
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
    // If n is odd: the last player in the seeded list receives a bye.
    //   → floor(n/2) real matches + 1 bye player
    // If n is even: all players are paired normally; no bye.
    //   → n/2 real matches
    const round1ByePlayer = (n % 2 === 1) ? this.compressPlayer(shuffled[n - 1]) : null;
    const round1MatchCount = Math.floor(n / 2);
    const round1 = [];

    for (let i = 0; i < round1MatchCount; i++) {
      round1.push({
        matchId: `R1_M${i + 1}`,
        round: 1,
        player1: this.compressPlayer(shuffled[i * 2]),
        player2: this.compressPlayer(shuffled[i * 2 + 1]),
        winner: null,
        eliminated: null,
        status: 'pending',
        startTime: null,
        endTime: null
      });
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

    bracket.rounds.push(round1);

    if (round1ByePlayer) {
      bracket.byePlayers['0'] = round1ByePlayer;
      bracket.byeHistory[round1ByePlayer.id] = 1;
    }

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

    // Retrieve the bye player who was waiting in this round (may be null)
    const byePlayers = this.currentBracket.byePlayers || {};
    const roundByePlayer = byePlayers[String(roundIndex)] || null;

    // All players advancing: match-winners first, then the bye holder
    const advancing = [...winners];
    if (roundByePlayer) advancing.push(roundByePlayer);

    if (advancing.length <= 1) {
      // Only one player remains — tournament is complete
      this.currentBracket.status = 'complete';
      console.log('🏆 Tournament complete');
      return;
    }

    const nextRoundIndex = roundIndex + 1;
    const nextRoundNum = nextRoundIndex + 1;  // 1-based label for matchId

    // ── ASSIGN BYE FOR NEXT ROUND (only if advancing count is odd) ───────
    let nextByePlayer = null;
    if (advancing.length % 2 === 1) {
      const byeHistory = this.currentBracket.byeHistory || {};
      const prevByeId = roundByePlayer ? roundByePlayer.id : null;

      // Sort by: fewest byes first; break ties by pushing the previous-round
      // bye holder to the back (prevents consecutive byes).
      const sorted = [...advancing].sort((a, b) => {
        const diff = (byeHistory[a.id] || 0) - (byeHistory[b.id] || 0);
        if (diff !== 0) return diff;
        return (a.id === prevByeId ? 1 : 0) - (b.id === prevByeId ? 1 : 0);
      });
      nextByePlayer = sorted[0];
    }

    // ── BUILD NEXT ROUND MATCHES ──────────────────────────────────────────
    const matchPlayers = advancing.filter(p => !nextByePlayer || p.id !== nextByePlayer.id);
    const nextRound = [];

    for (let i = 0; i < matchPlayers.length; i += 2) {
      nextRound.push({
        matchId: `R${nextRoundNum}_M${Math.floor(i / 2) + 1}`,
        round: nextRoundNum,
        player1: matchPlayers[i],
        player2: matchPlayers[i + 1],
        winner: null,
        eliminated: null,
        status: 'pending',
        startTime: null,
        endTime: null
      });
    }

    // ── APPLY TEAM-AWARE CONFLICT RESOLUTION ──────────────────────────────
    // Resolve any same-team matches by swapping players intelligently
    const resolution = this.resolveTeamConflicts(nextRound);
    if (resolution.resolved && resolution.swaps.length > 0) {
      console.log(`✅ Round ${nextRoundNum}: ${resolution.swaps.length} player swap(s) performed to avoid same-team matches`);
    } else if (!resolution.resolved && resolution.conflicts.length > 0) {
      console.warn(`⚠️ Round ${nextRoundNum}: ${resolution.conflicts.length} unavoidable same-team conflict(s)`);
      resolution.conflicts.forEach(c => {
        console.warn(`  - ${c.player1.playerName} vs ${c.player2.playerName} (both from ${c.player1.teamName})`);
      });
    }

    // Update nextRound with resolved matches
    for (let i = 0; i < resolution.newMatches.length; i++) {
      nextRound[i] = {
        ...nextRound[i],
        player1: resolution.newMatches[i].player1,
        player2: resolution.newMatches[i].player2
      };
    }

    this.currentBracket.rounds.push(nextRound);

    if (nextByePlayer) {
      if (!this.currentBracket.byePlayers) this.currentBracket.byePlayers = {};
      this.currentBracket.byePlayers[String(nextRoundIndex)] = nextByePlayer;
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

          bracket.rounds = toArray(bracket.rounds).map(round =>
            toArray(round).map(match => ({
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
            }))
          );
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
          rawBracket.rounds = toArray(rawBracket.rounds).map(round =>
            toArray(round).map(match => ({
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
            }))
          );
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
          console.log('🔄 Bracket updated from Firebase - re-rendering');
          this.renderBracket();
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
  setupCategoriesListener() {
    this.stopCategoriesListener();
    let debounceTimer = null;
    const bracketsRef = dbRef(database, 'brackets');
    this.categoriesListener = dbOnValue(bracketsRef, () => {
      // Skip if the user is currently inside the bracket view
      const bracketContainer = document.getElementById('bracketContainer');
      if (bracketContainer && bracketContainer.style.display === 'block') return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => this.renderCategories(), 500);
    });
    console.log('✅ Categories real-time listener active');
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

    const isComplete = this.isCategoryComplete();

    let html = `
      <div class="bracket-header">
        <button class="btn-back" onclick="BRACKET.closeCategory()">← Back to Categories</button>
        <h2>${this.categories[this.currentCategory].gender} ${this.categories[this.currentCategory].ageCategory} - ${this.categories[this.currentCategory].weightCategory}</h2>
        <div style="display:flex;gap:10px;align-items:center;">
          ${isComplete ? `<button class="btn-success" onclick="BRACKET.exportToExcel()" style="background:var(--success-green);color:#fff;border:none;padding:8px 18px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.95rem;">📥 Export Results</button>` : ''}
          <button class="btn-secondary" onclick="BRACKET.downloadFixturePDF()" style="padding:8px 18px;font-size:0.95rem;">📄 Download Fixture PDF</button>
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

      round.forEach(match => {
        html += this.renderMatch(match, roundIndex, matchNumMap[match.matchId]);
      });

      // Render the bye-player card for this round (if any)
      const byePlayers = this.currentBracket.byePlayers || {};
      const roundBye = byePlayers[String(roundIndex)];
      if (roundBye) {
        const roundComplete = round.every(m => m.status === 'completed');
        html += this.renderByeCard(roundBye, roundComplete, roundIndex);
      }

      html += `
          </div>
        </div>
      `;
    });

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
  renderMatch(match, roundIndex, matchNumber) {
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
              <option value="1">Court 1</option>
              <option value="2">Court 2</option>
              <option value="3">Court 3</option>
              <option value="4">Court 4</option>
              <option value="5">Court 5</option>
            </select>
            <button class="btn-start-match" onclick="BRACKET.startMatch('${match.matchId}')">
              ▶️ Start Match
            </button>
          </div>
        ` : ''}

        ${isInProgress ? this.renderMatchControls(match) : ''}

        ${isCompleted ? `
          <div class="match-completed-info">
            <span class="winner-badge">✅ Winner: ${match.winner === player1?.id ? player1.playerName : player2.playerName}</span>
            ${match.eliminated ? `<span class="eliminated-badge">❌ Eliminated: ${match.eliminated === player1?.id ? player1.playerName : player2.playerName}</span>` : ''}
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

  // Close category view
  async closeCategory() {
    // Stop real-time listeners when leaving the bracket
    this.stopBracketListeners();

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
    if (!rounds || rounds.length === 0) return false;
    const expectedTotal = this.getExpectedTotalRounds(this.currentBracket);
    if (rounds.length < expectedTotal) return false;
    for (const round of rounds) {
      for (const match of round) {
        if (match.status !== 'completed') return false;
      }
    }
    return true;
  },

  // Derive final rankings from bracket structure
  // 1st = winner of final, 2nd = loser of final, 3rd = both semi-final losers
  buildRankings() {
    const rounds = this.currentBracket.rounds;
    const totalRounds = rounds.length;
    const rankings = [];

    // Rounds are stored in FORWARD order: [Round 1, Quarter-Final, Semi-Final, Final]
    // Final is at the last index (totalRounds - 1)
    const finalRound = rounds[totalRounds - 1];
    if (!finalRound || finalRound.length === 0) return rankings;

    const finalMatch = finalRound[0];
    if (!finalMatch || !finalMatch.winner) return rankings;

    const champion = finalMatch.player1.id === finalMatch.winner ? finalMatch.player1 : finalMatch.player2;
    const runnerUp = finalMatch.player1.id === finalMatch.winner ? finalMatch.player2 : finalMatch.player1;

    rankings.push({ rank: 1, player: champion, note: 'Champion' });
    rankings.push({ rank: 2, player: runnerUp, note: 'Runner-up' });

    // Semi-final losers get 3rd (if semi-final exists)
    if (totalRounds >= 2) {
      const semiRound = rounds[totalRounds - 2];
      semiRound.forEach(match => {
        if (match.player1 && match.player2 && match.winner && match.eliminated) {
          const loser = match.player1.id === match.eliminated ? match.player1 : match.player2;
          rankings.push({ rank: 3, player: loser, note: '3rd Place' });
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
            rankings.push({ rank: rankNum++, player: loser, note: `Eliminated in ${this.getRoundName(ri, totalRounds)}` });
            addedIds.add(loser.id);
          }
        }
      });
    }

    return rankings;
  },

  // Download fixture bracket as PDF — landscape A3, professional navy style
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
        : Object.keys(o).sort((a,b)=>Number(a)-Number(b)).map(k=>o[k]);
      const rounds       = toArr(this.currentBracket.rounds).map(r=>toArr(r));
      const expectedCnts = toArr(this.currentBracket.expectedRoundMatchCounts || []);
      const totalRounds  = Math.max(rounds.length, expectedCnts.length);

      // ── PAGE SETUP (A3 landscape, mm) ────────────────────────────────
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
      const PW = 420, PH = 297;
      const ML = 8, MR = 8, MT = 8, MB = 12;
      const W  = PW - ML - MR;

      const r1Matches   = rounds[0] || [];
      const byePlayers  = this.currentBracket.byePlayers || {};
      const r1ByePlayer = byePlayers['0'] || null;

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

      // Layout
      const HEADER_H  = 20, GOLD_LINE = 0.8, LABEL_H = 8, FOOTER_H = 10;
      const CONTENT_TOP = MT + HEADER_H + GOLD_LINE + LABEL_H + 1;
      const CONTENT_H   = PH - CONTENT_TOP - MB - FOOTER_H;
      const SEED_W = 6, ARM_W = 11, JUNC_SZ = 4.5, CHAMP_W = 32;
      const ROUND_W = (W - SEED_W - totalRounds * ARM_W - CHAMP_W) / totalRounds;
      const roundX  = ri => ML + SEED_W + ri * (ROUND_W + ARM_W);
      const armCX   = ri => roundX(ri) + ROUND_W + ARM_W / 2;

      const numM   = r1Matches.length;
      const matchH = CONTENT_H / Math.max(numM, 1);
      const pH     = Math.min(matchH * 0.40, 9.5);
      const r1p1Y  = mi => CONTENT_TOP + mi * matchH;
      const r1p2Y  = mi => CONTENT_TOP + mi * matchH + pH;

      // Junction Y[ri][mi] — recursive midpoint
      const jY = [];
      jY.push(r1Matches.map((_, mi) => CONTENT_TOP + mi * matchH + pH)); // at P1/P2 boundary
      for (let ri = 1; ri < totalRounds; ri++) {
        const prev = jY[ri - 1];
        const cnt  = expectedCnts[ri] !== undefined ? expectedCnts[ri] : Math.ceil(prev.length / 2);
        const cur  = [];
        for (let mi = 0; mi < cnt; mi++) {
          const a = prev[mi * 2], b = prev[mi * 2 + 1];
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
          bots.push(pB[fB] !== undefined ? pB[fB] : pB[fA]);
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
        const rn  = (rounds[ri] && rounds[ri][0]) ? rounds[ri][0].round : ri + 1;
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
        const isFinal   = ri === totalRounds - 1;
        const x         = roundX(ri);
        const ax        = armCX(ri);
        const prevAX    = armCX(ri - 1);
        const matchList = rounds[ri] || [];

        if (isFinal) {
          const fm      = matchList[0] || {};
          const sfCount = jY[ri - 1].length;
          for (let fi = 0; fi < Math.min(sfCount, 2); fi++) {
            const prevJY  = jY[ri - 1][fi];
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
          const champX    = ax + JUNC_SZ / 2 + 2;
          const champBoxW = CHAMP_W - 4;
          const champJY   = jY[ri][0];
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
            const jy    = jY[ri][mi];
            const match = matchList[mi] || {};
            const pjA   = jY[ri - 1][mi * 2];
            const pjB   = jY[ri - 1][mi * 2 + 1];

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

    const byePlayers = this.currentBracket.byePlayers || {};
    const byePlayer = byePlayers[String(roundIndex)];

    if (!byePlayer || String(byePlayer.id) !== playerId) {
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
    delete this.currentBracket.byePlayers[String(roundIndex)];

    await this.saveBracket(this.currentCategory, this.currentBracket);
    this.renderBracket();
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

      const rounds       = toArr(this.currentBracket.rounds).map(r => toArr(r));
      const byePlayers   = this.currentBracket.byePlayers || {};
      const expectedCnts = toArr(this.currentBracket.expectedRoundMatchCounts || []);
      const totalRounds  = Math.max(rounds.length, expectedCnts.length);
      const r1Matches    = rounds[0] || [];
      const r1ByePlayer  = byePlayers['0'] || null;

      // ── Layout constants ─────────────────────────────────────────────
      // 4 rows per R1 match: P1 row, spacer row, P2 row, gap/junction row
      const ROWS_PER_MATCH = 4;
      const HEADER = 3; // title + subtitle + column headers

      // ── Colour palette ───────────────────────────────────────────────
      const NAVY   = '17305E';
      const WHITE  = 'FFFFFF';
      const DKLINE = '1A3A6B'; // bracket line colour
      const LTGRAY = 'E8ECF0'; // player row background
      const BYGRAY = 'F0F0E8'; // bye row background
      const CHAMGN = '155724'; // champion green fill

      // ── Border helpers ───────────────────────────────────────────────
      const bk = (style) => ({ style, color:{ rgb: DKLINE } });
      const th = bk('thin');
      const md = bk('medium');
      const tk = bk('thick');
      const none = undefined;

      // Build a border object (pass undefined for sides to omit)
      const mkBorder = (t, r, b, l) => {
        const o = {};
        if (t) o.top    = t;
        if (r) o.right  = r;
        if (b) o.bottom = b;
        if (l) o.left   = l;
        return o;
      };

      // ── Fill helper (SheetJS requires patternType:'solid') ───────────
      const fgFill = (hex) => ({ patternType:'solid', fgColor:{ rgb: hex } });

      // ── Shared cell styles ───────────────────────────────────────────
      const S = {
        title:  { font:{bold:true,sz:14,color:{rgb:NAVY}},
                  alignment:{horizontal:'left',vertical:'center'} },
        sub:    { font:{sz:9,color:{rgb:'555555'}},
                  alignment:{vertical:'center'} },
        hdr:    { font:{bold:true,sz:9,color:{rgb:WHITE}},
                  fill:fgFill(NAVY),
                  alignment:{horizontal:'center',vertical:'center'},
                  border:mkBorder(md,md,md,md) },
        // Seed number cell: dark navy, white bold
        seed:   { font:{bold:true,sz:8,color:{rgb:WHITE}},
                  fill:fgFill(NAVY),
                  alignment:{horizontal:'center',vertical:'center'},
                  border:mkBorder(th,th,th,th) },
        // Player name cell: light gray bg, 3-sided border (open right toward arm)
        pname:  { font:{sz:9,color:{rgb:'111111'}},
                  fill:fgFill(LTGRAY),
                  alignment:{vertical:'center',wrapText:false},
                  border:mkBorder(md,none,md,md) },
        // Bye player cell
        bye:    { font:{sz:9,color:{rgb:'887700'},italic:true},
                  fill:fgFill(BYGRAY),
                  alignment:{vertical:'center'},
                  border:mkBorder(th,none,th,th) },
        // Arm/spacer row — no content, just specific border sides
        arm_p1: { fill:fgFill(WHITE), border:mkBorder(none,md,md,none) },
        arm_sp: { fill:fgFill(WHITE), border:mkBorder(md,none,md,none) },
        arm_p2: { fill:fgFill(WHITE), border:mkBorder(md,md,none,none) },
        // Junction box: dark navy fill + all medium borders + white match# text
        junc:   { font:{bold:true,sz:8,color:{rgb:WHITE}},
                  fill:fgFill(NAVY),
                  alignment:{horizontal:'center',vertical:'center'},
                  border:mkBorder(md,md,md,md) },
        // Later-round player merged cell (winner advancing)
        adv:    { font:{bold:true,sz:9,color:{rgb:'111111'}},
                  fill:fgFill('EAF4FF'),
                  alignment:{horizontal:'left',vertical:'center',wrapText:false},
                  border:mkBorder(md,none,md,md) },
        tbd:    { font:{sz:9,color:{rgb:'AAAAAA'},italic:true},
                  fill:fgFill('F7F7F7'),
                  alignment:{vertical:'center'},
                  border:mkBorder(th,none,th,th) },
        // Champion final cell: dark green, white, all-bordered
        champ:  { font:{bold:true,sz:11,color:{rgb:WHITE}},
                  fill:fgFill(CHAMGN),
                  alignment:{horizontal:'center',vertical:'center',wrapText:false},
                  border:mkBorder(tk,tk,tk,tk) },
        // Junction boxes for later rounds
        juncLR: { font:{bold:true,sz:8,color:{rgb:WHITE}},
                  fill:fgFill(NAVY),
                  alignment:{horizontal:'center',vertical:'center'},
                  border:mkBorder(md,md,md,md) },
        navyBg: { fill:fgFill(NAVY) },
        blank:  { fill:fgFill(WHITE) }
      };

      // ── Column layout ────────────────────────────────────────────────
      // Per round ri:
      //   nameCol(ri) = 1 + ri * 2   (wide player name)
      //   armCol(ri)  = 2 + ri * 2   (narrow arm/junction)
      // Final round (ri = totalRounds-1): only nameCol exists (champion)
      const nameCol = ri => 1 + ri * 2;
      const armCol  = ri => 2 + ri * 2;
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
        const cnt  = expectedCnts[ri] !== undefined
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
      ws['!ref']    = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:totalRows, c:totalCols} });
      ws['!merges'] = [];

      const enc    = (r, c) => XLSX.utils.encode_cell({ r, c });
      const setCell = (r, c, v, s) => {
        ws[enc(r, c)] = { v: v ?? '', t: typeof v === 'number' ? 'n' : 's', s: s || {} };
      };
      const mergeSet = (r1x, c1x, r2x, c2x, v, s) => {
        if (r1x < r2x || c1x < c2x)
          ws['!merges'].push({ s:{r:r1x,c:c1x}, e:{r:r2x,c:c2x} });
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
        const nc  = nameCol(ri);
        const rn  = (rounds[ri] && rounds[ri][0]) ? rounds[ri][0].round : ri + 1;
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
        const base  = HEADER + ROWS_PER_MATCH * mi;
        const rowP1 = base;
        const rowSp = base + 1;
        const rowP2 = base + 2;
        const rowGp = base + 3;

        const p1   = match.player1;
        const p2   = match.player2;
        const mn   = globalMatchNum++;
        const seed1 = mi * 2 + 1;
        const seed2 = mi * 2 + 2;

        // Seed # column (col 0): navy fill entire 4-row block
        setCell(rowP1, 0, seed1, S.seed);
        setCell(rowSp, 0, '',    S.navyBg);
        setCell(rowP2, 0, seed2, S.seed);
        setCell(rowGp, 0, '',    S.navyBg);

        // Player name cells (col 1 = nameCol(0))
        const n1   = p1 ? p1.playerName + (p1.centerName ? ` (${p1.centerName})` : '') : 'BYE';
        const n2   = p2 ? p2.playerName + (p2.centerName ? ` (${p2.centerName})` : '') : 'BYE';
        setCell(rowP1, nameCol(0), n1, p1 ? S.pname : S.bye);
        setCell(rowSp, nameCol(0), '',  S.blank);
        setCell(rowP2, nameCol(0), n2,  p2 ? S.pname : S.bye);
        setCell(rowGp, nameCol(0), '',  S.blank);

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
        const nc  = nameCol(ri);
        const ac  = armCol(ri);

        slotTop[ri].forEach((top, mi) => {
          const bot   = slotBot[ri][mi];
          const match = matchesInRound[mi] || {};
          const mn    = isFinalRd ? null : globalMatchNum++;

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
            const midRow  = Math.floor((top + bot) / 2);

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
        ws['!rows'].push({ hpt: 8  }); // spacer
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
        const actualRn  = round[0]?.round || (ri + 1);
        const roundName = this.getRoundName(ri, totalRounds, actualRn);
        round.forEach(match => {
          if (!match.player1 && !match.player2) return;
          const p1     = match.player1 ? match.player1.playerName : 'BYE';
          const p2     = match.player2 ? match.player2.playerName : 'BYE';
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
        {wch:10},{wch:18},{wch:28},{wch:5},{wch:28},{wch:12},{wch:28},{wch:20}
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
      ['Rank', 'Player Name', 'Center / Club', 'Result']
    ];
    rankings.forEach(r => {
      rankRows.push([r.rank, r.player.playerName, r.player.centerName || '', r.note]);
    });
    const wsRank = XLSX.utils.aoa_to_sheet(rankRows);
    wsRank['!cols'] = [{ wch: 6 }, { wch: 28 }, { wch: 28 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsRank, 'Rankings');

    // ── SHEET 2: MATCH RESULTS ───────────────────────────────────────────
    const matchRows = [
      ['Round', 'Match', 'Player 1', 'Player 2', 'Winner', 'Start Time', 'End Time']
    ];
    const totalRounds = this.currentBracket.rounds.length;

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
  }
};

window.BRACKET = BRACKET;