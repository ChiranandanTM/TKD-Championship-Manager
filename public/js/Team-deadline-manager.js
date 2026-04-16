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
  }
};

window.TEAM_DEADLINE_MANAGER = TEAM_DEADLINE_MANAGER;