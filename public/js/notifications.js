// notifications.js — Real-time popup, browser and sound notifications
// Works for admin (notified on referee messages) and
// referee (notified on admin messages).
//
// Usage:
//   1. NOTIFY.init('admin' | 'referee')
//   2. NOTIFY.processMessages(msgs, uid, openPanelFn)  ← call inside every listener callback

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  const _seen   = new Set(); // IDs already shown a notification
  let _isFirst  = true;      // first listener callback since page load?
  let _role     = 'referee';
  let _audioCtx = null;
  const MAX_TOASTS = 4;

  // ── Inject CSS ─────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('notif-styles')) return;
    var s = document.createElement('style');
    s.id = 'notif-styles';
    s.textContent = [
      '#notif-container{position:fixed;bottom:24px;right:24px;z-index:99999;',
      'display:flex;flex-direction:column;gap:10px;align-items:flex-end;',
      'pointer-events:none;max-width:360px;width:calc(100vw - 48px);}',

      '.notif-toast{background:linear-gradient(135deg,rgba(8,14,36,.97) 0%,rgba(18,28,58,.97) 100%);',
      'border-radius:14px;padding:14px 16px 14px 20px;min-width:260px;max-width:360px;width:100%;',
      'box-shadow:0 12px 40px rgba(0,0,0,.75),0 0 0 1px rgba(255,255,255,.06);',
      'pointer-events:all;cursor:pointer;position:relative;overflow:hidden;',
      'box-sizing:border-box;transition:filter .2s;',
      'animation:notifIn .4s cubic-bezier(.175,.885,.32,1.275) both;}',

      '.notif-toast:hover{filter:brightness(1.1);}',
      '.notif-toast.notif-out{animation:notifOut .28s ease forwards;}',

      '.ntf-bar{position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:14px 0 0 14px;}',
      '.ntf-ring{position:absolute;inset:-1px;border-radius:14px;',
      'border:2px solid rgba(255,23,68,.5);pointer-events:none;',
      'animation:ntfRing .85s ease-in-out 3;}',

      '.ntf-row{display:flex;align-items:flex-start;gap:10px;}',
      '.ntf-icon{font-size:1.5rem;flex-shrink:0;line-height:1;margin-top:1px;}',
      '.ntf-body{flex:1;min-width:0;}',
      '.ntf-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}',
      '.ntf-sender{font-size:.84rem;font-weight:800;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;}',
      '.ntf-right{display:flex;align-items:center;gap:7px;flex-shrink:0;}',
      '.ntf-time{font-size:.68rem;color:#666;}',
      '.ntf-close{background:none;border:none;color:#555;font-size:.9rem;cursor:pointer;',
      'padding:2px 4px;border-radius:4px;line-height:1;transition:color .15s,background .15s;}',
      '.ntf-close:hover{color:#ff4444;background:rgba(255,23,68,.12);}',
      '.ntf-urgent{font-size:.62rem;font-weight:900;color:#FF1744;',
      'text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;}',
      '.ntf-text{font-size:.87rem;color:#bbb;line-height:1.45;word-break:break-word;',
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
      '.ntf-bar-prog{position:absolute;bottom:0;left:0;height:2px;opacity:.35;',
      'animation:ntfProg 6s linear forwards;border-radius:0 0 14px 14px;}',

      '@keyframes notifIn{',
      '0%{opacity:0;transform:translateX(110%) scale(.88)}',
      '100%{opacity:1;transform:translateX(0) scale(1)}}',

      '@keyframes notifOut{',
      '0%{opacity:1;transform:translateX(0) scale(1);max-height:140px;margin-bottom:0}',
      '100%{opacity:0;transform:translateX(110%) scale(.85);max-height:0;padding:0}}',

      '@keyframes ntfRing{',
      '0%,100%{opacity:.8;transform:scale(1)}',
      '50%{opacity:.1;transform:scale(1.03)}}',

      '@keyframes ntfProg{from{width:100%}to{width:0%}}',

      '@media(max-width:480px){',
      '#notif-container{bottom:12px;right:12px;left:12px;max-width:100%;width:auto;}',
      '.notif-toast{min-width:unset;}}'
    ].join('');
    document.head.appendChild(s);
  }

  // ── Container ──────────────────────────────────────────────────────────────
  function getContainer() {
    var c = document.getElementById('notif-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'notif-container';
      document.body.appendChild(c);
    }
    return c;
  }

  // ── Dismiss ────────────────────────────────────────────────────────────────
  function dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add('notif-out');
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 300);
  }

  // ── Show toast ─────────────────────────────────────────────────────────────
  function showToast(msg, openFn) {
    var container = getContainer();

    // Evict oldest if at limit
    var existing = container.querySelectorAll('.notif-toast');
    if (existing.length >= MAX_TOASTS) dismiss(existing[0]);

    var isAdmin  = msg.fromRole === 'admin';
    var isUrgent = msg.type === 'urgent';
    var accent   = isUrgent ? '#FF1744' : (isAdmin ? '#00E5FF' : '#FFD700');
    var icon     = isAdmin ? '📩' : '🧑‍⚖️';

    var ts = msg.timestamp;
    var time = '';
    try {
      var ms = ts ? (ts.toMillis ? ts.toMillis() : Number(ts)) : Date.now();
      time = new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {}

    var sender = isAdmin
      ? 'Admin'
      : (msg.fromName || 'Referee') + (msg.courtNumber ? '  ·  Court ' + msg.courtNumber : '');

    var preview = String(msg.text || '');
    if (preview.length > 120) preview = preview.slice(0, 120) + '…';

    var toast = document.createElement('div');
    toast.className = 'notif-toast';
    toast.setAttribute('role', 'alert');

    toast.innerHTML =
      '<div class="ntf-bar" style="background:' + accent + '"></div>' +
      (isUrgent ? '<div class="ntf-ring"></div>' : '') +
      '<div class="ntf-row">' +
        '<div class="ntf-icon">' + icon + '</div>' +
        '<div class="ntf-body">' +
          '<div class="ntf-head">' +
            '<span class="ntf-sender" style="color:' + accent + '">' + esc(sender) + '</span>' +
            '<div class="ntf-right">' +
              '<span class="ntf-time">' + time + '</span>' +
              '<button class="ntf-close" title="Dismiss">&#x2715;</button>' +
            '</div>' +
          '</div>' +
          (isUrgent ? '<div class="ntf-urgent">&#x1F534; Urgent</div>' : '') +
          '<div class="ntf-text">' + esc(preview) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ntf-bar-prog" style="background:' + accent + '"></div>';

    toast.addEventListener('click', function (e) {
      if (e.target.classList.contains('ntf-close')) return;
      if (typeof openFn === 'function') openFn();
      dismiss(toast);
    });
    toast.querySelector('.ntf-close').addEventListener('click', function (e) {
      e.stopPropagation();
      dismiss(toast);
    });

    container.appendChild(toast);
    var timer = setTimeout(function () { dismiss(toast); }, 6000);
    toast.addEventListener('click', function () { clearTimeout(timer); });
  }

  // ── Browser (OS) notification ──────────────────────────────────────────────
  function showBrowserNotif(msg, openFn) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;

    var isAdmin  = msg.fromRole === 'admin';
    var isUrgent = msg.type === 'urgent';
    var title    = isAdmin
      ? (isUrgent ? '🔴 URGENT — Admin' : '📩 Message from Admin')
      : '🧑‍⚖️ ' + (msg.fromName || 'Referee') + (msg.courtNumber ? ' — Court ' + msg.courtNumber : '');
    var body = String(msg.text || '');
    if (body.length > 120) body = body.slice(0, 120) + '…';

    try {
      var notif = new Notification(title, {
        body: body,
        icon: '/assets/images/favicon.jpeg',
        badge: '/assets/images/favicon.jpeg',
        tag: 'tkd-' + (msg.id || Date.now()),
        requireInteraction: isUrgent
      });
      notif.onclick = function () {
        window.focus();
        if (typeof openFn === 'function') openFn();
        notif.close();
      };
    } catch (e) {}
  }

  // ── Sound ──────────────────────────────────────────────────────────────────
  function playSound(isUrgent) {
    try {
      if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      var ctx = _audioCtx;
      var doPlay = function () {
        var now = ctx.currentTime;
        var notes = isUrgent
          ? [{ f: 880, t: 0 }, { f: 1100, t: 0.18 }, { f: 880, t: 0.36 }]
          : [{ f: 660, t: 0 }];
        notes.forEach(function (n) {
          var osc = ctx.createOscillator();
          var g   = ctx.createGain();
          osc.connect(g); g.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(n.f, now + n.t);
          osc.frequency.exponentialRampToValueAtTime(n.f * 0.55, now + n.t + 0.25);
          g.gain.setValueAtTime(isUrgent ? 0.35 : 0.25, now + n.t);
          g.gain.exponentialRampToValueAtTime(0.001, now + n.t + 0.45);
          osc.start(now + n.t);
          osc.stop(now + n.t + 0.5);
        });
      };
      if (ctx.state === 'suspended') {
        ctx.resume().then(doPlay).catch(function () {});
      } else {
        doPlay();
      }
    } catch (e) {}
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  var NOTIFY = {

    // Call once after auth is confirmed. role: 'admin' | 'referee'
    init: function (role) {
      _role = role || 'referee';
      injectStyles();
      if ('Notification' in window && Notification.permission === 'default') {
        setTimeout(function () {
          Notification.requestPermission().catch(function () {});
        }, 2500);
      }
      // Resume AudioContext on first user gesture (browser policy)
      document.addEventListener('click', function resume() {
        if (_audioCtx && _audioCtx.state === 'suspended') {
          _audioCtx.resume().catch(function () {});
        }
        document.removeEventListener('click', resume);
      }, { once: true });
    },

    // Call inside every Firestore listener callback.
    //   msgs    : full message array
    //   uid     : current user's Firebase UID (don't notify about own messages)
    //   openFn  : opens the messages panel on click
    processMessages: function (msgs, uid, openFn) {
      var isFirst = _isFirst;
      _isFirst = false;

      var toNotify = [];

      msgs.forEach(function (m) {
        if (_seen.has(m.id)) return;
        _seen.add(m.id);

        // Skip own messages
        if (m.from === uid) return;

        // Role filter: referee cares about admin messages, admin cares about referee messages
        var relevant = _role === 'referee'
          ? m.fromRole === 'admin'
          : m.fromRole === 'referee';
        if (!relevant) return;

        // Skip already read by this user
        if (m.readBy && m.readBy[uid]) return;

        toNotify.push(m);
      });

      if (toNotify.length === 0) return;

      // Show toast + browser notification for every unread message
      toNotify.forEach(function (msg) {
        showToast(msg, openFn);
        showBrowserNotif(msg, openFn);
      });

      // Sound: play once per batch.
      // Skip sound on the very first listener callback (page just loaded —
      // would be jarring if there are several old unread messages).
      if (!isFirst) {
        var urgent = toNotify.some(function (m) { return m.type === 'urgent'; });
        playSound(urgent);
      }
    },

    // Manually request browser notification permission (wire to a UI button if needed)
    requestPermission: function () {
      if ('Notification' in window) return Notification.requestPermission();
      return Promise.resolve('denied');
    }
  };

  window.NOTIFY = NOTIFY;

})();
