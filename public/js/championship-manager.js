// ============================================
// CHAMPIONSHIP MANAGER - Archive & History
// ============================================

const CHAMPIONSHIP_MANAGER = {
  // 🔒 CONCURRENCY FIX #5: Lock mechanism to prevent concurrent operations
  isCreatingChampionship: false,
  
  // ✅ Database connection verification helper
  async _verifyDatabaseConnection(timeoutMs = 3000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn('⚠️ Connection check timeout - assuming offline');
        resolve(false);
      }, timeoutMs);

      try {
        const testRef = dbRef(database, '.info/connected');
        const unsubscribe = dbOnValue(testRef, (snap) => {
          if (unsubscribe) unsubscribe();
          clearTimeout(timer);
          const isConnected = snap.val() === true;
          console.log(`📡 Database ${isConnected ? 'ONLINE' : 'OFFLINE'}`);
          resolve(isConnected);
        });
      } catch (e) {
        clearTimeout(timer);
        console.error('❌ Connection check error:', e.message);
        resolve(false);
      }
    });
  },
  
  // Archive current championship
  async archiveCurrentChampionship() {
    // 🔒 CONCURRENCY FIX #5: Prevent concurrent execution
    if (this.isCreatingChampionship) {
      throw new Error('Championship operation already in progress. Please wait.');
    }
    
    this.isCreatingChampionship = true;
    try {
      console.log("📦 Starting archive process...");
      
      const timestamp = new Date().toISOString();
      const championshipId = timestamp.replace(/[:.]/g, '-');
      const archivePath = `championshipHistory/${championshipId}`;

      console.log("📦 Archiving to path:", archivePath);
      console.log("📚 Fetching championship data...");

      // Get current championship details
      const formConfigRef = dbRef(database, 'formConfig');
      const formSnap = await dbGet(formConfigRef);
      const championship = formSnap.exists() ? formSnap.val().championship : {};
      console.log("✅ Championship metadata fetched");

      // Get all competition data
      const playersRef = dbRef(database, 'players');
      const bracketsRef = dbRef(database, 'brackets');
      const matchHistoryRef = dbRef(database, 'matchHistory');
      const teamsRef = dbRef(database, 'teams');

      const [playersSnap, bracketsSnap, historySnap, teamsSnap] = await Promise.all([
        dbGet(playersRef),
        dbGet(bracketsRef),
        dbGet(matchHistoryRef),
        dbGet(teamsRef)
      ]);
      console.log("✅ All data fetched");

      // Create archive structure with competition data only
      const archiveData = {
        timestamp: timestamp,
        championship: championship,
        data: {
          players: playersSnap.exists() ? playersSnap.val() : {},
          brackets: bracketsSnap.exists() ? bracketsSnap.val() : {},
          matchHistory: historySnap.exists() ? historySnap.val() : {},
          teams: teamsSnap.exists() ? teamsSnap.val() : {}
        }
      };

      console.log("✍️ Writing archive to Firebase...");
      await dbSet(dbRef(database, archivePath), archiveData);
      
      console.log("✅ Championship archived successfully to", archivePath);
      return { success: true, championshipId };
    } catch (error) {
      console.error("❌ Error archiving championship:", error);
      console.error("❌ Error details:", error.message, error.code);
      throw error;
    } finally {
      this.isCreatingChampionship = false;  // 🔒 Always release lock
    }
  },

  // Clear all current competition data
  async clearCurrentData() {
    try {
      console.log("🗑️ Clearing all competition data...");
      
      console.log("📝 Clearing players...");
      await dbSet(dbRef(database, 'players'), {});
      console.log("✅ Players cleared");
      
      console.log("📝 Clearing brackets...");
      await dbSet(dbRef(database, 'brackets'), {});
      console.log("✅ Brackets cleared");
      
      console.log("📝 Clearing match history...");
      await dbSet(dbRef(database, 'matchHistory'), {});
      console.log("✅ Match history cleared");
      
      console.log("📝 Clearing teams...");
      await dbSet(dbRef(database, 'teams'), {});
      console.log("✅ Teams cleared");
      
      console.log("✅ All competition data cleared successfully");
      return { success: true };
    } catch (error) {
      console.error("❌ Error clearing data:", error);
      console.error("❌ Error details:", error.message, error.code);
      throw error;
    }
  },

  // Create new championship (PRESERVES all existing championships in /championships collection)
  async createNewChampionship(title, venue, address, date, organizer) {
    // 🔒 CONCURRENCY FIX #5: Prevent concurrent execution
    if (this.isCreatingChampionship) {
      throw new Error('Championship operation already in progress. Please wait.');
    }
    
    this.isCreatingChampionship = true;
    try {
      // ✅ DATABASE CONNECTION FIX #4: Verify connection first
      const isConnected = await this._verifyDatabaseConnection(3000);
      if (!isConnected) {
        throw new Error('Database connection failed. Please check your internet and try again.');
      }
      
      console.log("📝 Creating new championship with:", { title, venue, address, date, organizer });
      
      // Generate unique championship ID
      const champId = `champ_${Date.now()}`;
      const champRef = dbRef(database, `championships/${champId}`);
      
      // Save to /championships collection (PERMANENT storage - never overwritten)
      await dbSet(champRef, {
        name: title,
        location: venue,
        description: address,
        date: date,
        organizer: organizer,
        status: 'active',
        createdAt: Date.now(),
        championship: {
          title,
          venue,
          address,
          date,
          organizer
        },
        categories: {},
        participants: {},
        standings: {},
        medals: {},
        matches: {}
      });
      console.log("✅ Championship saved to /championships collection with ID:", champId);
      
      // Also update formConfig so the current form displays the new championship info
      console.log("💾 Updating formConfig with new championship details...");
      const configRef = dbRef(database, 'formConfig');
      const configSnap = await dbGet(configRef);
      const config = configSnap.exists() ? configSnap.val() : {};
      
      config.championship = {
        title,
        venue,
        address,
        date,
        organizer,
        champId: champId
      };
      
      await dbSet(configRef, config);
      console.log("✅ formConfig updated with new championship details");
      
      console.log("✅ New championship created successfully - existing championships preserved");
      return { success: true, champId };
    } catch (error) {
      console.error("❌ Error creating championship:", error);
      console.error("❌ Error details:", error.message, error.code);
      throw error;
    } finally {
      this.isCreatingChampionship = false;  // 🔒 Always release lock
    }
  },

  // Load all archived championships
  async loadArchivedChampionships() {
    try {
      const historyRef = dbRef(database, 'championshipHistory');
      const snapshot = await dbGet(historyRef);
      
      if (!snapshot.exists()) {
        return [];
      }

      const championships = [];
      snapshot.forEach(child => {
        const data = child.val();
        
        // Skip null or invalid entries
        if (!data || !data.data || !data.timestamp) {
          return;
        }
        
        championships.push({
          id: child.key,
          timestamp: data.timestamp,
          championshipName: data.championship?.title || 'Unknown',
          playerCount: Object.keys(data.data.players || {}).length,
          teamCount: Object.keys(data.data.teams || {}).length,
          matchCount: this.countMatches(data.data.matchHistory || {})
        });
      });

      // Sort by timestamp descending (newest first)
      championships.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return championships;
    } catch (error) {
      console.error("❌ Error loading archived championships:", error);
      return [];
    }
  },

  // Count total matches
  countMatches(matchHistory) {
    let count = 0;
    Object.keys(matchHistory).forEach(category => {
      if (matchHistory[category]) {
        count += Object.keys(matchHistory[category]).length;
      }
    });
    return count;
  },

  // Load championship from /championships collection (KEEPS it in collection - does NOT delete)
  async loadChampionshipFromCollection(champId) {
    try {
      console.log("📂 Loading championship from /championships collection:", champId);
      const champRef = dbRef(database, `championships/${champId}`);
      const champSnap = await dbGet(champRef);

      if (!champSnap.exists()) {
        throw new Error("Championship not found in /championships collection");
      }

      const champ = champSnap.val();
      console.log("📖 Championship data loaded", champ);
      
      // Extract championship metadata
      const champMetadata = champ.championship || {
        title: champ.name,
        venue: champ.location,
        address: champ.description,
        date: champ.date,
        organizer: champ.organizer
      };
      
      // Update formConfig to mark this as the active championship
      console.log("💾 Updating formConfig with championship metadata...");
      const configRef = dbRef(database, 'formConfig');
      const configSnap = await dbGet(configRef);
      const config = configSnap.exists() ? configSnap.val() : {};
      
      config.championship = {
        ...champMetadata,
        champId: champId,
        loadedAt: Date.now()
      };
      
      await dbSet(configRef, config);
      console.log("✅ formConfig updated");
      
      // Note: Championship remains in /championships collection - NOT deleted
      console.log("✅ Championship loaded successfully from collection (preserved in /championships)");
      return { success: true, data: champ };
    } catch (error) {
      console.error("❌ Error loading championship from collection:", error);
      console.error("❌ Error details:", error.message);
      throw error;
    }
  },

  // Restore championship from archive
  async restoreChampionship(championshipId) {
    try {
      console.log("📂 Loading championship:", championshipId);
      const archiveRef = dbRef(database, `championshipHistory/${championshipId}`);
      const snapshot = await dbGet(archiveRef);

      if (!snapshot.exists()) {
        throw new Error("Championship not found in archive");
      }

      const archiveData = snapshot.val();
      console.log("📖 Archive data loaded");
      
      // Restore competition data only
      console.log("💾 Restoring players...");
      await dbSet(dbRef(database, 'players'), archiveData.data.players || {});
      
      console.log("💾 Restoring brackets...");
      await dbSet(dbRef(database, 'brackets'), archiveData.data.brackets || {});
      
      console.log("💾 Restoring match history...");
      await dbSet(dbRef(database, 'matchHistory'), archiveData.data.matchHistory || {});
      
      console.log("💾 Restoring teams...");
      await dbSet(dbRef(database, 'teams'), archiveData.data.teams || {});

      // Also restore championship metadata to formConfig
      if (archiveData.championship) {
        const config = await FORM_CONFIG.loadConfig();
        config.championship = archiveData.championship;
        await FORM_CONFIG.saveConfig(config);
      }

      console.log("✅ Championship loaded successfully!");
      return { success: true };
    } catch (error) {
      console.error("❌ Error loading championship:", error);
      console.error("❌ Error details:", error.message);
      throw error;
    }
  },

  // Delete archived championship
  async deleteArchivedChampionship(championshipId) {
    try {
      await dbRemove(dbRef(database, `championshipHistory/${championshipId}`));
      console.log("✅ Championship deleted from Firebase:", championshipId);
      return { success: true };
    } catch (error) {
      console.error("❌ Error deleting championship:", error);
      throw error;
    }
  },

  // NEW CHAMPIONSHIP SYSTEM - Per-championship data management
  
  // Create a new championship
  async createChampionship(data) {
    try {
      const champId = `champ_${Date.now()}`;
      const champRef = dbRef(database, `championships/${champId}`);
      
      await dbSet(champRef, {
        name: data.name,
        description: data.description || '',
        location: data.location || '',
        status: data.status || 'draft',
        createdAt: Date.now(),
        categories: {},
        participants: {},
        standings: {},
        medals: {},
        matches: {}
      });
      
      console.log('✅ Championship created:', champId);
      return champId;
    } catch (error) {
      console.error("❌ Error creating championship:", error);
      throw error;
    }
  },

  // Get all championships
  async getAllChampionships() {
    try {
      const champs = [];
      
      // Get championships from /championships collection - this is the source of truth
      const champsRef = dbRef(database, 'championships');
      const snapshot = await dbGet(champsRef);
      
      if (snapshot.exists()) {
        snapshot.forEach(child => {
          const data = child.val();
          if (data) {
            champs.push({
              id: child.key,
              ...data
            });
          }
        });
      }

      // Sort by createdAt descending (newest first)
      champs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return champs;
    } catch (error) {
      console.error("❌ Error getting championships:", error);
      return [];
    }
  },

  // Get single championship with all its data
  async getChampionship(champId) {
    try {
      const champRef = dbRef(database, `championships/${champId}`);
      const snapshot = await dbGet(champRef);
      
      if (!snapshot.exists()) {
        throw new Error('Championship not found');
      }

      return {
        id: champId,
        ...snapshot.val()
      };
    } catch (error) {
      console.error("❌ Error getting championship:", error);
      throw error;
    }
  },

  // Update championship status
  async updateChampionshipStatus(champId, status) {
    try {
      const statusRef = dbRef(database, `championships/${champId}/status`);
      await dbSet(statusRef, status);
      return true;
    } catch (error) {
      console.error("❌ Error updating status:", error);
      throw error;
    }
  },

  // Add category to championship
  async addCategoryToChampionship(champId, category) {
    try {
      const catId = `cat_${Date.now()}`;
      const catRef = dbRef(database, `championships/${champId}/categories/${catId}`);
      
      await dbSet(catRef, {
        type: category.type,
        weight: category.weight,
        gender: category.gender,
        createdAt: Date.now()
      });
      
      return catId;
    } catch (error) {
      console.error("❌ Error adding category:", error);
      throw error;
    }
  },

  // Add participant to championship
  async addParticipantToChampionship(champId, participant) {
    try {
      const partId = `part_${Date.now()}`;
      const partRef = dbRef(database, `championships/${champId}/participants/${partId}`);
      
      await dbSet(partRef, {
        name: participant.name,
        teamId: participant.teamId,
        division: participant.division,
        createdAt: Date.now()
      });
      
      return partId;
    } catch (error) {
      console.error("❌ Error adding participant:", error);
      throw error;
    }
  },

  // Record championship match
  async recordChampionshipMatch(champId, matchData) {
    try {
      const matchId = `match_${Date.now()}`;
      const matchRef = dbRef(database, `championships/${champId}/matches/${matchId}`);
      
      await dbSet(matchRef, {
        categoryType: matchData.categoryType,
        player1Id: matchData.player1Id,
        player2Id: matchData.player2Id,
        winner: matchData.winner,
        recordedAt: Date.now()
      });
      
      return matchId;
    } catch (error) {
      console.error("❌ Error recording match:", error);
      throw error;
    }
  },

  // Update overall standings (cross-championship)
  async updateOverallStandings(data) {
    try {
      const standId = `stand_${Date.now()}`;
      const standRef = dbRef(database, `overallStandings/${standId}`);
      
      await dbSet(standRef, {
        ...data,
        recordedAt: Date.now()
      });
      
      return standId;
    } catch (error) {
      console.error("❌ Error updating standings:", error);
      throw error;
    }
  },

  // Award medals to championship
  async awardMedals(champId, medals) {
    try {
      const medalsRef = dbRef(database, `championships/${champId}/medals`);
      
      await dbSet(medalsRef, {
        gold: medals.gold || {},
        silver: medals.silver || {},
        bronze: medals.bronze || {},
        awardedAt: Date.now()
      });
      
      return true;
    } catch (error) {
      console.error("❌ Error awarding medals:", error);
      throw error;
    }
  },

  // Complete championship
  async completeChampionship(champId) {
    try {
      await this.updateChampionshipStatus(champId, 'completed');
      
      // Optionally archive it
      const champ = await this.getChampionship(champId);
      await dbSet(dbRef(database, `championshipHistory/${champId}`), {
        ...champ,
        completedAt: Date.now()
      });
      
      return true;
    } catch (error) {
      console.error("❌ Error completing championship:", error);
      throw error;
    }
  }
};

window.CHAMPIONSHIP_MANAGER = CHAMPIONSHIP_MANAGER;
