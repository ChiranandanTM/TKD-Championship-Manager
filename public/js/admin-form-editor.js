// ============================================
// ADMIN FORM EDITOR — Premium UI v2.0
// ============================================

const ADMIN_FORM_EDITOR = {
  currentConfig: null,
  protectedFieldIds: ['playerName','playerImage','dob','age','gender','weight','weightCategory','ageCategory','playerCategory','categories'],

  isFieldProtected(id) { return this.protectedFieldIds.includes(id); },

  async init() {
    try {
      if (typeof FORM_CONFIG === 'undefined') { console.error('FORM_CONFIG missing'); return; }
      this.currentConfig = await FORM_CONFIG.loadConfig();
      if (!this.currentConfig?.championship || !Array.isArray(this.currentConfig.fields)) {
        MODAL.error('Failed to load form configuration.'); return;
      }
      if (this.currentConfig.fields.length === 0)
        this.currentConfig.fields = FORM_CONFIG.defaultConfig.fields;
      this.renderEditor();
    } catch (e) { console.error('Form editor init error:', e); MODAL.error('Init error: ' + e.message); }
  },

  renderEditor() {
    const el = document.getElementById('formEditorContainer');
    if (!el) return;
    el.innerHTML = this.buildHTML();
    this.setupDrag();
    this.injectStyles();
  },

  buildHTML() {
    const c = this.currentConfig.championship || {};
    const fields = [...(this.currentConfig.fields || [])].sort((a,b) => (a.order||0)-(b.order||0));

    const fieldCards = fields.map((f, i) => {
      const protected_ = this.isFieldProtected(f.id);
      const typeColor = { text:'#00E5FF', number:'#FF9800', date:'#E040FB', select:'#FFD700', checkbox:'#00E676', image:'#FF6B6B' }[f.type] || '#aaa';
      return `
        <div class="afe-field-card" data-field-id="${f.id}" draggable="true">
          <div class="afe-drag-grip" title="Drag to reorder">⠿</div>
          <div class="afe-field-body">
            <div class="afe-field-name">${f.label}</div>
            <div class="afe-field-meta">
              <span class="afe-type-badge" style="color:${typeColor};border-color:${typeColor}">${f.type}</span>
              ${f.required ? '<span class="afe-badge afe-req">Required</span>' : ''}
              ${f.readonly  ? '<span class="afe-badge afe-ro">Read-only</span>' : ''}
              ${protected_  ? '<span class="afe-badge afe-sys">System</span>' : ''}
            </div>
          </div>
          <div class="afe-field-btns">
            <button class="afe-btn-edit" onclick="ADMIN_FORM_EDITOR.openEditModal('${f.id}')" title="Edit">✏️ Edit</button>
            ${!protected_ ? `<button class="afe-btn-del" onclick="ADMIN_FORM_EDITOR.deleteField('${f.id}')" title="Delete">🗑 Delete</button>` : ''}
          </div>
        </div>`;
    }).join('');

    return `
      <div class="afe-section">
        <div class="afe-section-title">🏆 Championship Details</div>
        <div class="afe-champ-grid">
          ${this.champInput('champ_title','Title','text', c.title||'')}
          ${this.champInput('champ_venue','Venue','text', c.venue||'')}
          ${this.champInput('champ_address','Address / Location','text', c.address||'')}
          ${this.champInput('champ_date','Event Date','date', c.date||'')}
          ${this.champInput('champ_organizer','Organizer','text', c.organizer||'')}
          ${this.champDeadlineChip(c.registrationDeadline||'')}
        </div>
        <div class="afe-note">💡 Changes here reflect on all team registration forms immediately after saving.</div>
      </div>

      <div class="afe-section">
        <div class="afe-section-header">
          <div class="afe-section-title">📋 Form Fields <span class="afe-count">${fields.length}</span></div>
          <button class="afe-add-btn" onclick="ADMIN_FORM_EDITOR.openAddModal()">＋ Add Field</button>
        </div>
        <div class="afe-hint">⠿ Drag cards to reorder · ✏️ Edit label/options · 🗑 Delete removes from all team forms</div>
        <div class="afe-fields-list" id="afeFieldsList">${fieldCards}</div>
      </div>

      <div class="afe-section">
        <div class="afe-section-title">⚖️ Weight Categories</div>
        <button class="afe-wc-btn" onclick="window.location.href='/admin/weight-categories.html'">Edit Weight Categories →</button>
      </div>

      <div class="afe-actions">
        <button class="afe-save-btn" onclick="ADMIN_FORM_EDITOR.saveAllChanges()">💾 Save All Changes</button>
        <button class="afe-preview-btn" onclick="window.open('/admin/form-preview.html','_blank')">👁 Preview Form</button>
      </div>

      <!-- Field edit modal -->
      <div id="afeModal" class="afe-modal-overlay" style="display:none">
        <div class="afe-modal">
          <div class="afe-modal-header">
            <span id="afeModalTitle">Edit Field</span>
            <button class="afe-modal-close" onclick="ADMIN_FORM_EDITOR.closeModal()">✕</button>
          </div>
          <div class="afe-modal-body" id="afeModalBody"></div>
        </div>
      </div>`;
  },

  champInput(id, label, type, val) {
    return `
      <div class="afe-form-group">
        <label class="afe-label">${label}</label>
        <input type="${type}" id="${id}" value="${val.replace(/"/g,'&quot;')}" class="afe-input">
      </div>`;
  },

  // ── Registration Deadline chip + picker modal ───────────────────────────
  // Same interaction pattern as the per-team deadline picker (Team-deadline-
  // manager.js): a compact chip replaces the plain date input, opening a
  // modal with quick-set presets and a live "closes in N days" preview.
  // The hidden #champ_registrationDeadline input keeps its value in sync so
  // saveAllChanges() (which reads it directly) needs no changes.
  champDeadlineChip(value) {
    const display = value ? this.formatChampDeadlineDisplay(value) : 'No deadline set — click to set';
    return `
      <div class="afe-form-group">
        <label class="afe-label">Registration Deadline</label>
        <input type="hidden" id="champ_registrationDeadline" value="${value}">
        <button type="button" class="champ-deadline-chip" onclick="ADMIN_FORM_EDITOR.openChampDeadlineModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          <span id="champDeadlineChipText">${display}</span>
        </button>
      </div>`;
  },

  formatChampDeadlineDisplay(val) {
    const d = new Date(val + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  },

  createChampDeadlineModalHTML() {
    if (document.getElementById('champDeadlineModal')) return;

    const stylesHTML = `
      <style id="champDeadlineModalStyles">
        @keyframes champDeadlineModalPop { from { opacity:0; transform:scale(0.94) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
        .champ-deadline-preset-btn { padding:10px 16px; border-radius:10px; border:1.5px solid rgba(0,229,255,0.3); background:rgba(0,229,255,0.08); color:var(--accent-cyan); font-weight:700; font-size:0.85rem; cursor:pointer; transition:all 0.2s; }
        .champ-deadline-preset-btn:hover { border-color:var(--accent-cyan); background:rgba(0,229,255,0.18); transform:translateY(-2px); }
        .champ-deadline-preset-btn.active { background:var(--accent-cyan); color:#000; border-color:var(--accent-cyan); box-shadow:0 4px 14px rgba(0,229,255,0.4); }
        .champ-deadline-preset-clear { border-color:rgba(255,165,0,0.35); background:rgba(255,165,0,0.08); color:#FFA500; }
        .champ-deadline-preset-clear:hover { border-color:#FFA500; background:rgba(255,165,0,0.18); }
        .champ-deadline-preset-clear.active { background:#FFA500; color:#000; border-color:#FFA500; box-shadow:0 4px 14px rgba(255,165,0,0.4); }
        .champ-deadline-input-big { color-scheme: dark; width:100%; padding:16px 18px; font-size:1.1rem; background:rgba(0,0,0,0.5); border:2px solid rgba(0,229,255,0.5); border-radius:14px; color:#fff; outline:none; transition:border-color 0.2s, box-shadow 0.2s; cursor:pointer; box-sizing:border-box; }
        .champ-deadline-input-big:focus { border-color:var(--border-gold); box-shadow:0 0 0 4px rgba(255,215,0,0.15); }
      </style>
    `;

    const modalHTML = `
      <div id="champDeadlineModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:2100; align-items:center; justify-content:center; backdrop-filter:blur(6px);">
        <div style="background:linear-gradient(160deg, rgba(12,18,36,0.98) 0%, rgba(20,28,50,0.98) 100%); border:2px solid var(--accent-cyan); border-radius:22px; padding:34px; width:92%; max-width:460px; box-shadow:0 24px 70px rgba(0,229,255,0.25); animation:champDeadlineModalPop 0.22s ease;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <h2 style="margin:0; font-size:1.3rem; color:var(--accent-cyan);">📅 Registration Deadline</h2>
            <button onclick="ADMIN_FORM_EDITOR.closeChampDeadlineModal()" style="background:transparent; border:none; color:var(--accent-cyan); font-size:26px; cursor:pointer; line-height:1; padding:4px;">×</button>
          </div>
          <p style="margin:0 0 24px; color:var(--border-gold); font-weight:700; font-size:0.95rem;">Championship-wide deadline shown on the registration form</p>

          <div style="margin-bottom:18px;">
            <label style="display:block; font-size:0.78rem; font-weight:700; color:var(--text-gray); text-transform:uppercase; letter-spacing:0.8px; margin-bottom:10px;">Quick Set</label>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
              <button type="button" class="champ-deadline-preset-btn" onclick="ADMIN_FORM_EDITOR.applyChampDeadlinePreset(1, this)">+1 Day</button>
              <button type="button" class="champ-deadline-preset-btn" onclick="ADMIN_FORM_EDITOR.applyChampDeadlinePreset(7, this)">+1 Week</button>
              <button type="button" class="champ-deadline-preset-btn" onclick="ADMIN_FORM_EDITOR.applyChampDeadlinePreset(14, this)">+2 Weeks</button>
              <button type="button" class="champ-deadline-preset-btn" onclick="ADMIN_FORM_EDITOR.applyChampDeadlinePreset(30, this)">+1 Month</button>
              <button type="button" class="champ-deadline-preset-btn champ-deadline-preset-clear" onclick="ADMIN_FORM_EDITOR.clearChampDeadlineInModal(this)">🚫 No Deadline</button>
            </div>
          </div>

          <div style="margin-bottom:16px;">
            <label style="display:block; font-size:0.78rem; font-weight:700; color:var(--text-gray); text-transform:uppercase; letter-spacing:0.8px; margin-bottom:10px;">Or Pick Exact Date</label>
            <input type="date" id="champDeadlineInput" class="champ-deadline-input-big" oninput="ADMIN_FORM_EDITOR.onChampDeadlineInputChange()">
          </div>

          <div id="champDeadlinePreviewBox" style="padding:14px 16px; border-radius:12px; background:rgba(255,255,255,0.04); border:1.5px dashed rgba(255,255,255,0.15); margin-bottom:26px;">
            <span id="champDeadlinePreviewText" style="font-size:0.92rem;"></span>
          </div>

          <div style="display:flex; gap:12px;">
            <button type="button" onclick="ADMIN_FORM_EDITOR.closeChampDeadlineModal()" style="flex:1; padding:13px; background:rgba(255,255,255,0.08); color:#fff; border:none; border-radius:10px; font-weight:700; cursor:pointer;">Cancel</button>
            <button type="button" onclick="ADMIN_FORM_EDITOR.applyChampDeadlineFromModal()" style="flex:1.4; padding:13px; background:linear-gradient(135deg,#00E5FF,#0088FF); color:#000; border:none; border-radius:10px; font-weight:900; cursor:pointer; letter-spacing:0.3px;">✓ Apply</button>
          </div>
        </div>
      </div>
    `;

    document.head.insertAdjacentHTML('beforeend', stylesHTML);
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    document.getElementById('champDeadlineModal').addEventListener('click', (e) => {
      if (e.target.id === 'champDeadlineModal') ADMIN_FORM_EDITOR.closeChampDeadlineModal();
    });
  },

  openChampDeadlineModal() {
    this.createChampDeadlineModalHTML();

    const current = document.getElementById('champ_registrationDeadline').value || '';
    document.getElementById('champDeadlineInput').value = current;
    document.querySelectorAll('.champ-deadline-preset-btn').forEach(b => b.classList.remove('active'));
    this.updateChampDeadlinePreview();

    document.getElementById('champDeadlineModal').style.display = 'flex';
  },

  closeChampDeadlineModal() {
    const modal = document.getElementById('champDeadlineModal');
    if (modal) modal.style.display = 'none';
  },

  applyChampDeadlinePreset(days, btnEl) {
    const d = new Date(Date.now() + days * 86400000);
    const pad = n => String(n).padStart(2, '0');
    document.getElementById('champDeadlineInput').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    document.querySelectorAll('.champ-deadline-preset-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    this.updateChampDeadlinePreview();
  },

  clearChampDeadlineInModal(btnEl) {
    document.getElementById('champDeadlineInput').value = '';
    document.querySelectorAll('.champ-deadline-preset-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    this.updateChampDeadlinePreview();
  },

  onChampDeadlineInputChange() {
    document.querySelectorAll('.champ-deadline-preset-btn').forEach(b => b.classList.remove('active'));
    this.updateChampDeadlinePreview();
  },

  updateChampDeadlinePreview() {
    const val = document.getElementById('champDeadlineInput')?.value;
    const box = document.getElementById('champDeadlinePreviewBox');
    const text = document.getElementById('champDeadlinePreviewText');
    if (!text || !box) return;

    if (!val) {
      text.textContent = '♾️ No deadline set — registration form stays open indefinitely.';
      text.style.color = 'var(--text-gray)';
      box.style.borderColor = 'rgba(255,255,255,0.15)';
      return;
    }

    const d = new Date(val + 'T23:59:59');
    const diffMs = d - new Date();
    const formatted = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

    if (diffMs <= 0) {
      text.innerHTML = `⏰ <strong>${formatted}</strong> — this date has already passed`;
      text.style.color = '#FFA500';
      box.style.borderColor = 'rgba(255,165,0,0.4)';
    } else {
      const days = Math.ceil(diffMs / 86400000);
      text.innerHTML = `✅ Closes <strong>${formatted}</strong> — in ${days} day${days === 1 ? '' : 's'}`;
      text.style.color = 'var(--success-green)';
      box.style.borderColor = 'rgba(0,230,118,0.35)';
    }
  },

  // Applies the modal's chosen date back onto the hidden field + chip label
  // only — the actual Firebase write still happens via the page's single
  // "💾 Save All Changes" button, same as every other championship field.
  applyChampDeadlineFromModal() {
    const val = document.getElementById('champDeadlineInput')?.value || '';
    document.getElementById('champ_registrationDeadline').value = val;
    const chipText = document.getElementById('champDeadlineChipText');
    if (chipText) chipText.textContent = val ? this.formatChampDeadlineDisplay(val) : 'No deadline set — click to set';
    this.closeChampDeadlineModal();
  },

  // ── Drag-and-drop reorder ─────────────────────────────────────────────────
  setupDrag() {
    let dragged = null;
    document.querySelectorAll('.afe-field-card').forEach(card => {
      card.addEventListener('dragstart', e => { dragged = card; card.style.opacity = '0.5'; });
      card.addEventListener('dragend',   e => { dragged = null; card.style.opacity = '1'; });
      card.addEventListener('dragover',  e => { e.preventDefault(); card.style.borderColor = 'var(--border-gold)'; });
      card.addEventListener('dragleave', e => { card.style.borderColor = ''; });
      card.addEventListener('drop', e => {
        e.preventDefault(); card.style.borderColor = '';
        if (dragged && dragged !== card) {
          const list = card.parentNode;
          const all  = [...list.querySelectorAll('.afe-field-card')];
          const di = all.indexOf(dragged), ti = all.indexOf(card);
          list.insertBefore(dragged, di < ti ? card.nextSibling : card);
          this.syncOrderFromDOM();
        }
      });
    });
  },

  syncOrderFromDOM() {
    document.querySelectorAll('.afe-field-card').forEach((card, i) => {
      const f = this.currentConfig.fields.find(x => x.id === card.dataset.fieldId);
      if (f) f.order = i + 1;
    });
  },

  // ── Add field modal ───────────────────────────────────────────────────────
  openAddModal() {
    document.getElementById('afeModalTitle').textContent = '➕ Add New Field';
    document.getElementById('afeModalBody').innerHTML = `
      <div class="afe-form-group"><label class="afe-label">Field ID <small>(no spaces)</small></label>
        <input class="afe-input" id="nf_id" placeholder="e.g. clubName"></div>
      <div class="afe-form-group"><label class="afe-label">Label</label>
        <input class="afe-input" id="nf_label" placeholder="e.g. Club Name"></div>
      <div class="afe-form-group"><label class="afe-label">Type</label>
        <select class="afe-input" id="nf_type" onchange="ADMIN_FORM_EDITOR.toggleOptions('nf')">
          <option value="text">Text</option><option value="number">Number</option>
          <option value="date">Date</option><option value="select">Select (Dropdown)</option>
          <option value="checkbox">Checkbox (Multi)</option><option value="image">Image Upload</option>
        </select></div>
      <div class="afe-form-group" id="nf_options_row" style="display:none">
        <label class="afe-label">Options <small>(comma-separated)</small></label>
        <input class="afe-input" id="nf_options" placeholder="Option A, Option B, Option C">
      </div>
      <div class="afe-form-group" style="display:flex;gap:20px;align-items:center">
        <label style="display:flex;align-items:center;gap:8px;color:var(--text-white);cursor:pointer">
          <input type="checkbox" id="nf_required" style="accent-color:var(--border-gold);width:18px;height:18px"> Required
        </label>
        <label style="display:flex;align-items:center;gap:8px;color:var(--text-white);cursor:pointer">
          <input type="checkbox" id="nf_readonly" style="accent-color:var(--border-gold);width:18px;height:18px"> Read-only
        </label>
      </div>
      <div class="afe-modal-footer">
        <button class="afe-save-btn" onclick="ADMIN_FORM_EDITOR.saveNewField()">Add Field</button>
        <button class="afe-preview-btn" onclick="ADMIN_FORM_EDITOR.closeModal()">Cancel</button>
      </div>`;
    document.getElementById('afeModal').style.display = 'flex';
  },

  toggleOptions(prefix) {
    const t = document.getElementById(prefix+'_type').value;
    document.getElementById(prefix+'_options_row').style.display =
      (t === 'select' || t === 'checkbox' || t === 'checkbox-single') ? '' : 'none';
  },

  async saveNewField() {
    const id    = (document.getElementById('nf_id').value||'').trim().replace(/\s+/g,'_');
    const label = (document.getElementById('nf_label').value||'').trim();
    const type  = document.getElementById('nf_type').value;
    if (!id || !label) { MODAL.warning('Field ID and Label are required.'); return; }
    if (this.currentConfig.fields.find(f => f.id === id)) { MODAL.warning('Field ID already exists.'); return; }

    const field = { id, label, type, required: document.getElementById('nf_required').checked,
      readonly: document.getElementById('nf_readonly').checked, order: this.currentConfig.fields.length + 1 };

    const optEl = document.getElementById('nf_options');
    if (optEl && optEl.value.trim() && (type === 'select' || type === 'checkbox' || type === 'checkbox-single'))
      field.options = optEl.value.split(',').map(o => o.trim()).filter(Boolean);

    this.currentConfig.fields.push(field);
    const ok = await FORM_CONFIG.updateFields(this.currentConfig.fields);
    if (!ok) { this.currentConfig.fields.pop(); MODAL.error('Failed to save field.'); return; }
    this.closeModal();
    this.renderEditor();
    MODAL.success(`Field "${label}" added and saved to Firebase.`);
  },

  // ── Edit field modal ──────────────────────────────────────────────────────
  openEditModal(fieldId) {
    const f = this.currentConfig.fields.find(x => x.id === fieldId);
    if (!f) return;
    const isP = this.isFieldProtected(fieldId);
    const opts = (f.options || []).join(', ');
    const hasOpts = f.type === 'select' || f.type === 'checkbox' || f.type === 'checkbox-single';

    document.getElementById('afeModalTitle').textContent = '✏️ Edit Field: ' + f.label;
    document.getElementById('afeModalBody').innerHTML = `
      <div class="afe-form-group"><label class="afe-label">Field ID</label>
        <input class="afe-input" value="${f.id}" disabled style="opacity:0.5"></div>
      <div class="afe-form-group"><label class="afe-label">Label</label>
        <input class="afe-input" id="ef_label" value="${(f.label||'').replace(/"/g,'&quot;')}"></div>
      <div class="afe-form-group"><label class="afe-label">Type</label>
        <select class="afe-input" id="ef_type" ${isP?'disabled':''} onchange="ADMIN_FORM_EDITOR.toggleOptions('ef')">
          ${['text','number','date','select','checkbox','checkbox-single','image'].map(t =>
            `<option value="${t}" ${f.type===t?'selected':''}>${t}</option>`).join('')}
        </select></div>
      <div class="afe-form-group" id="ef_options_row" style="${hasOpts?'':'display:none'}">
        <label class="afe-label">Options <small>(comma-separated)</small></label>
        <input class="afe-input" id="ef_options" value="${opts}">
      </div>
      <div class="afe-form-group" style="display:flex;gap:20px;align-items:center">
        <label style="display:flex;align-items:center;gap:8px;color:var(--text-white);cursor:pointer">
          <input type="checkbox" id="ef_required" ${f.required?'checked':''} ${isP?'disabled':''} style="accent-color:var(--border-gold);width:18px;height:18px"> Required
        </label>
        <label style="display:flex;align-items:center;gap:8px;color:var(--text-white);cursor:pointer">
          <input type="checkbox" id="ef_readonly" ${f.readonly?'checked':''} ${isP?'disabled':''} style="accent-color:var(--border-gold);width:18px;height:18px"> Read-only
        </label>
      </div>
      ${isP ? '<div class="afe-note">⚠️ System field — type and required settings are locked.</div>' : ''}
      <div class="afe-modal-footer">
        <button class="afe-save-btn" onclick="ADMIN_FORM_EDITOR.saveEditField('${fieldId}')">Save Changes</button>
        <button class="afe-preview-btn" onclick="ADMIN_FORM_EDITOR.closeModal()">Cancel</button>
      </div>`;
    document.getElementById('afeModal').style.display = 'flex';
  },

  async saveEditField(fieldId) {
    const f = this.currentConfig.fields.find(x => x.id === fieldId);
    if (!f) return;
    const prev = { ...f };
    f.label    = (document.getElementById('ef_label').value||'').trim() || f.label;
    f.type     = document.getElementById('ef_type').value;
    f.required = document.getElementById('ef_required').checked;
    f.readonly = document.getElementById('ef_readonly').checked;
    const optEl = document.getElementById('ef_options');
    if (optEl && optEl.value.trim())
      f.options = optEl.value.split(',').map(o => o.trim()).filter(Boolean);
    else if (f.type !== 'select' && f.type !== 'checkbox' && f.type !== 'checkbox-single')
      delete f.options;

    const ok = await FORM_CONFIG.updateFields(this.currentConfig.fields);
    if (!ok) { Object.assign(f, prev); MODAL.error('Failed to save.'); return; }
    this.closeModal();
    this.renderEditor();
    MODAL.success(`Field "${f.label}" updated and reflected on all team forms.`);
  },

  // ── Delete field ──────────────────────────────────────────────────────────
  async deleteField(fieldId) {
    if (this.isFieldProtected(fieldId)) { MODAL.warning('System fields cannot be deleted.'); return; }
    const f = this.currentConfig.fields.find(x => x.id === fieldId);
    const ok = await MODAL.showConfirm(`Delete "${f?.label || fieldId}"?\n\nThis will remove it from ALL team registration forms immediately.`);
    if (!ok) return;

    const backup = JSON.parse(JSON.stringify(this.currentConfig.fields));
    this.currentConfig.fields = this.currentConfig.fields.filter(x => x.id !== fieldId);
    this.normalizeFieldOrder();

    const saved = await FORM_CONFIG.updateFields(this.currentConfig.fields);
    if (!saved) { this.currentConfig.fields = backup; this.renderEditor(); MODAL.error('Delete failed — form restored.'); return; }
    this.renderEditor();
    MODAL.success(`"${f?.label}" deleted from Firebase. All team forms updated.`);
  },

  // ── Save all ──────────────────────────────────────────────────────────────
  async saveAllChanges() {
    this.syncOrderFromDOM();
    this.currentConfig.championship = {
      title:                document.getElementById('champ_title').value,
      venue:                document.getElementById('champ_venue').value,
      address:              document.getElementById('champ_address').value,
      date:                 document.getElementById('champ_date').value,
      organizer:            document.getElementById('champ_organizer').value,
      registrationDeadline: document.getElementById('champ_registrationDeadline').value
    };
    const saved = await FORM_CONFIG.saveConfig(this.currentConfig);
    saved ? MODAL.success('All changes saved! Team forms reflect these updates immediately.')
           : MODAL.error('Save failed. Please try again.');
  },

  // ── Helpers ───────────────────────────────────────────────────────────────
  normalizeFieldOrder() {
    const s = [...this.currentConfig.fields].sort((a,b)=>(a.order||0)-(b.order||0));
    s.forEach((f,i) => f.order = i+1);
    this.currentConfig.fields = s;
  },

  closeModal() { document.getElementById('afeModal').style.display = 'none'; },

  // ── Styles ────────────────────────────────────────────────────────────────
  injectStyles() {
    if (document.getElementById('afeStyles')) return;
    const s = document.createElement('style');
    s.id = 'afeStyles';
    s.textContent = `
      .afe-section { background:linear-gradient(145deg,rgba(15,20,45,.97),rgba(22,33,62,.97)); border:2px solid var(--border-gold); border-radius:16px; padding:28px 32px; margin-bottom:28px; }
      .afe-section-title { font-size:1.2rem; font-weight:800; color:var(--border-gold); margin-bottom:20px; letter-spacing:1px; display:flex; align-items:center; gap:10px; }
      .afe-count { background:var(--accent-cyan); color:#000; border-radius:20px; font-size:.8rem; padding:2px 12px; font-weight:900; }
      .afe-section-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; flex-wrap:wrap; gap:12px; }
      .afe-hint { font-size:.82rem; color:#555; margin-bottom:18px; }
      .afe-note { font-size:.82rem; color:var(--accent-cyan); margin-top:14px; background:rgba(0,229,255,.07); padding:10px 14px; border-radius:8px; border-left:3px solid var(--accent-cyan); }
      .afe-champ-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:18px; }
      .afe-form-group { display:flex; flex-direction:column; gap:6px; }
      .afe-label { font-size:.85rem; font-weight:700; color:var(--accent-cyan); text-transform:uppercase; letter-spacing:.8px; }
      .afe-label small { font-size:.75rem; text-transform:none; font-weight:400; color:#666; }
      .afe-input { padding:11px 14px; background:rgba(0,0,0,.5); border:2px solid rgba(255,255,255,.12); border-radius:10px; color:var(--text-white); font-size:.95rem; font-family:inherit; transition:border-color .2s; width:100%; box-sizing:border-box; }
      .afe-input:focus { outline:none; border-color:var(--border-gold); box-shadow:0 0 16px rgba(255,215,0,.25); }
      .champ-deadline-chip { display:flex; align-items:center; gap:9px; padding:11px 14px; background:rgba(0,0,0,.5); border:2px solid rgba(255,255,255,.12); border-radius:10px; color:var(--text-white); font-size:.95rem; font-family:inherit; cursor:pointer; transition:all .2s; width:100%; box-sizing:border-box; text-align:left; }
      .champ-deadline-chip:hover { border-color:var(--border-gold); background:rgba(255,215,0,.06); transform:translateY(-1px); }
      .champ-deadline-chip svg { color:var(--accent-cyan); flex-shrink:0; }
      .afe-fields-list { display:flex; flex-direction:column; gap:12px; }
      .afe-field-card { display:flex; align-items:center; gap:14px; background:linear-gradient(135deg,rgba(0,229,255,.05),rgba(255,215,0,.03)); border:1.5px solid rgba(0,229,255,.2); border-radius:12px; padding:14px 18px; cursor:grab; transition:all .2s; }
      .afe-field-card:hover { border-color:var(--border-gold); background:linear-gradient(135deg,rgba(255,215,0,.07),rgba(0,229,255,.04)); transform:translateY(-2px); box-shadow:0 6px 20px rgba(255,215,0,.15); }
      .afe-drag-grip { font-size:1.3rem; color:#444; cursor:grab; user-select:none; flex-shrink:0; }
      .afe-field-body { flex:1; min-width:0; }
      .afe-field-name { font-size:1rem; font-weight:700; color:var(--text-white); margin-bottom:5px; }
      .afe-field-meta { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
      .afe-type-badge { font-size:.72rem; font-weight:700; padding:2px 10px; border-radius:12px; border:1.5px solid; text-transform:uppercase; letter-spacing:.8px; }
      .afe-badge { font-size:.7rem; font-weight:700; padding:2px 8px; border-radius:10px; }
      .afe-req { background:rgba(255,23,68,.15); color:#FF1744; border:1px solid rgba(255,23,68,.3); }
      .afe-ro  { background:rgba(255,152,0,.15); color:#FF9800; border:1px solid rgba(255,152,0,.3); }
      .afe-sys { background:rgba(0,229,255,.12); color:var(--accent-cyan); border:1px solid rgba(0,229,255,.3); }
      .afe-field-btns { display:flex; gap:8px; flex-shrink:0; }
      .afe-btn-edit { padding:7px 14px; background:rgba(0,229,255,.12); border:1.5px solid var(--accent-cyan); color:var(--accent-cyan); border-radius:8px; font-size:.82rem; font-weight:700; cursor:pointer; transition:all .2s; white-space:nowrap; }
      .afe-btn-edit:hover { background:rgba(0,229,255,.25); transform:translateY(-1px); }
      .afe-btn-del { padding:7px 14px; background:rgba(255,23,68,.1); border:1.5px solid var(--accent-red); color:var(--accent-red); border-radius:8px; font-size:.82rem; font-weight:700; cursor:pointer; transition:all .2s; white-space:nowrap; }
      .afe-btn-del:hover { background:rgba(255,23,68,.22); transform:translateY(-1px); box-shadow:0 4px 12px rgba(255,23,68,.3); }
      .afe-add-btn { padding:10px 22px; background:linear-gradient(135deg,rgba(0,230,118,.15),rgba(0,200,100,.08)); border:2px solid var(--success-green); color:var(--success-green); border-radius:10px; font-size:.9rem; font-weight:700; cursor:pointer; transition:all .2s; }
      .afe-add-btn:hover { background:rgba(0,230,118,.25); transform:translateY(-2px); box-shadow:0 6px 18px rgba(0,230,118,.3); }
      .afe-wc-btn { padding:10px 22px; background:rgba(255,215,0,.08); border:2px solid var(--border-gold); color:var(--border-gold); border-radius:10px; font-size:.9rem; font-weight:700; cursor:pointer; transition:all .2s; }
      .afe-wc-btn:hover { background:rgba(255,215,0,.18); transform:translateY(-1px); }
      .afe-actions { display:flex; gap:14px; flex-wrap:wrap; margin-top:8px; }
      .afe-save-btn { padding:13px 28px; background:linear-gradient(135deg,var(--border-gold),#FFA500); border:none; border-radius:12px; color:#000; font-size:1rem; font-weight:800; cursor:pointer; transition:all .2s; box-shadow:0 4px 16px rgba(255,215,0,.35); }
      .afe-save-btn:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(255,215,0,.5); }
      .afe-preview-btn { padding:13px 28px; background:rgba(255,255,255,.06); border:2px solid rgba(255,255,255,.2); color:var(--text-white); border-radius:12px; font-size:1rem; font-weight:700; cursor:pointer; transition:all .2s; }
      .afe-preview-btn:hover { border-color:var(--accent-cyan); color:var(--accent-cyan); }
      .afe-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.82); z-index:8000; align-items:center; justify-content:center; }
      .afe-modal { background:linear-gradient(145deg,rgba(12,18,42,.99),rgba(22,33,62,.99)); border:2px solid var(--border-gold); border-radius:18px; width:92%; max-width:520px; box-shadow:0 24px 64px rgba(255,215,0,.25); animation:fadeInUp .3s ease; overflow:hidden; }
      .afe-modal-header { background:linear-gradient(90deg,rgba(255,215,0,.1),rgba(0,229,255,.06)); padding:18px 24px; border-bottom:1px solid rgba(255,215,0,.2); display:flex; align-items:center; justify-content:space-between; font-size:1.1rem; font-weight:800; color:var(--border-gold); }
      .afe-modal-close { background:none; border:none; color:#666; font-size:1.3rem; cursor:pointer; padding:0 4px; transition:color .2s; }
      .afe-modal-close:hover { color:var(--accent-red); }
      .afe-modal-body { padding:24px; display:flex; flex-direction:column; gap:16px; max-height:70vh; overflow-y:auto; }
      .afe-modal-footer { display:flex; gap:12px; padding-top:8px; }
      .afe-modal-footer button { flex:1; }
    `;
    document.head.appendChild(s);
  }
};

window.ADMIN_FORM_EDITOR = ADMIN_FORM_EDITOR;