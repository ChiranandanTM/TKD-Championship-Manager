// ── PATH HELPER ──────────────────────────────────────────────────────────────
// Calculates absolute path to index.html from any subfolder depth.
// Works on Firebase Hosting and any subdirectory deployment.
function getLoginPath() {
  // Use full absolute URL to avoid rewrite rule catching relative path
  return window.location.origin + '/index.html';
}

// AUTH MANAGER - NO IMPORTS!
const AUTH_MANAGER = {
  currentUser: null,
  currentRole: null,
  currentTeamId: null,

  init() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.currentUser = user;

        // If a team session is already active in sessionStorage (DB-auth teams),
        // do NOT overwrite it with a Firebase Auth UID lookup.
        // Team login uses DB auth; the Firebase Auth UID != teamId, so
        // loadUserRole(firebaseAuthUid) would either find nothing or a different role,
        // corrupting the valid team session and causing a redirect to login.
        const existingRole = sessionStorage.getItem('userRole');
        if (existingRole === 'team') {
          // Restore in-memory state from sessionStorage and skip the DB lookup
          this.currentRole = 'team';
          this.currentTeamId = sessionStorage.getItem('teamId');
          this.redirectBasedOnRole();
          return;
        }

        // Referee sessions are also DB-auth (not Firebase Auth)
        if (existingRole === 'referee') {
          this.currentRole = 'referee';
          this.redirectBasedOnRole();
          return;
        }

        await this.loadUserRole(user.uid);
        this.redirectBasedOnRole();
      } else {
        this.currentUser = null;
        // Do NOT wipe the team session — team users authenticated via DB, not Firebase Auth.
        // Firebase Auth fires with null for team users; clearing currentRole here would
        // cause getCurrentUser to return an inconsistent state vs sessionStorage.
        const sessionRole = sessionStorage.getItem('userRole');
        if (sessionRole !== 'team' && sessionRole !== 'referee') {
          // Only clear if it's NOT a team/referee session (i.e., admin/judge who genuinely signed out)
          this.currentRole = null;
          this.currentTeamId = null;
        }
        // If it IS a team session, keep currentRole in sync with sessionStorage
        if (sessionRole === 'team') {
          this.currentRole = 'team';
          this.currentTeamId = sessionStorage.getItem('teamId');
        }
        // If it IS a referee session, keep currentRole in sync
        if (sessionRole === 'referee') {
          this.currentRole = 'referee';
        }
      }
    });
  },

  async loadUserRole(uid) {
    try {
      const userRef = dbRef(database, `users/${uid}`);
      const snapshot = await dbGet(userRef);
      
      if (snapshot.exists()) {
        const userData = snapshot.val();
        const role = userData.role;

        // Never overwrite a valid team session with an unrelated Firebase Auth UID lookup.
        // Team users log in via DB (teamId = DB key != Firebase Auth UID).
        // If sessionStorage already holds 'team' and the looked-up UID resolves to a
        // different role (or undefined), that would corrupt the session and cause
        // initPageProtection to redirect team users to login.
        const existingRole = sessionStorage.getItem('userRole');
        if (existingRole === 'team' && role !== 'team') {
          console.log('⚠️ loadUserRole: skipping overwrite — protecting active team session');
          return existingRole;
        }

        // Only write valid, known roles to sessionStorage
        if (role === 'admin' || role === 'judge' || role === 'team' || role === 'referee') {
          this.currentRole = role;
          this.currentTeamId = userData.teamId || null;
          sessionStorage.setItem('userRole', role);
          sessionStorage.setItem('userId', uid);
          if (this.currentTeamId) {
            sessionStorage.setItem('teamId', this.currentTeamId);
          }
          // Extra: persist referee-specific session data
          if (role === 'referee' && userData.refId) {
            sessionStorage.setItem('refId', userData.refId);
            sessionStorage.setItem('courtNumber', userData.courtNumber || '');
          }
        }
        
        return role || null;
      }
      
      return null;
    } catch (error) {
      console.error("❌ Error loading user role:", error);
      return null;
    }
  },

  async loginAdmin(email, password) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const role = await this.loadUserRole(userCredential.user.uid);
      
      if (role !== 'admin' && role !== 'judge') {
        await signOut(auth);
        throw new Error("Access denied. Admin or Judge credentials required.");
      }
      
      return { success: true, role, uid: userCredential.user.uid };
    } catch (error) {
      console.error("❌ Admin login error:", error);
      throw new Error(error.message);
    }
  },

  async loginTeam(username, password) {
    try {
      console.log("🔍 Team login attempt for username:", username);
      
      // Trim inputs to remove accidental whitespace
      const trimmedUsername = (username || '').trim();
      const trimmedPassword = (password || '').trim();
      
      if (!trimmedUsername || !trimmedPassword) {
        throw new Error("Invalid username or password");
      }

      console.log("📡 Querying Firebase for username...");
      const teamsRef = dbRef(database, 'teams');
      
      // First, get all teams and search locally (more reliable)
      const allTeamsSnapshot = await dbGet(teamsRef);
      
      if (!allTeamsSnapshot.exists()) {
        console.error("❌ No teams found in database");
        throw new Error("Invalid username or password");
      }
      
      console.log("📊 Total teams in database:", Object.keys(allTeamsSnapshot.val()).length);
      
      let teamData = null;
      let teamId = null;
      
      // Search through all teams for matching username
      allTeamsSnapshot.forEach((childSnapshot) => {
        const data = childSnapshot.val();
        console.log("🔍 Checking team:", data.teamName, "username:", data.username);
        
        if (data.username && data.username.trim().toLowerCase() === trimmedUsername.toLowerCase()) {
          console.log("✅ Team found:", data.teamName);
          teamData = data;
          teamId = childSnapshot.key;
        }
      });
      
      if (!teamData) {
        console.error("❌ No team found with username:", trimmedUsername);
        throw new Error("Invalid username or password");
      }
      
      console.log("🔐 Comparing passwords...");
      console.log("Stored password:", teamData.password);
      console.log("Entered password:", trimmedPassword);
      
      if (teamData.password !== trimmedPassword) {
        console.error("❌ Password mismatch!");
        throw new Error("Invalid username or password");
      }
      
      console.log("✅ Credentials matched!");
      
      // Try to sign in with Firebase Auth, but don't fail if email doesn't exist
      try {
        const userCredential = await signInWithEmailAndPassword(auth, teamData.email, trimmedPassword);
        console.log("✅ Firebase Auth sign-in successful");
        // If successful, proceed normally
      } catch (authError) {
        // Email might not exist in Firebase Auth if team was created in new championship
        // That's okay - we authenticated through database, which is sufficient
        console.log("⚠️ Firebase Auth sign-in not available:", authError.message);
        console.log("Using database authentication instead");
      }
      
      // Update user role entry with this team's ID
      const userUpdateRef = dbRef(database, `users/${teamId}`);
      await dbSet(userUpdateRef, {
        role: 'team',
        teamId: teamId,
        email: teamData.email,
        teamName: teamData.teamName,
        username: teamData.username
      });

      this.currentRole = 'team';
      this.currentTeamId = teamId;
      sessionStorage.setItem('userId', teamId);
      sessionStorage.setItem('userRole', 'team');
      sessionStorage.setItem('teamId', teamId);
      sessionStorage.setItem('teamName', teamData.teamName);
      
      console.log("✅ Team login successful!");
      return { success: true, role: 'team', uid: teamId, teamId };
    } catch (error) {
      console.error("❌ Team login error:", error);
      console.error("Error message:", error.message);
      throw new Error(error.message || "Invalid username or password");
    }
  },

  async logout() {
    try {
      await signOut(auth);
      sessionStorage.clear();
      // FIXED: Use origin instead of absolute path
      window.location.href = getLoginPath();
    } catch (error) {
      console.error("❌ Logout error:", error);
    }
  },

  redirectBasedOnRole() {
    if (!this.currentRole) return;
    
    const path = window.location.pathname;
    
    if (path.includes('index.html') || path === '/' || path === '') {
      if (this.currentRole === 'admin' || this.currentRole === 'judge') {
        window.location.href = window.location.origin + '/admin/dashboard.html';
      } else if (this.currentRole === 'team') {
        window.location.href = window.location.origin + '/team/dashboard.html';
      } else if (this.currentRole === 'referee') {
        window.location.href = window.location.origin + '/referee/dashboard.html';
      }
    }
  },

  requireRole(requiredRoles) {
    const role = sessionStorage.getItem('userRole');
    if (!role || !requiredRoles.includes(role)) {
      if (typeof MODAL !== 'undefined') {
        MODAL.error('Access Denied');
      } else {
        alert('Access Denied');
      }
      window.location.href = getLoginPath();
      return false;
    }
    return true;
  },

  getCurrentUser() {
    // Prefer sessionStorage (persistent across async gaps), fall back to in-memory role
    const role = sessionStorage.getItem('userRole') || this.currentRole;
    const teamId = sessionStorage.getItem('teamId') || this.currentTeamId;
    const uid = sessionStorage.getItem('userId');
    return { uid, role, teamId };
  }
};

// CRITICAL: Must initialize
if (typeof auth !== 'undefined') {
  AUTH_MANAGER.init();
}

// CRITICAL: Export globally
window.AUTH_MANAGER = AUTH_MANAGER;