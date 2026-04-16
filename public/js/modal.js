// ============================================
// CUSTOM MODAL SYSTEM - Replace Browser Alerts/Confirms
// ============================================

const MODAL = {
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
      modalDiv.id = 'customAlertModal';
      document.body.appendChild(modalDiv);

      // Store resolve function for closing
      window.modalResolve = () => {
        modalDiv.remove();
        resolve();
      };
    });
  },

  // Close alert
  closeAlert() {
    const modal = document.getElementById('customAlertModal');
    if (modal) {
      modal.remove();
    }
    if (window.modalResolve) {
      window.modalResolve();
    }
  },

  // Show custom confirm dialog
  showConfirm(message, title = '🔒 Confirmation') {
    return new Promise((resolve) => {
      console.log("📋 Creating confirm dialog with message:", message);
      
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
      modalDiv.id = 'customConfirmModal';
      document.body.appendChild(modalDiv);

      // Store resolve function
      window.confirmResolve = resolve;
      window._modalDiv = modalDiv;
      console.log("✅ Modal created, waiting for user response...");
    });
  },

  // Internal confirm OK handler
  _confirmOK() {
    console.log("✅ Confirm OK clicked");
    if (window._modalDiv) {
      window._modalDiv.remove();
      console.log("✅ Modal removed");
    }
    if (window.confirmResolve) {
      console.log("✅ Resolving with true");
      window.confirmResolve(true);
      delete window.confirmResolve;
      delete window._modalDiv;
    }
  },

  // Internal confirm Cancel handler
  _confirmCancel() {
    console.log("❌ Confirm cancelled");
    if (window._modalDiv) {
      window._modalDiv.remove();
      console.log("❌ Modal removed");
    }
    if (window.confirmResolve) {
      console.log("❌ Resolving with false");
      window.confirmResolve(false);
      delete window.confirmResolve;
      delete window._modalDiv;
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
