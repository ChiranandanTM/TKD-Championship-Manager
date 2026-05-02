// ============================================
// DYNAMIC FORM CONFIGURATION MANAGER
// ============================================

const FORM_CONFIG = {
  defaultConfig: {
    championship: {
      title: "TAEKWONDO CHAMPIONSHIP",
      venue: "National Sports Complex",
      address: "Bengaluru, Karnataka, India",
      date: "2026-03-15",
      organizer: "Karnataka Taekwondo Association",
      registrationDeadline: ""
    },
    fields: [
      { id: 'playerName', label: 'Player Name', type: 'text', required: true, order: 1 },
      { id: 'playerImage', label: 'Player Image', type: 'image', required: true, order: 2 },
      { id: 'fatherName', label: 'Father Name', type: 'text', required: true, order: 3 },
      { id: 'motherName', label: 'Mother Name', type: 'text', required: true, order: 4 },
      { id: 'dob', label: 'Date of Birth', type: 'date', required: true, order: 5 },
      { id: 'age', label: 'Age', type: 'number', required: true, readonly: true, order: 6 },
      { id: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female'], required: true, order: 7 },
      { id: 'centerName', label: 'Center Name', type: 'text', required: true, order: 8 },
      { id: 'weight', label: 'Weight (kg)', type: 'text', required: true, order: 9, info: 'Enter exact weight (e.g., 60 or 61.5)' },
      { id: 'weightCategory', label: 'Weight Category', type: 'text', required: true, readonly: true, order: 10 },
      { id: 'district', label: 'District', type: 'text', required: true, order: 11 },
      { id: 'taluk', label: 'Taluk', type: 'text', required: true, order: 12 },
      { id: 'paymentStatus', label: 'Payment Status', type: 'select', options: ['Not Paid', 'Paid'], required: false, order: 14 },
      // ageCategory and playerCategory are auto-calculated from DOB — never shown as manual selects
      { id: 'ageCategory', label: 'Age Category', type: 'hidden', required: false, order: 99 },
      { id: 'playerCategory', label: 'Player Category', type: 'hidden', required: false, order: 99 },
      { id: 'categories', label: 'Categories', type: 'hidden', required: false, order: 99 }
    ]
  },

  // Load form configuration from Firebase with caching for performance
  async loadConfig() {
    
    try {
      console.log("📥 loadConfig called...");
      
      // Check cache first to reduce Firebase calls (5 minute cache)
      if (typeof PERFORMANCE_CACHE !== 'undefined') {
        try {
          const cachedConfig = PERFORMANCE_CACHE.get('formConfig');
          if (cachedConfig && cachedConfig.championship && cachedConfig.fields) {
            console.log("📦 Using cached form config");
            return cachedConfig;
          }
        } catch (cacheError) {
          console.warn("⚠️ Cache access error, continuing with Firebase load:", cacheError);
        }
      }

      console.log("📡 Fetching config from Firebase...");
      console.log("database available:", typeof database !== 'undefined');
      console.log("dbRef available:", typeof dbRef !== 'undefined');
      console.log("dbGet available:", typeof dbGet !== 'undefined');
      
      const configRef = dbRef(database, 'formConfig');
      const snapshot = await dbGet(configRef);
      
      if (snapshot.exists()) {
        let config = snapshot.val();
        console.log("✅ Config data received from Firebase");
        console.log("📊 Firebase config structure:", {
          hasChampionship: !!config?.championship,
          hasFields: !!config?.fields,
          fieldsCount: config?.fields?.length || 0
        });
        
        // Validate config structure - ensure both championship and fields exist
        if (!config.championship || !config.fields) {
          console.warn("⚠️ Firebase config missing required structure, merging with defaults...");
          config = {
            championship: config?.championship || this.defaultConfig.championship,
            fields: config?.fields || this.defaultConfig.fields
          };
        }
        
        // Migrate old paymentStatus field if needed
        if (config.fields) {
          const paymentStatusField = config.fields.find(f => f.id === 'paymentStatus');
          if (paymentStatusField) {
            // Update old checkbox-single type to select
            if (paymentStatusField.type === 'checkbox-single') {
              paymentStatusField.type = 'select';
            }
            // Ensure both options are present
            if (!paymentStatusField.options || paymentStatusField.options.length < 2) {
              paymentStatusField.options = ['Not Paid', 'Paid'];
              await this.saveConfig(config); // Save the update
            }
          }
        }

        // MIGRATION: Deduplicate fields (backward compat - old configs had duplicate age/weightCategory)
        if (config.fields) {
          const seenIds = {};
          config.fields = config.fields.filter(f => {
            if (!f || !f.id) return false;
            if (seenIds[f.id]) return false;
            seenIds[f.id] = true;
            return true;
          });

          // MIGRATION: Force ageCategory and playerCategory to always be hidden (auto-calculated)
          // Remove any existing manual select/text entries for these fields, then re-add as hidden
          const AUTO_CALC_FIELDS = ['ageCategory', 'playerCategory', 'categories'];
          config.fields = config.fields.filter(f => !AUTO_CALC_FIELDS.includes(f.id));
          config.fields.push(
            { id: 'ageCategory', label: 'Age Category', type: 'hidden', required: false, order: 99 },
            { id: 'playerCategory', label: 'Player Category', type: 'hidden', required: false, order: 99 },
            { id: 'categories', label: 'Categories', type: 'hidden', required: false, order: 99 }
          );
        }
        
        console.log("✅ Config ready to return, fields count:", config.fields?.length);
        return config;
      } else {
        console.log("⚠️ No config in Firebase, initializing with defaults...");
        // Initialize with default config
        try {
          await this.saveConfig(this.defaultConfig);
          console.log("✅ Default config saved to Firebase");
        } catch (saveError) {
          console.warn("⚠️ Could not save default config to Firebase:", saveError.message);
        }
        console.log("✅ Returning default config");
        return JSON.parse(JSON.stringify(this.defaultConfig)); // Deep copy to avoid mutations
      }
    } catch (error) {
      console.error("❌ Error loading form config:", error);
      console.error("❌ Error message:", error.message);
      console.error("❌ Error code:", error.code);
      console.log("⚠️ Returning default config as fallback");
      return JSON.parse(JSON.stringify(this.defaultConfig)); // Deep copy
    }
  },

  // Wait for Firebase Auth to settle (up to timeoutMs)
  _waitForAuth(timeoutMs = 5000) {
    return new Promise((resolve) => {
      // Already signed in
      if (window.auth && window.auth.currentUser) { resolve(window.auth.currentUser); return; }
      // Auth not available — resolve null so we can attempt write anyway
      if (!window.auth || typeof window.onAuthStateChanged !== 'function') { resolve(null); return; }
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(window.auth?.currentUser || null); } }, timeoutMs);
      window.onAuthStateChanged(window.auth, (user) => {
        if (!done) { done = true; clearTimeout(timer); resolve(user); }
      });
    });
  },

  // Save form configuration to Firebase and update cache
  async saveConfig(config) {
    try {
      console.log("💾 Saving config to Firebase...");

      // Wait for auth state to settle (fixes race condition after bootstrap login)
      const user = await this._waitForAuth(5000);
      console.log("🔐 Auth user:", user ? user.uid : 'none — attempting write anyway (sessionStorage role)');

      // If Firebase Auth user is present, verify role in DB
      if (user) {
        const userRef = dbRef(database, `users/${user.uid}`);
        const snap = await dbGet(userRef);
        if (snap.exists() && snap.val().role !== 'admin') {
          throw new Error(`Permission denied: role is '${snap.val().role}', 'admin' required.`);
        }
      } else {
        // No Firebase Auth token — check sessionStorage role as UI-layer guard
        const role = sessionStorage.getItem('userRole');
        if (role !== 'admin') throw new Error('User not authenticated as admin.');
      }

      const configRef = dbRef(database, 'formConfig');
      console.log("🔄 Writing to database...");
      await dbSet(configRef, config);
      console.log("✅ Config saved to Firebase");

      // Update cache after saving
      if (typeof PERFORMANCE_CACHE !== 'undefined' && PERFORMANCE_CACHE.EXPIRY_TIMES?.formConfig) {
        PERFORMANCE_CACHE.set('formConfig', config, PERFORMANCE_CACHE.EXPIRY_TIMES.formConfig);
        console.log("✅ Cache updated");
      }
      return true;
    } catch (error) {
      console.error("❌ Error saving form config:", error);
      console.error("❌ Error message:", error.message);
      console.error("❌ Error code:", error.code);
      return false;
    }
  },

  // Update championship details
  async updateChampionship(details) {
    try {
      const config = await this.loadConfig();
      config.championship = { ...config.championship, ...details };
      await this.saveConfig(config);
      return true;
    } catch (error) {
      console.error("❌ Error updating championship:", error);
      return false;
    }
  },

  // Update field configuration
  async updateFields(fields) {
    try {
      const config = await this.loadConfig();
      config.fields = fields;
      await this.saveConfig(config);
      return true;
    } catch (error) {
      console.error("❌ Error updating fields:", error);
      return false;
    }
  },

  // Get field by ID
  getField(config, fieldId) {
    return config.fields.find(f => f.id === fieldId);
  }
};

window.FORM_CONFIG = FORM_CONFIG;