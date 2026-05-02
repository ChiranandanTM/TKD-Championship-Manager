// ============================================
// PLAYER MANAGER
// Handle player deletion with cascading cleanup
// ============================================

const PLAYER_MANAGER = {

  // Delete a player and all associated data
  async deletePlayer(playerId, playerName, playerTeamId) {
    // Check access - must be team owner or admin
    let isAdmin = false;
    let isTeamOwner = false;
    
    if (typeof AUTH_MANAGER !== 'undefined') {
      const user = AUTH_MANAGER.getCurrentUser();
      isAdmin = user.role === 'admin';
      isTeamOwner = user.role === 'team' && user.teamId === playerTeamId;
      
      if (!isAdmin && !isTeamOwner) {
        if (typeof MODAL !== 'undefined') {
          MODAL.error('❌ You do not have permission to delete this player.');
        }
        return;
      }
    }

    // Check if team registration is still open
    try {
      const teamRef = dbRef(database, `teams/${playerTeamId}`);
      const teamSnap = await dbGet(teamRef);
      
      if (teamSnap.exists()) {
        const team = teamSnap.val();
        if (team.registrationClosed === true) {
          if (typeof MODAL !== 'undefined') {
            MODAL.error('❌ Cannot delete player: Registration form has been closed by the admin. Player roster is now locked.');
          }
          return;
        }
      }
    } catch (error) {
      console.error('Error checking team registration status:', error);
    }

    // Show confirmation with warning
    const message = `⚠️ WARNING: This will permanently delete:\n\n` +
      `• Player: "${playerName}"\n` +
      `• All bracket entries for this player\n` +
      `• All match records involving this player\n` +
      `• All statistics and standings\n\n` +
      `This action CANNOT be undone.\n\n` +
      `Are you sure you want to delete this player?`;

    const confirmed = await MODAL.showConfirm(message);
    if (!confirmed) return;

    const startTime = Date.now();
    if (typeof MODAL !== 'undefined') {
      MODAL.info('🔄 Deleting player and associated data... Please wait.');
    }

    try {
      console.log(`🗑️ Starting deletion process for player: "${playerName}" (ID: ${playerId})`);

      // For team users (no Firebase Auth), delete player record AND clean bracket references
      if (isTeamOwner && !isAdmin) {
        console.log('👥 Team user detected - deleting player + bracket cleanup');

        const cleanupUpdates = {};
        cleanupUpdates[`players/${playerId}`] = null;

        // Clean bracket references so no ghost IDs remain
        try {
          const bracketsSnap = await dbGet(dbRef(database, 'brackets'));
          if (bracketsSnap.exists()) {
            bracketsSnap.forEach(bracketChild => {
              const bracketId = bracketChild.key;
              const bracketData = bracketChild.val();
              // Remove from player list
              if (bracketData.players && bracketData.players[playerId]) {
                cleanupUpdates[`brackets/${bracketId}/players/${playerId}`] = null;
              }
              // Remove from match slots
              if (bracketData.matches && typeof bracketData.matches === 'object') {
                Object.entries(bracketData.matches).forEach(([matchId, matchData]) => {
                  if (matchData.player1 === playerId) {
                    cleanupUpdates[`brackets/${bracketId}/matches/${matchId}/player1`] = null;
                    cleanupUpdates[`brackets/${bracketId}/matches/${matchId}/player1Name`] = null;
                    cleanupUpdates[`brackets/${bracketId}/matches/${matchId}/player1Team`] = null;
                  }
                  if (matchData.player2 === playerId) {
                    cleanupUpdates[`brackets/${bracketId}/matches/${matchId}/player2`] = null;
                    cleanupUpdates[`brackets/${bracketId}/matches/${matchId}/player2Name`] = null;
                    cleanupUpdates[`brackets/${bracketId}/matches/${matchId}/player2Team`] = null;
                  }
                });
              }
            });
          }
        } catch (bracketErr) {
          console.warn('⚠️ Bracket cleanup partial error (non-fatal):', bracketErr.message);
        }

        await dbUpdate(dbRef(database), cleanupUpdates);

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        if (typeof MODAL !== 'undefined') {
          MODAL.success(`✅ Player "${playerName}" deleted and bracket data cleaned.\nTime: ${duration}s`);
        }

        if (typeof loadPlayers === 'function') {
          await loadPlayers();
        }
        return;
      }

      // For admin users, do full cleanup
      const updates = {};

      // Step 1: Clean up bracket references
      console.log('🏆 Cleaning up bracket references...');
      const bracketsRef = dbRef(database, 'brackets');
      const bracketsSnap = await dbGet(bracketsRef);
      
      let bracketsModified = 0;
      if (bracketsSnap.exists()) {
        const allBrackets = bracketsSnap.val();
        Object.entries(allBrackets).forEach(([bracketId, bracketData]) => {
          // Remove player from bracket player list
          if (bracketData.players && bracketData.players[playerId]) {
            updates[`brackets/${bracketId}/players/${playerId}`] = null;
            bracketsModified++;
          }

          // Remove player from matches
          if (bracketData.matches && typeof bracketData.matches === 'object') {
            Object.entries(bracketData.matches).forEach(([matchId, matchData]) => {
              if (matchData.player1 === playerId) {
                updates[`brackets/${bracketId}/matches/${matchId}/player1`] = null;
                updates[`brackets/${bracketId}/matches/${matchId}/player1Name`] = null;
                updates[`brackets/${bracketId}/matches/${matchId}/player1Team`] = null;
              }
              if (matchData.player2 === playerId) {
                updates[`brackets/${bracketId}/matches/${matchId}/player2`] = null;
                updates[`brackets/${bracketId}/matches/${matchId}/player2Name`] = null;
                updates[`brackets/${bracketId}/matches/${matchId}/player2Team`] = null;
              }
            });
          }
        });
      }
      console.log(`✅ Prepared cleanup for ${bracketsModified} brackets`);

      // Step 2: Clean up match history
      console.log('📊 Cleaning up match history...');
      const matchHistoryRef = dbRef(database, 'matchHistory');
      const matchHistorySnap = await dbGet(matchHistoryRef);
      
      let matchHistoryModified = 0;
      if (matchHistorySnap.exists()) {
        const allHistory = matchHistorySnap.val();
        Object.entries(allHistory).forEach(([historyId, historyData]) => {
          if (historyData.player1 === playerId) {
            updates[`matchHistory/${historyId}/player1`] = null;
          }
          if (historyData.player2 === playerId) {
            updates[`matchHistory/${historyId}/player2`] = null;
          }
          if (historyData.winner === playerId) {
            updates[`matchHistory/${historyId}/winner`] = null;
          }
          matchHistoryModified++;
        });
      }
      console.log(`✅ Prepared cleanup for ${matchHistoryModified} match history records`);

      // Step 3: Clean up match results
      console.log('📈 Cleaning up match results...');
      const matchResultsRef = dbRef(database, 'matchResults');
      const matchResultsSnap = await dbGet(matchResultsRef);
      
      let matchResultsModified = 0;
      if (matchResultsSnap.exists()) {
        const allResults = matchResultsSnap.val();
        Object.entries(allResults).forEach(([resultId, resultData]) => {
          if (resultData.player1 === playerId) {
            updates[`matchResults/${resultId}/player1`] = null;
          }
          if (resultData.player2 === playerId) {
            updates[`matchResults/${resultId}/player2`] = null;
          }
          if (resultData.winner === playerId) {
            updates[`matchResults/${resultId}/winner`] = null;
          }
          matchResultsModified++;
        });
      }
      console.log(`✅ Prepared cleanup for ${matchResultsModified} match results`);

      // Step 4: Clean up overall standings
      console.log('🏅 Cleaning up overall standings...');
      const overallStandingsRef = dbRef(database, 'overallStandings');
      const overallStandingsSnap = await dbGet(overallStandingsRef);
      
      let overallStandingsModified = 0;
      if (overallStandingsSnap.exists()) {
        const allStandings = overallStandingsSnap.val();
        Object.entries(allStandings).forEach(([standingId, standingData]) => {
          if (standingData.playerId === playerId) {
            updates[`overallStandings/${standingId}`] = null;
            overallStandingsModified++;
          }
        });
      }
      console.log(`✅ Prepared cleanup for ${overallStandingsModified} overall standings`);

      // Step 5: Clean up category results
      console.log('📋 Cleaning up category results...');
      const categoryResultsRef = dbRef(database, 'categoryResults');
      const categoryResultsSnap = await dbGet(categoryResultsRef);
      
      let categoryResultsModified = 0;
      if (categoryResultsSnap.exists()) {
        const allCategoryResults = categoryResultsSnap.val();
        Object.entries(allCategoryResults).forEach(([catResultId, catResultData]) => {
          if (catResultData.playerId === playerId) {
            updates[`categoryResults/${catResultId}`] = null;
            categoryResultsModified++;
          }
        });
      }
      console.log(`✅ Prepared cleanup for ${categoryResultsModified} category results`);

      // Step 6: Delete the player record
      console.log('🗑️ Deleting player record...');
      updates[`players/${playerId}`] = null;

      // Step 7: Execute all deletions in a single batch operation
      console.log('💾 Executing batch delete operation...');
      await dbUpdate(dbRef(database), updates);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const successMsg = `✅ Player Deleted Successfully!\n\n` +
        `Deleted: ${playerName}\n` +
        `Brackets cleaned: ${bracketsModified}\n` +
        `Match history cleaned: ${matchHistoryModified}\n` +
        `Match results cleaned: ${matchResultsModified}\n` +
        `Overall standings cleaned: ${overallStandingsModified}\n` +
        `Category results cleaned: ${categoryResultsModified}\n` +
        `Time: ${duration}s`;

      console.log(`✅ Deletion completed in ${duration}s`);

      if (typeof MODAL !== 'undefined') {
        MODAL.success(successMsg);
      }

      // Refresh UI - need to determine where to refresh based on context
      // For team dashboard
      if (typeof loadPlayers === 'function') {
        await loadPlayers();
      }
      // For admin dashboard - would need to reload statistics or player lists

    } catch (error) {
      console.error('❌ Error deleting player:', error);
      if (typeof MODAL !== 'undefined') {
        MODAL.error('Error deleting player: ' + error.message);
      }
    }
  }
};

window.PLAYER_MANAGER = PLAYER_MANAGER;
