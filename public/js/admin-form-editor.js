// ============================================
// ADMIN FORM EDITOR
// ============================================

const ADMIN_FORM_EDITOR = {
  currentConfig: null,

  // Initialize editor
  async init() {
    try {
      console.log("🔄 Initializing form editor...");
      console.log("FORM_CONFIG available:", typeof FORM_CONFIG !== 'undefined');
      
      if (typeof FORM_CONFIG === 'undefined') {
        console.error("❌ FORM_CONFIG not available!");
        return;
      }
      
      this.currentConfig = await FORM_CONFIG.loadConfig();
      console.log("✅ Config loaded");
      console.log("📊 Config structure check:", {
        configExists: !!this.currentConfig,
        hasChampionship: !!this.currentConfig?.championship,
        hasFields: !!this.currentConfig?.fields,
        fieldsCount: this.currentConfig?.fields?.length || 0,
        configKeys: Object.keys(this.currentConfig || {}),
        champKeys: Object.keys(this.currentConfig?.championship || {}),
        firstFieldKeys: this.currentConfig?.fields?.[0] ? Object.keys(this.currentConfig.fields[0]) : []
      });
      
      // Validate structure before rendering
      if (!this.currentConfig) {
        console.error("❌ Config is null/undefined!");
        alert("Error: Could not load form configuration");
        return;
      }
      
      if (!this.currentConfig.championship) {
        console.error("❌ Championship data missing from config!");
        alert("Error: Championship data missing");
        return;
      }
      
      if (!Array.isArray(this.currentConfig.fields)) {
        console.error("❌ Fields is not an array:", typeof this.currentConfig.fields);
        alert("Error: Form fields configuration invalid");
        return;
      }
      
      if (this.currentConfig.fields.length === 0) {
        console.warn("⚠️ No fields in config, using defaults");
        this.currentConfig.fields = FORM_CONFIG.defaultConfig.fields;
      }
      
      console.log("✅ Validation passed, rendering editor...");
      this.renderEditor();
      this.setupEventListeners();
      console.log("✅ Form editor initialized successfully");
    } catch (error) {
      console.error("❌ Error initializing form editor:", error);
      console.error("❌ Error message:", error.message);
      console.error("❌ Stack:", error.stack);
      alert(`Error initializing form editor: ${error.message}`);
    }
  },

  // Render form editor
  renderEditor() {
    try {
      const editorContainer = document.getElementById('formEditorContainer');
      if (!editorContainer) {
        console.error("❌ formEditorContainer not found in DOM");
        return;
      }
      
      if (!this.currentConfig) {
        console.error("❌ currentConfig not available");
        editorContainer.innerHTML = '<div class="error">❌ Configuration not loaded. Please refresh the page.</div>';
        return;
      }

      console.log("🏗️ Building editor HTML...");
      
      // Render championship editor safely
      let champEditor = '<div class="error">Error loading championship data</div>';
      try {
        champEditor = this.renderChampionshipEditor();
      } catch (err) {
        console.error("Error rendering championship editor:", err);
      }
      
      // Render fields editor safely
      let fieldsEditor = '<div class="error">Error loading fields</div>';
      try {
        fieldsEditor = this.renderFieldsEditor();
      } catch (err) {
        console.error("Error rendering fields editor:", err);
      }
      
      let html = `
      <div class="editor-section">
        <h2>Championship Details</h2>
        ${champEditor}
      </div>

      <div class="editor-section">
        <h2>Form Fields Configuration</h2>
        <p class="info-text">Drag to reorder fields. Click to edit.</p>
        <div id="fieldsEditor">
          ${fieldsEditor}
        </div>
      </div>

      <div class="editor-section">
        <h2>Weight Categories</h2>
        <button type="button" class="btn-secondary" onclick="ADMIN_FORM_EDITOR.openWeightCategoriesEditor()">
          Edit Weight Categories
        </button>
      </div>

      <div class="editor-actions">
        <button type="button" class="btn-primary" onclick="ADMIN_FORM_EDITOR.saveAllChanges()">
          💾 Save All Changes
        </button>
        <button type="button" class="btn-secondary" onclick="ADMIN_FORM_EDITOR.previewForm()">
          👁️ Preview Form
        </button>
      </div>
    `;

      editorContainer.innerHTML = html;
      console.log("✅ Editor HTML rendered successfully");
    } catch (error) {
      console.error("❌ Error rendering form editor:", error);
      const editorContainer = document.getElementById('formEditorContainer');
      if (editorContainer) {
        editorContainer.innerHTML = `<div class="error" style="padding: 20px; background: #f00; color: white; border-radius: 5px;">
          ❌ Error rendering form editor: ${error.message}
          <br><br>
          <button onclick="location.reload()">🔄 Reload Page</button>
        </div>`;
      }
    }
  },

  // Render championship editor
  renderChampionshipEditor() {
    try {
      if (!this.currentConfig || !this.currentConfig.championship) {
        console.error("❌ Championship data not available");
        return '<div class="error">❌ Championship data not loaded</div>';
      }
      
      const c = this.currentConfig.championship;
      const title = c?.title || 'TAEKWONDO CHAMPIONSHIP';
      const venue = c?.venue || 'National Sports Complex';
      const address = c?.address || 'Bengaluru, Karnataka, India';
      const date = c?.date || '2026-03-15';
      const organizer = c?.organizer || 'Karnataka Taekwondo Association';
      const registrationDeadline = c?.registrationDeadline || '';
      
      return `
        <div class="championship-editor">
          <div class="form-group">
            <label>Championship Title</label>
            <input type="text" id="champ_title" value="${title}" class="form-control">
          </div>
          <div class="form-group">
            <label>Venue</label>
            <input type="text" id="champ_venue" value="${venue}" class="form-control">
          </div>
          <div class="form-group">
            <label>Address</label>
            <input type="text" id="champ_address" value="${address}" class="form-control">
          </div>
          <div class="form-group">
            <label>Date</label>
            <input type="date" id="champ_date" value="${date}" class="form-control">
          </div>
          <div class="form-group">
            <label>Organizer</label>
            <input type="text" id="champ_organizer" value="${organizer}" class="form-control">
          </div>
          <div class="form-group">
            <label>Registration Deadline <span style="color: var(--accent-red);">*</span> <small style="color: var(--text-gray); font-weight: normal; text-transform: none;">(leave blank for no deadline)</small></label>
            <input type="date" id="champ_registrationDeadline" value="${registrationDeadline}" class="form-control">
          </div>
        </div>
      `;
    } catch (error) {
      console.error("❌ Error rendering championship editor:", error);
      return '<div class="error">❌ Error loading championship data: ' + error.message + '</div>';
    }
  },

  // Render fields editor
  renderFieldsEditor() {
    try {
      console.log("🔍 === RENDER FIELDS EDITOR START ===");
      
      // Safe check for currentConfig
      if (!this.currentConfig) {
        console.warn("⚠️ No currentConfig, using defaults");
        this.currentConfig = JSON.parse(JSON.stringify(FORM_CONFIG.defaultConfig));
      }
      
      // Safe check for fields
      if (!this.currentConfig.fields || !Array.isArray(this.currentConfig.fields)) {
        console.warn("⚠️ Fields missing or not array, using defaults");
        this.currentConfig.fields = JSON.parse(JSON.stringify(FORM_CONFIG.defaultConfig.fields));
      }
      
      // Safe check for empty fields
      if (this.currentConfig.fields.length === 0) {
        console.warn("⚠️ Fields array empty, using defaults");
        this.currentConfig.fields = JSON.parse(JSON.stringify(FORM_CONFIG.defaultConfig.fields));
      }
      
      console.log("✅ Fields ready, count:", this.currentConfig.fields.length);
      
      // Safe sort
      let fields = [];
      try {
        fields = this.currentConfig.fields.sort((a, b) => (a.order || 0) - (b.order || 0));
      } catch (sortErr) {
        console.error("Sort error:", sortErr);
        fields = this.currentConfig.fields;
      }
      
      console.log("✅ Fields sorted successfully");
      
      let html = '<div class="fields-list">';

      fields.forEach((field, index) => {
        const fieldId = field?.id || 'field_' + index;
        const fieldLabel = field?.label || 'Field ' + (index + 1);
        const fieldType = field?.type || 'text';
        const required = field?.required || false;
        const readonly = field?.readonly || false;
        
        html += `
          <div class="field-item" data-field-id="${fieldId}" draggable="true">
            <span class="drag-handle">☰</span>
            <div class="field-info">
              <strong>${fieldLabel}</strong>
              <span class="field-type">(${fieldType})</span>
              ${required ? '<span class="badge-required">Required</span>' : ''}
              ${readonly ? '<span class="badge-readonly">Read-only</span>' : ''}
            </div>
            <div class="field-actions">
              <button onclick="ADMIN_FORM_EDITOR.editField('${fieldId}')" class="btn-icon">✏️</button>
              ${!required ? `<button onclick="ADMIN_FORM_EDITOR.deleteField('${fieldId}')" class="btn-icon">🗑️</button>` : ''}
            </div>
          </div>
        `;
      });

      html += `
        </div>
        <button type="button" class="btn-secondary" onclick="ADMIN_FORM_EDITOR.addNewField()">
          ➕ Add New Field
        </button>
      `;

      console.log("✅ Fields HTML rendered, length:", html.length);
      return html;
    } catch (error) {
      console.error("❌ CRITICAL ERROR in renderFieldsEditor:", error);
      console.error("Error message:", error?.message);
      console.error("Error stack:", error?.stack);
      return `<div class="error" style="padding: 20px; background: #f00; color: white; border-radius: 5px;">
        ❌ Error loading form fields: ${error?.message || 'Unknown error'}
        <br><br>
        <button onclick="location.reload()">🔄 Reload Page</button>
      </div>`;
    }
  },

  // Setup event listeners
  setupEventListeners() {
    try {
      console.log("🎯 Setting up event listeners...");
      // Drag and drop for reordering
      setTimeout(() => {
        const fieldItems = document.querySelectorAll('.field-item');
        console.log("🎯 Found field items:", fieldItems.length);
        fieldItems.forEach(item => {
          item.addEventListener('dragstart', this.handleDragStart.bind(this));
          item.addEventListener('dragover', this.handleDragOver.bind(this));
          item.addEventListener('drop', this.handleDrop.bind(this));
          item.addEventListener('dragend', this.handleDragEnd.bind(this));
        });
        console.log("✅ Event listeners set up successfully");
      }, 100);
    } catch (error) {
      console.error("❌ Error setting up event listeners:", error);
    }
  },

  // Drag and drop handlers
  handleDragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.innerHTML);
    e.target.classList.add('dragging');
    window.draggedElement = e.target;
  },

  handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
  },

  handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    
    const draggedElement = window.draggedElement;
    if (draggedElement !== e.currentTarget) {
      const allItems = Array.from(document.querySelectorAll('.field-item'));
      const draggedIndex = allItems.indexOf(draggedElement);
      const targetIndex = allItems.indexOf(e.currentTarget);
      
      if (draggedIndex < targetIndex) {
        e.currentTarget.parentNode.insertBefore(draggedElement, e.currentTarget.nextSibling);
      } else {
        e.currentTarget.parentNode.insertBefore(draggedElement, e.currentTarget);
      }
      
      this.updateFieldOrder();
    }
    
    return false;
  },

  handleDragEnd(e) {
    e.target.classList.remove('dragging');
    window.draggedElement = null;
  },

  // Update field order after drag
  updateFieldOrder() {
    const fieldItems = document.querySelectorAll('.field-item');
    fieldItems.forEach((item, index) => {
      const fieldId = item.getAttribute('data-field-id');
      const field = this.currentConfig.fields.find(f => f.id === fieldId);
      if (field) {
        field.order = index + 1;
      }
    });
  },

  // Edit field
  editField(fieldId) {
    const field = this.currentConfig.fields.find(f => f.id === fieldId);
    if (!field) return;

    const newLabel = prompt('Enter new label:', field.label);
    if (newLabel && newLabel.trim()) {
      field.label = newLabel.trim();
      this.renderEditor();
      this.setupEventListeners();
    }
  },

  // Delete field
  async deleteField(fieldId) {
    const confirmed = await MODAL.showConfirm('Are you sure you want to delete this field?');
    if (!confirmed) return;
    
    this.currentConfig.fields = this.currentConfig.fields.filter(f => f.id !== fieldId);
    this.renderEditor();
    this.setupEventListeners();
  },

  // Add new field
  async addNewField() {
    const fieldId = prompt('Enter field ID (e.g., customField1):');
    if (!fieldId) return;

    const fieldLabel = prompt('Enter field label:');
    if (!fieldLabel) return;

    const fieldType = prompt('Enter field type (text/number/date/select/checkbox):');
    if (!fieldType) return;

    const isRequired = await MODAL.showConfirm('Is this field required?');

    const newField = {
      id: fieldId,
      label: fieldLabel,
      type: fieldType,
      required: isRequired,
      readonly: false,
      order: this.currentConfig.fields.length + 1
    };

    if (fieldType === 'select' || fieldType === 'checkbox') {
      const optionsStr = prompt('Enter options (comma-separated):');
      if (optionsStr) {
        newField.options = optionsStr.split(',').map(o => o.trim());
      }
    }

    this.currentConfig.fields.push(newField);
    this.renderEditor();
    this.setupEventListeners();
  },

  // Open weight categories editor
  openWeightCategoriesEditor() {
    window.location.href = window.location.origin + '/admin/weight-categories.html';
  },

  // Preview form
  previewForm() {
    window.open('/admin/form-preview.html', '_blank');
  },

  // Save all changes
  async saveAllChanges() {
    try {
      // Update championship details
      this.currentConfig.championship = {
        title: document.getElementById('champ_title').value,
        venue: document.getElementById('champ_venue').value,
        address: document.getElementById('champ_address').value,
        date: document.getElementById('champ_date').value,
        organizer: document.getElementById('champ_organizer').value,
        registrationDeadline: document.getElementById('champ_registrationDeadline').value
      };

      // Save to Firebase
      await FORM_CONFIG.saveConfig(this.currentConfig);
      
      if (typeof MODAL !== 'undefined') {
        MODAL.success('All changes saved successfully!');
      } else {
        alert('✅ All changes saved successfully!');
      }
    } catch (error) {
      if (typeof MODAL !== 'undefined') {
        MODAL.error('Error saving changes: ' + error.message);
      } else {
        alert('❌ Error saving changes: ' + error.message);
      }
    }
  }
};

window.ADMIN_FORM_EDITOR = ADMIN_FORM_EDITOR;