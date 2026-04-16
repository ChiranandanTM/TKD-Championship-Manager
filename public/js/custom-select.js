/**
 * Custom Select Dropdown Implementation
 * Replaces native select elements with fully customizable dropdown
 */

class CustomSelect {
  constructor(selectElement) {
    this.select = selectElement;
    this.isOpen = false;
    this.init();
  }

  init() {
    // Create wrapper
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'custom-select-wrapper';
    this.wrapper.setAttribute('data-field-id', this.select.id);

    // Create display element
    this.display = document.createElement('div');
    this.display.className = 'custom-select-display';
    this.display.innerHTML = this.select.options[this.select.selectedIndex].text;

    // Create dropdown menu
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'custom-select-dropdown';

    // Populate options
    this.populateOptions();

    // Assemble wrapper
    this.wrapper.appendChild(this.display);
    this.wrapper.appendChild(this.dropdown);

    // Replace native select with custom select
    this.select.style.display = 'none';
    this.select.parentNode.insertBefore(this.wrapper, this.select.nextSibling);

    // Add event listeners
    this.display.addEventListener('click', () => this.toggleDropdown());
    this.wrapper.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.closeDropdown());
  }

  populateOptions() {
    this.dropdown.innerHTML = '';
    
    Array.from(this.select.options).forEach((option, index) => {
      const optionElement = document.createElement('div');
      optionElement.className = 'custom-option';
      optionElement.textContent = option.text;
      optionElement.setAttribute('data-value', option.value);
      
      if (this.select.selectedIndex === index) {
        optionElement.classList.add('selected');
      }

      optionElement.addEventListener('click', () => {
        this.select.selectedIndex = index;
        this.select.value = option.value;
        this.display.textContent = option.text;
        this.closeDropdown();
        
        // Trigger change event
        const event = new Event('change', { bubbles: true });
        this.select.dispatchEvent(event);
      });

      this.dropdown.appendChild(optionElement);
    });
  }

  toggleDropdown() {
    if (this.isOpen) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }

  openDropdown() {
    this.isOpen = true;
    this.wrapper.classList.add('open');
    this.dropdown.style.display = 'block';
  }

  closeDropdown() {
    this.isOpen = false;
    this.wrapper.classList.remove('open');
    this.dropdown.style.display = 'none';
  }

  destroy() {
    this.select.style.display = '';
    this.wrapper.remove();
  }
}

/**
 * Initialize all select elements as custom dropdowns
 */
function initializeCustomSelects() {
  const selects = document.querySelectorAll('select:not([data-custom-initialized])');
  selects.forEach(select => {
    new CustomSelect(select);
    select.setAttribute('data-custom-initialized', 'true');
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeCustomSelects);
} else {
  initializeCustomSelects();
}

// Also reinitialize when new forms are added (for dynamic content)
window.addEventListener('customSelectReinit', initializeCustomSelects);
