// ── Token storage ──────────────────────────────────────────────────────────
const TOKEN_KEY = 'vocab_token';

function getToken()          { return localStorage.getItem(TOKEN_KEY); }
function setToken(t)         { localStorage.setItem(TOKEN_KEY, t); }
function clearToken()        { localStorage.removeItem(TOKEN_KEY); }

// ── API ────────────────────────────────────────────────────────────────────
const API = (window.__API_URL__ || '/api').replace(/\/$/, '');

async function apiFetch(method, path, body) {
  const opts = { method, headers: {} };
  const token = getToken();
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, opts);
  if (res.status === 401) {
    clearToken();
    replaceRoute('auth', { authMode: 'login' });
    throw new Error('Session expired — please log in again.');
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({ detail: res.statusText }));
  if (!res.ok) throw Object.assign(new Error(json.detail || 'Request failed'), { status: res.status });
  return json;
}

const api = {
  // Auth
  register:   (email, pw) => apiFetch('POST', '/auth/register', { email, password: pw }),
  login:      (email, pw) => apiFetch('POST', '/auth/login',    { email, password: pw }),
  me:         ()           => apiFetch('GET',  '/auth/me'),
  // Cards
  stats:      ()            => apiFetch('GET',    '/cards/stats'),
  due:        ()            => apiFetch('GET',    '/cards/due'),
  list:       (cat)         => apiFetch('GET',    `/cards${cat ? `?category=${cat}` : ''}`),
  get:        (id)          => apiFetch('GET',    `/cards/${id}`),
  create:     (word)        => apiFetch('POST',   '/cards', { word }),
  update:     (id, patch)   => apiFetch('PATCH',  `/cards/${id}`, patch),
  regen:      (id, field)   => apiFetch('POST',   `/cards/${id}/regenerate`, { field: field ?? null }),
  review:     (id, rating)  => apiFetch('POST',   `/cards/${id}/review`, { rating }),
  del:        (id)          => apiFetch('DELETE',  `/cards/${id}`),
};

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  view: 'auth',
  // auth
  authMode: 'login',   // 'login' | 'register'
  // home
  stats: null,
  // study
  dueCards: [],
  studyIndex: 0,
  revealStep: 0,   // 0=word 1=examples 2=explanation 3=translation
  sessionRated: 0,
  // cards list
  listCategory: null,
  listCards: [],
  // card detail
  detailCard: null,
  detailEdits: {},
};

// ── Navigation ─────────────────────────────────────────────────────────────
// Real history entries back the SPA's navigation stack. Tab-bar destinations
// (home/study/cards) use replaceState — switching tabs never grows the stack.
// Anything "pushed" on top of a tab (currently just the detail screen) uses
// pushState, so the platform back gesture / button returns to whichever tab
// screen it was opened from, and never closes the installed PWA by surprise.

function pushRoute(view, payload = {}) {
  Object.assign(state, { view, ...payload });
  history.pushState({ view, payload }, '', `#${view}`);
  refresh();
}

function replaceRoute(view, payload = {}) {
  Object.assign(state, { view, ...payload });
  history.replaceState({ view, payload }, '', `#${view}`);
  refresh();
}

function goTab(view) {
  const payload = view === 'cards' ? { listCategory: null } : {};
  replaceRoute(view, payload);
}

window.addEventListener('popstate', (e) => {
  if (!e.state) return; // fell off the bottom of our stack — let the platform handle it
  Object.assign(state, { view: e.state.view, ...e.state.payload });
  refresh();
});

async function refresh() {
  try {
    switch (state.view) {
      case 'auth':   break;
      case 'home':   await loadHome();   break;
      case 'study':  await loadStudy();  break;
      case 'cards':  await loadCards();  break;
      case 'detail': break;
    }
  } catch (e) {
    if (state.view !== 'auth') showToast(e.message, 'error');
  }
  render();
}

// ── Data loaders ───────────────────────────────────────────────────────────
async function loadHome()  { state.stats = await api.stats(); }
async function loadStudy() {
  if (state.dueCards.length === 0) {
    state.dueCards = await api.due();
    state.studyIndex = 0;
    state.revealStep = 0;
    state.sessionRated = 0;
  }
}
async function loadCards() { state.listCards = await api.list(state.listCategory); }

// ── Render ─────────────────────────────────────────────────────────────────
const TABS = [
  { view: 'home',  icon: '⌂', label: 'Home' },
  { view: 'study', icon: '▷', label: 'Study' },
  { view: 'cards', icon: '▤', label: 'Cards' },
];

function render() {
  const root = document.getElementById('app');
  const showTabbar = ['home', 'study', 'cards'].includes(state.view);
  let html;
  switch (state.view) {
    case 'auth':   html = viewAuth();   break;
    case 'home':   html = viewHome();   break;
    case 'study':  html = viewStudy();  break;
    case 'cards':  html = viewCards();  break;
    case 'detail': html = viewDetail(); break;
  }
  root.innerHTML = html + (showTabbar ? renderTabbar() : '');
}

function renderTabbar() {
  return `
  <nav class="tabbar">
    ${TABS.map(t => `
      <button class="tab ${state.view === t.view ? 'active' : ''}" data-action="tab" data-view="${t.view}">
        <span class="tab-icon">${t.icon}</span>
        <span>${t.label}</span>
      </button>`).join('')}
  </nav>`;
}

// ── View: Auth (login / register) ─────────────────────────────────────────
function viewAuth() {
  const isLogin = state.authMode === 'login';
  return `
  <div class="screen auth-screen">
    <div style="padding:0 0 2rem">
      <h1 class="auth-title">Vocab</h1>
      <p class="auth-sub">English vocabulary · spaced repetition</p>
    </div>

    <div class="card auth-card">
      <h2>${isLogin ? 'Log in' : 'Create account'}</h2>

      <div class="field-block">
        <label class="field-label" for="auth-email">Email</label>
        <input id="auth-email" class="input" type="email" placeholder="you@example.com"
               autocomplete="email" inputmode="email" autocapitalize="none" />
      </div>
      <div class="field-block">
        <label class="field-label" for="auth-password">Password</label>
        <input id="auth-password" class="input" type="password"
               placeholder="${isLogin ? '••••••••' : 'At least 8 characters'}"
               autocomplete="${isLogin ? 'current-password' : 'new-password'}" />
      </div>

      <button class="btn btn-primary btn-block" data-action="auth-submit">
        ${isLogin ? 'Log in' : 'Register'}
      </button>
    </div>

    <p class="auth-switch">
      ${isLogin ? "Don't have an account?" : 'Already have an account?'}
      <button class="btn-ghost" data-action="auth-toggle">
        ${isLogin ? 'Register' : 'Log in'}
      </button>
    </p>
  </div>`;
}

// ── View: Home ─────────────────────────────────────────────────────────────
function viewHome() {
  const s = state.stats;
  const due = s ? s.due_session : '…';
  const newC = s ? s.new : '…';
  const lrn = s ? s.learning : '…';
  const lnd = s ? s.learned : '…';

  return `
  <div class="screen screen--tabbed">
    <div class="topbar">
      <h1 style="flex:1">Vocab</h1>
      <button class="btn-ghost" style="color:var(--text-muted);font-size:var(--fs-xs)" data-action="logout">Log out</button>
    </div>

    <div class="stats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-bottom:1rem">
      <div class="card" style="text-align:center;padding:0.6rem 0.25rem">
        <div style="font-size:1.4rem;font-weight:700;color:var(--due)">${due}</div>
        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase">Due</div>
      </div>
      <div class="card" style="text-align:center;padding:0.6rem 0.25rem">
        <div style="font-size:1.4rem;font-weight:700">${newC}</div>
        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase">New</div>
      </div>
      <div class="card" style="text-align:center;padding:0.6rem 0.25rem">
        <div style="font-size:1.4rem;font-weight:700;color:var(--learning)">${lrn}</div>
        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase">Learning</div>
      </div>
      <div class="card" style="text-align:center;padding:0.6rem 0.25rem">
        <div style="font-size:1.4rem;font-weight:700;color:var(--learned)">${lnd}</div>
        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase">Learned</div>
      </div>
    </div>

    <button class="btn btn-primary btn-block" data-action="start-study" ${!due || due === 0 ? 'disabled' : ''}>
      Study${due ? ` · ${due} cards` : ''}
    </button>

    <div class="field-block" style="margin-top:1rem">
      <div style="display:flex;gap:0.5rem">
        <input id="add-input" class="input" type="text" placeholder="Add a word…" autocomplete="off"
               autocapitalize="none" spellcheck="false" />
        <button class="btn btn-secondary" data-action="add-word" style="white-space:nowrap">Add</button>
      </div>
    </div>
  </div>`;
}

// ── View: Study ────────────────────────────────────────────────────────────
function viewStudy() {
  const cards = state.dueCards;
  const total = cards.length + state.sessionRated;
  const done  = state.sessionRated;

  if (cards.length === 0) {
    return `
    <div class="screen screen--tabbed">
      <div class="complete-screen">
        <div class="big-emoji">🎉</div>
        <h2>Session complete!</h2>
        <p>You reviewed ${done} card${done !== 1 ? 's' : ''}.</p>
        <button class="btn btn-primary" style="margin-top:1rem;max-width:240px" data-action="tab" data-view="home">Back to home</button>
      </div>
    </div>`;
  }

  const card = cards[state.studyIndex];
  const step = state.revealStep;
  const pct  = Math.round((done / total) * 100);

  const examplesHtml = step >= 1 ? `
    <div class="study-section examples">
      <div class="study-section-label">Examples</div>
      <p>${highlight(card.example_1, card.word)}</p>
      <p>${highlight(card.example_2, card.word)}</p>
    </div>` : '';

  const explanationHtml = step >= 2 ? `
    <div class="study-section">
      <div class="study-section-label">Meaning</div>
      <p>${highlight(card.explanation, card.word)}</p>
    </div>` : '';

  const translationHtml = step >= 3 ? `
    <div class="study-section">
      <div class="study-section-label">Translation</div>
      <p>${highlight(card.translation, card.word)}</p>
    </div>` : '';

  const tapHint = step < 3 ? `<div class="tap-hint" data-action="reveal">tap to reveal ↓</div>` : '';

  const ratingHtml = step >= 3 ? `
    <div class="rating-row">
      <button class="btn rating-again"  data-action="rate" data-rating="again">Again</button>
      <button class="btn rating-good"   data-action="rate" data-rating="good">Good</button>
      <button class="btn rating-easy"   data-action="rate" data-rating="easy">Easy</button>
    </div>` : '';

  return `
  <div class="screen screen--tabbed">
    <div class="study-progress">
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <span class="progress-text">${done}/${total}</span>
    </div>

    <div class="study-word">${esc(card.word)}</div>
    ${examplesHtml}
    ${explanationHtml}
    ${translationHtml}
    ${tapHint}
    ${ratingHtml}
  </div>`;
}

// ── View: Cards list ───────────────────────────────────────────────────────
function viewCards() {
  const cats = [
    { key: null,        label: 'All' },
    { key: 'new',       label: 'New' },
    { key: 'learning',  label: 'Learning' },
    { key: 'learned',   label: 'Learned' },
  ];

  const tabs = cats.map(c => `
    <button class="chip ${state.listCategory === c.key ? 'active' : ''}"
            data-action="filter" data-cat="${c.key ?? ''}">
      ${c.label}
    </button>`).join('');

  const items = state.listCards.length
    ? state.listCards.map(c => `
      <div class="row" data-action="open-card" data-id="${c.id}">
        <div class="row-main">
          <div class="row-title">${esc(c.word)}</div>
        </div>
        <span class="dot dot-${c.category}"></span>
      </div>`).join('')
    : `<div class="empty"><p>No cards here yet.</p></div>`;

  return `
  <div class="screen screen--tabbed">
    <div class="topbar">
      <h1>Cards</h1>
    </div>
    <div class="chip-row" style="margin-bottom:0.875rem">${tabs}</div>
    <div class="list">${items}</div>
  </div>`;
}

// ── View: Card detail / edit ───────────────────────────────────────────────
function viewDetail() {
  const c = state.detailCard;
  if (!c) return '<div class="screen"><p style="padding:2rem">Loading…</p></div>';

  const field = (key, label) => {
    const val = state.detailEdits[key] ?? c[key];
    return `
    <div class="field-block">
      <div class="detail-field-head">
        <div class="detail-field-label">${label}</div>
        <button class="btn btn-ghost btn-sm" data-action="regen-field" data-field="${key}">↺ Regen</button>
      </div>
      <div style="position:relative">
        <textarea rows="2" data-field="${key}" class="input">${esc(val)}</textarea>
        <div class="spinner" id="spin-${key}" style="display:none;position:absolute;right:0.65rem;top:0.65rem"></div>
      </div>
    </div>`;
  };

  return `
  <div class="screen">
    <div class="topbar">
      <button class="btn-icon" data-action="back">←</button>
      <h1>${esc(c.word)}</h1>
      <button class="btn-ghost" style="color:var(--danger)" data-action="delete-card">Delete</button>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div class="field-label" style="margin-bottom:0.25rem">Status</div>
      <span class="dot dot-${c.category}" style="display:inline-block;margin-right:6px"></span>${c.category}
      ${c.next_review_at ? ` · next ${fmtDate(c.next_review_at)}` : ''}
      · interval ${c.interval_days}d · ease ${c.ease_factor.toFixed(2)}
    </div>

    ${field('example_1',   'Example 1')}
    ${field('example_2',   'Example 2')}
    ${field('explanation', 'Explanation (simple English)')}
    ${field('translation', 'Russian translation')}

    <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
      <button class="btn btn-secondary" style="flex:1" data-action="regen-all">↺ Regenerate all</button>
      <button class="btn btn-primary" style="flex:1" data-action="save-card">Save</button>
    </div>
  </div>`;
}

// ── Events ─────────────────────────────────────────────────────────────────
// A single delegated listener attached once at boot. Screens are re-rendered
// via innerHTML, but #app itself is never replaced, so this keeps working
// across every render without needing to be re-attached (the previous
// `{ once: true }` + re-attach-on-every-click pattern was fragile: any branch
// that forgot to call attachEvents() again would silently stop responding to
// clicks until the next full render).
function initEvents() {
  const app = document.getElementById('app');
  app.addEventListener('click', handleClick);
  app.addEventListener('input', handleInput);
  app.addEventListener('keydown', handleKeydown);
}

function handleInput(e) {
  if (e.target.dataset.field && e.target.matches('textarea')) {
    state.detailEdits[e.target.dataset.field] = e.target.value;
  }
}

function handleKeydown(e) {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'add-input') { doAddWord(); return; }
  if (e.target.id === 'auth-password') { doAuth(); return; }
}

async function handleClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const action = el.dataset.action;

  try {
    switch (action) {
      case 'auth-submit':    await doAuth(); break;
      case 'auth-toggle':
        state.authMode = state.authMode === 'login' ? 'register' : 'login';
        render();
        return;

      case 'logout':
        clearToken();
        state.dueCards = [];
        replaceRoute('auth', { authMode: 'login' });
        break;

      case 'tab':            goTab(el.dataset.view); break;
      case 'start-study':    goTab('study'); break;
      case 'back':           history.back(); break;

      case 'add-word':       await doAddWord(); break;

      case 'reveal':
        state.revealStep++;
        render();
        return;

      case 'rate':           await doRate(el.dataset.rating); break;

      case 'filter': {
        const cat = el.dataset.cat || null;
        state.listCategory = cat;
        await loadCards();
        render();
        return;
      }

      case 'open-card': {
        const card = await api.get(el.dataset.id);
        pushRoute('detail', { detailCard: card, detailEdits: {} });
        return;
      }

      case 'save-card':      await doSaveCard(); break;
      case 'regen-field':    await doRegenField(el.dataset.field); break;
      case 'regen-all':      await doRegenAll(); break;
      case 'delete-card':    await doDeleteCard(); break;
    }
  } catch (err) {
    showToast(err.message, 'error');
    render();
  }
}

// ── Actions ────────────────────────────────────────────────────────────────
async function doAuth() {
  const email    = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  if (!email || !password) { showToast('Enter email and password', 'error'); return; }

  showLoading(state.authMode === 'login' ? 'Logging in…' : 'Creating account…');
  try {
    const { access_token } = state.authMode === 'login'
      ? await api.login(email, password)
      : await api.register(email, password);
    setToken(access_token);
    hideLoading();
    replaceRoute('home');
  } catch (err) {
    hideLoading();
    throw err;
  }
}

async function doAddWord() {
  const input = document.getElementById('add-input');
  const word = input ? input.value.trim() : '';
  if (!word) return;

  showLoading(`Generating card for "${word}"…`);
  try {
    const card = await api.create(word);
    hideLoading();
    pushRoute('detail', { detailCard: card, detailEdits: {} });
    showToast(`"${card.word}" added!`, 'success');
  } catch (err) {
    hideLoading();
    throw err;
  }
}

async function doRate(rating) {
  const card = state.dueCards[state.studyIndex];
  await api.review(card.id, rating);
  state.dueCards.splice(state.studyIndex, 1);
  state.sessionRated++;
  state.revealStep = 0;
  if (state.studyIndex >= state.dueCards.length) state.studyIndex = 0;
  render();
}

async function doSaveCard() {
  const edits = state.detailEdits;
  if (Object.keys(edits).length === 0) { showToast('Nothing to save'); return; }
  showLoading('Saving…');
  try {
    state.detailCard = await api.update(state.detailCard.id, edits);
    state.detailEdits = {};
    hideLoading();
    render();
    showToast('Saved!', 'success');
  } catch (err) {
    hideLoading();
    throw err;
  }
}

async function doRegenField(field) {
  const spin = document.getElementById(`spin-${field}`);
  if (spin) spin.style.display = 'block';
  try {
    const updated = await api.regen(state.detailCard.id, field);
    state.detailCard = updated;
    delete state.detailEdits[field];
  } finally {
    if (spin) spin.style.display = 'none';
  }
  render();
  showToast('Regenerated!', 'success');
}

async function doRegenAll() {
  showLoading('Regenerating…');
  try {
    state.detailCard = await api.regen(state.detailCard.id, null);
    state.detailEdits = {};
    hideLoading();
    render();
    showToast('Regenerated!', 'success');
  } catch (err) {
    hideLoading();
    throw err;
  }
}

async function doDeleteCard() {
  if (!confirm(`Delete "${state.detailCard.word}"? This cannot be undone.`)) return;
  await api.del(state.detailCard.id);
  showToast('Deleted', 'success');
  history.back();
}

// ── UI helpers ─────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  document.querySelectorAll('.toast-stack').forEach(t => t.remove());
  const stack = document.createElement('div');
  stack.className = `toast-stack ${['home', 'study', 'cards'].includes(state.view) ? '' : 'toast-stack--flush'}`;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-msg">${esc(msg)}</span>`;
  stack.appendChild(t);
  document.body.appendChild(stack);
  setTimeout(() => stack.remove(), 3000);
}

function showLoading(msg = 'Loading…') {
  hideLoading();
  const overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.id = 'loading-overlay';
  overlay.innerHTML = `<div class="spinner spinner-lg"></div><p>${esc(msg)}</p>`;
  document.body.appendChild(overlay);
}

function hideLoading() {
  document.getElementById('loading-overlay')?.remove();
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlight(text, word) {
  if (!text || !word) return esc(text);
  const re = new RegExp(esc(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return esc(text).replace(re, m => `<span class="word-hi">${m}</span>`);
}

function fmtDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.round((d - now) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1 && days < 7) return `in ${days}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Boot ───────────────────────────────────────────────────────────────────
initEvents();

const initialView = getToken() ? 'home' : 'auth';
history.replaceState({ view: initialView, payload: { authMode: 'login' } }, '', `#${initialView}`);
Object.assign(state, { view: initialView, authMode: 'login' });
refresh();
