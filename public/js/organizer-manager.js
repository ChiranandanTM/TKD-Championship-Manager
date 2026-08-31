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
function isLegacyPassword(stored) {
  return !/^[0-9a-f]{64}$/.test(stored);
}

// ============================================================
// ORGANIZER MANAGER — CRUD for organizers/{orgId}
// ============================================================
// Roles: only 'admin' may create / edit / delete organizers.
// Organizers may read their own data for login.
// ============================================================

const ORGANIZER_MANAGER = {

  // ── Helpers ────────────────────────────────────────────────

  /** Verify that the current session belongs to an admin */
  _requireAdmin() {
    const role = sessionStorage.getItem('userRole');
    if (role !== 'admin') throw new Error('Access denied: Admin only');
  },

  // ── Create ─────────────────────────────────────────────────

  /**
   * Create a new organizer record.
   * @param {string} orgId       - Unique login ID (e.g. "ORG001")
   * @param {string} name        - Display name
   * @param {string} password    - Plain-text password
   * @returns {Promise<string>} Firebase key used
   */
  async createOrganizer(orgId, name, password) {
    this._requireAdmin();

    if (!orgId || !name || !password) {
      throw new Error('All fields are required (ID, name, password)');
    }

    const trimmedId = orgId.trim();
    const trimmedName = name.trim();
    const trimmedPw = password.trim();

    // Check uniqueness: orgId must not already exist
    const existing = await dbGet(dbRef(database, `organizers/${trimmedId}`));
    if (existing.exists()) {
      throw new Error(`Organizer ID "${trimmedId}" already exists`);
    }

    const now = new Date().toISOString();
    const orgData = {
      orgId: trimmedId,
      name: trimmedName,
      password: await hashPassword(trimmedPw),
      enabled: true,
      createdAt: now,
      updatedAt: now
    };

    // Store under organizers/{orgId}
    await dbSet(dbRef(database, `organizers/${trimmedId}`), orgData);

    // Create users/{orgId} entry for role-based auth
    await dbSet(dbRef(database, `users/${trimmedId}`), {
      role: 'organizer',
      orgId: trimmedId,
      name: trimmedName,
      createdAt: now
    });

    console.log(`✅ Organizer created: ${trimmedId}`);
    return trimmedId;
  },

  // ── Read ───────────────────────────────────────────────────

  /** Fetch all organizers (admin view) */
  async getAllOrganizers() {
    this._requireAdmin();
    const snap = await dbGet(dbRef(database, 'organizers'));
    if (!snap.exists()) return [];
    return Object.entries(snap.val()).map(([key, val]) => ({ ...val, _key: key }));
  },

  /** Fetch a single organizer by ID */
  async getOrganizer(orgId) {
    const snap = await dbGet(dbRef(database, `organizers/${orgId}`));
    if (!snap.exists()) throw new Error(`Organizer "${orgId}" not found`);
    return snap.val();
  },

  // ── Update ─────────────────────────────────────────────────

  /**
   * Admin: update organizer fields (name, password, enabled).
   * Pass only the fields you want to change.
   */
  async updateOrganizer(orgId, { name, password, enabled } = {}) {
    this._requireAdmin();

    const updates = { updatedAt: new Date().toISOString() };
    if (name !== undefined && name.trim() !== '') {
      updates.name = name.trim();
      // Mirror in users node
      await dbUpdate(dbRef(database, `users/${orgId}`), {
        name: updates.name
      });
    }
    if (password !== undefined && password.trim() !== '') {
      updates.password = await hashPassword(password.trim());
    }
    if (enabled !== undefined) {
      updates.enabled = !!enabled;
    }

    await dbUpdate(dbRef(database, `organizers/${orgId}`), updates);
    console.log(`✅ Organizer updated: ${orgId}`);
  },

  // ── Delete ─────────────────────────────────────────────────

  /** Admin: permanently remove an organizer */
  async deleteOrganizer(orgId) {
    this._requireAdmin();
    await dbRemove(dbRef(database, `organizers/${orgId}`));
    await dbRemove(dbRef(database, `users/${orgId}`));
    console.log(`🗑️ Organizer deleted: ${orgId}`);
  },

  // ── Login ──────────────────────────────────────────────────

  /**
   * Authenticate an organizer by ID + password (DB-auth, same pattern as referees).
   * Sets sessionStorage on success.
   */
  async loginOrganizer(orgId, password) {
    const trimmedId = (orgId || '').trim();
    const trimmedPw = (password || '').trim();

    if (!trimmedId || !trimmedPw) throw new Error('Please enter organizer ID and password');

    const snap = await dbGet(dbRef(database, `organizers/${trimmedId}`));
    if (!snap.exists()) throw new Error('Invalid organizer ID or password');

    const data = snap.val();

    // Check if account is enabled
    if (data.enabled === false) {
      throw new Error('This organizer account has been disabled. Contact the administrator.');
    }

    const hashedInput = await hashPassword(trimmedPw);
    const storedPw = data.password;

    if (isLegacyPassword(storedPw)) {
      if (storedPw !== trimmedPw) throw new Error('Invalid organizer ID or password');
      // Migrate to hash silently
      try {
        await dbUpdate(dbRef(database, `organizers/${trimmedId}`), { password: hashedInput });
      } catch (_) { /* non-critical */ }
    } else {
      if (storedPw !== hashedInput) throw new Error('Invalid organizer ID or password');
    }

    // Persist session
    sessionStorage.setItem('userRole', 'organizer');
    sessionStorage.setItem('userId', trimmedId);
    sessionStorage.setItem('orgId', trimmedId);
    sessionStorage.setItem('orgName', data.name || trimmedId);

    // Store the login page URL for logout redirect
    sessionStorage.setItem('loginPageUrl', window.location.href);

    // Ensure users/{orgId} reflects role (in case it was wiped)
    await dbSet(dbRef(database, `users/${trimmedId}`), {
      role: 'organizer',
      orgId: trimmedId,
      name: data.name || trimmedId,
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ Organizer logged in: ${trimmedId}`);
    return { success: true, orgId: trimmedId, name: data.name };
  }
};

// Export globally
window.ORGANIZER_MANAGER = ORGANIZER_MANAGER;
console.log('✅ ORGANIZER_MANAGER loaded');
