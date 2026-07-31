// ============================================
// DOB CALENDAR PICKER - Mobile-friendly calendar for date-of-birth fields
// Replaces the native OS date wheel (which forces lots of scrolling to
// reach an old birth year) with a tap-friendly calendar that jumps straight
// to any month/year via dropdowns.
// ============================================

(function () {
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  let activeInput = null;
  let viewYear = null;
  let viewMonth = null; // 0-11
  let overlayEl = null;

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function parseISO(value) {
    if (!value) return null;
    const parts = value.split('-').map(Number);
    const [y, m, d] = parts;
    if (!y || !m || !d) return null;
    return { y, m: m - 1, d };
  }

  function buildOverlay() {
    if (overlayEl) return overlayEl;

    overlayEl = document.createElement('div');
    overlayEl.className = 'dob-calendar-overlay';
    overlayEl.innerHTML = `
      <div class="dob-calendar-card" role="dialog" aria-modal="true" aria-label="Select date of birth">
        <div class="dob-calendar-header">
          <button type="button" class="dob-cal-nav" data-nav="prev" aria-label="Previous month">&lsaquo;</button>
          <select class="dob-cal-month" aria-label="Month"></select>
          <select class="dob-cal-year" aria-label="Year"></select>
          <button type="button" class="dob-cal-nav" data-nav="next" aria-label="Next month">&rsaquo;</button>
        </div>
        <div class="dob-calendar-weekdays">
          <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
        </div>
        <div class="dob-calendar-grid"></div>
        <div class="dob-calendar-footer">
          <button type="button" class="btn-secondary dob-cal-today">Today</button>
          <button type="button" class="btn-secondary dob-cal-close">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlayEl);

    const monthSelect = overlayEl.querySelector('.dob-cal-month');
    MONTH_NAMES.forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = name;
      monthSelect.appendChild(opt);
    });

    const yearSelect = overlayEl.querySelector('.dob-cal-year');
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= currentYear - 100; y--) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      yearSelect.appendChild(opt);
    }

    monthSelect.addEventListener('change', () => {
      viewMonth = Number(monthSelect.value);
      renderGrid();
    });
    yearSelect.addEventListener('change', () => {
      viewYear = Number(yearSelect.value);
      renderGrid();
    });

    overlayEl.querySelector('[data-nav="prev"]').addEventListener('click', () => shiftMonth(-1));
    overlayEl.querySelector('[data-nav="next"]').addEventListener('click', () => shiftMonth(1));
    overlayEl.querySelector('.dob-cal-today').addEventListener('click', () => {
      const now = new Date();
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
      syncHeaderSelects();
      renderGrid();
    });
    overlayEl.querySelector('.dob-cal-close').addEventListener('click', close);
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlayEl.classList.contains('open')) close();
    });

    return overlayEl;
  }

  function syncHeaderSelects() {
    overlayEl.querySelector('.dob-cal-month').value = String(viewMonth);
    overlayEl.querySelector('.dob-cal-year').value = String(viewYear);
  }

  function shiftMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    syncHeaderSelects();
    renderGrid();
  }

  function renderGrid() {
    const grid = overlayEl.querySelector('.dob-calendar-grid');
    grid.innerHTML = '';

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const selected = activeInput ? parseISO(activeInput.value) : null;
    const today = new Date();
    const maxDate = activeInput && activeInput.max ? parseISO(activeInput.max) : null;
    const minDate = activeInput && activeInput.min ? parseISO(activeInput.min) : null;
    const maxTime = maxDate ? new Date(maxDate.y, maxDate.m, maxDate.d).getTime() : null;
    const minTime = minDate ? new Date(minDate.y, minDate.m, minDate.d).getTime() : null;

    for (let i = 0; i < firstDay; i++) {
      grid.appendChild(document.createElement('span'));
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'dob-cal-day';
      cell.textContent = String(d);

      const isSelected = !!selected && selected.y === viewYear && selected.m === viewMonth && selected.d === d;
      if (isSelected) cell.classList.add('selected');

      const isToday = today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === d;
      if (isToday && !isSelected) cell.classList.add('today');

      const cellTime = new Date(viewYear, viewMonth, d).getTime();
      const outOfRange = (maxTime !== null && cellTime > maxTime) || (minTime !== null && cellTime < minTime);
      if (outOfRange) {
        cell.disabled = true;
        cell.classList.add('disabled');
      } else {
        cell.addEventListener('click', () => selectDate(viewYear, viewMonth, d));
      }

      grid.appendChild(cell);
    }
  }

  function selectDate(y, m, d) {
    if (!activeInput) return;
    const value = `${y}-${pad(m + 1)}-${pad(d)}`;
    activeInput.value = value;
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    activeInput.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  }

  function open(input) {
    activeInput = input;
    buildOverlay();

    const existing = parseISO(input.value);
    const now = new Date();
    viewYear = existing ? existing.y : now.getFullYear() - 12;
    viewMonth = existing ? existing.m : now.getMonth();

    syncHeaderSelects();
    renderGrid();
    overlayEl.classList.add('open');
  }

  function close() {
    if (overlayEl) overlayEl.classList.remove('open');
    activeInput = null;
  }

  // Mouse-driven devices (desktop/laptop) get to type the date directly into
  // the native segmented date input, in addition to the calendar button.
  // Touch devices (no fine pointer) stay calendar-only, since that's what
  // avoids the janky native OS date wheel this picker was built to replace.
  function isTypingFriendlyDevice() {
    return !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
  }

  function attach(input) {
    if (!input || input.dataset.dobPickerAttached === '1') return;
    input.dataset.dobPickerAttached = '1';

    const trigger = input.parentElement ? input.parentElement.querySelector('.dob-calendar-trigger') : null;
    const canType = isTypingFriendlyDevice();

    if (canType) {
      input.readOnly = false;
    } else {
      input.addEventListener('click', () => open(input));
      input.addEventListener('focus', () => open(input));
    }

    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        open(input);
      });
    }
  }

  window.DOB_PICKER = { attach };
})();
