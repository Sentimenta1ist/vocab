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
  sessionTotal: 0, // fixed once when the session's due cards are first fetched
  // cards list
  listCategory: null,
  listCards: [],
  cardSearch: '',
  // card detail
  detailCard: null,
  detailEdits: {},
  editingFields: {},   // { [field]: true } — fields switched to inline edit mode for this visit
  detailMenuOpen: false,
  // home: recently-added cards, optimistic in-flight/failed adds prepended
  recentCards: [],
  pendingAdds: [], // { localId, word, status: 'pending'|'error', error? }
};

let pendingAddSeq = 0;

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

function openDetail(card) {
  pushRoute('detail', {
    detailCard: card,
    detailEdits: {},
    editingFields: {},
    detailMenuOpen: false,
  });
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
async function loadHome() {
  const [stats, allCards] = await Promise.all([api.stats(), api.list()]);
  state.stats = stats;
  state.recentCards = allCards.slice(0, 8); // list() is already created_at desc
}
async function loadStudy() {
  if (state.dueCards.length === 0) {
    state.dueCards = await api.due();
    state.studyIndex = 0;
    state.revealStep = 0;
    state.sessionRated = 0;
    state.sessionTotal = state.dueCards.length; // fixed for the whole session, not recomputed per render
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
  const loaded = !!s;
  const due  = loaded ? s.due_session : 0;
  const newC = loaded ? s.new      : 0;
  const lrn  = loaded ? s.learning : 0;
  const lnd  = loaded ? s.learned  : 0;
  const totalCards = newC + lrn + lnd;

  const heroBody = !loaded ? `
      <div class="hero-count">…</div>
      <div class="hero-label">loading</div>` :
    due > 0 ? `
      <div class="hero-count">${due}</div>
      <div class="hero-label">${due === 1 ? 'card to review' : 'cards to review'}</div>` : `
      <div class="empty-emoji">✅</div>
      <div class="hero-label">All caught up</div>`;

  const studyLabel = !loaded ? 'Study'
    : due > 0 ? `Study · ${due} card${due === 1 ? '' : 's'}`
    : 'Nothing due right now';

  const segbar = totalCards > 0 ? `
    <div class="segbar">
      <div class="segbar-seg new"      style="flex:${newC} 0 auto"></div>
      <div class="segbar-seg learning" style="flex:${lrn} 0 auto"></div>
      <div class="segbar-seg learned"  style="flex:${lnd} 0 auto"></div>
    </div>
    <div class="seglegend">
      <span><b>${newC}</b> new</span>
      <span><b>${lrn}</b> learning</span>
      <span><b>${lnd}</b> learned</span>
    </div>` : '';

  return `
  <div class="screen screen--composer">
    <div class="topbar">
      <h1 style="flex:1">Vocab</h1>
      <button class="btn-ghost" style="color:var(--text-muted);font-size:var(--fs-xs)" data-action="logout">Log out</button>
    </div>

    <div class="hero">
      ${heroBody}
      <button class="btn btn-primary btn-block" style="margin-top:var(--sp-5)" data-action="start-study" ${!due ? 'disabled' : ''}>
        ${studyLabel}
      </button>
    </div>

    ${segbar}

    <div class="section-title">Recently added</div>
    <div class="list" id="recent-list">${buildRecentListHtml()}</div>

    <div class="composer">
      <div style="flex:1">
        <input id="add-input" class="input" type="text" placeholder="Add a word…" autocomplete="off"
               autocapitalize="none" spellcheck="false" />
        <div class="input-hint error" id="add-hint" hidden>Enter a word first</div>
      </div>
      <button class="btn btn-primary" data-action="add-word" style="white-space:nowrap">Add</button>
    </div>
  </div>`;
}

function buildRecentListHtml() {
  const pending = state.pendingAdds.map(renderPendingRow);
  const done = state.recentCards.map(renderCardRow);
  const items = pending.concat(done).slice(0, 8);
  return items.length ? items.join('') : `<div class="empty"><p>No words yet — add your first one below.</p></div>`;
}

function renderCardRow(c) {
  return `
  <div class="row" data-action="open-card" data-id="${c.id}">
    <div class="row-main"><div class="row-title">${esc(c.word)}</div></div>
    <span class="dot dot-${c.category}"></span>
  </div>`;
}

function renderPendingRow(entry) {
  if (entry.status === 'error') {
    return `
    <div class="row row-error">
      <div class="row-main">
        <div class="row-title">${esc(entry.word)}</div>
        <div class="row-sub">${esc(entry.error)}</div>
      </div>
      <div class="row-actions">
        <button class="btn btn-sm btn-secondary" data-action="retry-add" data-local-id="${entry.localId}">Retry</button>
        <button class="btn-icon" data-action="dismiss-add" data-local-id="${entry.localId}">✕</button>
      </div>
    </div>`;
  }
  return `
  <div class="row row-pending">
    <div class="row-main"><div class="row-title">${esc(entry.word)}</div></div>
    <div class="spinner"></div>
  </div>`;
}

function renderRecentList() {
  const el = document.getElementById('recent-list');
  if (el) el.innerHTML = buildRecentListHtml();
}

// Mirrors the interval arithmetic in backend/app/services/srs_service.py::
// compute_next_review (kept in sync by hand — this is only a client-side
// preview label for the rating buttons; the server response is always the
// actual source of truth for what a rating does to the card).
function previewIntervalDays(card, rating) {
  if (rating === 'again') return 1;
  if (card.repetitions === 0) return 1;
  if (card.repetitions === 1) return 6;
  return Math.round(card.interval_days * card.ease_factor);
}

function intervalLabel(days) { return `${days}d`; }

// ── View: Study ────────────────────────────────────────────────────────────
function viewStudy() {
  const cards = state.dueCards;
  const total = state.sessionTotal;
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
  const pct  = total > 0 ? Math.round((done / total) * 100) : 0;

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
      <button class="btn rating-btn rating-again" data-action="rate" data-rating="again">
        <span>Again</span><span class="rating-btn-sub">${intervalLabel(previewIntervalDays(card, 'again'))}</span>
      </button>
      <button class="btn rating-btn rating-good" data-action="rate" data-rating="good">
        <span>Good</span><span class="rating-btn-sub">${intervalLabel(previewIntervalDays(card, 'good'))}</span>
      </button>
      <button class="btn rating-btn rating-easy" data-action="rate" data-rating="easy">
        <span>Easy</span><span class="rating-btn-sub">${intervalLabel(previewIntervalDays(card, 'easy'))}</span>
      </button>
    </div>` : '';

  return `
  <div class="screen screen--tabbed">
    <div class="study-progress">
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <span class="progress-text">${done}/${total}</span>
    </div>

    <div class="study-word" data-action="view-studied-card">${esc(card.word)}</div>
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

  return `
  <div class="screen screen--tabbed">
    <div class="topbar">
      <h1>Cards</h1>
    </div>
    <div class="field-block">
      <input id="cards-search" class="input" type="search" placeholder="Search word or translation…"
             autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(state.cardSearch)}" />
    </div>
    <div class="chip-row" style="margin-bottom:0.875rem">${tabs}</div>
    <div class="list" id="cards-list">${buildCardsListHtml()}</div>
  </div>`;
}

function dueLabel(c) {
  if (c.category === 'new') return 'new';
  if (!c.next_review_at) return '';
  const days = Math.round((new Date(c.next_review_at) - new Date()) / 86400000);
  if (days <= 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days}d`;
}

function buildCardsListHtml() {
  const q = state.cardSearch.trim().toLowerCase();
  const filtered = q
    ? state.listCards.filter(c => c.word.toLowerCase().includes(q) || c.translation.toLowerCase().includes(q))
    : state.listCards;

  if (filtered.length === 0) {
    return q
      ? `<div class="empty"><p>No matches for "${esc(state.cardSearch.trim())}".</p></div>`
      : `<div class="empty"><p>No cards here yet.</p></div>`;
  }

  return filtered.map(c => `
    <div class="row" data-action="open-card" data-id="${c.id}">
      <div class="row-main">
        <div class="row-title">${esc(c.word)}</div>
        <div class="row-sub">${esc(c.translation)}</div>
      </div>
      <div class="row-meta-row">
        <span class="dot dot-${c.category}"></span>
        <span class="row-meta">${dueLabel(c)}</span>
      </div>
    </div>`).join('');
}

function renderCardsList() {
  const el = document.getElementById('cards-list');
  if (el) el.innerHTML = buildCardsListHtml();
}

// ── View: Card detail / edit ───────────────────────────────────────────────
function viewDetail() {
  const c = state.detailCard;
  if (!c) return '<div class="screen"><p style="padding:2rem">Loading…</p></div>';

  const isDirty = Object.keys(state.detailEdits).length > 0;

  // Read mode by default; tapping a field's text switches it (permanently,
  // for the rest of this visit) into an editable textarea — see handleClick's
  // 'edit-field' case for why there's no auto-revert-to-read on blur.
  const field = (key, label) => {
    const val = state.detailEdits[key] ?? c[key];
    const editing = !!state.editingFields[key];
    const body = editing
      ? `<textarea rows="2" data-field="${key}" class="input" autofocus>${esc(val)}</textarea>`
      : `<div class="detail-field-body" data-action="edit-field" data-field="${key}">${esc(val)}</div>`;
    return `
    <div class="detail-field">
      <div class="detail-field-head">
        <div class="detail-field-label">${label}</div>
        <button class="btn-icon" data-action="regen-field" data-field="${key}" aria-label="Regenerate ${label}">
          <span id="spin-${key}" class="regen-icon">↺</span>
        </button>
      </div>
      ${body}
    </div>`;
  };

  const menu = state.detailMenuOpen ? `
    <div class="sheet-backdrop" data-action="close-menu"></div>
    <div class="sheet">
      <button class="sheet-action" data-action="regen-all">↺ Regenerate all</button>
      <button class="sheet-action danger" data-action="delete-card">Delete card</button>
      <button class="sheet-action cancel" data-action="close-menu">Cancel</button>
    </div>` : '';

  return `
  <div class="screen">
    <div class="topbar">
      <button class="btn-icon" data-action="back">←</button>
      <h1>${esc(c.word)}</h1>
      <button class="btn-icon" data-action="open-menu">⋯</button>
    </div>

    <div class="detail-word">${esc(c.word)}</div>

    ${field('translation',  'Translation')}
    ${field('explanation',  'Explanation')}
    ${field('example_1',    'Example 1')}
    ${field('example_2',    'Example 2')}

    <div class="detail-meta">
      <span class="dot dot-${c.category}" style="display:inline-block;margin-right:6px"></span><b>${c.category}</b>
      ${c.next_review_at ? ` · next ${fmtDate(c.next_review_at)}` : ''}
      · interval ${c.interval_days}d · ease ${c.ease_factor.toFixed(2)}
    </div>

    ${isDirty ? `
    <div class="save-bar">
      <button class="btn btn-secondary" data-action="discard-edits">Discard</button>
      <button class="btn btn-primary" data-action="save-card">Save</button>
    </div>` : ''}

    ${menu}
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
  if (e.target.id === 'add-input') {
    e.target.classList.remove('input-error');
    const hint = document.getElementById('add-hint');
    if (hint) hint.hidden = true;
  }
  if (e.target.id === 'cards-search') {
    state.cardSearch = e.target.value;
    renderCardsList();
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

      case 'tab':            if (confirmLeaveIfDirty()) goTab(el.dataset.view); break;
      case 'start-study':    goTab('study'); break;
      case 'back':           if (confirmLeaveIfDirty()) history.back(); break;

      case 'add-word':       doAddWord(); return; // sync: clears+refocuses input immediately, add runs in background
      case 'retry-add':      retryAdd(Number(el.dataset.localId)); return;
      case 'dismiss-add':    dismissAdd(Number(el.dataset.localId)); return;

      case 'reveal':
        state.revealStep++;
        render();
        return;

      case 'rate':           await doRate(el.dataset.rating); break;

      case 'view-studied-card':
        openDetail(state.dueCards[state.studyIndex]);
        return;

      case 'filter': {
        const cat = el.dataset.cat || null;
        state.listCategory = cat;
        await loadCards();
        render();
        return;
      }

      case 'open-card': {
        const card = await api.get(el.dataset.id);
        openDetail(card);
        return;
      }

      case 'edit-field':
        state.editingFields[el.dataset.field] = true;
        render();
        document.querySelector(`textarea[data-field="${el.dataset.field}"]`)?.focus();
        return;

      case 'discard-edits':
        state.detailEdits = {};
        state.editingFields = {};
        render();
        return;

      case 'open-menu':      state.detailMenuOpen = true;  render(); return;
      case 'close-menu':     state.detailMenuOpen = false; render(); return;

      case 'save-card':      await doSaveCard(); break;
      case 'regen-field':    await doRegenField(el.dataset.field); break;
      case 'regen-all':      state.detailMenuOpen = false; await doRegenAll(); break;
      case 'delete-card':    state.detailMenuOpen = false; await doDeleteCard(); break;
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

function doAddWord() {
  const input = document.getElementById('add-input');
  const word = input ? input.value.trim() : '';
  const hint = document.getElementById('add-hint');

  if (!word) {
    input?.classList.add('input-error');
    if (hint) hint.hidden = false;
    input?.focus();
    return;
  }

  input.classList.remove('input-error');
  if (hint) hint.hidden = true;
  input.value = '';
  input.focus(); // stays focused — renderRecentList() below only touches #recent-list, never the composer

  startAdd(word);
}

function startAdd(word) {
  const localId = ++pendingAddSeq;
  state.pendingAdds.unshift({ localId, word, status: 'pending' });
  renderRecentList();

  api.create(word).then(card => {
    state.pendingAdds = state.pendingAdds.filter(p => p.localId !== localId);
    state.recentCards = [card, ...state.recentCards.filter(c => c.id !== card.id)];
    renderRecentList();
    showToast(`"${card.word}" added`, 'success', {
      actionLabel: 'Edit',
      onAction: () => openDetail(card),
    });
  }).catch(err => {
    const entry = state.pendingAdds.find(p => p.localId === localId);
    if (entry) { entry.status = 'error'; entry.error = err.message; }
    renderRecentList();
  });
}

function retryAdd(localId) {
  const entry = state.pendingAdds.find(p => p.localId === localId);
  if (!entry) return;
  entry.status = 'pending';
  entry.error = undefined;
  renderRecentList();
  api.create(entry.word).then(card => {
    state.pendingAdds = state.pendingAdds.filter(p => p.localId !== localId);
    state.recentCards = [card, ...state.recentCards.filter(c => c.id !== card.id)];
    renderRecentList();
    showToast(`"${card.word}" added`, 'success', {
      actionLabel: 'Edit',
      onAction: () => openDetail(card),
    });
  }).catch(err => {
    entry.status = 'error';
    entry.error = err.message;
    renderRecentList();
  });
}

function dismissAdd(localId) {
  state.pendingAdds = state.pendingAdds.filter(p => p.localId !== localId);
  renderRecentList();
}

async function doRate(rating) {
  const card = state.dueCards[state.studyIndex];
  const wasLearned = card.category === 'learned';
  await api.review(card.id, rating);
  state.dueCards.splice(state.studyIndex, 1);
  state.sessionRated++;
  state.revealStep = 0;
  if (state.studyIndex >= state.dueCards.length) state.studyIndex = 0;
  render();
  if (rating === 'again' && wasLearned) showToast('back to learning', 'info');
}

function hasUnsavedEdits() {
  return state.view === 'detail' && Object.keys(state.detailEdits).length > 0;
}

function confirmLeaveIfDirty() {
  return !hasUnsavedEdits() || confirm('Discard unsaved changes to this card?');
}

const REGEN_FIELDS = ['example_1', 'example_2', 'explanation', 'translation'];

async function doSaveCard() {
  const edits = state.detailEdits;
  if (Object.keys(edits).length === 0) { showToast('Nothing to save'); return; }
  showLoading('Saving…');
  try {
    state.detailCard = await api.update(state.detailCard.id, edits);
    state.detailEdits = {};
    state.editingFields = {};
    hideLoading();
    render();
    showToast('Saved!', 'success');
  } catch (err) {
    hideLoading();
    throw err;
  }
}

function offerUndo(previousValues) {
  showToast('Regenerated', 'success', {
    actionLabel: 'Undo',
    duration: 10000,
    onAction: async () => {
      try {
        state.detailCard = await api.update(state.detailCard.id, previousValues);
        render();
        showToast('Reverted', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    },
  });
}

async function doRegenField(field) {
  const spin = document.getElementById(`spin-${field}`);
  spin?.classList.add('spinning');
  const previousValues = { [field]: state.detailCard[field] };
  try {
    state.detailCard = await api.regen(state.detailCard.id, field);
    delete state.detailEdits[field];
  } finally {
    spin?.classList.remove('spinning');
  }
  render();
  offerUndo(previousValues);
}

async function doRegenAll() {
  const previousValues = Object.fromEntries(REGEN_FIELDS.map(f => [f, state.detailCard[f]]));
  showLoading('Regenerating…');
  try {
    state.detailCard = await api.regen(state.detailCard.id, null);
    state.detailEdits = {};
    state.editingFields = {};
    hideLoading();
    render();
    offerUndo(previousValues);
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
function showToast(msg, type = 'info', opts = {}) {
  document.querySelectorAll('.toast-stack').forEach(t => t.remove());
  const { actionLabel, onAction, duration = actionLabel ? 5000 : 3000 } = opts;

  const stack = document.createElement('div');
  stack.className = `toast-stack ${['home', 'study', 'cards'].includes(state.view) ? '' : 'toast-stack--flush'}`;

  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-msg">${esc(msg)}</span>` +
    (actionLabel ? `<button class="toast-action">${esc(actionLabel)}</button>` : '');
  stack.appendChild(t);
  document.body.appendChild(stack);

  if (actionLabel && onAction) {
    t.querySelector('.toast-action').addEventListener('click', () => {
      stack.remove();
      onAction();
    });
  }
  setTimeout(() => stack.remove(), duration);
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
