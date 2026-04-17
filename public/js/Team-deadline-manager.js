// ============================================
// TEAM DEADLINE MANAGER
// Admin tool to set per-team registration deadlines
// and globally close/open registration
// ============================================

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
          d.setHours(23, 59, 59, 999);
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
            <td style="padding: 14px 16px; color: var(--text-gray); font-size: 0.9rem;">${createdAt}</td>
            <td style="padding: 14px 16px;">${statusHtml}</td>
            <td style="padding: 14px 16px;">
              <input type="date" id="deadline-${team.id}" value="${deadline}"
                style="background: var(--secondary-black); border: 1px solid var(--accent-cyan); color: var(--text-white);
                       border-radius: 6px; padding: 6px 10px; font-size: 0.9rem; width: 150px;">
            </td>
            <td style="padding: 14px 16px;">
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button onclick="TEAM_DEADLINE_MANAGER.saveTeamDeadline('${team.id}')"
                  style="padding: 6px 14px; font-size: 0.85rem; background: var(--border-gold); color: var(--primary-black);
                         border: none; border-radius: 6px; cursor: pointer; font-weight: 700;">
                  💾 Save
                </button>
                <button onclick="TEAM_DEADLINE_MANAGER.toggleTeamClose('${team.id}', ${!isClosed})"
                  style="padding: 6px 14px; font-size: 0.85rem;
                         background: ${isClosed ? 'var(--success-green)' : 'var(--accent-red)'};
                         color: ${isClosed ? 'var(--primary-black)' : 'var(--text-white)'};
                         border: none; border-radius: 6px; cursor: pointer; font-weight: 700;"
                  id="toggle-btn-${team.id}">
                  ${isClosed ? '🔓 Reopen' : '🔒 Close'}
                </button>
                ${isAdmin ? `<button onclick="TEAM_DEADLINE_MANAGER.deleteTeam('${team.id}', '${team.teamName.replace(/'/g, "\\'")}')"
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

        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; background: var(--card-black);
                        border: 2px solid var(--border-gold); border-radius: var(--border-radius);">
            <thead>
              <tr style="background: linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(0,229,255,0.05) 100%);
                         border-bottom: 2px solid var(--border-gold);">
                <th style="padding: 14px 16px; text-align: left; color: var(--border-gold); font-size: 0.95rem;">Team Name</th>
                <th style="padding: 14px 16px; text-align: left; color: var(--border-gold); font-size: 0.95rem;">Username</th>
                <th style="padding: 14px 16px; text-align: left; color: var(--border-gold); font-size: 0.95rem;">Email</th>
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
        updates[`teams/${child.key}/registrationClosed`] = true;
      });

      await dbUpdate(dbRef(database), updates);

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
    const confirmed = await MODAL.showConfirm('🔓 Reopen registration for ALL teams?');
    if (!confirmed) return;

    try {
      const teamsRef = dbRef(database, 'teams');
      const snapshot = await dbGet(teamsRef);

      if (!snapshot.exists()) return;

      const updates = {};
      snapshot.forEach(child => {
        updates[`teams/${child.key}/registrationClosed`] = false;
        updates[`teams/${child.key}/registrationDeadline`] = '';
      });

      await dbUpdate(dbRef(database), updates);

      if (typeof MODAL !== 'undefined') {
        MODAL.success('Registration opened for all teams.');
      }

      await this.renderTeamsTable('teamsTableContainer');
    } catch (error) {
      console.error('❌ Error opening all teams:', error);
      if (typeof MODAL !== 'undefined') {
        MODAL.error('Error: ' + error.message);
      }
    }
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
      `• All players from this team\n` +
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

      // Step 1: Find and delete all players associated with this team
      console.log('📋 Finding all players for this team...');
      const playersRef = dbRef(database, 'players');
      const playersSnap = await dbGet(playersRef);
      
      const playersToDelete = [];
      if (playersSnap.exists()) {
        const allPlayers = playersSnap.val();
        Object.entries(allPlayers).forEach(([playerId, playerData]) => {
          // Players are linked to teams via centerName or teamName
          if (playerData.centerName === teamName || playerData.teamName === teamName) {
            playersToDelete.push(playerId);
          }
        });
      }
      console.log(`✅ Found ${playersToDelete.length} players to delete`);

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

      // Step 4: Delete all players in a batch
      console.log('🗑️ Deleting players...');
      playersToDelete.forEach(playerId => {
        bracketsToUpdate[`players/${playerId}`] = null;
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
        `Players removed: ${playersToDelete.length}\n` +
        `Brackets cleaned: ${bracketsModified}\n` +
        `Match history cleaned: ${standingsModified}\n` +
        `Match results cleaned: ${matchResultsModified}\n` +
        `Overall standings cleaned: ${overallStandingsModified}\n` +
        `Category results cleaned: ${categoryResultsModified}\n` +
        `Time: ${duration}s`;

      console.log(`✅ Deletion completed in ${duration}s`);

      if (typeof MODAL !== 'undefined') {
        MODAL.success(successMsg);
      }

      // Refresh teams table
      await this.renderTeamsTable('teamsTableContainer');

    } catch (error) {
      console.error('❌ Error deleting team:', error);
      if (typeof MODAL !== 'undefined') {
        MODAL.error('Error deleting team: ' + error.message);
      }
    }
  }
};

window.TEAM_DEADLINE_MANAGER = TEAM_DEADLINE_MANAGER;