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
        cleanupUpdates[`playerImages/${playerId}`] = null;
        cleanupUpdates[`expoPlayers/${playerId}`] = null;

        // Clean bracket references so no ghost IDs remain. Schema matches
        // bracket.js's saveBracket: rounds is an array of arrays of match
        // objects with player1/player2 as compressed player objects (not
        // raw ID strings), plus a separate byePlayers map keyed by round
        // index — there is no top-level players/matches map.
        try {
          const bracketsSnap = await dbGet(dbRef(database, 'brackets'));
          if (bracketsSnap.exists()) {
            bracketsSnap.forEach(bracketChild => {
              const bracketId = bracketChild.key;
              const bracketData = bracketChild.val();
              if (Array.isArray(bracketData.rounds)) {
                bracketData.rounds.forEach((round, roundIdx) => {
                  (round || []).forEach((matchData, matchIdx) => {
                    if (matchData.player1?.id === playerId) {
                      cleanupUpdates[`brackets/${bracketId}/rounds/${roundIdx}/${matchIdx}/player1`] = null;
                    }
                    if (matchData.player2?.id === playerId) {
                      cleanupUpdates[`brackets/${bracketId}/rounds/${roundIdx}/${matchIdx}/player2`] = null;
                    }
                  });
                });
              }
              if (bracketData.byePlayers && typeof bracketData.byePlayers === 'object') {
                Object.entries(bracketData.byePlayers).forEach(([roundKey, byePlayer]) => {
                  if (byePlayer?.id === playerId) {
                    cleanupUpdates[`brackets/${bracketId}/byePlayers/${roundKey}`] = null;
                  }
                });
              }
            });
          }
        } catch (bracketErr) {
          console.warn('⚠️ Bracket cleanup partial error (non-fatal):', bracketErr.message);
        }

        // Clean Expo bracket references (isolated tree — separate from brackets/ above)
        try {
          const expoBracketsSnap = await dbGet(dbRef(database, 'expoBrackets'));
          if (expoBracketsSnap.exists()) {
            expoBracketsSnap.forEach(bracketChild => {
              const bracketId = bracketChild.key;
              const bracketData = bracketChild.val();
              if (Array.isArray(bracketData.matches)) {
                bracketData.matches.forEach((matchData, idx) => {
                  if (matchData.player1?.id === playerId) {
                    cleanupUpdates[`expoBrackets/${bracketId}/matches/${idx}/player1`] = null;
                  }
                  if (matchData.player2?.id === playerId) {
                    cleanupUpdates[`expoBrackets/${bracketId}/matches/${idx}/player2`] = null;
                  }
                });
              }
              if (Array.isArray(bracketData.byes)) {
                bracketData.byes.forEach((byePlayer, idx) => {
                  if (byePlayer?.id === playerId) {
                    cleanupUpdates[`expoBrackets/${bracketId}/byes/${idx}`] = null;
                  }
                });
              }
            });
          }
        } catch (expoErr) {
          console.warn('⚠️ Expo bracket cleanup partial error (non-fatal):', expoErr.message);
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

      // Step 1: Clean up bracket references. Schema matches bracket.js's
      // saveBracket: rounds is an array of arrays of match objects with
      // player1/player2 as compressed player objects (not raw ID strings),
      // plus a separate byePlayers map keyed by round index — there is no
      // top-level players/matches map.
      console.log('🏆 Cleaning up bracket references...');
      const bracketsRef = dbRef(database, 'brackets');
      const bracketsSnap = await dbGet(bracketsRef);

      let bracketsModified = 0;
      if (bracketsSnap.exists()) {
        const allBrackets = bracketsSnap.val();
        Object.entries(allBrackets).forEach(([bracketId, bracketData]) => {
          if (Array.isArray(bracketData.rounds)) {
            bracketData.rounds.forEach((round, roundIdx) => {
              (round || []).forEach((matchData, matchIdx) => {
                if (matchData.player1?.id === playerId) {
                  updates[`brackets/${bracketId}/rounds/${roundIdx}/${matchIdx}/player1`] = null;
                  bracketsModified++;
                }
                if (matchData.player2?.id === playerId) {
                  updates[`brackets/${bracketId}/rounds/${roundIdx}/${matchIdx}/player2`] = null;
                  bracketsModified++;
                }
              });
            });
          }
          if (bracketData.byePlayers && typeof bracketData.byePlayers === 'object') {
            Object.entries(bracketData.byePlayers).forEach(([roundKey, byePlayer]) => {
              if (byePlayer?.id === playerId) {
                updates[`brackets/${bracketId}/byePlayers/${roundKey}`] = null;
                bracketsModified++;
              }
            });
          }
        });
      }
      console.log(`✅ Prepared cleanup for ${bracketsModified} brackets`);

      // Step 1b: Clean up Expo bracket references (isolated tree)
      console.log('🏆 Cleaning up Expo bracket references...');
      const expoBracketsRef = dbRef(database, 'expoBrackets');
      const expoBracketsSnap = await dbGet(expoBracketsRef);

      let expoBracketsModified = 0;
      if (expoBracketsSnap.exists()) {
        const allExpoBrackets = expoBracketsSnap.val();
        Object.entries(allExpoBrackets).forEach(([bracketId, bracketData]) => {
          if (Array.isArray(bracketData.matches)) {
            bracketData.matches.forEach((matchData, idx) => {
              if (matchData.player1?.id === playerId) {
                updates[`expoBrackets/${bracketId}/matches/${idx}/player1`] = null;
                expoBracketsModified++;
              }
              if (matchData.player2?.id === playerId) {
                updates[`expoBrackets/${bracketId}/matches/${idx}/player2`] = null;
                expoBracketsModified++;
              }
            });
          }
          if (Array.isArray(bracketData.byes)) {
            bracketData.byes.forEach((byePlayer, idx) => {
              if (byePlayer?.id === playerId) {
                updates[`expoBrackets/${bracketId}/byes/${idx}`] = null;
                expoBracketsModified++;
              }
            });
          }
        });
      }
      console.log(`✅ Prepared cleanup for ${expoBracketsModified} expo bracket references`);

      // Step 1c: Clean up Expo match history
      console.log('📊 Cleaning up Expo match history...');
      const expoMatchHistorySnap = await dbGet(dbRef(database, 'expoMatchHistory'));
      if (expoMatchHistorySnap.exists()) {
        const allExpoHistory = expoMatchHistorySnap.val();
        Object.entries(allExpoHistory).forEach(([categoryKey, matches]) => {
          Object.entries(matches || {}).forEach(([matchId, matchData]) => {
            if (matchData.player1?.id === playerId) {
              updates[`expoMatchHistory/${categoryKey}/${matchId}/player1`] = null;
            }
            if (matchData.player2?.id === playerId) {
              updates[`expoMatchHistory/${categoryKey}/${matchId}/player2`] = null;
            }
          });
        });
      }

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

      // Step 6: Delete the player record and image
      console.log('🗑️ Deleting player record...');
      updates[`players/${playerId}`] = null;
      updates[`playerImages/${playerId}`] = null;
      updates[`expoPlayers/${playerId}`] = null;

      // Step 7: Execute all deletions in a single batch operation
      console.log('💾 Executing batch delete operation...');
      await dbUpdate(dbRef(database), updates);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const successMsg = `✅ Player Deleted Successfully!\n\n` +
        `Deleted: ${playerName}\n` +
        `Brackets cleaned: ${bracketsModified}\n` +
        `Expo brackets cleaned: ${expoBracketsModified}\n` +
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
