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
// REFEREE MANAGER — CRUD for referees/{refId}
// ============================================================
// Roles: only 'admin' may create / edit / delete referees.
// Referees may read their own data and update assignedRefs.
// ============================================================

const REFEREE_MANAGER = {

  // ── Helpers ────────────────────────────────────────────────

  /** Verify that the current session belongs to an admin */
  _requireAdmin() {
    const role = sessionStorage.getItem('userRole');
    if (role !== 'admin') throw new Error('Access denied: Admin only');
  },

  // ── Create ─────────────────────────────────────────────────

  /**
   * Create a new referee record.
   * @param {string} refId       - Unique login ID (e.g. "REF001")
   * @param {string} password    - Plain-text password
   * @param {number|string} courtNumber - Court assignment
   * @returns {Promise<string>} Firebase key used
   */
  async createReferee(refId, password, courtNumber) {
    this._requireAdmin();

    if (!refId || !password || !courtNumber) {
      throw new Error('All fields are required (ID, password, court number)');
    }

    const trimmedId = refId.trim();
    const trimmedPw = password.trim();

    // Check uniqueness: refId must not already exist
    const existing = await dbGet(dbRef(database, `referees/${trimmedId}`));
    if (existing.exists()) {
      throw new Error(`Referee ID "${trimmedId}" already exists`);
    }

    const now = new Date().toISOString();
    const refData = {
      refId: trimmedId,
      password: await hashPassword(trimmedPw),
      courtNumber: String(courtNumber).trim(),
      assignedRefs: [],
      createdAt: now,
      updatedAt: now
    };

    // Store under referees/{refId}
    await dbSet(dbRef(database, `referees/${trimmedId}`), refData);

    // Create users/{refId} entry for role-based auth
    await dbSet(dbRef(database, `users/${trimmedId}`), {
      role: 'referee',
      refId: trimmedId,
      courtNumber: String(courtNumber).trim(),
      createdAt: now
    });

    console.log(`✅ Referee created: ${trimmedId}`);
    return trimmedId;
  },

  // ── Read ───────────────────────────────────────────────────

  /** Fetch all referees (admin view) */
  async getAllReferees() {
    this._requireAdmin();
    const snap = await dbGet(dbRef(database, 'referees'));
    if (!snap.exists()) return [];
    return Object.entries(snap.val()).map(([key, val]) => ({ ...val, _key: key }));
  },

  /** Fetch a single referee by ID */
  async getReferee(refId) {
    const snap = await dbGet(dbRef(database, `referees/${refId}`));
    if (!snap.exists()) throw new Error(`Referee "${refId}" not found`);
    return snap.val();
  },

  // ── Update ─────────────────────────────────────────────────

  /**
   * Admin: update referee fields (password and/or courtNumber).
   * Pass only the fields you want to change.
   */
  async updateReferee(refId, { password, courtNumber } = {}) {
    this._requireAdmin();

    const updates = { updatedAt: new Date().toISOString() };
    if (password !== undefined && password.trim() !== '') {
      updates.password = await hashPassword(password.trim());
    }
    if (courtNumber !== undefined && String(courtNumber).trim() !== '') {
      updates.courtNumber = String(courtNumber).trim();
      // Mirror in users node
      await dbUpdate(dbRef(database, `users/${refId}`), {
        courtNumber: updates.courtNumber
      });
    }

    await dbUpdate(dbRef(database, `referees/${refId}`), updates);
    console.log(`✅ Referee updated: ${refId}`);
  },

  /**
   * Referee (self) or Admin: update assignedRefs list.
   * @param {string} refId
   * @param {string[]} assignedRefs  Array of referee/judge names
   */
  async updateAssignedRefs(refId, assignedRefs) {
    const role = sessionStorage.getItem('userRole');
    const currentUserId = sessionStorage.getItem('userId');

    // Referees can only update their own data; admins can update any
    if (role !== 'admin' && !(role === 'referee' && currentUserId === refId)) {
      throw new Error('Access denied');
    }

    await dbUpdate(dbRef(database, `referees/${refId}`), {
      assignedRefs: Array.isArray(assignedRefs) ? assignedRefs : [],
      updatedAt: new Date().toISOString()
    });
    console.log(`✅ AssignedRefs updated for: ${refId}`);
  },

  // ── Delete ─────────────────────────────────────────────────

  /** Admin: permanently remove a referee */
  async deleteReferee(refId) {
    this._requireAdmin();
    await dbRemove(dbRef(database, `referees/${refId}`));
    await dbRemove(dbRef(database, `users/${refId}`));
    console.log(`🗑️ Referee deleted: ${refId}`);
  },

  // ── Login ──────────────────────────────────────────────────

  /**
   * Authenticate a referee by ID + password (DB-auth, same pattern as teams).
   * Sets sessionStorage on success.
   */
  async loginReferee(refId, password) {
    const trimmedId = (refId || '').trim();
    const trimmedPw = (password || '').trim();

    if (!trimmedId || !trimmedPw) throw new Error('Please enter referee ID and password');

    const snap = await dbGet(dbRef(database, `referees/${trimmedId}`));
    if (!snap.exists()) throw new Error('Invalid referee ID or password');

    const data = snap.val();
    const hashedInput = await hashPassword(trimmedPw);
    const storedPw = data.password;

    if (isLegacyPassword(storedPw)) {
      if (storedPw !== trimmedPw) throw new Error('Invalid referee ID or password');
      // Migrate to hash silently
      try {
        await dbUpdate(dbRef(database, `referees/${trimmedId}`), { password: hashedInput });
      } catch (_) { /* non-critical */ }
    } else {
      if (storedPw !== hashedInput) throw new Error('Invalid referee ID or password');
    }

    // Persist session
    sessionStorage.setItem('userRole', 'referee');
    sessionStorage.setItem('userId', trimmedId);
    sessionStorage.setItem('refId', trimmedId);
    sessionStorage.setItem('courtNumber', data.courtNumber || '');

    // Ensure users/{refId} reflects role (in case it was wiped)
    await dbSet(dbRef(database, `users/${trimmedId}`), {
      role: 'referee',
      refId: trimmedId,
      courtNumber: data.courtNumber || '',
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ Referee logged in: ${trimmedId}`);
    return { success: true, refId: trimmedId, courtNumber: data.courtNumber };
  }
};

// Export globally
window.REFEREE_MANAGER = REFEREE_MANAGER;
console.log('✅ REFEREE_MANAGER loaded');
