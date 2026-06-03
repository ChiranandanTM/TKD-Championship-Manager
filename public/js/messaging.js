// messaging.js — Firestore-based court messaging
// Admin  → sends messages to a specific court or broadcasts to all courts
// Referee → receives messages for their court + broadcasts, sends replies to admin
//
// Auth model:
//   Admin/Judge : Firebase email Auth  (window.auth.currentUser is set)
//   Referee     : Firebase Anonymous Auth (signed in during referee-login.html,
//                 UID stored in sessionStorage 'firebaseUid')
//
// Depends on firebase.js globals:
//   window.firestore, window.fsCollection, window.fsDoc, window.fsAddDoc,
//   window.fsSetDoc, window.fsGetDoc, window.fsUpdateDoc, window.fsQuery,
//   window.fsWhere, window.fsOrderBy, window.fsOnSnapshot, window.fsServerTimestamp,
//   window.auth, window.database, window.dbGet, window.dbRef

(function () {
  'use strict';

  const COL_MESSAGES  = 'courtMessages';
  const COL_ROLES     = 'userRoles';

  // ── Internal helpers ────────────────────────────────────────────────────────

  function getUid() {
    return (window.auth && window.auth.currentUser && window.auth.currentUser.uid)
      || sessionStorage.getItem('firebaseUid')
      || null;
  }

  // Waits until auth.currentUser is set (up to 8 s).
  // Needed because Firebase restores the anonymous session asynchronously —
  // getUid() can return a sessionStorage value before auth.currentUser is ready,
  // causing Firestore to send the request without an auth token → denied.
  function ensureAuth() {
    if (window.auth && window.auth.currentUser) return Promise.resolve();
    return new Promise((resolve) => {
      if (!window.onAuthStateChanged || !window.auth) { resolve(); return; }
      const timer = setTimeout(() => { unsub(); resolve(); }, 8000);
      const unsub = window.onAuthStateChanged(window.auth, (user) => {
        clearTimeout(timer);
        unsub();
        resolve();
      });
    });
  }

  function getRole() {
    return sessionStorage.getItem('userRole') || '';
  }

  function getCourt() {
    return sessionStorage.getItem('courtNumber') || '';
  }

  function getRefId() {
    return sessionStorage.getItem('refId') || 'Referee';
  }

  // ── MESSAGING public API ────────────────────────────────────────────────────

  const MESSAGING = {

    _listeners: [],   // array of unsubscribe functions

    // ── Admin bootstrap ────────────────────────────────────────────────────────
    // Creates/updates the Firestore userRoles doc for the current admin/judge.
    // uidOverride: pass user.uid directly from onAuthStateChanged to avoid
    //              relying on auth.currentUser which may be null at callback time.
    async initAdmin(uidOverride) {
      const uid = uidOverride || getUid();
      if (!uid) return;
      try {
        const snap = await window.dbGet(window.dbRef(window.database, `users/${uid}`));
        if (!snap.exists()) return;
        const role = snap.val().role;
        if (role !== 'admin' && role !== 'judge') return;
        await window.fsSetDoc(
          window.fsDoc(window.firestore, COL_ROLES, uid),
          { role, createdAt: window.fsServerTimestamp() },
          { merge: true }
        );
      } catch (e) {
        console.warn('[MESSAGING] initAdmin:', e.message);
      }
    },

    // ── Send (admin only) ──────────────────────────────────────────────────────
    // to: 'broadcast' | 'court_1' | 'court_2' ...
    // type: 'info' | 'urgent'
    async sendMessage(to, text, type = 'info') {
      await ensureAuth();
      const uid = getUid();
      if (!uid) throw new Error('Not authenticated');
      const courtNumber = to.startsWith('court_') ? to.replace('court_', '') : null;
      await window.fsAddDoc(
        window.fsCollection(window.firestore, COL_MESSAGES),
        {
          from:        uid,
          fromRole:    'admin',
          fromName:    'Admin',
          to,
          courtNumber,
          text:        text.trim(),
          type,
          timestamp:   window.fsServerTimestamp(),
          isReply:     false,
          replyToId:   null,
          readBy:      {}
        }
      );
    },

    // ── Reply (referee → admin, threaded) ─────────────────────────────────────
    async sendReply(text, replyToId = null) {
      await ensureAuth();
      const uid = getUid();
      if (!uid) throw new Error('Not authenticated');
      await window.fsAddDoc(
        window.fsCollection(window.firestore, COL_MESSAGES),
        {
          from:        uid,
          fromRole:    'referee',
          fromName:    getRefId(),
          to:          'admin',
          courtNumber: getCourt(),
          text:        text.trim(),
          type:        'info',
          timestamp:   window.fsServerTimestamp(),
          isReply:     true,
          replyToId,
          readBy:      {}
        }
      );
    },

    // ── New message (referee → admin, not a reply) ─────────────────────────────
    async sendRefMessage(text) {
      await ensureAuth();
      const uid = getUid();
      if (!uid) throw new Error('Not authenticated');
      await window.fsAddDoc(
        window.fsCollection(window.firestore, COL_MESSAGES),
        {
          from:        uid,
          fromRole:    'referee',
          fromName:    getRefId(),
          to:          'admin',
          courtNumber: getCourt(),
          text:        text.trim(),
          type:        'info',
          timestamp:   window.fsServerTimestamp(),
          isReply:     false,
          replyToId:   null,
          readBy:      {}
        }
      );
    },

    // ── Delete (admin only) ────────────────────────────────────────────────────
    async deleteMessage(messageId) {
      if (!messageId) return;
      await window.fsDeleteDoc(window.fsDoc(window.firestore, COL_MESSAGES, messageId));
    },

    // ── Admin listener ─────────────────────────────────────────────────────────
    // Streams all messages, newest first.
    listenAdmin(callback) {
      const q = window.fsQuery(
        window.fsCollection(window.firestore, COL_MESSAGES),
        window.fsOrderBy('timestamp', 'desc')
      );
      const unsub = window.fsOnSnapshot(q,
        (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        (err)  => console.warn('[MESSAGING] listenAdmin:', err.message)
      );
      this._listeners.push(unsub);
      return unsub;
    },

    // ── Referee listener ───────────────────────────────────────────────────────
    // Three separate queries so Firestore rules can validate each independently:
    //   q1: messages broadcast to all courts
    //   q2: messages to this specific court
    //   q3: this referee's own replies sent to admin
    // Results are merged and deduplicated in the callback.
    listenReferee(callback) {
      const uid      = getUid();
      const court    = getCourt();
      const courtId  = 'court_' + court;

      let broadcastMsgs = [];
      let courtMsgs     = [];
      let replyMsgs     = [];

      const merge = () => {
        const seen = new Set();
        const combined = [...broadcastMsgs, ...courtMsgs, ...replyMsgs]
          .filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
          .sort((a, b) => {
            const ta = a.timestamp?.toMillis?.() || 0;
            const tb = b.timestamp?.toMillis?.() || 0;
            return tb - ta;
          });
        callback(combined);
      };

      // q1 — broadcast messages (no orderBy: avoids composite index, merge() sorts client-side)
      const u1 = window.fsOnSnapshot(
        window.fsQuery(
          window.fsCollection(window.firestore, COL_MESSAGES),
          window.fsWhere('to', '==', 'broadcast')
        ),
        (snap) => { broadcastMsgs = snap.docs.map(d => ({ id: d.id, ...d.data() })); merge(); },
        (err)  => console.warn('[MESSAGING] listenReferee broadcast:', err.message)
      );

      // q2 — court-specific messages (no orderBy for same reason)
      const u2 = window.fsOnSnapshot(
        window.fsQuery(
          window.fsCollection(window.firestore, COL_MESSAGES),
          window.fsWhere('to', '==', courtId)
        ),
        (snap) => { courtMsgs = snap.docs.map(d => ({ id: d.id, ...d.data() })); merge(); },
        (err)  => console.warn('[MESSAGING] listenReferee court:', err.message)
      );

      // q3 — own replies: single where only (avoids compound-query index requirement)
      //      filter to=='admin' client-side in merge()
      const u3 = uid ? window.fsOnSnapshot(
        window.fsQuery(
          window.fsCollection(window.firestore, COL_MESSAGES),
          window.fsWhere('from', '==', uid)
        ),
        (snap) => {
          replyMsgs = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(m => m.to === 'admin');
          merge();
        },
        (err)  => console.warn('[MESSAGING] listenReferee replies:', err.message)
      ) : () => {};

      const unsub = () => { u1(); u2(); u3(); };
      this._listeners.push(unsub);
      return unsub;
    },

    // ── Mark as read (best-effort, non-blocking) ───────────────────────────────
    markRead(messageId) {
      const uid = getUid();
      if (!uid || !messageId) return;
      window.fsUpdateDoc(
        window.fsDoc(window.firestore, COL_MESSAGES, messageId),
        { [`readBy.${uid}`]: true }
      ).catch(() => {});
    },

    // ── Count unread for badge ─────────────────────────────────────────────────
    countUnread(messages) {
      const uid = getUid();
      if (!uid) return 0;
      return messages.filter(m => !m.readBy || !m.readBy[uid]).length;
    },

    // ── Cleanup ────────────────────────────────────────────────────────────────
    stop() {
      this._listeners.forEach(u => { try { u(); } catch (_) {} });
      this._listeners = [];
    }
  };

  window.MESSAGING = MESSAGING;

})();
