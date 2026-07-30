// Renders the app-comparison grid on compare.html from assets/data/apps.json.
// Fully data-driven: no app names, scores, or feature rows are hardcoded here.
// DOM is built with createElement/textContent only — never innerHTML with
// fetched data — so a compromised or malformed data file cannot inject markup.

const DATA_URL = '/assets/data/apps.json';

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function createAvatar(app, extraClass) {
  const wrap = document.createElement('div');
  wrap.className = 'compare-app-logo';
  if (extraClass) wrap.classList.add(extraClass);
  if (typeof app.logo === 'string' && app.logo) {
    const img = document.createElement('img');
    img.src = app.logo;
    img.alt = '';
    img.width = 40;
    img.height = 40;
    img.loading = 'lazy';
    wrap.appendChild(img);
  } else {
    wrap.classList.add('compare-app-logo-fallback');
    const initial = typeof app.name === 'string' && app.name.trim() ? app.name.trim()[0].toUpperCase() : '?';
    wrap.textContent = initial;
    wrap.setAttribute('aria-hidden', 'true');
  }
  return wrap;
}

function createMeter(labelText, score) {
  const clamped = clampScore(score);

  const meter = document.createElement('div');
  meter.className = 'compare-meter';

  const labelRow = document.createElement('div');
  labelRow.className = 'compare-meter-label';
  const label = document.createElement('span');
  label.textContent = labelText;
  const value = document.createElement('span');
  value.className = 'compare-meter-value';
  value.textContent = String(clamped);
  labelRow.append(label, value);

  const track = document.createElement('div');
  track.className = 'compare-meter-track';
  track.setAttribute('role', 'img');
  track.setAttribute('aria-label', `${labelText}: ${clamped} out of 100`);
  const marker = document.createElement('span');
  marker.className = 'compare-meter-marker';
  marker.style.left = `${clamped}%`;
  track.appendChild(marker);

  meter.append(labelRow, track);
  return meter;
}

function createMeters(app) {
  const meters = document.createElement('div');
  meters.className = 'compare-meters';
  const scores = app.scores || {};
  meters.append(
    createMeter('Overall', scores.overall),
    createMeter('Privacy Score', scores.privacy),
    createMeter('Features Score', scores.features),
  );
  return meters;
}

function createMarkCell(value) {
  const mark = document.createElement('span');
  let cls, glyph, label;
  if (value === 'partial') {
    cls = 'compare-mark-partial';
    glyph = '◐';
    label = 'Partial';
  } else if (value) {
    cls = 'compare-mark-yes';
    glyph = '✓';
    label = 'Yes';
  } else {
    cls = 'compare-mark-no';
    glyph = '✕';
    label = 'No';
  }
  mark.className = `compare-mark ${cls}`;
  mark.textContent = glyph;
  mark.setAttribute('aria-label', label);
  return mark;
}

function createComparisonTable(app, osl, features) {
  const table = document.createElement('table');
  table.className = 'compare-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const headFeature = document.createElement('th');
  headFeature.scope = 'col';
  headFeature.textContent = 'Feature';
  const headApp = document.createElement('th');
  headApp.scope = 'col';
  headApp.textContent = app.name;
  const headOsl = document.createElement('th');
  headOsl.scope = 'col';
  headOsl.className = 'compare-col-osl';
  headOsl.textContent = osl.name;
  headRow.append(headFeature, headApp, headOsl);
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  features.forEach((feature) => {
    const row = document.createElement('tr');
    const featureCell = document.createElement('th');
    featureCell.scope = 'row';
    featureCell.textContent = feature.label;

    const appCell = document.createElement('td');
    appCell.append(createMarkCell(app.values && app.values[feature.key]));

    const oslCell = document.createElement('td');
    oslCell.className = 'compare-col-osl';
    oslCell.append(createMarkCell(osl.values && osl.values[feature.key]));

    row.append(featureCell, appCell, oslCell);
    tbody.appendChild(row);
  });

  table.append(thead, tbody);
  return table;
}

/* ------------------------------------------------------------------ */
/* Bottom-sheet flyout: one reusable modal <dialog> that slides up and */
/* dims the page, populated per app when "See more" is pressed.        */
/* ------------------------------------------------------------------ */

let sheet = null;
let sheetTitle = null;
let sheetBody = null;
let lastTrigger = null;

function ensureSheet() {
  if (sheet) return sheet;

  sheet = document.createElement('dialog');
  sheet.className = 'compare-sheet';
  sheet.setAttribute('aria-labelledby', 'compare-sheet-title');

  const inner = document.createElement('div');
  inner.className = 'compare-sheet-inner';

  const topbar = document.createElement('div');
  topbar.className = 'compare-sheet-topbar';
  const grip = document.createElement('span');
  grip.className = 'compare-sheet-grip';
  grip.setAttribute('aria-hidden', 'true');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'compare-sheet-close';
  close.setAttribute('aria-label', 'Close comparison');
  close.textContent = '✕';
  close.addEventListener('click', closeSheet);
  topbar.append(grip, close);

  sheetBody = document.createElement('div');
  sheetBody.className = 'compare-sheet-scroll';

  inner.append(topbar, sheetBody);
  sheet.appendChild(inner);
  document.body.appendChild(sheet);

  // Click on the dimmed area outside the sheet content closes it.
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) closeSheet();
  });
  // Native Escape ("cancel") — let it close, but run our teardown.
  sheet.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeSheet();
  });
  sheet.addEventListener('close', () => {
    document.documentElement.classList.remove('compare-sheet-open');
    if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
    lastTrigger = null;
  });

  return sheet;
}

function openSheet(app, osl, features, trigger) {
  ensureSheet();
  lastTrigger = trigger || null;

  sheetBody.textContent = '';

  const head = document.createElement('header');
  head.className = 'compare-sheet-head';
  head.appendChild(createAvatar(app, 'compare-sheet-avatar'));
  const heading = document.createElement('div');
  const title = document.createElement('h2');
  title.id = 'compare-sheet-title';
  title.className = 'compare-sheet-title';
  title.textContent = app.name || 'App';
  const sub = document.createElement('p');
  sub.className = 'compare-sheet-sub';
  sub.textContent = `Compared with ${osl.name}`;
  heading.append(title, sub);
  head.appendChild(heading);

  const meters = createMeters(app);
  meters.classList.add('compare-sheet-meters');

  const tableWrap = document.createElement('div');
  tableWrap.className = 'compare-sheet-table';
  tableWrap.appendChild(createComparisonTable(app, osl, features));

  sheetBody.append(head, meters, tableWrap);
  sheetBody.scrollTop = 0;

  document.documentElement.classList.add('compare-sheet-open');
  if (typeof sheet.showModal === 'function') {
    sheet.showModal();
  } else {
    sheet.setAttribute('open', '');
  }
}

function closeSheet() {
  if (!sheet) return;
  if (typeof sheet.close === 'function' && sheet.open) {
    sheet.close();
  } else {
    sheet.removeAttribute('open');
    document.documentElement.classList.remove('compare-sheet-open');
  }
}

function createCard(app, osl, features) {
  const card = document.createElement('article');
  card.className = 'compare-card';
  card.dataset.appName = (app.name || '').toLowerCase();

  const head = document.createElement('div');
  head.className = 'compare-card-head';
  head.appendChild(createAvatar(app));
  const name = document.createElement('h3');
  name.className = 'compare-app-name';
  name.textContent = app.name || 'Unknown app';
  head.appendChild(name);
  card.appendChild(head);

  card.appendChild(createMeters(app));

  const seeMore = document.createElement('button');
  seeMore.type = 'button';
  seeMore.className = 'button button-secondary compare-see-more';
  seeMore.textContent = 'See more';
  seeMore.addEventListener('click', () => openSheet(app, osl, features, seeMore));
  card.appendChild(seeMore);

  return card;
}

// OSL's own benchmark card, pinned first and highlighted — this is the
// reference every app is measured against, so its scores are shown up front.
function createOslCard(osl) {
  const card = document.createElement('article');
  card.className = 'compare-card compare-card-osl';

  const head = document.createElement('div');
  head.className = 'compare-card-head';
  head.appendChild(createAvatar(osl));

  const heading = document.createElement('div');
  heading.className = 'compare-osl-heading';
  const name = document.createElement('h3');
  name.className = 'compare-app-name';
  name.textContent = osl.name || 'OSL Privacy';
  const badge = document.createElement('span');
  badge.className = 'compare-osl-badge';
  badge.textContent = 'The benchmark';
  heading.append(name, badge);
  head.appendChild(heading);
  card.appendChild(head);

  card.appendChild(createMeters(osl));

  const cta = document.createElement('a');
  cta.className = 'button button-primary compare-osl-cta';
  cta.href = '/download';
  cta.textContent = 'Get OSL';
  card.appendChild(cta);

  return card;
}

function setStatus(statusElement, message) {
  if (!statusElement) return;
  if (message) {
    statusElement.textContent = message;
    statusElement.hidden = false;
  } else {
    statusElement.textContent = '';
    statusElement.hidden = true;
  }
}

// How closely an app name matches the query: name prefix > word prefix >
// substring. 0 means no match.
function matchRank(name, query) {
  if (name.startsWith(query)) return 3;
  if (name.includes(' ' + query)) return 2;
  if (name.includes(query)) return 1;
  return 0;
}

function bestMatches(apps, query, limit) {
  return apps
    .map((app) => ({ app, rank: matchRank((app.name || '').toLowerCase(), query) }))
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => (
      b.rank - a.rank
      || a.app.name.length - b.app.name.length
      || a.app.name.localeCompare(b.app.name)
    ))
    .slice(0, limit)
    .map((entry) => entry.app);
}

// Type-ahead search: shows the two closest apps; picking one opens its flyout.
function wireSearch(searchInput, data) {
  if (!searchInput) return;
  const form = searchInput.closest('form') || searchInput.parentElement;
  if (!form) return;

  const box = document.createElement('div');
  box.className = 'compare-suggestions';
  box.setAttribute('role', 'listbox');
  box.hidden = true;
  form.appendChild(box);

  let matches = [];
  let activeIndex = -1;

  const close = () => {
    box.hidden = true;
    box.textContent = '';
    matches = [];
    activeIndex = -1;
    searchInput.setAttribute('aria-expanded', 'false');
  };

  const highlight = (index) => {
    const buttons = [...box.querySelectorAll('.compare-suggestion')];
    if (buttons.length === 0) return;
    activeIndex = (index + buttons.length) % buttons.length;
    buttons.forEach((btn, i) => btn.classList.toggle('is-active', i === activeIndex));
  };

  const pick = (app) => {
    if (!app) return;
    openSheet(app, data.osl, data.features, searchInput);
    close();
  };

  const render = () => {
    const query = searchInput.value.trim().toLowerCase();
    box.textContent = '';
    activeIndex = -1;
    if (!query) { close(); return; }

    matches = bestMatches(data.apps, query, 2);
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'compare-suggestion-empty';
      empty.textContent = 'No apps match your search.';
      box.appendChild(empty);
    } else {
      matches.forEach((app) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'compare-suggestion';
        btn.setAttribute('role', 'option');
        btn.appendChild(createAvatar(app));

        const name = document.createElement('span');
        name.className = 'compare-suggestion-name';
        name.textContent = app.name;

        const score = document.createElement('span');
        score.className = 'compare-suggestion-score';
        const value = document.createElement('b');
        value.textContent = String(clampScore(app.scores && app.scores.overall));
        score.append('Overall ', value);

        btn.append(name, score);
        btn.addEventListener('click', () => pick(app));
        box.appendChild(btn);
      });
    }
    box.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  };

  searchInput.addEventListener('input', render);
  searchInput.addEventListener('focus', render);
  searchInput.addEventListener('keydown', (event) => {
    if (box.hidden) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(activeIndex - 1);
    } else if (event.key === 'Enter') {
      if (matches.length > 0) {
        event.preventDefault();
        pick(matches[activeIndex >= 0 ? activeIndex : 0]);
      }
    } else if (event.key === 'Escape') {
      close();
    }
  });
  document.addEventListener('click', (event) => {
    if (!form.contains(event.target)) close();
  });
}

async function loadComparisonData() {
  const response = await fetch(DATA_URL, { credentials: 'omit' });
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  const data = await response.json();
  if (
    !data
    || typeof data !== 'object'
    || !Array.isArray(data.features)
    || !data.osl
    || typeof data.osl !== 'object'
    || !Array.isArray(data.apps)
  ) {
    throw new Error('Comparison data has an unexpected shape.');
  }
  return data;
}

function initializeCompare() {
  const grid = document.getElementById('compare-grid');
  const searchInput = document.getElementById('compare-search-input');
  const statusElement = document.getElementById('compare-status');
  if (!grid) return;

  loadComparisonData()
    .then((data) => {
      const fragment = document.createDocumentFragment();
      data.apps.forEach((app) => {
        fragment.appendChild(createCard(app, data.osl, data.features));
      });
      grid.textContent = '';
      grid.appendChild(createOslCard(data.osl));
      grid.appendChild(fragment);
      wireSearch(searchInput, data);
    })
    .catch(() => {
      grid.textContent = '';
      setStatus(statusElement, 'Comparison data unavailable.');
    });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCompare);
  } else {
    initializeCompare();
  }
}
