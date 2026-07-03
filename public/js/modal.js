// ============================================
// CUSTOM MODAL SYSTEM - Replace Browser Alerts/Confirms
// ============================================

const MODAL = {
  // Stack of currently-open alert/confirm dialogs, most-recently-opened
  // last. Each entry owns its own DOM node + resolve callback instead of
  // sharing a single global slot — so if a dialog opens again before the
  // previous one was dismissed (e.g. a double-clicked button, or two async
  // calls racing), every dialog still gets its own working OK/Cancel
  // instead of the newest one silently overwriting the previous one's
  // resolver and leaving its overlay stuck on screen forever (blocking all
  // clicks until a page reload).
  _stack: [],

  // Show custom alert message on website
  showAlert(message, title = '⚠️ Message', type = 'info') {
    return new Promise((resolve) => {
      const modalHTML = `
        <div class="custom-modal-overlay" onclick="if(event.target === this) MODAL.closeAlert()">
          <div class="custom-modal-content modal-${type}">
            <div class="custom-modal-header">
              <h2>${title}</h2>
              <button class="custom-modal-close" onclick="MODAL.closeAlert()">✕</button>
            </div>
            <div class="custom-modal-body">
              <p>${message.replace(/\n/g, '<br>')}</p>
            </div>
            <div class="custom-modal-footer">
              <button class="btn-primary" onclick="MODAL.closeAlert()">OK</button>
            </div>
          </div>
        </div>
      `;

      // Create modal element
      const modalDiv = document.createElement('div');
      modalDiv.innerHTML = modalHTML;
      document.body.appendChild(modalDiv);

      this._stack.push({ div: modalDiv, resolve, kind: 'alert' });
    });
  },

  // Close alert
  closeAlert() {
    this._closeTop('alert', undefined);
  },

  // Show custom confirm dialog
  showConfirm(message, title = '🔒 Confirmation') {
    return new Promise((resolve) => {
      const modalHTML = `
        <div class="custom-modal-overlay" onclick="if(event.target === this) MODAL._confirmCancel()">
          <div class="custom-modal-content modal-warning">
            <div class="custom-modal-header">
              <h2>${title}</h2>
              <button class="custom-modal-close" onclick="MODAL._confirmCancel()">✕</button>
            </div>
            <div class="custom-modal-body">
              <p>${message.replace(/\n/g, '<br>')}</p>
            </div>
            <div class="custom-modal-footer">
              <button class="btn-secondary" onclick="MODAL._confirmCancel()">Cancel</button>
              <button class="btn-primary" onclick="MODAL._confirmOK()">OK</button>
            </div>
          </div>
        </div>
      `;

      // Create modal element
      const modalDiv = document.createElement('div');
      modalDiv.innerHTML = modalHTML;
      document.body.appendChild(modalDiv);

      this._stack.push({ div: modalDiv, resolve, kind: 'confirm' });
    });
  },

  // Internal confirm OK handler
  _confirmOK() {
    this._closeTop('confirm', true);
  },

  // Internal confirm Cancel handler
  _confirmCancel() {
    this._closeTop('confirm', false);
  },

  // Resolve + remove the most recently opened dialog of the given kind.
  // Newer dialogs render on top of (and fully cover) older ones, so the
  // topmost entry of that kind is always the one the click actually came
  // from — closing it reveals any earlier dialog still underneath rather
  // than leaving it stuck forever.
  _closeTop(kind, value) {
    for (let i = this._stack.length - 1; i >= 0; i--) {
      if (this._stack[i].kind === kind) {
        const [entry] = this._stack.splice(i, 1);
        entry.div.remove();
        entry.resolve(value);
        return;
      }
    }
  },

  // Show toast notification (temporary message)
  showToast(message, type = 'success', duration = 3000) {
    const toastHTML = `
      <div class="custom-toast toast-${type}">
        <span>${message}</span>
      </div>
    `;

    const toastDiv = document.createElement('div');
    toastDiv.innerHTML = toastHTML;
    toastDiv.className = 'toast-container';
    document.body.appendChild(toastDiv);

    // Auto remove after duration
    setTimeout(() => {
      toastDiv.remove();
    }, duration);
  },

  // Show success message
  success(message, title = '✅ Success') {
    return this.showAlert(message, title, 'success');
  },

  // Show error message
  error(message, title = '❌ Error') {
    return this.showAlert(message, title, 'error');
  },

  // Show warning message
  warning(message, title = '⚠️ Warning') {
    return this.showAlert(message, title, 'warning');
  },

  // Show info message
  info(message, title = 'ℹ️ Information') {
    return this.showAlert(message, title, 'info');
  }
};

// Global access
window.MODAL = MODAL;
