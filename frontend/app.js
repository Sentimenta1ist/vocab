'use strict';

// ── Token storage ──────────────────────────────────────────────────────────
const TOKEN_KEY = 'vocab_token';

function getToken()          { return localStorage.getItem(TOKEN_KEY); }
function setToken(t)         { localStorage.setItem(TOKEN_KEY, t); }
function clearToken()        { localStorage.removeItem(TOKEN_KEY); }

// ── API ────────────────────────────────────────────────────────────────────
const API = '/api';

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
    Object.assign(state, { view: 'auth', authMode: 'login' });
    render();
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
async function navigate(view, payload = {}) {
  Object.assign(state, { view, ...payload });
  await refresh();
}

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
function render() {
  const root = document.getElementById('app');
  switch (state.view) {
    case 'auth':   root.innerHTML = viewAuth();   break;
    case 'home':   root.innerHTML = viewHome();   break;
    case 'study':  root.innerHTML = viewStudy();  break;
    case 'cards':  root.innerHTML = viewCards();  break;
    case 'detail': root.innerHTML = viewDetail(); break;
  }
  attachEvents();
}

// ── View: Auth (login / register) ─────────────────────────────────────────
function viewAuth() {
  const isLogin = state.authMode === 'login';
  return `
  <div class="screen" style="justify-content:center;min-height:100dvh">
    <div style="padding:0 0 2rem">
      <h1 style="font-size:2rem;font-weight:800;margin-bottom:0.25rem">Vocab</h1>
      <p style="color:var(--muted);font-size:0.9rem">English vocabulary · spaced repetition</p>
    </div>

    <div class="card" style="padding:1.5rem">
      <h2 style="font-size:1.1rem;font-weight:700;margin-bottom:1.25rem">
        ${isLogin ? 'Log in' : 'Create account'}
      </h2>

      <div class="field-block">
        <input id="auth-email" type="email" placeholder="Email"
               autocomplete="${isLogin ? 'email' : 'email'}"
               inputmode="email" autocapitalize="none" />
      </div>
      <div class="field-block">
        <input id="auth-password" type="password"
               placeholder="${isLogin ? 'Password' : 'Password (8+ characters)'}"
               autocomplete="${isLogin ? 'current-password' : 'new-password'}" />
      </div>

      <button class="btn btn-primary" data-action="auth-submit" style="margin-top:0.25rem">
        ${isLogin ? 'Log in' : 'Register'}
      </button>
    </div>

    <p style="text-align:center;margin-top:1.25rem;font-size:0.875rem;color:var(--muted)">
      ${isLogin ? "Don't have an account?" : 'Already have an account?'}
      <button class="btn-ghost" style="font-size:0.875rem" data-action="auth-toggle">
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
  <div class="screen">
    <div class="topbar">
      <h1>Vocab</h1>
      <button class="btn-ghost" data-action="go-cards">All cards</button>
      <button class="btn-ghost" style="color:var(--muted)" data-action="logout">Log out</button>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value" style="color:var(--blue)">${due}</div>
        <div class="stat-label">Due</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color:#6B7280">${newC}</div>
        <div class="stat-label">New</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color:var(--yellow)">${lrn}</div>
        <div class="stat-label">Learning</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color:var(--green)">${lnd}</div>
        <div class="stat-label">Learned</div>
      </div>
    </div>

    <button class="btn btn-primary" data-action="start-study" ${!due || due === 0 ? 'disabled' : ''}>
      Study${due ? ` · ${due} cards` : ''}
    </button>

    <hr class="divider" style="margin-top:1rem" />

    <div class="field-block" style="margin-top:0.25rem">
      <div class="input-row">
        <input id="add-input" type="text" placeholder="Add a word…" autocomplete="off"
               autocapitalize="none" spellcheck="false" />
        <button class="btn btn-outline btn-sm" data-action="add-word" style="white-space:nowrap">Add</button>
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
    <div class="screen">
      <div class="topbar">
        <button class="btn-ghost" data-action="go-home">← Home</button>
      </div>
      <div class="complete-screen">
        <div class="big-emoji">🎉</div>
        <h2>Session complete!</h2>
        <p>You reviewed ${done} card${done !== 1 ? 's' : ''}.</p>
        <button class="btn btn-primary" style="margin-top:1rem;max-width:240px" data-action="go-home">Back to home</button>
      </div>
    </div>`;
  }

  const card = cards[state.studyIndex];
  const step = state.revealStep;
  const pct  = Math.round((done / total) * 100);

  const examplesHtml = step >= 1 ? `
    <div class="study-section examples">
      <div class="study-section-label">Examples</div>
      <p>${esc(card.example_1)}</p>
      <p>${esc(card.example_2)}</p>
    </div>` : '';

  const explanationHtml = step >= 2 ? `
    <div class="study-section">
      <div class="study-section-label">Meaning</div>
      <p>${esc(card.explanation)}</p>
    </div>` : '';

  const translationHtml = step >= 3 ? `
    <div class="study-section">
      <div class="study-section-label">Translation</div>
      <p>${esc(card.translation)}</p>
    </div>` : '';

  const tapHint = step < 3 ? `<div class="tap-hint" data-action="reveal">tap to reveal ↓</div>` : '';

  const ratingHtml = step >= 3 ? `
    <div class="rating-row">
      <button class="btn btn-danger"  data-action="rate" data-rating="again">Again</button>
      <button class="btn btn-warning" data-action="rate" data-rating="good">Good</button>
      <button class="btn btn-success" data-action="rate" data-rating="easy">Easy</button>
    </div>` : '';

  return `
  <div class="screen">
    <div class="topbar">
      <button class="btn-ghost" data-action="go-home">← Home</button>
      <div class="study-progress" style="flex:1;margin-left:0.75rem">
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="progress-text">${done}/${total}</span>
      </div>
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
    <button class="tab ${state.listCategory === c.key ? 'active' : ''}"
            data-action="filter" data-cat="${c.key ?? ''}">
      ${c.label}
    </button>`).join('');

  const items = state.listCards.length
    ? state.listCards.map(c => `
      <div class="word-item" data-action="open-card" data-id="${c.id}">
        <div class="word-item-word">${esc(c.word)}</div>
        <span class="badge badge-${c.category}">${c.category}</span>
      </div>`).join('')
    : `<div class="empty"><p>No cards here yet.</p></div>`;

  return `
  <div class="screen">
    <div class="topbar">
      <button class="btn-ghost" data-action="go-home">← Home</button>
      <h1 style="flex:1;text-align:center">Cards</h1>
      <span style="width:4rem"></span>
    </div>
    <div class="filter-tabs">${tabs}</div>
    ${items}
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
      <div class="field-label">
        ${label}
        <div class="field-actions">
          <button class="btn btn-outline btn-sm" data-action="regen-field" data-field="${key}">↺ Regen</button>
        </div>
      </div>
      <div class="edit-area-wrap">
        <textarea rows="2" data-field="${key}" class="field-textarea">${esc(val)}</textarea>
        <div class="spinner-inline" id="spin-${key}"></div>
      </div>
    </div>`;
  };

  return `
  <div class="screen">
    <div class="topbar">
      <button class="btn-ghost" data-action="go-back-cards">← Cards</button>
      <h1 style="flex:1;text-align:center">${esc(c.word)}</h1>
      <button class="btn-ghost" style="color:var(--red)" data-action="delete-card">Delete</button>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div class="stat-label" style="margin-bottom:0.25rem">Status</div>
      <span class="badge badge-${c.category}">${c.category}</span>
      ${c.next_review_at ? ` · next ${fmtDate(c.next_review_at)}` : ''}
      · interval ${c.interval_days}d · ease ${c.ease_factor.toFixed(2)}
    </div>

    ${field('example_1',   'Example 1')}
    ${field('example_2',   'Example 2')}
    ${field('explanation', 'Explanation (simple English)')}
    ${field('translation', 'Russian translation')}

    <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
      <button class="btn btn-outline" style="flex:1" data-action="regen-all">↺ Regenerate all</button>
      <button class="btn btn-primary" style="flex:1" data-action="save-card">Save</button>
    </div>
  </div>`;
}

// ── Events ─────────────────────────────────────────────────────────────────
function attachEvents() {
  document.getElementById('app').addEventListener('click', handleClick, { once: true, capture: false });
  document.getElementById('app').addEventListener('input', handleInput);

  // Enter key on add-word input
  const addInput = document.getElementById('add-input');
  if (addInput) {
    addInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAddWord(); });
  }

  // Enter key on auth form
  const authPassword = document.getElementById('auth-password');
  if (authPassword) {
    authPassword.addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
  }
}

function handleInput(e) {
  if (e.target.dataset.field && e.target.classList.contains('field-textarea')) {
    state.detailEdits[e.target.dataset.field] = e.target.value;
  }
}

async function handleClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) { attachEvents(); return; }

  const action = el.dataset.action;

  try {
    switch (action) {
      case 'auth-submit':    await doAuth(); break;
      case 'auth-toggle':
        state.authMode = state.authMode === 'login' ? 'register' : 'login';
        render();
        attachEvents();
        return;

      case 'logout':
        clearToken();
        state.dueCards = [];
        await navigate('auth', { authMode: 'login' });
        break;

      case 'go-home':        state.dueCards = []; await navigate('home'); break;
      case 'go-cards':       await navigate('cards', { listCategory: null }); break;
      case 'go-back-cards':  await navigate('cards'); break;
      case 'start-study':    await navigate('study'); break;

      case 'add-word':       await doAddWord(); break;

      case 'reveal':
        state.revealStep++;
        render();
        attachEvents();
        return;

      case 'rate':           await doRate(el.dataset.rating); break;

      case 'filter': {
        const cat = el.dataset.cat || null;
        state.listCategory = cat;
        await loadCards();
        render();
        attachEvents();
        return;
      }

      case 'open-card': {
        const card = await api.get(el.dataset.id);
        state.detailCard = card;
        state.detailEdits = {};
        state.view = 'detail';
        render();
        attachEvents();
        return;
      }

      case 'save-card':      await doSaveCard(); break;
      case 'regen-field':    await doRegenField(el.dataset.field); break;
      case 'regen-all':      await doRegenAll(); break;
      case 'delete-card':    await doDeleteCard(); break;
    }
  } catch (err) {
    showToast(err.message, 'error');
  }

  attachEvents();
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
    await navigate('home');
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
    state.detailCard = card;
    state.detailEdits = {};
    state.view = 'detail';
    render();
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
  await navigate('cards');
}

// ── UI helpers ─────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function showLoading(msg = 'Loading…') {
  hideLoading();
  const overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.id = 'loading-overlay';
  overlay.innerHTML = `<div class="spinner"></div><p>${esc(msg)}</p>`;
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

function fmtDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.round((d - now) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1 && days < 7) return `in ${days}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Service Worker ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Boot ───────────────────────────────────────────────────────────────────
if (getToken()) {
  navigate('home');
} else {
  navigate('auth', { authMode: 'login' });
}
