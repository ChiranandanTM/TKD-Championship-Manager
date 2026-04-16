
// admin-category-editor.js
import { auth, db, ref, get, set, update, onValue } from '../js/firebase.js';

let currentGender = 'male';
let weightDataCache = { male: {}, female: {} };

async function initCategoryEditor() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentGender = tab.dataset.gender;
      renderCategoryEditor();
    });
  });

  const ageSelect = document.getElementById('ageGroupSelect');
  const ageSnap = await get(ref(db, 'championship/ageGroupDefinitions'));
  const defs = ageSnap.val() || {};
  Object.keys(defs).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = defs[key].displayName || key;
    ageSelect.appendChild(opt);
  });

  onValue(ref(db, 'championship/weightRanges'), snap => {
    const data = snap.val() || { male: {}, female: {} };
    weightDataCache = data;
    renderCategoryEditor();
  });

  document.getElementById('addRangeBtn').onclick = addNewRange;
  document.getElementById('saveWeightRangesBtn').onclick = saveAllRanges;
}

async function renderCategoryEditor() {
  const container = document.getElementById('categoryEditor');
  container.innerHTML = '';

  const groups = weightDataCache[currentGender] || {};

  for (const [ageGroup, info] of Object.entries(groups)) {
    const title = await getAgeGroupName(ageGroup);
    const block = document.createElement('div');
    block.className = 'age-group-block';
    block.innerHTML = `<h3>${title}</h3>`;

    const list = document.createElement('div');
    list.className = 'range-list';

    (info.ranges || []).forEach((r, idx) => {
      const row = document.createElement('div');
      row.className = 'range-row';
      row.innerHTML = `
        <span>${r.min} – ${r.max} kg → ${r.label}</span>
        <button class="btn btn-small btn-danger remove-range" data-group="${ageGroup}" data-idx="${idx}">×</button>
      `;
      list.appendChild(row);
    });

    block.appendChild(list);
    container.appendChild(block);
  }
}

function addNewRange() {
  const groupKey = document.getElementById('ageGroupSelect').value;
  const min = parseFloat(document.getElementById('minWeight').value);
  const max = parseFloat(document.getElementById('maxWeight').value);
  const label = document.getElementById('rangeLabel').value.trim();

  if (!groupKey || isNaN(min) || isNaN(max) || !label) {
    alert("Please fill all fields correctly.");
    return;
  }

  const path = `championship/weightRanges/${currentGender}/${groupKey}/ranges`;
  get(ref(db, path)).then(snap => {
    const ranges = snap.val() || [];
    ranges.push({ min, max, label });
    update(ref(db, `championship/weightRanges/${currentGender}/${groupKey}`), { ranges });
    document.getElementById('minWeight').value = '';
    document.getElementById('maxWeight').value = '';
    document.getElementById('rangeLabel').value = '';
  });
}

document.addEventListener('click', e => {
  if (e.target.classList.contains('remove-range')) {
    const group = e.target.dataset.group;
    const idx = parseInt(e.target.dataset.idx);
    const path = `championship/weightRanges/${currentGender}/${group}/ranges`;
    get(ref(db, path)).then(snap => {
      const ranges = snap.val() || [];
      ranges.splice(idx, 1);
      update(ref(db, `championship/weightRanges/${currentGender}/${group}`), { ranges });
    });
  }
});

function saveAllRanges() {
  alert("All ranges saved (changes applied immediately).");
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.pathname.includes('dashboard.html')) {
    initCategoryEditor();
  }
});