// ============================================
// PERFORMANCE CACHE - Fast reads, low Firebase usage
// ============================================

const PERFORMANCE_CACHE = {
  cache: {},
  cacheExpiry: {},
  _pendingRequests: {}, // Dedup simultaneous requests for same key

  EXPIRY_TIMES: {
    formConfig:       10 * 60 * 1000, // 10 min  (rarely changes)
    weightCategories: 15 * 60 * 1000, // 15 min
    players:           2 * 60 * 1000, // 2 min
    teams:             5 * 60 * 1000, // 5 min
    brackets:          1 * 60 * 1000, // 1 min
    matchHistory:      1 * 60 * 1000, // 1 min
    championship:     10 * 60 * 1000, // 10 min
  },

  set(key, value, expiryTime) {
    this.cache[key] = value;
    if (expiryTime) this.cacheExpiry[key] = Date.now() + expiryTime;
  },

  get(key) {
    if (!this.cache.hasOwnProperty(key)) return null;
    if (this.cacheExpiry[key] && Date.now() > this.cacheExpiry[key]) {
      delete this.cache[key];
      delete this.cacheExpiry[key];
      return null;
    }
    return this.cache[key];
  },

  clear(key) {
    delete this.cache[key];
    delete this.cacheExpiry[key];
  },

  clearAll() {
    this.cache = {};
    this.cacheExpiry = {};
    this._pendingRequests = {};
  },

  // Deduplication: if same key is already being fetched, wait for it instead of firing another request
  async _fetchOnce(key, fetchFn, expiryTime) {
    const cached = this.get(key);
    if (cached !== null) return cached;

    if (this._pendingRequests[key]) {
      return this._pendingRequests[key];
    }

    this._pendingRequests[key] = fetchFn().then(result => {
      this.set(key, result, expiryTime);
      delete this._pendingRequests[key];
      return result;
    }).catch(err => {
      delete this._pendingRequests[key];
      throw err;
    });

    return this._pendingRequests[key];
  },

  async getCachedFormConfig() {
    return this._fetchOnce('formConfig', () => FORM_CONFIG.loadConfig(), this.EXPIRY_TIMES.formConfig);
  },

  async getCachedWeightCategories() {
    return this._fetchOnce('weightCategories', async () => {
      try {
        const snap = await dbGet(dbRef(database, 'weightCategories'));
        return snap.exists() ? snap.val() : CATEGORY_LOGIC.defaultWeightCategories;
      } catch {
        return CATEGORY_LOGIC.defaultWeightCategories;
      }
    }, this.EXPIRY_TIMES.weightCategories);
  },

  async getCachedPlayers() {
    return this._fetchOnce('players', async () => {
      const snap = await dbGet(dbRef(database, 'players'));
      return snap.exists() ? snap.val() : {};
    }, this.EXPIRY_TIMES.players);
  },

  async getCachedTeams() {
    return this._fetchOnce('teams', async () => {
      const snap = await dbGet(dbRef(database, 'teams'));
      return snap.exists() ? snap.val() : {};
    }, this.EXPIRY_TIMES.teams);
  },

  // Debounce - prevents rapid repeated calls (e.g. typing in weight field)
  debounce(func, delay) {
    let timeoutId;
    return function debounced(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  },

  // Throttle - limits how often a function can fire
  throttle(func, limit) {
    let inThrottle;
    return function throttled(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
};

window.PERFORMANCE_CACHE = PERFORMANCE_CACHE;