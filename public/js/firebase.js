// FIREBASE v11 - Modular SDK with persistence + performance optimizations
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, onIdTokenChanged, createUserWithEmailAndPassword, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getDatabase, ref, set, get, update, remove, onValue, onChildAdded, onChildChanged, onChildRemoved, push, query, orderByChild, equalTo, child, goOnline, goOffline, connectDatabaseEmulator } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, updateDoc, deleteDoc, query as fsQuery, where, orderBy, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyC7NfS7RMv8C78KGJsPkQCeV9fzmJ86lDU",
  authDomain: "taekowndo-championship.firebaseapp.com",
  databaseURL: "https://taekowndo-championship-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "taekowndo-championship",
  storageBucket: "taekowndo-championship.firebasestorage.app",
  messagingSenderId: "747830683087",
  appId: "1:747830683087:web:3a7461d1a54d475f1cdeba"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const storage = getStorage(app);
const firestore = getFirestore(app);

// ── Keep connection alive on visibility change ────────────────────────────────
// When tab becomes hidden, Firebase drops the WebSocket. When the user returns,
// re-connect the database AND force-refresh the auth token. Without the token
// refresh, ops that require auth fail with PERMISSION_DENIED if the 60-minute
// token expired while the browser was in background / device was asleep.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    goOnline(database);
    if (auth.currentUser) {
      auth.currentUser.getIdToken(true).catch(() => {});
    }
  }
});

// ── Monitor connection state and show user feedback ───────────────────────────
const connectedRef = ref(database, '.info/connected');
let connectionBanner = null;
onValue(connectedRef, (snap) => {
  const isConnected = snap.val() === true;
  if (isConnected) {
    // Refresh auth token whenever the database reconnects. Covers network drops
    // where the token may have aged past its 60-minute expiry while offline.
    if (auth.currentUser) {
      auth.currentUser.getIdToken(true).catch(() => {});
    }
  }
  if (!isConnected) {
    // Show offline banner after 3s delay (avoid flashing on brief drops)
    if (!connectionBanner) {
      connectionBanner = setTimeout(() => {
        const banner = document.createElement('div');
        banner.id = 'offline-banner';
        banner.textContent = '⚠️ No internet connection — changes will sync when reconnected';
        banner.style.cssText = `
          position:fixed;bottom:0;left:0;right:0;
          background:#FF6B35;color:#fff;
          text-align:center;padding:10px;
          font-size:14px;z-index:99999;
          font-family:sans-serif;
        `;
        document.body && document.body.appendChild(banner);
      }, 3000);
    }
  } else {
    if (connectionBanner) {
      clearTimeout(connectionBanner);
      connectionBanner = null;
    }
    const banner = document.getElementById('offline-banner');
    if (banner) banner.remove();
  }
});

// ── Register service worker for offline + fast load ──────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/js/service-worker.js')
      .then(reg => {
        // Check for updates every 60 seconds
        setInterval(() => reg.update(), 60000);
      })
      .catch(() => {});
  });
}

// ── Retry DB ops once on permission-denied after forcing a fresh token ───────
// A cached ID token can expire while a tab is idle/backgrounded. The
// visibilitychange/reconnect handlers above refresh it, but that refresh
// races against whatever the resuming page does next, so a call can still go
// out with a stale token and get rejected. Wrapping get/set/update/remove
// here means every call site gets one automatic retry after a forced token
// refresh (or a short wait for auth to hydrate), instead of surfacing a
// permission-denied error the user has to work around by re-logging in.
function isPermissionDeniedError(error) {
  const msg = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  // RTDB uses "PERMISSION_DENIED", Firestore uses "permission-denied".
  return msg.includes('permission denied') || code.includes('permission_denied') || code.includes('permission-denied');
}

function waitForAuthUser(timeoutMs = 3500) {
  if (auth.currentUser) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) finish(true);
    });
    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(result);
    }
  });
}

function withAuthRetry(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (!isPermissionDeniedError(error)) throw error;

      if (auth.currentUser) {
        await auth.currentUser.getIdToken(true).catch(() => {});
      } else {
        await waitForAuthUser();
      }

      return await fn(...args);
    }
  };
}

// ── Export everything globally ────────────────────────────────────────────────
window.firebaseApp = app;
window.auth = auth;
window.database = database;
window.storage = storage;
window.dbRef = ref;
window.dbSet = withAuthRetry(set);
window.dbGet = withAuthRetry(get);
window.dbUpdate = withAuthRetry(update);
window.dbRemove = withAuthRetry(remove);
window.dbOnValue = onValue;
window.dbPush = push;
window.dbQuery = query;
window.dbOrderByChild = orderByChild;
window.dbEqualTo = equalTo;
window.dbChild = child;
window.storageRef = storageRef;
window.uploadBytes = uploadBytes;
window.getDownloadURL = getDownloadURL;
window.signInWithEmailAndPassword = signInWithEmailAndPassword;
window.signOut = signOut;
window.onAuthStateChanged = onAuthStateChanged;
window.onIdTokenChanged = onIdTokenChanged;
window.createUserWithEmailAndPassword = createUserWithEmailAndPassword;
window.signInAnonymously = signInAnonymously;
window.dbGoOnline = goOnline;
window.dbGoOffline = goOffline;
window.dbOnChildAdded = onChildAdded;
window.dbOnChildChanged = onChildChanged;
window.dbOnChildRemoved = onChildRemoved;

// ── Firestore globals ─────────────────────────────────────────────────────────
window.firestore = firestore;
window.fsCollection = collection;
window.fsDoc = doc;
window.fsAddDoc = withAuthRetry(addDoc);
window.fsSetDoc = withAuthRetry(setDoc);
window.fsGetDoc = withAuthRetry(getDoc);
window.fsUpdateDoc = withAuthRetry(updateDoc);
window.fsDeleteDoc = withAuthRetry(deleteDoc);
window.fsQuery = fsQuery;
window.fsWhere = where;
window.fsOrderBy = orderBy;
window.fsOnSnapshot = onSnapshot;
window.fsServerTimestamp = serverTimestamp;

// 🔌 DATABASE CONNECTION FIX #4: Export connection verification function
window.verifyDatabaseConnection = async function(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn('⚠️ Connection check timeout - assuming offline');
      resolve(false);
    }, timeoutMs);

    try {
      const testRef = ref(database, '.info/connected');
      const unsubscribe = onValue(testRef, (snap) => {
        if (unsubscribe) unsubscribe();
        clearTimeout(timer);
        const isConnected = snap.val() === true;
        console.log(`📡 Database ${isConnected ? 'ONLINE ✅' : 'OFFLINE ❌'}`);
        resolve(isConnected);
      });
    } catch (e) {
      clearTimeout(timer);
      console.error('❌ Connection check error:', e.message);
      resolve(false);
    }
  });
};

console.log("✅ Firebase v11 initialized");