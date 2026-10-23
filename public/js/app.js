import { $, $$ } from './query.js';
import { el } from './dom.js';
import {
  fetchTraders,
  fetchTrader,
  fetchPerformance,
  fetchExchanges,
  captureUtm,
  track,
} from './api.js';
import { traderCard, profileBody, compareTable } from './render.js';

/** @typedef {import('./api.js').Trader} Trader */

const MAX_COMPARE = 3;
const grid = $('#grid');
const loading = $('#loading');
const errorBox = $('#error');
const empty = $('#empty');
const count = $('#count');
const search = /** @type {HTMLInputElement} */ ($('#search'));
const exchange = /** @type {HTMLSelectElement} */ ($('#exchange'));
const risk = /** @type {HTMLSelectElement} */ ($('#risk'));
const sort = /** @type {HTMLSelectElement} */ ($('#sort'));
const dialog = /** @type {HTMLDialogElement} */ ($('#profile-dialog'));
const compareDialog = /** @type {HTMLDialogElement} */ ($('#compare-dialog'));
const compareBar = $('#compare-bar');
const toast = $('#toast');

/** @type {Set<string>} */
const selected = new Set();
/** @type {AbortController | null} */
let inflight = null;
let toastTimer = 0;
let lastSearchTracked = '';

/** @param {string} message */
function notify(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
}

/** @param {'loading' | 'error' | 'empty' | 'grid'} state */
function show(state) {
  loading.hidden = state !== 'loading';
  errorBox.hidden = state !== 'error';
  empty.hidden = state !== 'empty';
  grid.hidden = state !== 'grid';
}

function filters() {
  return { q: search.value.trim(), exchange: exchange.value, risk: risk.value, sort: sort.value };
}

async function load() {
  inflight?.abort();
  inflight = new AbortController();
  show('loading');
  count.textContent = 'Loading…';
  try {
    const { data, total } = await fetchTraders(filters(), inflight.signal);
    count.textContent = `Showing ${data.length} of ${total} demo profile${total === 1 ? '' : 's'}`;
    if (!data.length) return show('empty');
    grid.replaceChildren(
      ...data.map((t) =>
        traderCard(t, {
          selected: selected.has(t.id),
          compareDisabled: selected.size >= MAX_COMPARE,
          onView: () => openProfile(t),
          onToggleCompare: (checked) => {
            if (checked) selected.add(t.id);
            else selected.delete(t.id);
            updateCompareBar();
            load();
          },
        }),
      ),
    );
    show('grid');
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return;
    $('#error-text').textContent =
      e instanceof Error ? e.message : 'The data service is unavailable.';
    count.textContent = 'Unavailable';
    show('error');
  }
}

function updateCompareBar() {
  compareBar.hidden = selected.size === 0;
  $('#compare-text').textContent =
    `${selected.size} selected (max ${MAX_COMPARE}). Select at least 2 to compare.`;
  /** @type {HTMLButtonElement} */ ($('#compare-open')).disabled = selected.size < 2;
}

/** @param {Trader} t */
async function openProfile(t) {
  $('#dialog-title').textContent = t.displayName;
  $('#dialog-eyebrow').textContent = t.isDemo ? '— DEMO PROFILE' : '— PROFILE';
  const body = $('#dialog-body');
  body.replaceChildren(el('p', { text: 'Loading profile…' }));
  dialog.showModal();
  track({ type: 'profile_view', traderId: t.id, exchangeId: t.exchangeId });
  try {
    const [{ data }, perf] = await Promise.all([fetchTrader(t.id), fetchPerformance(t.id)]);
    body.replaceChildren(profileBody(data, perf.data.series));
  } catch (e) {
    body.replaceChildren(
      el('p', { text: e instanceof Error ? e.message : 'Profile unavailable.' }),
    );
  }
}

async function openCompare() {
  const ids = [...selected];
  const body = $('#compare-body');
  body.replaceChildren(el('p', { text: 'Loading comparison…' }));
  compareDialog.showModal();
  track({ type: 'compare', traderIds: ids });
  try {
    const rows = await Promise.all(ids.map((id) => fetchTrader(id)));
    body.replaceChildren(
      compareTable(rows.map((r) => r.data)),
      el('p', {
        class: 'fineprint',
        text: 'Scores are provisional and descriptive. Demo profiles use synthetic data.',
      }),
    );
  } catch (e) {
    body.replaceChildren(
      el('p', { text: e instanceof Error ? e.message : 'Comparison unavailable.' }),
    );
  }
}

/** @param {number} ms @param {() => void} fn */
function debounce(ms, fn) {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

function trackFilterUse() {
  const f = filters();
  if (f.q && f.q !== lastSearchTracked) {
    lastSearchTracked = f.q;
    track({ type: 'search', usedQuery: true });
  }
  if (f.exchange || f.risk || f.sort !== 'score') {
    track({ type: 'filter', filters: { exchange: f.exchange, risk: f.risk, sort: f.sort } });
  }
}

async function init() {
  captureUtm();
  $('#year').textContent = String(new Date().getFullYear());
  try {
    const { data } = await fetchExchanges();
    for (const ex of data)
      exchange.append(
        el('option', {
          text: `${ex.name}${ex.status === 'planned' ? ' (no live data yet)' : ''}`,
          attrs: { value: ex.id },
        }),
      );
  } catch {
    // exchange filter stays at "All"; load() reports the real error state
  }
  const run = debounce(250, () => {
    trackFilterUse();
    load();
  });
  search.addEventListener('input', run);
  for (const s of [exchange, risk, sort]) s.addEventListener('change', run);
  $('#filters').addEventListener('submit', (e) => e.preventDefault());
  $('#reset').addEventListener('click', () => {
    search.value = '';
    exchange.value = '';
    risk.value = '';
    sort.value = 'score';
    load();
    search.focus();
  });
  $('#retry').addEventListener('click', load);
  $('#compare-open').addEventListener('click', openCompare);
  $('#compare-clear').addEventListener('click', () => {
    selected.clear();
    updateCompareBar();
    load();
  });
  for (const d of [dialog, compareDialog]) {
    $('.close', d).addEventListener('click', () => d.close());
    d.addEventListener('click', (event) => {
      if (event.target === d) d.close();
    });
  }
  const menu = $('.menu');
  const nav = $('#nav');
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    nav.classList.toggle('open', open);
  });
  for (const link of $$('a', nav)) {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      menu.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-label', 'Open navigation');
    });
  }
  $('#dismiss-notice').addEventListener('click', () => {
    $('#demo-notice').hidden = true;
    notify('Reminder: all trader profiles use synthetic demo data.');
  });
  updateCompareBar();
  await load();
}

init();
