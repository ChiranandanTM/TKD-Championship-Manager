// ── PASSWORD HASHING ──────────────────────────────────────────────────────────
async function hashPassword(plain) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('TKDCM:' + plain)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================
// UI MANAGER - Page Protection & Navigation
// ============================================

const UI = {
  // 🔐 SECURITY FIX #3: Validate session expiration before critical operations
  validateSessionExpiry() {
    const sessionDataStr = sessionStorage.getItem('sessionData');
    if (!sessionDataStr) return true; // No expiry data = session valid (backward compat)
    
    try {
      const sessionData = JSON.parse(sessionDataStr);
      const now = Date.now();
      
      if (now > sessionData.expiresAt) {
        console.log('⏰ Session expired - logging out user');
        sessionStorage.clear();
        MODAL.error('❌ Your session has expired. Please login again.');
        setTimeout(() => {
          location.href = window.location.origin + '/index.html';
        }, 1000);
        return false;
      }
      
      // Session still valid
      const timeRemaining = sessionData.expiresAt - now;
      const hoursRemaining = Math.floor(timeRemaining / (60 * 60 * 1000));
      
      // Warn if less than 1 hour remaining
      if (hoursRemaining < 1 && hoursRemaining >= 0) {
        const minutesRemaining = Math.floor(timeRemaining / (60 * 1000));
        console.warn(`⏰ Session expiring soon - ${minutesRemaining} minutes remaining`);
      }
      
      return true;
    } catch (e) {
      console.warn('⚠️ Could not parse session data:', e.message);
      return true; // Invalid data = allow (backward compat)
    }
  },

  // Initialize page protection - check if user has required role
  initPageProtection(requiredRoles) {
    // 🔐 Check session expiration first
    if (!this.validateSessionExpiry()) return;

    const user = AUTH_MANAGER.getCurrentUser();
    const userRole = user.role;

    if (!userRole || !requiredRoles.includes(userRole)) {
      if (typeof MODAL !== 'undefined') {
        MODAL.error('Access Denied: You do not have permission to access this page.');
      } else {
        alert('Access Denied: You do not have permission to access this page.');
      }
      window.location.href = window.location.origin + '/index.html';
      return;
    }

    if (userRole === 'admin') {
      this._purgePasswordTextFields();
    }
  },

  // Removes any plaintext passwordText fields that may exist in Firebase from old data.
  // Runs silently in the background whenever an admin page loads.
  async _purgePasswordTextFields() {
    try {
      const [teamsSnap, refsSnap] = await Promise.all([
        dbGet(dbRef(database, 'teams')),
        dbGet(dbRef(database, 'referees'))
      ]);
      const updates = {};
      if (teamsSnap.exists()) {
        teamsSnap.forEach(child => {
          if (child.val().passwordText !== undefined) {
            updates['teams/' + child.key + '/passwordText'] = null;
          }
        });
      }
      if (refsSnap.exists()) {
        refsSnap.forEach(child => {
          if (child.val().passwordText !== undefined) {
            updates['referees/' + child.key + '/passwordText'] = null;
          }
        });
      }
      if (Object.keys(updates).length > 0) {
        await dbUpdate(dbRef(database), updates);
      }
    } catch (_) {
      // non-critical, silent
    }
  },

  // Logout user
  async logout() {
    const confirmed = await MODAL.showConfirm('Are you sure you want to logout?');
    if (confirmed) {
      try {
        await AUTH_MANAGER.logout();
      } catch (error) {
        console.error('Logout error:', error);
        MODAL.error('Error during logout. Please try again.');
      }
    }
  },

  // Open create team modal
  openCreateTeamModal() {
    // 🔐 Check session expiration before critical operations
    if (!this.validateSessionExpiry()) return;
    
    const modal = document.getElementById('createTeamModal');
    if (!modal) {
      this.createTeamModalHTML();
    }
    document.getElementById('createTeamModal').style.display = 'flex';
    document.getElementById('teamFormName').focus();
  },

  // Generic password-visibility toggle — reused by every eye-icon password
  // field in the app so they all share one implementation and behavior.
  togglePasswordVisibility(inputId, iconId, btnId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    const btn = btnId ? document.getElementById(btnId) : null;
    if (!input || !icon) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    if (btn) btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    icon.innerHTML = showing
      ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>'
      : '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
  },

  // Toggle password visibility in create team modal
  toggleTeamPasswordVisibility() {
    this.togglePasswordVisibility('teamFormPassword', 'teamFormPasswordToggleIcon', 'teamFormPasswordToggle');
  },

  // Close create team modal
  closeCreateTeamModal() {
    const modal = document.getElementById('createTeamModal');
    if (modal) {
      modal.style.display = 'none';
      document.getElementById('teamForm').reset();
    }
  },

  // Create modal HTML
  createTeamModalHTML() {
    if (document.getElementById('createTeamModal')) return;
    
    const modalHTML = `
      <div id="createTeamModal" class="modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 2000; align-items: center; justify-content: center;">
        <div class="modal-content" style="background: var(--secondary-black); border: 2px solid var(--border-gold); border-radius: var(--border-radius); padding: 40px; width: 90%; max-width: 500px; box-shadow: 0 10px 40px rgba(255,215,0,0.3);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
            <h2 style="margin: 0; color: var(--border-gold);">➕ Create New Team</h2>
            <button onclick="UI.closeCreateTeamModal()" style="background: transparent; border: none; color: var(--border-gold); font-size: 28px; cursor: pointer; padding: 0; width: 30px; height: 30px;">×</button>
          </div>

          <form id="teamForm" style="display: flex; flex-direction: column; gap: 20px;">
            <div style="display: flex; flex-direction: column;">
              <label style="color: var(--text-gray); margin-bottom: 8px; font-size: 0.95rem;">Team Name <span style="color: var(--accent-red);">*</span></label>
              <input type="text" id="teamFormName" placeholder="Enter team name" required style="padding: 12px; background: var(--primary-black); border: 2px solid var(--text-gray); border-radius: 6px; color: var(--text-white); font-size: 1rem;" />
            </div>

            <div style="display: flex; flex-direction: column;">
              <label style="color: var(--text-gray); margin-bottom: 8px; font-size: 0.95rem;">Username <span style="color: var(--accent-red);">*</span></label>
              <input type="text" id="teamFormUsername" placeholder="Enable team login username" required style="padding: 12px; background: var(--primary-black); border: 2px solid var(--text-gray); border-radius: 6px; color: var(--text-white); font-size: 1rem;" />
            </div>

            <div style="display: flex; flex-direction: column;">
              <label style="color: var(--text-gray); margin-bottom: 8px; font-size: 0.95rem;">Email <span style="color: var(--accent-red);">*</span></label>
              <input type="email" id="teamFormEmail" placeholder="Enter team email" required style="padding: 12px; background: var(--primary-black); border: 2px solid var(--text-gray); border-radius: 6px; color: var(--text-white); font-size: 1rem;" />
            </div>

            <div style="display: flex; flex-direction: column;">
              <label style="color: var(--text-gray); margin-bottom: 8px; font-size: 0.95rem;">Password <span style="color: var(--accent-red);">*</span></label>
              <div style="position: relative; display: flex; align-items: center;">
                <input type="password" id="teamFormPassword" placeholder="Set initial password" required style="padding: 12px; padding-right: 44px; width: 100%; background: var(--primary-black); border: 2px solid var(--text-gray); border-radius: 6px; color: var(--text-white); font-size: 1rem; box-sizing: border-box;" />
                <button type="button" onclick="UI.toggleTeamPasswordVisibility()" id="teamFormPasswordToggle" aria-label="Show password" style="position: absolute; right: 8px; background: transparent; border: none; color: #ffffff; cursor: pointer; padding: 6px; display: flex; align-items: center; justify-content: center;">
                  <svg id="teamFormPasswordToggleIcon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
              </div>
            </div>

            <div style="display: flex; gap: 15px; margin-top: 20px;">
              <button type="submit" class="btn-primary" style="flex: 1; padding: 12px;">✅ Create Team</button>
              <button type="button" class="btn-secondary" onclick="UI.closeCreateTeamModal()" style="flex: 1; padding: 12px;">❌ Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Add form submit handler
    document.getElementById('teamForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitCreateTeamForm();
    });
  },

  // Submit create team form
  async submitCreateTeamForm() {
    const teamName = document.getElementById('teamFormName').value.trim();
    const username = document.getElementById('teamFormUsername').value.trim();
    const email = document.getElementById('teamFormEmail').value.trim();
    const password = document.getElementById('teamFormPassword').value.trim();

    // Validation
    if (!teamName || !username || !email || !password) {
      if (typeof MODAL !== 'undefined') {
        MODAL.warning('All fields are required');
      } else {
        alert('❌ All fields are required');
      }
      return;
    }

    if (password.length < 6) {
      if (typeof MODAL !== 'undefined') {
        MODAL.warning('Password must be at least 6 characters');
      } else {
        alert('❌ Password must be at least 6 characters');
      }
      return;
    }

    if (!email.includes('@')) {
      if (typeof MODAL !== 'undefined') {
        MODAL.warning('Invalid email format');
      } else {
        alert('❌ Invalid email format');
      }
      return;
    }

    const submitBtn = document.querySelector('#teamForm button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
      // Generate a unique team ID for this championship
      const newTeamId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

      // Save team data directly to database (no Firebase Auth needed)
      const teamRef = dbRef(database, `teams/${newTeamId}`);
      await dbSet(teamRef, {
        teamName: teamName,
        username: username,
        email: email,
        password: await hashPassword(password),
        createdAt: new Date().toISOString()
      });
      localStorage.setItem('pw_team_' + newTeamId, password);

      // Create user role entry
      const userRef = dbRef(database, `users/${newTeamId}`);
      await dbSet(userRef, {
        role: 'team',
        teamId: newTeamId
      });

      const successMsg = `✅ Team Created Successfully!\n\nTeam Name: ${teamName}\nUsername: ${username}\nPassword: ${password}\n\nShare these credentials with the team.`;
      if (typeof MODAL !== 'undefined') {
        MODAL.success(successMsg);
      } else {
        alert(successMsg);
      }
      
      this.closeCreateTeamModal();
      
      // Reload teams list if on admin dashboard
      if (typeof loadTeams === 'function') {
        loadTeams();
      }
    } catch (error) {
      console.error('Error creating team account:', error);
      let errorMsg = error.message;
      let isPermissionError = false;
      
      // Handle Firebase-specific errors
      if (error.code === 'auth/email-already-in-use') {
        errorMsg = 'This email is already in use. Try a different email.';
      } else if (error.code === 'auth/invalid-email') {
        errorMsg = 'Invalid email format. Please enter a valid email.';
      } else if (error.code === 'auth/weak-password') {
        errorMsg = 'Password is too weak. Use at least 6 characters.';
      } else if (error.message && error.message.includes('PERMISSION_DENIED')) {
        isPermissionError = true;
        errorMsg = `Database Permission Error!\n\n❌ Firebase Realtime Database security rules are blocking this operation.\n\n✅ Solution:\n1. Go to Firebase Console\n2. Select your project (tkd-kc)\n3. Go to Realtime Database → Rules tab\n4. Replace with rules from FIREBASE_SECURITY_RULES.json\n5. Click "Publish"\n6. Try again\n\nIf you need help, see SETUP_FIREBASE_RULES.txt`;
      } else if (error.code === 'PERMISSION_DENIED') {
        isPermissionError = true;
        errorMsg = `Database Permission Error!\n\n❌ Firebase Realtime Database security rules need to be updated.\n\n✅ Solution:\n1. Go to Firebase Console\n2. Select your project (tkd-kc)\n3. Go to Realtime Database → Rules tab\n4. Replace with rules from FIREBASE_SECURITY_RULES.json\n5. Click "Publish"\n6. Try again`;
      }
      
      if (isPermissionError) {
        if (typeof MODAL !== 'undefined') {
          MODAL.error(errorMsg);
        } else {
          alert(errorMsg);
        }
      } else {
        if (typeof MODAL !== 'undefined') {
          MODAL.error(`Error: ${errorMsg}`);
        } else {
          alert(`❌ Error: ${errorMsg}`);
        }
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '✅ Create Team';
    }
  },

  async createTeamAccount() {
    // This now opens the modal instead
    this.openCreateTeamModal();
  },

  // Format timestamp to readable date
  formatTimestamp(timestamp) {
    if (!timestamp) return 'N/A';
    try {
      const date = new Date(timestamp);
      return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return timestamp;
    }
  },

  // Show loading overlay
  showLoading(message = 'Loading...') {
    const existing = document.getElementById('loadingOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>${message}</p>
      </div>
    `;
    document.body.appendChild(overlay);
  },

  // Hide loading overlay
  hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.remove();
  }
};

// ============================================
// SCOREBOARD INTEGRATION LINK
// ============================================

const SCOREBOARD_LINK = {
  currentMatch: null,
  matchListener: null,

  // Initialize scoreboard integration
  init() {
    this.listenForMatchUpdates();
    this.listenForScoreboardUpdates();
  },

  // Listen for new matches from bracket
  listenForMatchUpdates() {
    const matchRef = dbRef(database, 'currentMatch');
    
    this.matchListener = dbOnValue(matchRef, (snapshot) => {
      if (snapshot.exists()) {
        this.currentMatch = snapshot.val();
        this.updateScoreboardDisplay();
      }
    });
  },

  // Listen for match completion from scoreboard
  listenForScoreboardUpdates() {
    const resultRef = dbRef(database, 'matchResults');
    
    dbOnValue(resultRef, async (snapshot) => {
      if (snapshot.exists()) {
        const result = snapshot.val();
        
        if (result.status === 'completed' && result.winnerId) {
          await this.processMatchResult(result);
          
          // Clear the result after processing
          await dbRemove(resultRef);
        }
      }
    });
  },

  // Update scoreboard display
  updateScoreboardDisplay() {
    if (!this.currentMatch) return;

    // Send event to scoreboard iframe or window
    const scoreboardWindow = document.getElementById('scoreboardFrame')?.contentWindow;
    
    if (scoreboardWindow) {
      scoreboardWindow.postMessage({
        type: 'UPDATE_PLAYERS',
        data: {
          chong: this.currentMatch.chong,
          hong: this.currentMatch.hong,
          matchId: this.currentMatch.matchId
        }
      }, '*');
    }

    // Update local display if exists
    this.updateLocalDisplay();
  },

  // Update local scoreboard display
  updateLocalDisplay() {
    const chongNameEl = document.getElementById('chongName');
    const hongNameEl = document.getElementById('hongName');
    const chongCenterEl = document.getElementById('chongCenter');
    const hongCenterEl = document.getElementById('hongCenter');

    if (chongNameEl) chongNameEl.textContent = this.currentMatch.chong.name;
    if (hongNameEl) hongNameEl.textContent = this.currentMatch.hong.name;
    if (chongCenterEl) chongCenterEl.textContent = this.currentMatch.chong.center;
    if (hongCenterEl) hongCenterEl.textContent = this.currentMatch.hong.center;
  },

  // Process match result from scoreboard
  async processMatchResult(result) {
    try {
      console.log("Processing match result:", result);
      
      // Update bracket with winner
      if (typeof BRACKET !== 'undefined' && BRACKET.updateMatchResult) {
        await BRACKET.updateMatchResult(result.matchId, result.winnerId);
      }

      // Clear current match
      const matchRef = dbRef(database, 'currentMatch');
      await dbRemove(matchRef);

      if (typeof MODAL !== 'undefined') {
        MODAL.success(`Match completed! Winner: ${result.winnerName}`);
      } else {
        alert(`Match completed! Winner: ${result.winnerName}`);
      }
      
    } catch (error) {
      console.error("❌ Error processing match result:", error);
    }
  },

  // Submit match result (called from scoreboard)
  async submitResult(winnerId, winnerName, chongScore, hongScore) {
    try {
      if (!this.currentMatch) {
        throw new Error("No active match");
      }

      const result = {
        matchId: this.currentMatch.matchId,
        categoryKey: this.currentMatch.categoryKey,
        winnerId: winnerId,
        winnerName: winnerName,
        chongId: this.currentMatch.chong.playerId,
        chongName: this.currentMatch.chong.name,
        chongScore: chongScore,
        hongId: this.currentMatch.hong.playerId,
        hongName: this.currentMatch.hong.name,
        hongScore: hongScore,
        timestamp: Date.now(),
        status: 'completed'
      };

      // Save result to Firebase
      const resultRef = dbRef(database, 'matchResults');
      await dbSet(resultRef, result);

      // Also save to match history
      const historyRef = dbRef(database, 'matchHistory');
      const newHistoryRef = dbPush(historyRef);
      await dbSet(newHistoryRef, result);

      console.log("✅ Match result submitted");
      return true;
      
    } catch (error) {
      console.error("❌ Error submitting result:", error);
      return false;
    }
  },

  // Reset match (new match button clicked)
  async resetMatch() {
    try {
      const matchRef = dbRef(database, 'currentMatch');
      await dbRemove(matchRef);
      
      this.currentMatch = null;
      
      console.log("✅ Match reset");
    } catch (error) {
      console.error("❌ Error resetting match:", error);
    }
  },

  // Get current match info
  getCurrentMatch() {
    return this.currentMatch;
  }
};

// Initialize on page load — wait for Firebase globals (async module loads after DOMContentLoaded)
window.addEventListener('DOMContentLoaded', () => {
  const waitAndInit = () => {
    if (typeof database !== 'undefined' && typeof dbOnValue !== 'undefined' && typeof dbRef !== 'undefined') {
      SCOREBOARD_LINK.init();
    } else {
      setTimeout(waitAndInit, 80);
    }
  };
  waitAndInit();
});

// Listen for messages from scoreboard iframe
window.addEventListener('message', async (event) => {
  if (event.data.type === 'MATCH_COMPLETE') {
    await SCOREBOARD_LINK.submitResult(
      event.data.winnerId,
      event.data.winnerName,
      event.data.chongScore,
      event.data.hongScore
    );
  } else if (event.data.type === 'NEW_MATCH') {
    await SCOREBOARD_LINK.resetMatch();
  }
});

window.SCOREBOARD_LINK = SCOREBOARD_LINK;
window.UI = UI;