// ============================================
// PLAYER REGISTRATION FORM LOGIC
// ============================================

const REGISTRATION = {
  currentImageFile: null,
  currentImageURL: null,
  editingPlayerId: null,

  // Initialize registration form
  async init() {
    // Wait for Firebase globals to be ready
    await new Promise(resolve => {
      const check = () => {
        if (typeof dbRef !== 'undefined' && typeof dbGet !== 'undefined' && typeof database !== 'undefined') {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');

    if (editId) {
      this.editingPlayerId = editId;
      await this.loadPlayerData(editId);
    } else {
      this.editingPlayerId = null;
      this._editPlayerData = null;
      sessionStorage.removeItem('editPlayerId');
      console.log('✅ Starting fresh - no editing data');
    }

    await this.loadFormStructure();

    setTimeout(() => {
      this.setupEventListeners();
    }, 200);
  },

  // Load existing player data for editing
  async loadPlayerData(playerId) {
    try {
      const playerRef = dbRef(database, `players/${playerId}`);
      const snapshot = await dbGet(playerRef);
      if (snapshot.exists()) {
        const data = snapshot.val();
        // Load image from dedicated playerImages/ path (new format).
        // Fall back to legacy playerImage field already in data if present.
        if (!data.playerImage) {
          try {
            const imgSnap = await dbGet(dbRef(database, `playerImages/${playerId}`));
            if (imgSnap.exists()) data.playerImage = imgSnap.val();
          } catch (_) {}
        }
        // Store in memory - avoids sessionStorage quota error from large base64 images
        this._editPlayerData = data;
        console.log('✅ Player data loaded into memory');
      }
    } catch (error) {
      console.error('Error loading player data:', error);
    }
  },

  // Load and render form structure
  async loadFormStructure() {
    try {
      const config = await FORM_CONFIG.loadConfig();

      // Validate config structure
      if (!config) {
        console.error("❌ Config is null/undefined");
        return;
      }

      if (!config.championship) {
        console.error("❌ Championship data missing from config");
        return;
      }

      if (!config.fields || !Array.isArray(config.fields)) {
        console.error("❌ Fields not available or not an array");
        return;
      }

      console.log("✅ Config loaded successfully");

      // ── PER-TEAM REGISTRATION DEADLINE CHECK (client-side UI block) ──────────
      const teamId = sessionStorage.getItem('teamId');
      if (teamId) {
        const teamSnap = await dbGet(dbRef(database, `teams/${teamId}`));
        if (teamSnap.exists()) {
          const teamData = teamSnap.val();

          // Store authoritative team name to pre-fill and lock the centerName field
          if (teamData.teamName) {
            this.currentTeamName = teamData.teamName;
            sessionStorage.setItem('teamName', teamData.teamName);
          }

          // Check hard close flag
          if (teamData.registrationClosed === true) {
            this.showDeadlineClosed(config.championship, null, true);
            return;
          }

          // Check deadline date
          const teamDeadline = teamData.registrationDeadline;
          if (teamDeadline) {
            const deadlineDate = new Date(teamDeadline);
            if (!teamDeadline.includes('T')) {
              deadlineDate.setHours(23, 59, 59, 999);
            }
            if (new Date() > deadlineDate) {
              this.showDeadlineClosed(config.championship, teamDeadline, false);
              return;
            }
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────────

      // Render championship header
      this.renderChampionshipHeader(config.championship);

      // Render form fields
      this.renderFormFields(config.fields);
    } catch (error) {
      console.error("❌ Error loading form structure:", error);
      const formContainer = document.getElementById('registrationForm');
      if (formContainer) {
        formContainer.innerHTML = `<div class="error">Error loading form: ${error.message}</div>`;
      }
    }
  },

  // Render championship header
  renderChampionshipHeader(championship) {
    try {
      // Validate championship object
      if (!championship) {
        console.error("❌ Championship is null/undefined");
        return;
      }

      // Log the actual championship data for debugging
      console.log("📊 Championship data received:", championship);

      // Get values with defaults - with validation
      let title = championship?.title || 'TAEKWONDO CHAMPIONSHIP';
      let venue = championship?.venue || 'National Sports Complex';
      let address = championship?.address || 'Location TBD';
      let organizer = championship?.organizer || 'Karnataka Taekwondo Association';

      // Clean up string values (remove "TBD" that might be recorded as string)
      venue = (venue && venue !== 'TBD' && venue.trim()) || 'Venue TBD';
      address = (address && address !== 'TBD' && address.trim()) || 'Location TBD';
      organizer = (organizer && organizer !== 'TBD' && organizer.trim()) || 'Karnataka Taekwondo Association';

      // If organizer looks like a location (contains common location names), swap with address
      const locationKeywords = ['tiptur', 'bangalore', 'bengaluru', 'karnataka', 'district', 'taluk', 'city', 'state', 'india'];
      const organizerLower = organizer.toLowerCase();
      const addressLower = address.toLowerCase();

      if (locationKeywords.some(keyword => organizerLower.includes(keyword)) &&
        !locationKeywords.some(keyword => addressLower.includes(keyword))) {
        // Swap: organizer appears to be a location
        console.warn("⚠️ Detected location in organizer field, swapping with address");
        const temp = organizer;
        organizer = address;
        address = temp;
      }

      // Safely parse date
      let dateString = 'Date TBD';
      try {
        if (championship?.date && championship.date !== 'TBD') {
          const dateObj = new Date(championship.date);
          // Check if date is valid
          if (!isNaN(dateObj.getTime())) {
            dateString = `Date: ${dateObj.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}`;
          } else {
            console.warn("⚠️ Invalid date value:", championship.date);
          }
        }
      } catch (dateError) {
        console.warn("⚠️ Error parsing championship date:", dateError);
        dateString = 'Date TBD';
      }

      console.log("📋 Processed championship header:", { title, venue, address, dateString, organizer });

      const headerHTML = `
        <div class="championship-header">
          <h1>${title}</h1>
          <p class="venue">${venue}</p>
          <p class="address">${address}</p>
          <p class="date">${dateString}</p>
          <p class="organizer">Organized by: ${organizer}</p>
        </div>
      `;

      const headerContainer = document.getElementById('championshipHeader');
      if (headerContainer) {
        headerContainer.innerHTML = headerHTML;
      }
    } catch (error) {
      console.error("❌ Error rendering championship header:", error);
      const headerContainer = document.getElementById('championshipHeader');
      if (headerContainer) {
        headerContainer.innerHTML = `<div class="championship-header"><h1>TAEKWONDO CHAMPIONSHIP</h1></div>`;
      }
    }
  },

  // Render form fields dynamically
  renderFormFields(fields) {
    try {
      // Validate fields array
      if (!Array.isArray(fields) || fields.length === 0) {
        console.error("❌ Fields array is empty or invalid");
        const formContainer = document.getElementById('registrationForm');
        if (formContainer) {
          formContainer.innerHTML = '<div class="error">Error: Form fields not configured properly</div>';
        }
        return;
      }

      const sortedFields = [...fields].sort((a, b) => (a.order || 0) - (b.order || 0));
      const formContainer = document.getElementById('registrationForm');

      if (!formContainer) {
        console.error("❌ Form container not found");
        return;
      }

      console.log('📋 Rendering fields:', sortedFields.map(f => f.id));

      let formHTML = '';

      sortedFields.forEach(field => {
        try {
          formHTML += this.renderField(field);
        } catch (fieldError) {
          console.error("❌ Error rendering field:", field.id, fieldError);
        }
      });

      const buttonText = this.editingPlayerId ? 'Update Player' : 'Register Player';
      formHTML += `
        <div class="form-group">
          <button type="submit" id="submitBtn" class="submit-btn">${buttonText}</button>
        </div>
      `;

      formContainer.innerHTML = formHTML;
      console.log('✅ Form HTML injected into DOM');

      // Initialize custom selects for dropdowns
      if (typeof initializeCustomSelects === 'function') {
        initializeCustomSelects();
      }

      // Populate with existing data if editing
      if (this.editingPlayerId && this._editPlayerData) {
        const playerData = this._editPlayerData;
        // Delay so custom select dropdowns finish initializing first
        setTimeout(() => {
          this.populateFormData(playerData);
          setTimeout(() => this.updateWeightCategory(), 200);
        }, 300);
      }
    } catch (error) {
      console.error("❌ Error rendering form fields:", error);
      const formContainer = document.getElementById('registrationForm');
      if (formContainer) {
        formContainer.innerHTML = `<div class="error">Error rendering form: ${error.message}</div>`;
      }
    }
  },

  // Populate form with existing player data
  populateFormData(playerData) {
    Object.keys(playerData).forEach(key => {
      const input = document.getElementById(key);
      if (!input) return;

      // SKIP file inputs — cannot set value on file input, handled separately below
      if (input.type === 'file') return;

      if (input.type === 'checkbox') {
        if (key === 'categories' && Array.isArray(playerData[key])) {
          playerData[key].forEach(category => {
            const checkbox = document.querySelector(`input[name="categories"][value="${category}"]`);
            if (checkbox) checkbox.checked = true;
          });
        }
      } else if (input.type === 'select-one') {
        input.value = playerData[key];
        // Update custom select display and highlight correct option
        const wrapper = input.nextSibling;
        if (wrapper && wrapper.classList && wrapper.classList.contains('custom-select-wrapper')) {
          const display = wrapper.querySelector('.custom-select-display');
          const opts = wrapper.querySelectorAll('.custom-option');
          if (display && input.options[input.selectedIndex]) {
            display.textContent = input.options[input.selectedIndex].text;
          }
          opts.forEach(opt => {
            opt.classList.toggle('selected', opt.getAttribute('data-value') === String(playerData[key]));
          });
        }
      } else {
        // text, number, date, hidden inputs
        if (key === 'centerName' && this.currentTeamName) {
          input.value = this.currentTeamName;
        } else {
          input.value = playerData[key];
        }
      }
    });

    // Re-derive ageCategory from DOB
    if (playerData.dob) {
      const age = CATEGORY_LOGIC.calculateAge(playerData.dob);
      const ageCategory = CATEGORY_LOGIC.getAgeCategory(age);

      const ageCategoryInput = document.getElementById('ageCategory');
      if (ageCategoryInput) ageCategoryInput.value = ageCategory;

      const playerCategoryInput = document.getElementById('playerCategory');
      if (playerCategoryInput) playerCategoryInput.value = ageCategory;

      const categoriesInput = document.querySelector('input[name="categories"]');
      if (categoriesInput) categoriesInput.value = ageCategory;

      ['ageCategory', 'playerCategory'].forEach(fieldId => {
        const badge = document.querySelector(`[data-category-field="${fieldId}"]`);
        if (badge) badge.innerHTML = `<span>${ageCategory}</span>`;
      });
    }

    // Show existing player photo in preview (file input itself cannot be set)
    if (playerData.playerImage) {
      this.currentImageURL = playerData.playerImage;
      const preview = document.getElementById('imagePreview');
      if (preview) {
        preview.style.cssText = 'width:100%;max-width:300px;height:auto;border:2px dashed #FFD700;border-radius:8px;display:flex;align-items:center;justify-content:center;margin:10px 0;background:#000;padding:10px;';
        preview.innerHTML = `<img src="${playerData.playerImage}" alt="Player Photo" style="max-width:100%;height:auto;object-fit:contain;display:block;border-radius:4px;">`;
      }
    }
  },

  // Render individual field
  renderField(field) {
    try {
      // Validate field object
      if (!field || !field.id) {
        console.warn("⚠️ Invalid field object:", field);
        return '';
      }

      // FORCE 'categories' field to always be hidden (regardless of config)
      if (field.id === 'categories') {
        return `<input type="hidden" id="categories" name="categories" value="">`;
      }

      // ageCategory and playerCategory: auto-calculated from DOB.
      // Always render as a visible read-only badge + hidden input — NEVER as a manual select.
      if (field.id === 'ageCategory' || field.id === 'playerCategory') {
        const label = field.id === 'ageCategory' ? 'Age Category' : 'Player Category';
        return `
          <div class="form-group" data-field-id="${field.id}">
            <label>${label} <span class="field-info" style="font-size:0.85em;color:#888;">(auto-calculated from date of birth)</span></label>
            <div class="category-badge" data-category-field="${field.id}" style="
              padding: 14px 18px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              border-radius: 8px;
              font-weight: 600;
              font-size: 1.2em;
              text-align: center;
              min-height: 50px;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 4px 8px rgba(102, 126, 234, 0.4);
              letter-spacing: 1px;
              text-transform: uppercase;
            ">
              <span>-- Enter date of birth --</span>
            </div>
            <input type="hidden" id="${field.id}" name="${field.id}" value="">
          </div>
        `;
      }

      // Skip other hidden fields
      if (field.type === 'hidden') {
        return `<input type="hidden" id="${field.id}" name="${field.id}" value="">`;
      }

      const requiredAttr = field.required ? 'required' : '';
      const readonlyAttr = field.readonly ? 'readonly' : '';

      let fieldHTML = `<div class="form-group" data-field-id="${field.id}">`;
      fieldHTML += `<label>${field.label || field.id}${field.required ? ' <span class="required">*</span>' : ''}`;
      if (field.info) {
        fieldHTML += ` <span class="field-info" style="font-size: 0.85em; color: #888;">${field.info}</span>`;
      }
      fieldHTML += `</label>`;

      // Safely handle field.options (might be undefined for some field types)
      const options = Array.isArray(field.options) ? field.options : [];

      switch (field.type) {
        case 'text':
          // Special handling for readonly category fields - render as badge/display
          if (field.readonly && (field.id === 'playerCategory' || field.id === 'ageCategory' || field.id === 'weightCategory')) {
            fieldHTML += `
              <div class="category-badge" data-category-field="${field.id}" style="
                padding: 14px 18px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border-radius: 8px;
                font-weight: 600;
                font-size: 1.2em;
                text-align: center;
                min-height: 50px;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 8px rgba(102, 126, 234, 0.4);
                letter-spacing: 1px;
                text-transform: uppercase;
              ">
                <span>-- Not calculated yet --</span>
              </div>
              <input type="hidden" id="${field.id}" name="${field.id}" value="">
            `;
          } else if (field.id === 'weight') {
            // Weight field: use text input with numeric pattern to preserve exact user input
            fieldHTML += `<input type="text" id="${field.id}" name="${field.id}" pattern="^\\d+(\\.\\d+)?$" placeholder="Enter weight (e.g., 60 or 61.5)" title="Please enter a valid weight (numbers and one decimal point only)" ${requiredAttr} ${readonlyAttr}>`;
          } else if (field.id === 'centerName') {
            // Force centerName to be readonly and prepopulated with the authoritative team name
            const teamName = this.currentTeamName || sessionStorage.getItem('teamName') || '';
            fieldHTML += `
              <input type="text" id="${field.id}" name="${field.id}" value="${teamName}" readonly style="background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.1); color: var(--text-gray); cursor: not-allowed;" title="Assigned automatically from your team account">
              <div style="font-size: 0.85em; color: var(--accent-cyan); margin-top: 6px;">Team name is automatically bound to your account to ensure correct fixture mapping.</div>
            `;
          } else {
            fieldHTML += `<input type="text" id="${field.id}" name="${field.id}" ${requiredAttr} ${readonlyAttr}>`;
          }
          break;

        case 'number':
          fieldHTML += `<input type="number" id="${field.id}" name="${field.id}" step="0.01" ${requiredAttr} ${readonlyAttr}>`;
          break;

        case 'date':
          fieldHTML += `<input type="date" id="${field.id}" name="${field.id}" ${requiredAttr}>`;
          break;

        case 'tel':
          fieldHTML += `<input type="tel" id="${field.id}" name="${field.id}" maxlength="10" pattern="\\d{10}" inputmode="numeric" placeholder="10-digit phone number" title="Phone number must be exactly 10 digits" ${requiredAttr}>`;
          break;

        case 'select':
          fieldHTML += `<select id="${field.id}" name="${field.id}" ${requiredAttr}>`;
          fieldHTML += `<option value="">-- Select ${field.label || field.id} --</option>`;
          options.forEach(opt => {
            fieldHTML += `<option value="${opt}">${opt}</option>`;
          });
          fieldHTML += `</select>`;
          break;

        case 'checkbox':
          fieldHTML += `<div class="checkbox-group">`;
          options.forEach(opt => {
            fieldHTML += `
              <label class="checkbox-label">
                <input type="checkbox" name="${field.id}" value="${opt}"> ${opt}
              </label>
            `;
          });
          fieldHTML += `</div>`;
          break;

        case 'checkbox-single':
          fieldHTML += `<div class="checkbox-group">`;
          options.forEach(opt => {
            fieldHTML += `
              <label class="checkbox-label">
                <input type="checkbox" id="${field.id}" name="${field.id}" value="${opt}"> ${opt}
              </label>
            `;
          });
          fieldHTML += `</div>`;
          break;

        case 'image':
          // When editing, file is not required — player already has an existing photo
          // NOTE: File is NOT marked as required in HTML because it's hidden.
          // Validation is done programmatically in submitForm() instead.
          fieldHTML += `
            <div style="display: flex; gap: 10px; margin-bottom: 15px;">
              <button type="button" class="btn-secondary" onclick="REGISTRATION.openCamera()" style="flex: 1;">📷 Capture Photo</button>
              <button type="button" class="btn-secondary" onclick="document.getElementById('${field.id}').click()" style="flex: 1;">📁 Upload Photo</button>
            </div>
            <input type="file" id="${field.id}" name="${field.id}" accept="image/*" onchange="REGISTRATION.handleFileSelect(event)" style="display: none;">
            <video id="cameraVideo" style="display: none; width: 100%; max-width: 500px; border-radius: 8px; margin: 10px 0;"></video>
            <canvas id="cameraCanvas" style="display: none;"></canvas>
            <button type="button" id="captureBtn" class="btn-primary" onclick="REGISTRATION.capturePhoto()" style="display: none; width: 100%; margin: 10px 0;">📸 Capture Photo</button>
            <div id="imagePreview" style="width: 100%; max-width: 300px; height: auto; border: 2px dashed #FFD700; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin: 10px 0; color: #666; overflow: visible; background: #000;">
              <span>Image preview will appear here</span>
            </div>
          `;
          break;

        default:
          console.warn("⚠️ Unknown field type:", field.type);
          fieldHTML += `<input type="text" id="${field.id}" name="${field.id}" ${requiredAttr} ${readonlyAttr}>`;
      }

      fieldHTML += '</div>';
      return fieldHTML;
    } catch (error) {
      console.error("❌ Error rendering field:", field, error);
      return '';
    }
  },

  // Setup event listeners
  setupEventListeners() {
    // Wait a bit longer to ensure form is fully rendered
    const setupListeners = () => {
      console.log('⏱️ Setting up event listeners... (delayed call)');

      const dobInput = document.getElementById('dob');
      const weightInput = document.getElementById('weight');
      const genderInput = document.getElementById('gender');

      console.log('🔍 Element check:');
      console.log('   DOB element:', !!dobInput, dobInput ? '(found)' : '(NOT FOUND!)');
      console.log('   Weight element:', !!weightInput, weightInput ? '(found)' : '(NOT FOUND!)');
      console.log('   Gender element:', !!genderInput, genderInput ? '(found)' : '(NOT FOUND!)');

      // Debug: log all input elements
      const allInputs = document.querySelectorAll('input[type="date"], input[type="number"], select');
      console.log('📊 All form inputs found:', allInputs.length);
      allInputs.forEach(input => {
        console.log(`   - ${input.id || input.name}: ${input.type}`);
      });

      // DOB change handler
      const handleDobChange = (e) => {
        console.log('📅 DOB changed:', e.target.value);
        const age = CATEGORY_LOGIC.calculateAge(e.target.value);
        const ageCategory = CATEGORY_LOGIC.getAgeCategory(age);

        console.log('📊 Calculated - Age:', age, 'AgeCategory:', ageCategory);

        // Update age input
        const ageInput = document.getElementById('age');
        if (ageInput) {
          ageInput.value = age;
          console.log('✅ Age input updated:', age);
        }

        // Update age category hidden input
        const ageCategoryInput = document.getElementById('ageCategory');
        if (ageCategoryInput) {
          ageCategoryInput.value = ageCategory;
          console.log('✅ Age category input updated:', ageCategory);

          // Update the display badge
          const ageCategoryBadge = document.querySelector('[data-category-field="ageCategory"]');
          if (ageCategoryBadge) {
            ageCategoryBadge.innerHTML = `<span>${ageCategory}</span>`;
            console.log('✅ Age category badge updated:', ageCategory);
          }
        } else {
          console.error('❌ Age category input not found!');
        }

        // Update player category (same as age category)
        const playerCategoryInput = document.getElementById('playerCategory');
        if (playerCategoryInput) {
          playerCategoryInput.value = ageCategory;
          console.log(`✅ Player category set to: ${ageCategory}`);

          // Update the display badge
          const playerCategoryBadge = document.querySelector('[data-category-field="playerCategory"]');
          if (playerCategoryBadge) {
            playerCategoryBadge.innerHTML = `<span>${ageCategory}</span>`;
            console.log('✅ Player category badge updated:', ageCategory);
          }
        }

        // Auto-set hidden categories field
        const categoriesInput = document.querySelector('input[name="categories"]');
        if (categoriesInput) {
          categoriesInput.value = ageCategory;
        }

        // Trigger weight category update
        this.updateWeightCategory();
      };

      if (dobInput) {
        dobInput.addEventListener('change', handleDobChange);
        console.log('✅ DOB listener attached');
      } else {
        console.error('❌ DOB input element not found in DOM! Cannot attach listener.');
      }

      // Weight change handler
      const handleWeightChange = (e) => {
        console.log('⚖️ Weight changed:', e.target.value);
        this.updateWeightCategory();
      };

      if (weightInput) {
        weightInput.addEventListener('input', handleWeightChange);
        weightInput.addEventListener('change', handleWeightChange);
        console.log('✅ Weight listener attached');
      } else {
        console.error('❌ Weight input element not found in DOM!');
      }

      // Gender change handler
      const handleGenderChange = (e) => {
        console.log('👥 Gender changed:', e.target.value);
        this.updateWeightCategory();
      };

      if (genderInput) {
        genderInput.addEventListener('change', handleGenderChange);
        console.log('✅ Gender listener attached');
      } else {
        console.error('❌ Gender input element not found in DOM!');
      }

      // Form submit
      const form = document.getElementById('registrationForm');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          this.submitForm();
        });
        console.log('✅ Form submit listener attached');
      }

      console.log('✅ Event listener setup complete');
    };

    // Use a longer timeout to ensure form is completely rendered
    console.log('⏱️ Scheduling event listener setup with 300ms delay...');
    setTimeout(setupListeners, 300);
  },

  // Update weight category based on gender, auto-calculated age category, and weight
  async updateWeightCategory() {
    try {
      const weightInput = document.getElementById('weight');
      const genderInput = document.getElementById('gender');
      const ageCategoryInput = document.getElementById('ageCategory');
      const weightCategoryInput = document.getElementById('weightCategory');

      // Log current state
      console.log('🔄 Updating weight category...');
      console.log('  Weight:', weightInput?.value);
      console.log('  Gender:', genderInput?.value);
      console.log('  Age Category:', ageCategoryInput?.value);

      // Get values
      const weight = weightInput ? parseFloat(weightInput.value) : null;
      const gender = genderInput ? genderInput.value : null;
      const ageCategory = ageCategoryInput ? ageCategoryInput.value : null;

      // If any required value is missing, clear the field
      if (!weightCategoryInput) {
        console.warn('⚠️ Weight category input not found in DOM');
        return;
      }

      if (!weight || !gender || !ageCategory) {
        console.warn('⚠️ Missing required data for weight category calculation');
        console.warn('  Weight:', weight, 'Gender:', gender, 'AgeCategory:', ageCategory);
        weightCategoryInput.value = '';
        // Clear the display badge as well
        const weightCategoryBadge = document.querySelector('[data-category-field="weightCategory"]');
        if (weightCategoryBadge) {
          weightCategoryBadge.innerHTML = '<span>-- Not calculated yet --</span>';
        }
        return;
      }

      // Check if CATEGORY_LOGIC is available
      if (typeof CATEGORY_LOGIC === 'undefined') {
        console.warn('⚠️ CATEGORY_LOGIC not loaded yet');
        weightCategoryInput.value = '';
        return;
      }

      console.log('📊 Calling CATEGORY_LOGIC.getWeightCategory...');
      // Pass ageCategory as array (as expected by getWeightCategory)
      const weightCategory = await CATEGORY_LOGIC.getWeightCategory(gender, [ageCategory], weight);

      console.log('📊 Weight category result:', weightCategory);

      // Always set the value, even if empty
      weightCategoryInput.value = weightCategory || '';

      // Update the display badge
      const weightCategoryBadge = document.querySelector('[data-category-field="weightCategory"]');
      if (weightCategoryBadge) {
        if (weightCategory && weightCategory !== 'Not Assigned' && weightCategory !== 'Error') {
          weightCategoryBadge.innerHTML = `<span>${weightCategory}</span>`;
          console.log(`✅ Weight category badge updated: ${weightCategory}`);
        } else {
          weightCategoryBadge.innerHTML = '<span>-- Not calculated yet --</span>';
          console.warn('⚠️ Weight category returned unexpected value:', weightCategory);
        }
      } else {
        console.warn('⚠️ Weight category badge element not found');
      }

    } catch (error) {
      console.error('❌ Error determining weight category:', error);
      const weightCategoryInput = document.getElementById('weightCategory');
      if (weightCategoryInput) {
        weightCategoryInput.value = '';
      }
      // Clear the display badge on error
      const weightCategoryBadge = document.querySelector('[data-category-field="weightCategory"]');
      if (weightCategoryBadge) {
        weightCategoryBadge.innerHTML = '<span>-- Error calculating --</span>';
      }
    }
  },

  async openCamera() {
    try {
      const video = document.getElementById('cameraVideo');
      const captureBtn = document.getElementById('captureBtn');

      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;
      video.style.display = 'block';
      captureBtn.style.display = 'block';
      video.play();
    } catch (error) {
      if (typeof MODAL !== 'undefined') {
        MODAL.error('Unable to access camera: ' + error.message);
      } else {
        alert('Unable to access camera: ' + error.message);
      }
    }
  },

  // Compress and optimize image using advanced image optimizer
  // Automatically targets ~50KB-80KB size while maintaining quality
  // Handles EXIF orientation, multiple formats, and adaptive quality
  async compressImage(file) {
    const result = await IMAGE_OPTIMIZER.optimizeImage(file);
    if (result.error) {
      console.error(result.error);
      // Fallback: return original file
      return { blob: file, dataUrl: await IMAGE_OPTIMIZER.fileToDataUrl(file) };
    }
    return { blob: result.blob, dataUrl: result.dataUrl };
  },

  capturePhoto() {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraCanvas');
    const preview = document.getElementById('imagePreview');

    const MAX = 400;
    let w = video.videoWidth, h = video.videoHeight;
    if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
    else { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);

    canvas.toBlob((blob) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        // Store original file - will be compressed during submission
        this.currentImageFile = new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' });
        this.currentImageURL = dataUrl;
        // Show full photo preview without compression
        preview.style.cssText = 'width:100%;max-width:300px;height:auto;border:2px dashed #FFD700;border-radius:8px;display:flex;align-items:center;justify-content:center;margin:10px 0;background:#000;padding:10px;';
        preview.innerHTML = `<img src="${dataUrl}" alt="Player Photo" style="max-width:100%;height:auto;object-fit:contain;display:block;border-radius:4px;">`;
      };
      reader.readAsDataURL(blob);
      // Stop camera
      const stream = video.srcObject;
      stream.getTracks().forEach(track => track.stop());
      video.style.display = 'none';
      document.getElementById('captureBtn').style.display = 'none';
    }, 'image/jpeg', 0.75);
  },

  // Handle file select — show original full image in preview, compression happens on submit
  handleFileSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      // Store original file - will be compressed during submission
      this.currentImageFile = file;
      
      // Show preview of original image (no compression)
      const reader = new FileReader();
      reader.onload = () => {
        this.currentImageURL = reader.result;
        const preview = document.getElementById('imagePreview');
        preview.style.cssText = 'width:100%;max-width:300px;height:auto;border:2px dashed #FFD700;border-radius:8px;display:flex;align-items:center;justify-content:center;margin:10px 0;background:#000;padding:10px;';
        preview.innerHTML = `<img src="${reader.result}" alt="Player Photo" style="max-width:100%;height:auto;object-fit:contain;display:block;border-radius:4px;">`;
      };
      reader.readAsDataURL(file);
    }
  },

  // Show registration closed message when deadline has passed or admin closed it
  showDeadlineClosed(championship, deadline, isHardClosed) {
    const title = championship?.title || 'TAEKWONDO CHAMPIONSHIP';

    let message = '';
    if (isHardClosed) {
      message = `Registration for <strong style="color: var(--text-white);">${title}</strong> has been <strong style="color: var(--accent-red);">closed by the administrator</strong>. Please contact the organizer to request access.`;
    } else {
      const formattedDate = deadline
        ? new Date(deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : 'the deadline';
      message = `The registration deadline for <strong style="color: var(--text-white);">${title}</strong> was <strong style="color: var(--accent-red);">${formattedDate}</strong>. No new players can be registered.`;
    }

    // Render championship header still so page looks right
    this.renderChampionshipHeader(championship);

    // Replace form with closed message
    const formContainer = document.getElementById('registrationForm');
    if (formContainer) {
      formContainer.innerHTML = `
        <div style="
          text-align: center;
          padding: 60px 40px;
          background: linear-gradient(135deg, rgba(255,23,68,0.1) 0%, rgba(26,26,46,0.95) 100%);
          border: 2px solid var(--accent-red);
          border-radius: var(--border-radius);
          box-shadow: 0 0 30px rgba(255,23,68,0.3);
        ">
          <div style="font-size: 4rem; margin-bottom: 20px;">🔒</div>
          <h2 style="color: var(--accent-red); margin-bottom: 16px;">Registration Closed</h2>
          <p style="font-size: 1.3rem; color: var(--text-gray); margin-bottom: 8px;">${message}</p>
          <p style="font-size: 1.1rem; color: var(--text-gray);">Please contact the organizer for assistance.</p>
        </div>
      `;
    }
    console.log('🔒 Registration closed for this team');
  },

  // Submit form
  async submitForm() {
    const submitBtn = document.getElementById('submitBtn');
    const originalText = submitBtn.textContent;

    try {
      // ────────────────────────────────────────────────────────────────────────
      // CRITICAL: Extract and validate the CURRENT authenticated user IMMEDIATELY
      // This prevents race conditions from concurrent registrations
      // ────────────────────────────────────────────────────────────────────────
      const currentTeamId = sessionStorage.getItem('teamId');
      const currentUserId = sessionStorage.getItem('userId');
      const currentUserRole = sessionStorage.getItem('userRole');
      
      if (currentUserRole !== 'team' || !currentTeamId || !currentUserId) {
        throw new Error('Session expired or invalid role. Please log in again.');
      }
      
      if (currentTeamId !== currentUserId) {
        throw new Error('❌ SECURITY: Team ID mismatch detected. Session may be compromised. Please log in again.');
      }
      
      console.log(`✅ SECURITY: Authenticated user=${currentUserId}, team=${currentTeamId}, role=${currentUserRole}`);
      // ────────────────────────────────────────────────────────────────────────

      // ── PER-TEAM SERVER-SIDE DEADLINE RE-VALIDATION ──────────────────────────
      // Re-fetch team data from Firebase using CURRENT authenticated team
      // to get the authoritative deadline/closed status.
      // This blocks API calls even if someone bypasses the UI.
      const teamSnap = await dbGet(dbRef(database, `teams/${currentTeamId}`));
      if (!teamSnap.exists()) {
        throw new Error('Team record not found. Session may be invalid.');
      }
      
      const teamData = teamSnap.val();
      
      // Verify this team record still exists and belongs to current user
      if (teamData.registrationClosed === true) {
        throw new Error('Registration has been closed by the administrator for your team.');
      }
      
      const teamDeadline = teamData.registrationDeadline;
      if (teamDeadline) {
        const deadlineDate = new Date(teamDeadline);
        if (!teamDeadline.includes('T')) {
          deadlineDate.setHours(23, 59, 59, 999);
        }
        if (new Date() > deadlineDate) {
          const formattedDate = new Date(teamDeadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
          throw new Error(`Registration closed. The deadline for your team was ${formattedDate}.`);
        }
      }
      console.log('✅ Team authorization verified:', teamData.teamName);
      // ────────────────────────────────────────────────────────────────────────

      // Validate image (required for new registrations, optional for edits)
      if (!this.currentImageFile && !this.editingPlayerId && !this.currentImageURL) {
        throw new Error('Please upload or capture a player image');
      }

      // Collect form data first
      const formData = this.collectFormData();

      // ── VALIDATE PHONE NUMBER: Must be exactly 10 digits ──────────────────────
      const phoneNumber = (formData.phoneNumber || '').replace(/\D/g, ''); // Remove non-digits
      if (!phoneNumber || phoneNumber.length !== 10) {
        throw new Error('Phone number must be exactly 10 digits.');
      }
      formData.phoneNumber = phoneNumber; // Store cleaned phone number
      // ────────────────────────────────────────────────────────────────────────

      // ── BACKEND VALIDATION: Re-derive ageCategory from DOB ──────────────────
      // This ensures the age category is ALWAYS computed from the date of birth,
      // regardless of what may be stored in any hidden input on the page.
      if (formData.dob) {
        const derivedAge = CATEGORY_LOGIC.calculateAge(formData.dob);
        const derivedAgeCategory = CATEGORY_LOGIC.getAgeCategory(derivedAge);
        formData.age = derivedAge;
        formData.ageCategory = derivedAgeCategory;
        formData.playerCategory = derivedAgeCategory;
        formData.categories = [derivedAgeCategory];
        console.log(`✅ Backend-validated: age=${derivedAge}, ageCategory=${derivedAgeCategory}`);
      } else {
        throw new Error('Date of Birth is required to determine age category.');
      }
      // ────────────────────────────────────────────────────────────────────────

      // Ensure categories is an array for display
      const categoriesDisplay = Array.isArray(formData.categories)
        ? formData.categories.join(', ')
        : (formData.ageCategory || 'Not assigned');

      // Show confirmation dialog BEFORE proceeding with submission
      const confirmMsg = this.editingPlayerId
        ? `✏️ Update Player Information?\n\nPlayer Name: ${formData.playerName}\nGender: ${formData.gender}\nWeight: ${formData.weight} kg\nAge Category: ${formData.ageCategory || 'Auto-calculated'}\n\nPlease review the information above before confirming.`
        : `📝 Confirm Player Registration?\n\nPlayer Name: ${formData.playerName}\nGender: ${formData.gender}\nWeight: ${formData.weight} kg\nAge Category: ${formData.ageCategory || 'Auto-calculated'}\n\nPlease review the information above before confirming.`;

      const confirmed = await MODAL.showConfirm(confirmMsg);

      // If user doesn't confirm, stop processing
      if (!confirmed) {
        console.log("❌ User cancelled the submission");
        return;
      }

      console.log("✅ User confirmed, proceeding with submission...");

      // NOW enable the button and disable it for processing
      submitBtn.disabled = true;
      submitBtn.textContent = this.editingPlayerId ? 'Updating player data...' : 'Saving player data...';

      // Add timeout to prevent infinite hang
      const timeout = setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        const timeoutMsg = '❌ Operation timed out. Please check:\n\n1. Internet connection\n2. Image upload (try smaller image)\n3. Firebase is accessible\n\nTry again or contact support.';
        if (typeof MODAL !== 'undefined') {
          MODAL.warning(timeoutMsg);
        } else {
          alert(timeoutMsg);
        }
      }, 30000); // 30 second timeout

      // Upload new image if one was selected (stored separately in playerImages/, not in player record)
      let _uploadedImageUrl = null;
      if (this.currentImageFile) {
        submitBtn.textContent = 'Uploading image...';
        _uploadedImageUrl = await this.uploadImage(this.currentImageFile);
      }

      // ────────────────────────────────────────────────────────────────────────
      // CRITICAL: SET TEAM DATA FROM AUTHENTICATED USER, NOT FROM FORM/SESSION
      // This ensures that even if two registrations run simultaneously,
      // each player is bound to the correct team at save time
      // ────────────────────────────────────────────────────────────────────────
      formData.teamId = currentTeamId;
      formData.centerName = teamData.teamName;    // Authoritative team name
      formData.teamName = teamData.teamName;      // Authoritative team name
      formData.submittedAt = new Date().toISOString();
      formData.submittedBy = currentUserId;
      
      console.log(`✅ SECURITY: Setting teamId=${currentTeamId}, teamName="${teamData.teamName}"`);
      console.log(`✅ SECURITY: Player ${formData.playerName} bound to team ${formData.teamName}`);
      // ────────────────────────────────────────────────────────────────────────

      // ── VALIDATE PLAYER TEAM BINDING BEFORE SAVE ──────────────────────────
      if (formData.teamId !== currentTeamId) {
        throw new Error('❌ SECURITY: Team binding mismatch. Player cannot be registered to a different team.');
      }
      if (!formData.teamName || formData.teamName !== teamData.teamName) {
        throw new Error('❌ SECURITY: Team name mismatch detected. Please try again.');
      }
      // ────────────────────────────────────────────────────────────────────────

      if (this.editingPlayerId) {
        // ── UPDATE: Verify player belongs to current team before updating ──
        const existingRef = dbRef(database, `players/${this.editingPlayerId}`);
        const existingSnapshot = await dbGet(existingRef);

        if (!existingSnapshot.exists()) {
          throw new Error('Player record not found.');
        }

        const existingData = existingSnapshot.val();
        
        // SECURITY: Ensure player being edited belongs to current logged-in team
        if (existingData.teamId !== currentTeamId) {
          throw new Error('❌ SECURITY: You can only edit players from your own team. This player belongs to another team.');
        }

        formData.status = existingData.status; // Keep existing status
        // playerImage is stored in playerImages/ — never include in player record

        // Sanitize before saving
        Object.keys(formData).forEach(key => {
          if (formData[key] === undefined) delete formData[key];
        });
        delete formData.playerImage; // Ensure image is never written into the player record

        const playerRef = dbRef(database, `players/${this.editingPlayerId}`);
        await dbSet(playerRef, formData);

        // Persist image to playerImages/ path (new image or migrate legacy record)
        const imgRef = dbRef(database, `playerImages/${this.editingPlayerId}`);
        if (_uploadedImageUrl) {
          await dbSet(imgRef, _uploadedImageUrl);
        } else if (existingData.playerImage) {
          // Migrate: move image out of player record into dedicated path
          await dbSet(imgRef, existingData.playerImage);
        }

        clearTimeout(timeout);
        const updateMsg = '✅ Player information updated successfully!';
        if (typeof MODAL !== 'undefined') {
          MODAL.success(updateMsg);
        } else {
          alert(updateMsg);
        }
      } else {
        // ── CREATE: New player - bind to current authenticated team ──
        formData.status = 'pending';
        delete formData.playerImage; // Ensure image is never written into the player record

        const playersRef = dbRef(database, 'players');
        const newPlayerRef = dbPush(playersRef);

        console.log(`✅ SECURITY: Creating new player ${newPlayerRef.key} for team ${currentTeamId}`);

        // Sanitize before saving
        Object.keys(formData).forEach(key => {
          if (formData[key] === undefined) delete formData[key];
        });

        await dbSet(newPlayerRef, formData);

        // Write image to dedicated playerImages/ path (keeps player record image-free)
        if (_uploadedImageUrl) {
          await dbSet(dbRef(database, `playerImages/${newPlayerRef.key}`), _uploadedImageUrl);
        }

        clearTimeout(timeout);

        const regMsg = '✅ Player registered successfully!';
        if (typeof MODAL !== 'undefined') {
          MODAL.success(regMsg);
        } else {
          alert(regMsg);
        }
      }

      // Redirect to team dashboard
      setTimeout(() => {
        window.location.href = window.location.origin + '/team/dashboard.html';
      }, 1000);

    } catch (error) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      console.error('❌ Operation error:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);

      let errorMsg = error.message;

      if (error.message && error.message.includes('PERMISSION_DENIED')) {
        errorMsg = 'Database permission error.\n\n❌ This means Firebase security rules may be blocking the write.\n\n✅ Possible fixes:\n- Make sure rules are published\n- Log out and back in\n- Check that your user role is set\n\nCheck console (F12) for detailed error.';
      } else if (error.code === 'storage/unauthenticated') {
        errorMsg = 'Authentication error. Please log out and back in.';
      } else if (error.code === 'storage/unauthorized') {
        errorMsg = 'You do not have permission. Please contact admin.';
      }

      if (typeof MODAL !== 'undefined') {
        MODAL.error(`Operation Failed:\n\n${errorMsg}`);
      } else {
        alert(`❌ Operation Failed:\n\n${errorMsg}`);
      }
    }
  },

  // Collect form data
  collectFormData() {
    const data = {};

    // Collect text, number, date inputs, hidden inputs, and selects
    const inputs = document.querySelectorAll('#registrationForm input[type="text"], #registrationForm input[type="number"], #registrationForm input[type="date"], #registrationForm input[type="hidden"], #registrationForm select');
    inputs.forEach(input => {
      if (input.name && input.value) {
        data[input.name] = input.value;
        console.log(`📝 Collected ${input.name}: ${input.value}`);
      }
    });

    // Explicitly check for hidden categories field if not already collected
    if (!data.categories) {
      const categoriesInput = document.querySelector('input[name="categories"]');
      if (categoriesInput && categoriesInput.value) {
        data.categories = [categoriesInput.value];
        console.log(`📝 Collected hidden categories: ${categoriesInput.value}`);
      }
    } else if (typeof data.categories === 'string') {
      // Convert categories string to array (from hidden input)
      data.categories = [data.categories];
    }

    // Ensure ageCategory is set from either ageCategory field or categories array
    if (!data.ageCategory) {
      if (data.categories && Array.isArray(data.categories) && data.categories[0]) {
        data.ageCategory = data.categories[0];
        console.log(`📝 Set ageCategory from categories: ${data.ageCategory}`);
      }
    }

    // Phone number
    const phoneInput = document.getElementById('phoneNumber');
    data.phoneNumber = phoneInput ? phoneInput.value : '';

    console.log('✅ Final collected data:', data);
    return data;
  },

  // Convert image to compressed base64 (no Firebase Storage needed - FREE!)
  async uploadImage(file) {
    const { dataUrl } = await this.compressImage(file);
    return dataUrl;
  }
};

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('registrationForm')) {
    REGISTRATION.init();
  }
});
window.REGISTRATION = REGISTRATION;