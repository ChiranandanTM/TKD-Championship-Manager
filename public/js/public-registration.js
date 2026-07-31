// ============================================
// PUBLIC PLAYER REGISTRATION FORM LOGIC
// For standalone registration without authentication
// ============================================

// Fixed Poomsae registration options. Independent of the admin-configurable
// formConfig fields — always rendered, always collected, regardless of what
// dynamic fields the admin has set up. Not a Kyorugi field: never affects
// competitionCategory/players-expoPlayers routing.
const POOMSAE_CATEGORY_OPTIONS = [
  'Official Individual', 'Expo Individual',
  'Official Pair', 'Expo Pair',
  'Official Group', 'Expo Group',
  'Official Mixed Group', 'Expo Mixed Group',
  'Official Freestyle', 'Expo Freestyle'
];

const PUBLIC_REGISTRATION = {
  currentImageFile: null,
  currentImageURL: null,
  selectedTeamId: null,
  selectedTeamName: null,
  allTeams: {},
  currentCameraStream: null,
  registrationClosed: false,
  registrationClosedMessage: '',
  isSubmitting: false, // Prevent double submissions
  submissionTimestamp: null, // Track submission time for deduplication

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

    console.log('✅ PUBLIC_REGISTRATION: Initializing public registration page (no auth required)');

    // Load teams from Firebase (readable by all)
    await this.loadTeams();

    // Load form configuration
    await this.loadFormStructure();

    setTimeout(() => {
      this.setupEventListeners();
    }, 200);
  },

  // Load all teams created by admins
  async loadTeams() {
    try {
      const teamsRef = dbRef(database, 'teams');
      const snapshot = await dbGet(teamsRef);

      if (snapshot.exists()) {
        this.allTeams = snapshot.val();
        console.log('✅ Teams loaded:', Object.keys(this.allTeams).length, 'teams found');
      } else {
        console.warn('⚠️ No teams found in database');
        this.allTeams = {};
      }
    } catch (error) {
      console.error('❌ Error loading teams:', error);
      if (typeof MODAL !== 'undefined') {
        MODAL.error('Could not load team list. Please refresh the page.');
      }
    }
  },

  // Check if registration is closed for a selected team
  checkTeamRegistrationStatus(teamId) {
    try {
      if (!teamId || !this.allTeams[teamId]) {
        this.registrationClosed = false;
        this.registrationClosedMessage = '';
        return false;
      }

      const teamData = this.allTeams[teamId];
      
      // Check if admin closed registration for this team
      if (teamData.registrationClosed === true) {
        this.registrationClosed = true;
        this.registrationClosedMessage = `❌ Registration has been closed for ${teamData.teamName} by the administrator.`;
        console.warn('⚠️ Registration closed for team:', teamData.teamName);
        return true;
      }

      // Check if registration deadline has passed
      if (teamData.registrationDeadline) {
        const deadlineDate = new Date(teamData.registrationDeadline);
        if (!teamData.registrationDeadline.includes('T')) {
          deadlineDate.setHours(23, 59, 59, 999);
        }
        
        if (new Date() > deadlineDate) {
          this.registrationClosed = true;
          const formattedDate = deadlineDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
          this.registrationClosedMessage = `❌ Registration deadline for ${teamData.teamName} has passed (Deadline: ${formattedDate})`;
          console.warn('⚠️ Registration deadline passed for team:', teamData.teamName);
          return true;
        }
      }

      // Registration is open
      this.registrationClosed = false;
      this.registrationClosedMessage = '';
      console.log('✅ Registration is open for team:', teamData.teamName);
      return false;
    } catch (error) {
      console.error('❌ Error checking registration status:', error);
      return false;
    }
  },

  // Update UI to show/hide registration closed warning
  updateRegistrationStatusUI() {
    try {
      const warningContainer = document.getElementById('registrationClosedWarning');
      const formContainer = document.getElementById('registrationForm');
      const submitBtn = document.getElementById('submitBtn');
      
      if (this.registrationClosed) {
        // Extract team name from message
        let teamName = this.selectedTeamName || 'Championship';
        
        // Hide the form completely
        if (formContainer) {
          formContainer.style.display = 'none';
        }
        
        // Show professional closed message
        if (warningContainer) {
          warningContainer.innerHTML = `
            <div style="
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              padding: 60px 30px;
              background: linear-gradient(135deg, rgba(139, 0, 0, 0.1) 0%, rgba(200, 0, 0, 0.05) 100%);
              border: 2px solid #ff6b6b;
              border-radius: 12px;
              margin: 30px 0;
              text-align: center;
              min-height: 400px;
            ">
              <div style="font-size: 64px; margin-bottom: 20px;">🔒</div>
              <h1 style="color: #ff6b6b; font-size: 2.5em; margin: 20px 0; font-weight: bold;">REGISTRATION CLOSED</h1>
              <div style="width: 100%; height: 3px; background: linear-gradient(90deg, #FFD700, #ff6b6b, #FFD700); margin: 20px 0; border-radius: 2px;"></div>
              <p style="font-size: 1.1em; color: #fff; margin: 20px 0; line-height: 1.6; max-width: 600px;">
                Registration for <strong style="color: #FFD700;">${teamName}</strong> has been <strong style="color: #ff6b6b;">closed by the administrator</strong>. Please contact the organizer to request access.
              </p>
              <p style="font-size: 1em; color: #ccc; margin-top: 30px;">Please contact the organizer for assistance.</p>
            </div>
          `;
          warningContainer.style.display = 'block';
        }
        
        // Disable submit button
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.style.opacity = '0.5';
          submitBtn.style.cursor = 'not-allowed';
        }
      } else {
        // Show form and hide warning
        if (formContainer) {
          formContainer.style.display = 'block';
        }
        
        if (warningContainer) {
          warningContainer.innerHTML = '';
          warningContainer.style.display = 'none';
        }
        
        // Enable submit button
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
          submitBtn.style.cursor = 'pointer';
        }
      }
    } catch (error) {
      console.error('❌ Error updating registration status UI:', error);
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

      // Render championship header
      this.renderChampionshipHeader(config.championship);

      // Render form fields (modified for public use)
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

      console.log("📊 Championship data received:", championship);

      // Get values with defaults
      let title = championship?.title || 'TAEKWONDO CHAMPIONSHIP';
      let venue = championship?.venue || 'National Sports Complex';
      let address = championship?.address || 'Location TBD';
      let organizer = championship?.organizer || 'Karnataka Taekwondo Association';

      // Clean up string values
      venue = (venue && venue !== 'TBD' && venue.trim()) || 'Venue TBD';
      address = (address && address !== 'TBD' && address.trim()) || 'Location TBD';
      organizer = (organizer && organizer !== 'TBD' && organizer.trim()) || 'Karnataka Taekwondo Association';

      // Safely parse date
      let dateString = 'Date TBD';
      try {
        if (championship?.date && championship.date !== 'TBD') {
          const dateObj = new Date(championship.date);
          if (!isNaN(dateObj.getTime())) {
            dateString = `Date: ${dateObj.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}`;
          }
        }
      } catch (dateError) {
        console.warn("⚠️ Error parsing championship date:", dateError);
      }

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

  // Render form fields dynamically (modified for public registration)
  renderFormFields(fields) {
    try {
      if (!Array.isArray(fields) || fields.length === 0) {
        console.error("❌ Fields array is empty or invalid");
        const formContainer = document.getElementById('registrationForm');
        if (formContainer) {
          formContainer.innerHTML = '<div class="error">Error: Form fields not configured properly</div>';
        }
        return;
      }

      const formContainer = document.getElementById('registrationForm');

      if (!formContainer) {
        console.error("❌ Form container not found");
        return;
      }

      console.log('📋 Rendering fields for public registration');

      let formHTML = '';

      // 🔥 PRIORITY: Render centerName field FIRST (team selection)
      const centerNameField = fields.find(f => f.id === 'centerName');
      if (centerNameField) {
        formHTML += this.renderField(centerNameField);
        console.log('✅ Center Name (team selection) rendered first');
      }

      // Then render all other fields in order (excluding centerName)
      const sortedFields = [...fields]
        .filter(f => f.id !== 'centerName') // Exclude centerName since we already rendered it
        .sort((a, b) => (a.order || 0) - (b.order || 0));

      sortedFields.forEach(field => {
        try {
          formHTML += this.renderField(field);
        } catch (fieldError) {
          console.error("❌ Error rendering field:", field.id, fieldError);
        }
      });

      formHTML += this.renderPoomsaeSection();

      formHTML += `
        <div class="form-group">
          <button type="submit" id="submitBtn" class="submit-btn">Register Player</button>
        </div>
      `;

      formContainer.innerHTML = formHTML;
      console.log('✅ Form HTML injected into DOM');

      // Initialize custom selects for dropdowns
      if (typeof initializeCustomSelects === 'function') {
        initializeCustomSelects();
      }
    } catch (error) {
      console.error("❌ Error rendering form fields:", error);
      const formContainer = document.getElementById('registrationForm');
      if (formContainer) {
        formContainer.innerHTML = `<div class="error">Error rendering form: ${error.message}</div>`;
      }
    }
  },

  // Render individual form field (modified to show team dropdown for centerName)
  renderField(field) {
    try {
      if (!field || !field.id) {
        console.warn("⚠️ Invalid field object:", field);
        return '';
      }

      // FORCE 'categories' field to always be hidden
      if (field.id === 'categories') {
        return `<input type="hidden" id="categories" name="categories" value="">`;
      }

      // ageCategory and playerCategory: auto-calculated from DOB
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

      const options = Array.isArray(field.options) ? field.options : [];

      switch (field.type) {
        case 'text':
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
            // Weight field: use text input with numeric pattern
            fieldHTML += `<input type="text" id="${field.id}" name="${field.id}" pattern="^\\d+(\\.\\d+)?$" placeholder="Enter weight (e.g., 60 or 61.5)" title="Please enter a valid weight (numbers and one decimal point only)" ${requiredAttr} ${readonlyAttr}>`;
          } else if (field.id === 'centerName') {
            // ▼▼▼ MODIFIED FOR PUBLIC REGISTRATION: centerName is now a dropdown of teams ▼▼▼
            fieldHTML += `<select id="${field.id}" name="${field.id}" class="team-select" ${requiredAttr}>`;
            fieldHTML += `<option value="">-- Select your team/center --</option>`;
            
            // Populate teams from database
            Object.entries(this.allTeams).forEach(([teamId, teamData]) => {
              const teamName = teamData.teamName || teamData.name || 'Unnamed Team';
              fieldHTML += `<option value="${teamId}" data-team-name="${teamName}">${teamName}</option>`;
            });
            fieldHTML += `</select>`;
            fieldHTML += `<div style="font-size: 0.85em; color: var(--accent-cyan); margin-top: 6px;">Select your team/center from the list. Only teams created by admins are shown.</div>`;
            // ▲▲▲ END MODIFICATION ▲▲▲
          } else {
            fieldHTML += `<input type="text" id="${field.id}" name="${field.id}" ${requiredAttr} ${readonlyAttr}>`;
          }
          break;

        case 'number':
          fieldHTML += `<input type="number" id="${field.id}" name="${field.id}" step="0.01" ${requiredAttr} ${readonlyAttr}>`;
          break;

        case 'date':
          fieldHTML += `
            <div class="dob-field-wrapper">
              <input type="date" id="${field.id}" name="${field.id}" class="dob-date-input" readonly max="${new Date().toISOString().split('T')[0]}" min="1900-01-01" ${requiredAttr}>
              <button type="button" class="dob-calendar-trigger" data-target="${field.id}" aria-label="Open calendar">📅</button>
            </div>
          `;
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
          fieldHTML += `
            <div style="display: flex; gap: 10px; margin-bottom: 15px;">
              <button type="button" class="btn-secondary" onclick="PUBLIC_REGISTRATION.openCamera()" style="flex: 1;">📷 Capture Photo</button>
              <button type="button" class="btn-secondary" onclick="document.getElementById('${field.id}').click()" style="flex: 1;">📁 Upload Photo</button>
            </div>
            <input type="file" id="${field.id}" name="${field.id}" accept="image/*" onchange="PUBLIC_REGISTRATION.handleFileSelect(event)" style="display: none;">
            <div id="cameraContainer" style="display: none; width: 100%; margin: 15px 0; text-align: center;">
              <video id="cameraVideo" autoplay playsinline muted style="width: 100%; max-width: 500px; height: auto; border-radius: 8px; background: #000; display: block; margin: 0 auto;"></video>
            </div>
            <canvas id="cameraCanvas" style="display: none;"></canvas>
            <button type="button" id="captureBtn" class="btn-primary" onclick="PUBLIC_REGISTRATION.capturePhoto()" style="display: none; width: 100%; margin: 10px 0;">📸 Capture Photo</button>
            <button type="button" id="stopCameraBtn" class="btn-secondary" onclick="PUBLIC_REGISTRATION.stopCamera()" style="display: none; width: 100%; margin: 10px 0;">❌ Close Camera</button>
            <div id="imagePreview" style="width: 100%; max-width: 300px; height: auto; border: 2px dashed #FFD700; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin: 10px 0; color: #666; overflow: visible;">
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

  // Render the fixed Poomsae Registration section (not part of the dynamic
  // formConfig fields). Purely additive — a player with no boxes checked is
  // treated as Kyorugi-only, matching pre-feature behavior.
  renderPoomsaeSection() {
    let html = `<div class="form-group" data-field-id="poomsaeCategories">`;
    html += `<label>Poomsae Registration <span class="field-info" style="font-size: 0.85em; color: #888;">(optional — leave unchecked if this player is Kyorugi-only)</span></label>`;
    html += `<div class="checkbox-group">`;
    POOMSAE_CATEGORY_OPTIONS.forEach(opt => {
      html += `
        <label class="checkbox-label">
          <input type="checkbox" name="poomsaeCategories" value="${opt}"> ${opt}
        </label>
      `;
    });
    html += `</div></div>`;
    return html;
  },

  // Setup event listeners
  setupEventListeners() {
    console.log('⏱️ Setting up event listeners for public registration...');

    const dobInput = document.getElementById('dob');
    const weightInput = document.getElementById('weight');
    const genderInput = document.getElementById('gender');
    const teamSelect = document.getElementById('centerName');

    // Team selection handler
    const handleTeamChange = (e) => {
      this.selectedTeamId = e.target.value;
      const selectedOption = e.target.options[e.target.selectedIndex];
      this.selectedTeamName = selectedOption.getAttribute('data-team-name') || e.target.value;
      console.log('🏢 Team selected:', this.selectedTeamName, '(ID:', this.selectedTeamId + ')');
      
      // Check if registration is closed for this team
      this.checkTeamRegistrationStatus(this.selectedTeamId);
      this.updateRegistrationStatusUI();
    };

    if (teamSelect) {
      teamSelect.addEventListener('change', handleTeamChange);
      console.log('✅ Team select listener attached');
    }

    // DOB change handler
    const handleDobChange = (e) => {
      console.log('📅 DOB changed:', e.target.value);
      const age = CATEGORY_LOGIC.calculateAge(e.target.value);
      const ageCategory = CATEGORY_LOGIC.getAgeCategory(age);

      // Update age input
      const ageInput = document.getElementById('age');
      if (ageInput) {
        ageInput.value = age;
      }

      // Update age category hidden input
      const ageCategoryInput = document.getElementById('ageCategory');
      if (ageCategoryInput) {
        ageCategoryInput.value = ageCategory;
        const ageCategoryBadge = document.querySelector('[data-category-field="ageCategory"]');
        if (ageCategoryBadge) {
          ageCategoryBadge.innerHTML = `<span>${ageCategory}</span>`;
        }
      }

      // Update player category
      const playerCategoryInput = document.getElementById('playerCategory');
      if (playerCategoryInput) {
        playerCategoryInput.value = ageCategory;
        const playerCategoryBadge = document.querySelector('[data-category-field="playerCategory"]');
        if (playerCategoryBadge) {
          playerCategoryBadge.innerHTML = `<span>${ageCategory}</span>`;
        }
      }

      // Auto-set hidden categories field
      const categoriesInput = document.querySelector('input[name="categories"]');
      if (categoriesInput) {
        categoriesInput.value = ageCategory;
      }

      this.updateWeightCategory();
    };

    if (dobInput) {
      dobInput.addEventListener('change', handleDobChange);
      console.log('✅ DOB listener attached');
      if (window.DOB_PICKER) window.DOB_PICKER.attach(dobInput);
    }

    // Weight change handler
    const handleWeightChange = (e) => {
      this.updateWeightCategory();
    };

    if (weightInput) {
      weightInput.addEventListener('input', handleWeightChange);
      weightInput.addEventListener('change', handleWeightChange);
      console.log('✅ Weight listener attached');
    }

    // Gender change handler
    const handleGenderChange = (e) => {
      this.updateWeightCategory();
    };

    if (genderInput) {
      genderInput.addEventListener('change', handleGenderChange);
      console.log('✅ Gender listener attached');
    }

    // Form submit
    const form = document.getElementById('registrationForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitForm();
      });
      console.log('✅ Form submit listener attached');

      // Poomsae checkboxes toggle whether Weight/Competition Category are required
      form.addEventListener('change', (e) => {
        if (e.target && e.target.name === 'poomsaeCategories') this.updateKyorugiFieldRequirements();
      });
    }
    this.updateKyorugiFieldRequirements();

    console.log('✅ Event listener setup complete');
  },

  // Weight and Competition Category are Kyorugi-specific — a player who has
  // selected at least one Poomsae category (and only wants Poomsae) should
  // be able to submit without them. Kyorugi-only/mixed registrations keep
  // the original required behavior unchanged.
  updateKyorugiFieldRequirements() {
    const anyPoomsaeChecked = document.querySelectorAll('#registrationForm input[name="poomsaeCategories"]:checked').length > 0;
    const weightInput = document.getElementById('weight');
    const competitionCategoryInput = document.getElementById('competitionCategory');
    if (weightInput) weightInput.required = !anyPoomsaeChecked;
    if (competitionCategoryInput) competitionCategoryInput.required = !anyPoomsaeChecked;
  },

  // Update weight category
  async updateWeightCategory() {
    try {
      const weightInput = document.getElementById('weight');
      const genderInput = document.getElementById('gender');
      const ageCategoryInput = document.getElementById('ageCategory');
      const weightCategoryInput = document.getElementById('weightCategory');

      const weight = weightInput ? parseFloat(weightInput.value) : null;
      const gender = genderInput ? genderInput.value : null;
      const ageCategory = ageCategoryInput ? ageCategoryInput.value : null;

      if (!weightCategoryInput) {
        return;
      }

      if (!weight || !gender || !ageCategory) {
        weightCategoryInput.value = '';
        const weightCategoryBadge = document.querySelector('[data-category-field="weightCategory"]');
        if (weightCategoryBadge) {
          weightCategoryBadge.innerHTML = '<span>-- Not calculated yet --</span>';
        }
        return;
      }

      if (typeof CATEGORY_LOGIC === 'undefined') {
        return;
      }

      const weightCategory = await CATEGORY_LOGIC.getWeightCategory(gender, [ageCategory], weight);
      weightCategoryInput.value = weightCategory || '';

      // Update display badge
      const weightCategoryBadge = document.querySelector('[data-category-field="weightCategory"]');
      if (weightCategoryBadge) {
        weightCategoryBadge.innerHTML = `<span>${weightCategory || '-- Not calculated yet --'}</span>`;
      }
    } catch (error) {
      console.error('❌ Error updating weight category:', error);
    }
  },

  // Camera methods
  async openCamera() {
    const video = document.getElementById('cameraVideo');
    const container = document.getElementById('cameraContainer');
    const captureBtn = document.getElementById('captureBtn');
    const stopBtn = document.getElementById('stopCameraBtn');
    
    try {
      console.log('📷 Requesting camera access...');
      
      const constraints = {
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('✅ Camera stream obtained');
      
      video.srcObject = stream;
      container.style.display = 'block';
      captureBtn.style.display = 'block';
      stopBtn.style.display = 'block';
      
      // Store stream reference for later stopping
      this.currentCameraStream = stream;
      
      console.log('✅ Camera display enabled');
    } catch (error) {
      console.error('❌ Camera error:', error);
      let errorMsg = 'Could not access camera. ';
      
      if (error.name === 'NotAllowedError') {
        errorMsg += 'Camera permission was denied. Please grant camera permission in your browser settings.';
      } else if (error.name === 'NotFoundError') {
        errorMsg += 'No camera device found.';
      } else if (error.name === 'NotReadableError') {
        errorMsg += 'Camera is already in use by another application.';
      } else {
        errorMsg += error.message || 'Please use file upload instead.';
      }
      
      console.warn('⚠️ ' + errorMsg);
      
      if (typeof MODAL !== 'undefined') {
        MODAL.error(errorMsg + '\n\nPlease use the "Upload Photo" option instead.');
      } else {
        alert(errorMsg + '\n\nPlease use the "Upload Photo" option instead.');
      }
    }
  },

  // Stop camera and release stream
  stopCamera() {
    if (this.currentCameraStream) {
      this.currentCameraStream.getTracks().forEach(track => track.stop());
      this.currentCameraStream = null;
    }
    
    const container = document.getElementById('cameraContainer');
    const captureBtn = document.getElementById('captureBtn');
    const stopBtn = document.getElementById('stopCameraBtn');
    
    container.style.display = 'none';
    captureBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    
    console.log('✅ Camera stopped');
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

    try {
      const MAX = 400;
      let w = video.videoWidth, h = video.videoHeight;
      
      if (w === 0 || h === 0) {
        console.warn('⚠️ Video dimensions not ready yet');
        alert('Camera is still loading. Please wait a moment and try again.');
        return;
      }
      
      if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
      else { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
      
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);

      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          // Store original file - will be compressed during submission
          this.currentImageFile = new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' });
          this.currentImageURL = dataUrl;
          preview.style.cssText = 'width:100%;max-width:300px;height:auto;border:2px dashed #FFD700;border-radius:8px;display:flex;align-items:center;justify-content:center;margin:10px 0;background:#000;padding:10px;';
          preview.innerHTML = `<img src="${dataUrl}" alt="Player Photo" style="max-width:100%;height:auto;object-fit:contain;display:block;border-radius:4px;">`;
          console.log('✅ Photo captured successfully');
        };
        reader.readAsDataURL(blob);
        
        // Stop camera after capturing
        this.stopCamera();
      }, 'image/jpeg', 0.75);
    } catch (error) {
      console.error('❌ Error capturing photo:', error);
      alert('Error capturing photo. Please try again.');
    }
  },

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

  // Collect form data
  collectFormData() {
    const data = {};

    const inputs = document.querySelectorAll('#registrationForm input[type="text"], #registrationForm input[type="number"], #registrationForm input[type="date"], #registrationForm input[type="hidden"], #registrationForm select');
    inputs.forEach(input => {
      if (input.name && input.value) {
        data[input.name] = input.value;
      }
    });

    // Handle categories
    if (!data.categories) {
      const categoriesInput = document.querySelector('input[name="categories"]');
      if (categoriesInput && categoriesInput.value) {
        data.categories = [categoriesInput.value];
      }
    } else if (typeof data.categories === 'string') {
      data.categories = [data.categories];
    }

    // Ensure ageCategory is set
    if (!data.ageCategory) {
      if (data.categories && Array.isArray(data.categories) && data.categories[0]) {
        data.ageCategory = data.categories[0];
      }
    }

    // Phone number
    const phoneInput = document.getElementById('phoneNumber');
    data.phoneNumber = phoneInput ? phoneInput.value : '';

    // Poomsae Registration checkboxes (independent of Kyorugi fields above).
    // Empty selection = Kyorugi-only player, stored as an empty array.
    const poomsaeChecked = document.querySelectorAll('#registrationForm input[name="poomsaeCategories"]:checked');
    data.poomsaeCategories = Array.from(poomsaeChecked).map(cb => cb.value);

    console.log('✅ Form data collected:', data);
    return data;
  },

  // Upload image to base64
  async uploadImage(file) {
    const { dataUrl } = await this.compressImage(file);
    return dataUrl;
  },

  // Submit form with concurrent safety
  async submitForm() {
    const submitBtn = document.getElementById('submitBtn');
    const originalText = submitBtn.textContent;

    try {
      // ═══════════════════════════════════════════════════════════════════════════
      // CONCURRENCY PROTECTION: Prevent double submissions
      // ═══════════════════════════════════════════════════════════════════════════
      if (this.isSubmitting) {
        console.warn('⚠️ CONCURRENCY: Submission already in progress. Ignoring duplicate request.');
        throw new Error('Registration already in progress. Please wait...');
      }

      this.isSubmitting = true;
      this.submissionTimestamp = new Date().getTime();
      console.log(`🔒 CONCURRENCY LOCK: Registration started at ${new Date(this.submissionTimestamp).toISOString()}`);
      // ═══════════════════════════════════════════════════════════════════════════

      // ═══════════════════════════════════════════════════════════════════════════
      // CRITICAL: PRE-SUBMISSION VALIDATION (before any async operations)
      // ═══════════════════════════════════════════════════════════════════════════
      
      // 1. Validate team selection exists
      if (!this.selectedTeamId || !this.selectedTeamName) {
        throw new Error('❌ Team Selection Error: Please select a team/center from the dropdown.');
      }

      // 2. Validate image provided
      if (!this.currentImageFile && !this.currentImageURL) {
        throw new Error('❌ Photo Required: Please upload or capture a player image');
      }

      // 3. Check registration not closed
      this.checkTeamRegistrationStatus(this.selectedTeamId);
      if (this.registrationClosed) {
        throw new Error(this.registrationClosedMessage);
      }

      console.log('✅ Pre-submission validations passed');
      // ═══════════════════════════════════════════════════════════════════════════

      // ═══════════════════════════════════════════════════════════════════════════
      // TEAM RE-VALIDATION: Verify selected team exists in database RIGHT NOW
      // This prevents team deletion race conditions
      // ═══════════════════════════════════════════════════════════════════════════
      console.log(`🔍 TEAM VALIDATION: Re-verifying team ${this.selectedTeamId} exists in database...`);
      const teamVerificationRef = dbRef(database, `teams/${this.selectedTeamId}`);
      const teamVerificationSnap = await dbGet(teamVerificationRef);

      if (!teamVerificationSnap.exists()) {
        console.error(`❌ TEAM VALIDATION FAILED: Team ${this.selectedTeamId} not found in database`);
        throw new Error('❌ Team Not Found: The selected team no longer exists in the system. Please select another team.');
      }

      const verifiedTeamData = teamVerificationSnap.val();
      const verifiedTeamName = verifiedTeamData.teamName || verifiedTeamData.name;

      // Verify team name matches (prevents team ID mismatch attacks)
      if (verifiedTeamName !== this.selectedTeamName) {
        console.warn(`⚠️ TEAM MISMATCH: Expected "${this.selectedTeamName}", got "${verifiedTeamName}"`);
        throw new Error('❌ Team Mismatch Error: Team name does not match. Please select the team again.');
      }

      // Re-check if registration closed during validation
      if (verifiedTeamData.registrationClosed === true) {
        console.warn(`⚠️ RACE CONDITION: Registration closed for team ${this.selectedTeamId} during submission`);
        throw new Error(`❌ Registration Closed: ${verifiedTeamName} registration has been closed by administrator.`);
      }

      console.log(`✅ TEAM VALIDATED: ${verifiedTeamName} (ID: ${this.selectedTeamId}) exists and is accepting registrations`);
      // ═══════════════════════════════════════════════════════════════════════════

      // Collect and validate form data
      const formData = this.collectFormData();

      // Validate all required form fields
      if (!formData.playerName || !formData.playerName.trim()) {
        throw new Error('❌ Player Name: Required field is empty');
      }
      if (!formData.dob) {
        throw new Error('❌ Date of Birth: Required field is empty');
      }
      if (!formData.gender) {
        throw new Error('❌ Gender: Required field is empty');
      }
      // Weight is a Kyorugi-specific field — not required for a Poomsae-only
      // registration, but if a value WAS entered it must still be valid.
      const hasPoomsae = Array.isArray(formData.poomsaeCategories) && formData.poomsaeCategories.length > 0;
      const weightProvided = formData.weight !== undefined && formData.weight !== null && String(formData.weight).trim() !== '';
      if (!hasPoomsae && !weightProvided) {
        throw new Error('❌ Weight: Please enter a valid weight value');
      }
      if (weightProvided && isNaN(parseFloat(formData.weight))) {
        throw new Error('❌ Weight: Please enter a valid weight value');
      }

      // ── VALIDATE PHONE NUMBER: Must be exactly 10 digits ──────────────────────
      const phoneNumber = (formData.phoneNumber || '').replace(/\D/g, ''); // Remove non-digits
      if (!phoneNumber || phoneNumber.length !== 10) {
        throw new Error('❌ Phone Number: Must be exactly 10 digits');
      }
      formData.phoneNumber = phoneNumber; // Store cleaned phone number
      // ────────────────────────────────────────────────────────────────────────

      // ═══════════════════════════════════════════════════════════════════════════
      // BACKEND VALIDATION: Re-derive age category from DOB
      // This ensures age category ALWAYS computed from DOB, never from form
      // ═══════════════════════════════════════════════════════════════════════════
      const derivedAge = CATEGORY_LOGIC.calculateAge(formData.dob);
      const derivedAgeCategory = CATEGORY_LOGIC.getAgeCategory(derivedAge);
      formData.age = derivedAge;
      formData.ageCategory = derivedAgeCategory;
      formData.playerCategory = derivedAgeCategory;
      formData.categories = [derivedAgeCategory];
      console.log(`✅ BACKEND VALIDATION: age=${derivedAge}, ageCategory=${derivedAgeCategory}`);
      // ═══════════════════════════════════════════════════════════════════════════

      // Show confirmation dialog
      const weightDisplay = formData.weight ? `${formData.weight} kg` : 'N/A (Poomsae only)';
      const confirmMsg = `📝 Confirm Player Registration?\n\nPlayer Name: ${formData.playerName}\nTeam/Center: ${verifiedTeamName}\nGender: ${formData.gender}\nWeight: ${weightDisplay}\nAge Category: ${derivedAgeCategory}\n\nPlease review before confirming.`;

      const confirmed = await MODAL.showConfirm(confirmMsg);
      if (!confirmed) {
        console.log("❌ User cancelled submission");
        this.isSubmitting = false;
        return;
      }

      // Disable button and show progress
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving player data...';

      // Timeout for safety
      const timeout = setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        this.isSubmitting = false;
        const timeoutMsg = '❌ Operation timed out. Please check internet connection and try again.';
        if (typeof MODAL !== 'undefined') {
          MODAL.warning(timeoutMsg);
        } else {
          alert(timeoutMsg);
        }
      }, 30000); // 30 second timeout

      // Upload image if needed (stored separately in playerImages/, not in player record)
      let _uploadedImageUrl = null;
      if (this.currentImageFile) {
        submitBtn.textContent = 'Uploading image...';
        _uploadedImageUrl = await this.uploadImage(this.currentImageFile);
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // CRITICAL: ATOMIC TEAM BINDING
      // Set team data using VERIFIED team info (not user input)
      // This prevents frontend manipulation of team paths
      // ═══════════════════════════════════════════════════════════════════════════
      formData.teamId = this.selectedTeamId; // From dropdown selection (verified)
      formData.centerName = verifiedTeamName; // From database (authoritative)
      formData.teamName = verifiedTeamName;   // From database (authoritative)
      formData.submittedAt = new Date().toISOString();
      formData.status = 'pending';

      console.log(`🔐 ATOMIC BINDING: Player bound to team ${this.selectedTeamId} (${verifiedTeamName})`);
      // ═══════════════════════════════════════════════════════════════════════════

      // ═══════════════════════════════════════════════════════════════════════════
      // FINAL VALIDATION: Verify team binding is correct before save
      // ═══════════════════════════════════════════════════════════════════════════
      if (!formData.teamId || formData.teamId !== this.selectedTeamId) {
        throw new Error('❌ Security Error: Team binding mismatch. Registration aborted.');
      }
      if (!formData.teamName || formData.teamName !== verifiedTeamName) {
        throw new Error('❌ Security Error: Team name verification failed. Registration aborted.');
      }
      console.log('✅ FINAL VALIDATION: Team binding verified');
      // ═══════════════════════════════════════════════════════════════════════════

      // ═══════════════════════════════════════════════════════════════════════════
      // CONCURRENT-SAFE WRITE: Each registration gets unique ID from Firebase push()
      // Multiple concurrent writes create separate unique records
      // ═══════════════════════════════════════════════════════════════════════════
      submitBtn.textContent = 'Creating player record...';

      // Use Firebase's push() for guaranteed unique ID generation.
      // The same id is shared across players/ and expoPlayers/ so a single id
      // always identifies this person in whichever tree(s) they belong to.
      const newPlayerRef = dbPush(dbRef(database, 'players'));
      const uniquePlayerId = newPlayerRef.key;
      const expoPlayerRef = dbRef(database, `expoPlayers/${uniquePlayerId}`);

      console.log(`✅ UNIQUE ID GENERATED: ${uniquePlayerId}`);
      console.log(`✅ CONCURRENT-SAFE WRITE: Saving player ${formData.playerName} to team ${formData.teamId}`);

      // Sanitize before saving
      Object.keys(formData).forEach(key => {
        if (formData[key] === undefined) delete formData[key];
      });
      delete formData.playerImage; // Ensure image is never written into the player record

      // Route into players/ and/or expoPlayers/ based on Competition Category.
      // Unrecognized/missing category defaults to Official-only (pre-feature behavior).
      const wantsExpo = formData.competitionCategory === 'Expo' || formData.competitionCategory === 'Official & Expo';
      const wantsOfficial = formData.competitionCategory !== 'Expo';
      await Promise.all([
        wantsOfficial ? dbSet(newPlayerRef, formData) : Promise.resolve(),
        wantsExpo ? dbSet(expoPlayerRef, formData) : Promise.resolve()
      ]);

      // Write image to dedicated playerImages/ path (keeps players/ image-free)
      if (_uploadedImageUrl) {
        await dbSet(dbRef(database, `playerImages/${uniquePlayerId}`), _uploadedImageUrl);
      }

      clearTimeout(timeout);
      console.log(`✅ REGISTRATION COMPLETE: Player ${uniquePlayerId} successfully saved`);

      // ═══════════════════════════════════════════════════════════════════════════
      // VERIFICATION: Read back the data to confirm it was saved correctly
      // ═══════════════════════════════════════════════════════════════════════════
      const verifySnap = await dbGet(wantsOfficial ? newPlayerRef : expoPlayerRef);
      if (!verifySnap.exists()) {
        throw new Error('❌ Verification Failed: Player data could not be confirmed in database');
      }

      const savedData = verifySnap.val();
      if (savedData.teamId !== this.selectedTeamId) {
        console.error('❌ CRITICAL: Team mismatch in saved data!', savedData);
        throw new Error('❌ Data Integrity Error: Saved player not assigned to correct team');
      }

      console.log(`✅ VERIFICATION PASSED: Player confirmed in database with correct team assignment`);
      // ═══════════════════════════════════════════════════════════════════════════

      const regMsg = `✅ Player registered successfully!\n\nPlayer: ${formData.playerName}\nTeam: ${verifiedTeamName}\nID: ${uniquePlayerId}\n\nRedirecting to thank you page...`;
      if (typeof MODAL !== 'undefined') {
        MODAL.success(regMsg);
      } else {
        alert(regMsg);
      }

      // Redirect to thank you page
      setTimeout(() => {
        window.location.href = window.location.origin + '/thank-you.html';
      }, 2000);

    } catch (error) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      this.isSubmitting = false; // Release submission lock on error
      
      console.error('❌ Submission error:', error);

      let errorMsg = error.message || 'Registration failed. Please try again.';

      if (error.message && error.message.includes('PERMISSION_DENIED')) {
        errorMsg = '❌ Permission Error: Your registration could not be saved.\n\n✅ Please ensure:\n- You have selected a valid team\n- Your data is complete\n- Try refreshing the page and submitting again\n\nIf problem persists, contact the administrator.';
      }

      if (typeof MODAL !== 'undefined') {
        MODAL.error(errorMsg);
      } else {
        alert(errorMsg);
      }
    }
  }
};

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('registrationForm')) {
    PUBLIC_REGISTRATION.init();
  }
});
window.PUBLIC_REGISTRATION = PUBLIC_REGISTRATION;
