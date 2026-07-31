// ============================================
// TEAM DEADLINE MANAGER
// Admin tool to set per-team registration deadlines
// and globally close/open registration
// ============================================

async function _tdmHashPassword(plain) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('TKDCM:' + plain));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const TEAM_DEADLINE_MANAGER = {

  // Render the Registered Teams section with deadline controls
  async renderTeamsTable(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<p style="color: var(--text-gray);">Loading teams...</p>`;

    try {
      const teamsRef = dbRef(database, 'teams');
      const snapshot = await dbGet(teamsRef);

      if (!snapshot.exists()) {
        container.innerHTML = `<p style="color: var(--text-gray);">No teams registered yet.</p>`;
        return;
      }

      const teams = [];
      snapshot.forEach(child => {
        teams.push({ id: child.key, ...child.val() });
      });

      // Sort by createdAt
      teams.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

      const now = new Date();

      // Check if current user is admin
      const isAdmin = typeof AUTH_MANAGER !== 'undefined' && AUTH_MANAGER.getCurrentUser().role === 'admin';

      let rows = '';
      teams.forEach(team => {
        const deadline = team.registrationDeadline || '';
        const isClosed = team.registrationClosed === true;

        let statusHtml = '';
        if (isClosed) {
          statusHtml = `<span style="color: var(--accent-red); font-weight: 700;">🔒 Closed</span>`;
        } else if (deadline) {
          const d = new Date(deadline);
          if (!deadline.includes('T')) {
            d.setHours(23, 59, 59, 999);
          }
          if (now > d) {
            statusHtml = `<span style="color: var(--warning-orange); font-weight: 700;">⏰ Expired</span>`;
          } else {
            statusHtml = `<span style="color: var(--success-green); font-weight: 700;">✅ Open</span>`;
          }
        } else {
          statusHtml = `<span style="color: var(--success-green); font-weight: 700;">✅ Open</span>`;
        }

        const createdAt = team.createdAt
          ? new Date(team.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '—';

        rows += `
          <tr id="team-row-${team.id}">
            <td style="padding: 14px 16px; font-weight: 700; color: var(--border-gold);">${team.teamName || '—'}</td>
            <td style="padding: 14px 16px; font-family: monospace; color: var(--accent-cyan);">${team.username || '—'}</td>
            <td style="padding: 14px 16px; color: var(--text-gray);">${team.email || '—'}</td>
            <td style="padding: 14px 16px; font-family: monospace; color: var(--accent-cyan);">${localStorage.getItem('pw_team_' + team.id) || '—'}</td>
            <td style="padding: 14px 16px; color: var(--text-gray); font-size: 0.9rem;">${createdAt}</td>
            <td style="padding: 14px 16px;">${statusHtml}</td>
            <td style="padding: 10px 16px;">
              <div style="display: inline-flex; align-items: center; background: rgba(10, 15, 30, 0.8); border: 1.5px solid rgba(0, 229, 255, 0.4); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3), inset 0 2px 5px rgba(0,0,0,0.5); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);"
                   onmouseover="this.style.borderColor='#00E5FF'; this.style.boxShadow='0 0 20px rgba(0, 229, 255, 0.3), inset 0 2px 5px rgba(0,0,0,0.5)'; this.style.transform='translateY(-2px)';"
                   onmouseout="this.style.borderColor='rgba(0, 229, 255, 0.4)'; this.style.boxShadow='0 4px 15px rgba(0, 0, 0, 0.3), inset 0 2px 5px rgba(0,0,0,0.5)'; this.style.transform='translateY(0)';">
                
                <div style="padding: 0 12px; background: rgba(0, 229, 255, 0.1); border-right: 1px solid rgba(0, 229, 255, 0.2); display: flex; align-items: center; justify-content: center; height: 100%; min-height: 40px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 4px rgba(0,229,255,0.6));">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                </div>
                
                <input type="datetime-local" id="deadline-${team.id}" value="${deadline}"
                  style="background: transparent; border: none; color: #fff; padding: 10px 12px; font-size: 0.9rem; width: 180px; outline: none; font-family: 'Inter', sans-serif; cursor: pointer;">
                  
                <button onclick="TEAM_DEADLINE_MANAGER.saveTeamDeadline('${team.id}')"
                  style="background: linear-gradient(135deg, #00E5FF, #0088FF); color: #000; border: none; padding: 10px 20px; font-weight: 900; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.5px; border-left: 1px solid rgba(0,0,0,0.3); height: 100%; min-height: 40px;"
                  onmouseover="this.style.filter='brightness(1.2)';" onmouseout="this.style.filter='brightness(1)';">
                  Set
                </button>
              </div>
            </td>
            <td style="padding: 14px 16px;">
              <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                <button onclick="TEAM_DEADLINE_MANAGER.toggleTeamClose('${team.id}', ${!isClosed})"
                  style="padding: 6px 14px; font-size: 0.85rem;
                         background: ${isClosed ? 'var(--success-green)' : 'var(--accent-red)'};
                         color: ${isClosed ? 'var(--primary-black)' : 'var(--text-white)'};
                         border: none; border-radius: 6px; cursor: pointer; font-weight: 700;"
                  id="toggle-btn-${team.id}">
                  ${isClosed ? '🔓 Reopen' : '🔒 Close'}
                </button>
                ${isAdmin ? `
                  <button onclick="TEAM_DEADLINE_MANAGER.openEditTeam('${team.id}')"
                    style="padding: 6px 14px; font-size: 0.85rem; background: var(--accent-cyan); color: var(--primary-black);
                           border: none; border-radius: 6px; cursor: pointer; font-weight: 700;">
                    ✏️ Edit
                  </button>
                  <button onclick="TEAM_DEADLINE_MANAGER.deleteTeam('${team.id}', '${team.teamName.replace(/'/g, "\\'")}')"
                  style="padding: 6px 14px; font-size: 0.85rem; background: var(--accent-red); color: var(--text-white);
                         border: none; border-radius: 6px; cursor: pointer; font-weight: 700; opacity: 0.8;"
                  title="⚠️ Delete this team and all associated players"
                  id="delete-btn-${team.id}">
                  🗑️ Delete
                </button>` : ''}
              </div>
            </td>
          </tr>
        `;
      });

      container.innerHTML = `
        <div style="margin-bottom: 20px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
          <button onclick="TEAM_DEADLINE_MANAGER.closeAllTeams()"
            style="padding: 12px 24px; font-size: 1rem; font-weight: 700; background: var(--accent-red);
                   color: var(--text-white); border: 2px solid var(--accent-red); border-radius: var(--border-radius);
                   cursor: pointer;">
            🔒 Close Registration for ALL Teams
          </button>
          <button onclick="TEAM_DEADLINE_MANAGER.openAllTeams()"
            style="padding: 12px 24px; font-size: 1rem; font-weight: 700; background: var(--success-green);
                   color: var(--primary-black); border: 2px solid var(--success-green); border-radius: var(--border-radius);
                   cursor: pointer;">
            🔓 Open Registration for ALL Teams
          </button>
        </div>

        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <input
            id="teamsSearchInput"
            type="text"
            placeholder="🔍 Search by name, username or email…"
            oninput="TEAM_DEADLINE_MANAGER.filterTeamsTable(this.value)"
            style="flex:1;min-width:220px;padding:12px 16px;background:rgba(0,0,0,.4);
                   border:2px solid rgba(255,215,0,.3);border-radius:12px;color:#fff;
                   font-size:1rem;outline:none;transition:border-color .2s;"
            onfocus="this.style.borderColor='#FFD700'"
            onblur="this.style.borderColor='rgba(255,215,0,.3)'"
          >
          <span id="teamsCountBadge"
            style="background:rgba(255,215,0,.1);border:1.5px solid rgba(255,215,0,.35);
                   color:#FFD700;padding:6px 16px;border-radius:20px;font-size:.9rem;
                   font-weight:800;white-space:nowrap;">
            ${teams.length} team${teams.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div style="overflow-x: auto;">
          <table id="teamsTable" style="width: 100%; border-collapse: collapse; background: var(--card-black);
                        border: 2px solid var(--border-gold); border-radius: var(--border-radius);">
            <thead>
              <tr style="background: linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(0,229,255,0.05) 100%);
                         border-bottom: 2px solid var(--border-gold);">
                <th style="padding: 14px 16px; text-align: left; color: var(--border-gold); font-size: 0.95rem;">Team Name</th>
                <th style="padding: 14px 16px; text-align: left; color: var(--border-gold); font-size: 0.95rem;">Username</th>
                <th style="padding: 14px 16px; text-align: left; color: var(--border-gold); font-size: 0.95rem;">Email</th>
                <th style="padding: 14px 16px; text-align: left; color: var(--border-gold); font-size: 0.95rem;">Password</th>
                <th style="padding: 14px 16px; text-align: left; color: var(--border-gold); font-size: 0.95rem;">Created</th>
                <th style="padding: 14px 16px; text-align: left; color: var(--border-gold); font-size: 0.95rem;">Status</th>
                <th style="padding: 14px 16px; text-align: left; color: var(--border-gold); font-size: 0.95rem;">Deadline</th>
                <th style="padding: 14px 16px; text-align: left; color: var(--border-gold); font-size: 0.95rem;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;

    } catch (error) {
      console.error('❌ Error loading teams:', error);
      container.innerHTML = `<p style="color: var(--accent-red);">Error loading teams: ${error.message}</p>`;
    }
  },

  // Save deadline for a single team
  async saveTeamDeadline(teamId) {
    try {
      const input = document.getElementById(`deadline-${teamId}`);
      const deadline = input ? input.value : '';

      await dbUpdate(dbRef(database, `teams/${teamId}`), {
        registrationDeadline: deadline
      });

      if (typeof MODAL !== 'undefined') {
        MODAL.success(deadline ? `Deadline set to ${deadline}` : 'Deadline cleared');
      }

      // Refresh table
      await this.renderTeamsTable('teamsTableContainer');
    } catch (error) {
      console.error('❌ Error saving deadline:', error);
      if (typeof MODAL !== 'undefined') {
        MODAL.error('Error saving deadline: ' + error.message);
      }
    }
  },

  // Toggle close/open for a single team
  async toggleTeamClose(teamId, shouldClose) {
    try {
      await dbUpdate(dbRef(database, `teams/${teamId}`), {
        registrationClosed: shouldClose
      });

      if (typeof MODAL !== 'undefined') {
        MODAL.success(shouldClose ? 'Registration closed for this team.' : 'Registration reopened for this team.');
      }

      await this.renderTeamsTable('teamsTableContainer');
    } catch (error) {
      console.error('❌ Error toggling team close:', error);
      if (typeof MODAL !== 'undefined') {
        MODAL.error('Error: ' + error.message);
      }
    }
  },

  async setBulkDeadline() {
    const h = parseInt(document.getElementById('bulk_hours')?.value || 0) || 0;
    const m = parseInt(document.getElementById('bulk_mins')?.value || 0) || 0;
    if (h === 0 && m === 0) { MODAL.warning('Enter hours and/or minutes.'); return; }

    const confirmed = await MODAL.showConfirm(`Set a ${h}h ${m}m deadline for ALL teams from now?`);
    if (!confirmed) return;

    try {
      const snap = await dbGet(dbRef(database, 'teams'));
      if (!snap.exists()) return;
      const deadline = new Date(Date.now() + (h * 60 + m) * 60000).toISOString();
      const updates = {};
      snap.forEach(c => {
        updates[`${c.key}/registrationDeadline`] = deadline;
        updates[`${c.key}/registrationClosed`] = false;
      });
      await dbUpdate(dbRef(database, 'teams'), updates);
      MODAL.success(`Deadline set for all teams: ${h}h ${m}m from now.`);
      await this.renderTeamsTable('teamsTableContainer');
    } catch (e) { MODAL.error('Error: ' + e.message); }
  },

  // Close registration for ALL teams
  async closeAllTeams() {
    const confirmed = await MODAL.showConfirm('🔒 Close registration for ALL teams? Coaches will not be able to register new players.');
    if (!confirmed) return;

    try {
      const teamsRef = dbRef(database, 'teams');
      const snapshot = await dbGet(teamsRef);

      if (!snapshot.exists()) return;

      const updates = {};
      snapshot.forEach(child => {
        updates[`${child.key}/registrationClosed`] = true;
      });

      await dbUpdate(dbRef(database, 'teams'), updates);

      if (typeof MODAL !== 'undefined') {
        MODAL.success('Registration closed for all teams.');
      }

      await this.renderTeamsTable('teamsTableContainer');
    } catch (error) {
      console.error('❌ Error closing all teams:', error);
      if (typeof MODAL !== 'undefined') {
        MODAL.error('Error: ' + error.message);
      }
    }
  },

  // Open registration for ALL teams
  async openAllTeams() {
    const ok = await MODAL.showConfirm('🔓 Reopen registration for ALL teams?');
    if (!ok) return;
    try {
      const snap = await dbGet(dbRef(database, 'teams'));
      if (!snap.exists()) return;
      const updates = {};
      snap.forEach(c => {
        updates[`${c.key}/registrationClosed`] = false;
        updates[`${c.key}/registrationDeadline`] = '';
      });
      await dbUpdate(dbRef(database, 'teams'), updates);
      MODAL.success('Registration opened for all teams.');
      await this.renderTeamsTable('teamsTableContainer');
    } catch (e) { MODAL.error('Error: ' + e.message); }
  },

  // Delete a team and all associated data (ADMIN ONLY)
  async deleteTeam(teamId, teamName) {
    // Check admin access
    if (typeof AUTH_MANAGER !== 'undefined') {
      const user = AUTH_MANAGER.getCurrentUser();
      if (user.role !== 'admin') {
        if (typeof MODAL !== 'undefined') {
          MODAL.error('❌ Only admins can delete teams.');
        }
        return;
      }
    }

    // Show confirmation with warning
    const message = `⚠️ WARNING: This will permanently delete:\n\n` +
      `• Team: "${teamName}"\n` +
      `• All players from this team — Official, Expo, and Poomsae\n` +
      `• All bracket entries and match records for these players\n\n` +
      `This action CANNOT be undone.\n\n` +
      `Are you sure you want to delete this team?`;

    const confirmed = await MODAL.showConfirm(message);
    if (!confirmed) return;

    const startTime = Date.now();
    if (typeof MODAL !== 'undefined') {
      MODAL.info('🔄 Deleting team and associated data... Please wait.');
    }

    try {
      console.log(`🗑️ Starting deletion process for team: "${teamName}" (ID: ${teamId})`);

      // Step 1: Find and delete all players associated with this team — across
      // BOTH the Official (`players`) and Expo (`expoPlayers`) trees. Poomsae
      // registrants have no separate node; they're plain rows in these same
      // two trees with a `poomsaeCategories` field, so they're covered here too.
      // "Official & Expo" registrants share the same id across both trees.
      console.log('📋 Finding all players for this team...');
      const playersSnap = await dbGet(dbRef(database, 'players'));
      const expoPlayersSnap = await dbGet(dbRef(database, 'expoPlayers'));

      const matchesTeam = (playerData) =>
        playerData.teamId === teamId || playerData.centerName === teamName || playerData.teamName === teamName;

      const officialPlayerIds = [];
      if (playersSnap.exists()) {
        Object.entries(playersSnap.val()).forEach(([playerId, playerData]) => {
          if (matchesTeam(playerData)) officialPlayerIds.push(playerId);
        });
      }

      const expoPlayerIds = [];
      if (expoPlayersSnap.exists()) {
        Object.entries(expoPlayersSnap.val()).forEach(([playerId, playerData]) => {
          if (matchesTeam(playerData)) expoPlayerIds.push(playerId);
        });
      }

      // Union of ids — used for anything that references a player generically
      // (match history, match results, standings, category results).
      const playersToDelete = Array.from(new Set([...officialPlayerIds, ...expoPlayerIds]));
      console.log(`✅ Found ${officialPlayerIds.length} official + ${expoPlayerIds.length} expo player record(s) (${playersToDelete.length} unique player(s)) to delete`);

      // Step 2: Find and clean up bracket references
      console.log('🏆 Cleaning up bracket references...');
      const bracketsRef = dbRef(database, 'brackets');
      const bracketsSnap = await dbGet(bracketsRef);

      const bracketsToUpdate = {};
      let bracketsModified = 0;
      if (bracketsSnap.exists()) {
        const allBrackets = bracketsSnap.val();
        Object.entries(allBrackets).forEach(([bracketId, bracketData]) => {
          let modified = false;

          // Remove deleted players from bracket
          if (bracketData.players && typeof bracketData.players === 'object') {
            Object.keys(bracketData.players).forEach(playerId => {
              if (playersToDelete.includes(playerId)) {
                bracketsToUpdate[`brackets/${bracketId}/players/${playerId}`] = null;
                modified = true;
              }
            });
          }

          // Remove team references from matches
          if (bracketData.matches && typeof bracketData.matches === 'object') {
            Object.entries(bracketData.matches).forEach(([matchId, matchData]) => {
              let matchModified = false;

              // Check if match involves deleted players
              if (matchData.player1 && playersToDelete.includes(matchData.player1)) {
                bracketsToUpdate[`brackets/${bracketId}/matches/${matchId}/player1`] = null;
                bracketsToUpdate[`brackets/${bracketId}/matches/${matchId}/player1Name`] = null;
                bracketsToUpdate[`brackets/${bracketId}/matches/${matchId}/player1Team`] = null;
                matchModified = true;
              }
              if (matchData.player2 && playersToDelete.includes(matchData.player2)) {
                bracketsToUpdate[`brackets/${bracketId}/matches/${matchId}/player2`] = null;
                bracketsToUpdate[`brackets/${bracketId}/matches/${matchId}/player2Name`] = null;
                bracketsToUpdate[`brackets/${bracketId}/matches/${matchId}/player2Team`] = null;
                matchModified = true;
              }

              if (matchModified) modified = true;
            });
          }

          if (modified) bracketsModified++;
        });
      }
      console.log(`✅ Prepared cleanup for ${bracketsModified} brackets`);

      // Step 2b: Find and clean up Expo bracket references (isolated tree —
      // flat matches with embedded player objects, not rounds of plain ids).
      console.log('🏆 Cleaning up Expo bracket references...');
      const expoBracketsSnap = await dbGet(dbRef(database, 'expoBrackets'));

      let expoBracketsModified = 0;
      if (expoBracketsSnap.exists()) {
        const allExpoBrackets = expoBracketsSnap.val();
        Object.entries(allExpoBrackets).forEach(([bracketId, bracketData]) => {
          let modified = false;

          if (Array.isArray(bracketData.matches)) {
            bracketData.matches.forEach((matchData, idx) => {
              if (matchData?.player1?.id && playersToDelete.includes(matchData.player1.id)) {
                bracketsToUpdate[`expoBrackets/${bracketId}/matches/${idx}/player1`] = null;
                modified = true;
              }
              if (matchData?.player2?.id && playersToDelete.includes(matchData.player2.id)) {
                bracketsToUpdate[`expoBrackets/${bracketId}/matches/${idx}/player2`] = null;
                modified = true;
              }
            });
          }

          if (Array.isArray(bracketData.byes)) {
            bracketData.byes.forEach((byePlayer, idx) => {
              if (byePlayer?.id && playersToDelete.includes(byePlayer.id)) {
                bracketsToUpdate[`expoBrackets/${bracketId}/byes/${idx}`] = null;
                modified = true;
              }
            });
          }

          if (modified) expoBracketsModified++;
        });
      }
      console.log(`✅ Prepared cleanup for ${expoBracketsModified} expo brackets`);

      // Step 3: Find and clean up match history / standings references
      console.log('📊 Cleaning up match history and standings...');
      const standingsRef = dbRef(database, 'matchHistory');
      const standingsSnap = await dbGet(standingsRef);

      let standingsModified = 0;
      if (standingsSnap.exists()) {
        const allHistory = standingsSnap.val();
        Object.entries(allHistory).forEach(([historyId, historyData]) => {
          if (historyData.player1 && playersToDelete.includes(historyData.player1)) {
            bracketsToUpdate[`matchHistory/${historyId}/player1`] = null;
          }
          if (historyData.player2 && playersToDelete.includes(historyData.player2)) {
            bracketsToUpdate[`matchHistory/${historyId}/player2`] = null;
          }
          if (historyData.winner && playersToDelete.includes(historyData.winner)) {
            bracketsToUpdate[`matchHistory/${historyId}/winner`] = null;
          }
          // Also clean up team references in standings
          if (historyData.teamId === teamId) {
            bracketsToUpdate[`matchHistory/${historyId}`] = null;
          }
          standingsModified++;
        });
      }
      console.log(`✅ Prepared cleanup for match history and standings`);

      // Step 3b: Clean up match results
      console.log('📈 Cleaning up match results...');
      const matchResultsRef = dbRef(database, 'matchResults');
      const matchResultsSnap = await dbGet(matchResultsRef);

      let matchResultsModified = 0;
      if (matchResultsSnap.exists()) {
        const allResults = matchResultsSnap.val();
        Object.entries(allResults).forEach(([resultId, resultData]) => {
          if (resultData.player1 && playersToDelete.includes(resultData.player1)) {
            bracketsToUpdate[`matchResults/${resultId}/player1`] = null;
          }
          if (resultData.player2 && playersToDelete.includes(resultData.player2)) {
            bracketsToUpdate[`matchResults/${resultId}/player2`] = null;
          }
          if (resultData.winner && playersToDelete.includes(resultData.winner)) {
            bracketsToUpdate[`matchResults/${resultId}/winner`] = null;
          }
          if (resultData.teamId === teamId) {
            bracketsToUpdate[`matchResults/${resultId}`] = null;
          }
          matchResultsModified++;
        });
      }
      console.log(`✅ Prepared cleanup for ${matchResultsModified} match results`);

      // Step 3c: Clean up overall standings (team-based statistics)
      console.log('🏅 Cleaning up overall standings...');
      const overallStandingsRef = dbRef(database, 'overallStandings');
      const overallStandingsSnap = await dbGet(overallStandingsRef);

      let overallStandingsModified = 0;
      if (overallStandingsSnap.exists()) {
        const allStandings = overallStandingsSnap.val();
        Object.entries(allStandings).forEach(([standingId, standingData]) => {
          // Delete standing records for this team
          if (standingData.teamId === teamId) {
            bracketsToUpdate[`overallStandings/${standingId}`] = null;
            overallStandingsModified++;
          }
          // Delete standing records for players from this team
          playersToDelete.forEach(playerId => {
            if (standingData.playerId === playerId) {
              bracketsToUpdate[`overallStandings/${standingId}`] = null;
              overallStandingsModified++;
            }
          });
        });
      }
      console.log(`✅ Prepared cleanup for ${overallStandingsModified} overall standings`);

      // Step 3d: Clean up category results
      console.log('📋 Cleaning up category results...');
      const categoryResultsRef = dbRef(database, 'categoryResults');
      const categoryResultsSnap = await dbGet(categoryResultsRef);

      let categoryResultsModified = 0;
      if (categoryResultsSnap.exists()) {
        const allCategoryResults = categoryResultsSnap.val();
        Object.entries(allCategoryResults).forEach(([catResultId, catResultData]) => {
          if (catResultData.teamId === teamId) {
            bracketsToUpdate[`categoryResults/${catResultId}`] = null;
            categoryResultsModified++;
          }
          // Also check for player references in category results
          playersToDelete.forEach(playerId => {
            if (catResultData.playerId === playerId) {
              bracketsToUpdate[`categoryResults/${catResultId}`] = null;
              categoryResultsModified++;
            }
          });
        });
      }
      console.log(`✅ Prepared cleanup for ${categoryResultsModified} category results`);

      // Step 3e: Clean up Expo match history
      console.log('📊 Cleaning up Expo match history...');
      const expoMatchHistorySnap = await dbGet(dbRef(database, 'expoMatchHistory'));

      let expoMatchHistoryModified = 0;
      if (expoMatchHistorySnap.exists()) {
        const allExpoHistory = expoMatchHistorySnap.val();
        Object.entries(allExpoHistory).forEach(([categoryKey, matches]) => {
          Object.entries(matches || {}).forEach(([matchId, matchData]) => {
            if (matchData.player1?.id && playersToDelete.includes(matchData.player1.id)) {
              bracketsToUpdate[`expoMatchHistory/${categoryKey}/${matchId}/player1`] = null;
              expoMatchHistoryModified++;
            }
            if (matchData.player2?.id && playersToDelete.includes(matchData.player2.id)) {
              bracketsToUpdate[`expoMatchHistory/${categoryKey}/${matchId}/player2`] = null;
              expoMatchHistoryModified++;
            }
          });
        });
      }
      console.log(`✅ Prepared cleanup for ${expoMatchHistoryModified} expo match history entries`);

      // Step 4: Delete all players (official + expo) and their images in a batch
      console.log('🗑️ Deleting players...');
      officialPlayerIds.forEach(playerId => {
        bracketsToUpdate[`players/${playerId}`] = null;
        bracketsToUpdate[`playerImages/${playerId}`] = null;
      });
      expoPlayerIds.forEach(playerId => {
        bracketsToUpdate[`expoPlayers/${playerId}`] = null;
        bracketsToUpdate[`playerImages/${playerId}`] = null;
      });

      // Step 5: Delete the team record
      console.log('🗑️ Deleting team record...');
      bracketsToUpdate[`teams/${teamId}`] = null;

      // Step 6: Delete team user role entry
      bracketsToUpdate[`users/${teamId}`] = null;

      // Step 7: Execute all deletions and updates in a single batch operation
      console.log('💾 Executing batch delete operation...');
      await dbUpdate(dbRef(database), bracketsToUpdate);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const successMsg = `✅ Team Deleted Successfully!\n\n` +
        `Deleted: ${teamName}\n` +
        `Players removed: ${playersToDelete.length} (${officialPlayerIds.length} official, ${expoPlayerIds.length} expo)\n` +
        `Brackets cleaned: ${bracketsModified}\n` +
        `Expo brackets cleaned: ${expoBracketsModified}\n` +
        `Match history cleaned: ${standingsModified}\n` +
        `Expo match history cleaned: ${expoMatchHistoryModified}\n` +
        `Match results cleaned: ${matchResultsModified}\n` +
        `Overall standings cleaned: ${overallStandingsModified}\n` +
        `Category results cleaned: ${categoryResultsModified}\n` +
        `Time: ${duration}s`;

      console.log(`✅ Deletion completed in ${duration}s`);

      if (typeof MODAL !== 'undefined') {
        MODAL.closeAlert();
        MODAL.success(successMsg);
      }

      // Refresh teams table
      await this.renderTeamsTable('teamsTableContainer');

    } catch (error) {
      console.error('❌ Error deleting team:', error);
      if (typeof MODAL !== 'undefined') {
        MODAL.closeAlert();
        MODAL.error('Error deleting team: ' + error.message);
      }
    }
  },

  // Live search: filter teams table rows by name / username / email
  filterTeamsTable(query) {
    const q = (query || '').toLowerCase().trim();
    const table = document.getElementById('teamsTable');
    const badge = document.getElementById('teamsCountBadge');
    if (!table) return;

    const rows = table.querySelectorAll('tbody tr');
    let visible = 0;
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      const show = !q || text.includes(q);
      row.style.display = show ? '' : 'none';
      if (show) visible++;
    });

    if (badge) {
      const total = rows.length;
      badge.textContent = q
        ? `${visible} of ${total} team${total !== 1 ? 's' : ''}`
        : `${total} team${total !== 1 ? 's' : ''}`;
    }
  },

  // ─── Edit Team Features ──────────────────────────────────────────────────
  async openEditTeam(teamId) {
    if (typeof AUTH_MANAGER !== 'undefined') {
      const user = AUTH_MANAGER.getCurrentUser();
      if (user.role !== 'admin') {
        if (typeof MODAL !== 'undefined') MODAL.error('❌ Only admins can edit teams.');
        return;
      }
    }

    this.createEditTeamModalHTML();

    try {
      const teamRef = dbRef(database, `teams/${teamId}`);
      const snap = await dbGet(teamRef);
      if (!snap.exists()) {
        if (typeof MODAL !== 'undefined') MODAL.error('Team not found.');
        return;
      }
      const t = snap.val();

      document.getElementById('editTeamId').value = teamId;
      document.getElementById('editTeamName').value = t.teamName || '';
      document.getElementById('editTeamUsername').value = t.username || '';
      document.getElementById('editTeamEmail').value = t.email || '';
      document.getElementById('editTeamPassword').value = localStorage.getItem('pw_team_' + teamId) || '';

      document.getElementById('editTeamModal').style.display = 'flex';
      document.getElementById('editTeamName').focus();
    } catch (err) {
      console.error('Error loading team for edit:', err);
      if (typeof MODAL !== 'undefined') MODAL.error('Error loading team data.');
    }
  },

  closeEditTeamModal() {
    const modal = document.getElementById('editTeamModal');
    if (modal) {
      modal.style.display = 'none';
      document.getElementById('editTeamForm').reset();
    }
  },

  createEditTeamModalHTML() {
    if (document.getElementById('editTeamModal')) return;

    const modalHTML = `
      <div id="editTeamModal" class="modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 2000; align-items: center; justify-content: center;">
        <div class="modal-content" style="background: var(--secondary-black); border: 2px solid var(--accent-cyan); border-radius: var(--border-radius); padding: 40px; width: 90%; max-width: 500px; box-shadow: 0 10px 40px rgba(0,229,255,0.3);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
            <h2 style="margin: 0; color: var(--accent-cyan);">✏️ Edit Team Details</h2>
            <button onclick="TEAM_DEADLINE_MANAGER.closeEditTeamModal()" style="background: transparent; border: none; color: var(--accent-cyan); font-size: 28px; cursor: pointer; padding: 0; width: 30px; height: 30px;">×</button>
          </div>

          <form id="editTeamForm" style="display: flex; flex-direction: column; gap: 20px;">
            <input type="hidden" id="editTeamId">
            <div style="display: flex; flex-direction: column;">
              <label style="color: var(--text-gray); margin-bottom: 8px; font-size: 0.95rem;">Team Name <span style="color: var(--accent-red);">*</span></label>
              <input type="text" id="editTeamName" required style="padding: 12px; background: var(--primary-black); border: 2px solid var(--text-gray); border-radius: 6px; color: var(--text-white); font-size: 1rem;" />
            </div>

            <div style="display: flex; flex-direction: column;">
              <label style="color: var(--text-gray); margin-bottom: 8px; font-size: 0.95rem;">Username <span style="color: var(--accent-red);">*</span></label>
              <input type="text" id="editTeamUsername" required style="padding: 12px; background: var(--primary-black); border: 2px solid var(--text-gray); border-radius: 6px; color: var(--text-white); font-size: 1rem;" />
            </div>

            <div style="display: flex; flex-direction: column;">
              <label style="color: var(--text-gray); margin-bottom: 8px; font-size: 0.95rem;">Email <span style="color: var(--accent-red);">*</span></label>
              <input type="email" id="editTeamEmail" required style="padding: 12px; background: var(--primary-black); border: 2px solid var(--text-gray); border-radius: 6px; color: var(--text-white); font-size: 1rem;" />
            </div>

            <div style="display: flex; flex-direction: column;">
              <label style="color: var(--text-gray); margin-bottom: 8px; font-size: 0.95rem;">Password <span style="color: var(--accent-red);">*</span></label>
              <input type="text" id="editTeamPassword" required style="padding: 12px; background: var(--primary-black); border: 2px solid var(--text-gray); border-radius: 6px; color: var(--text-white); font-size: 1rem;" />
            </div>

            <div style="display: flex; gap: 15px; margin-top: 20px;">
              <button type="submit" id="editTeamSubmitBtn" style="flex: 1; padding: 12px; background: var(--accent-cyan); color: var(--primary-black); border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">💾 Save Changes</button>
              <button type="button" onclick="TEAM_DEADLINE_MANAGER.closeEditTeamModal()" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.1); color: var(--text-white); border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">❌ Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    document.getElementById('editTeamForm').addEventListener('submit', (e) => {
      e.preventDefault();
      TEAM_DEADLINE_MANAGER.submitEditTeamForm();
    });

    // Close on backdrop click
    document.getElementById('editTeamModal').addEventListener('click', (e) => {
      if (e.target.id === 'editTeamModal') TEAM_DEADLINE_MANAGER.closeEditTeamModal();
    });
  },

  async submitEditTeamForm() {
    const teamId = document.getElementById('editTeamId').value;
    const teamName = document.getElementById('editTeamName').value.trim();
    const username = document.getElementById('editTeamUsername').value.trim();
    const email = document.getElementById('editTeamEmail').value.trim();
    const password = document.getElementById('editTeamPassword').value.trim();

    if (!teamName || !username || !email || !password) {
      if (typeof MODAL !== 'undefined') MODAL.warning('All fields are required');
      return;
    }
    if (password.length < 6) {
      if (typeof MODAL !== 'undefined') MODAL.warning('Password must be at least 6 characters');
      return;
    }
    if (!email.includes('@')) {
      if (typeof MODAL !== 'undefined') MODAL.warning('Invalid email format');
      return;
    }

    const submitBtn = document.getElementById('editTeamSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Saving...';

    try {
      const teamRef = dbRef(database, `teams/${teamId}`);
      await dbUpdate(teamRef, {
        teamName: teamName,
        username: username,
        email: email,
        password: await _tdmHashPassword(password)
      });
      localStorage.setItem('pw_team_' + teamId, password);

      if (typeof MODAL !== 'undefined') {
        MODAL.success('✅ Team details updated successfully!');
      }

      this.closeEditTeamModal();
      await this.renderTeamsTable('teamsTableContainer');
    } catch (err) {
      console.error('Error updating team:', err);
      if (typeof MODAL !== 'undefined') MODAL.error('Error: ' + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '💾 Save Changes';
    }
  }
};

window.TEAM_DEADLINE_MANAGER = TEAM_DEADLINE_MANAGER;