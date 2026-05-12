/* ============================================================
   Quiz Triggers — prototype interactions
   Type-adaptive UI for 5 quiz types: number / percentage /
   right_wrong / personality / survey.
============================================================ */

(function () {
  'use strict';

  // ============================================================
  // SEED DATA — realistic quizzes that demonstrate every quiz type
  // ============================================================

  const QUIZZES = {
    'photography-101': {
      id: 'photography-101',
      name: 'Photography 101',
      type: 'number',
      typeLabel: 'Number score',
      typeIcon: '🔢',
      maxPoints: 300,          // <-- realistic: NOT 100. Comes from sum(tge_answers.points)
      minPoints: 0,
      questionCount: 12,
      completions: 1247,
      meta: '12 questions · point sum',
      defaultRanges: [
        { id: 'r1', label: 'Beginner', min: 0,   max: 80,  color: '#dc2626' },
        { id: 'r2', label: 'Intermediate', min: 81,  max: 180, color: '#d97706' },
        { id: 'r3', label: 'Advanced', min: 181, max: 300, color: '#059669' }
      ]
    },
    'css-mastery': {
      id: 'css-mastery',
      name: 'CSS Mastery',
      type: 'percentage',
      typeLabel: 'Percentage score',
      typeIcon: '%',
      maxPoints: 100,
      minPoints: 0,
      questionCount: 20,
      completions: 4632,
      meta: '20 questions · 0–100%',
      defaultRanges: [
        { id: 'r1', label: 'Needs review', min: 0,  max: 49, color: '#dc2626' },
        { id: 'r2', label: 'Almost there', min: 50, max: 79, color: '#d97706' },
        { id: 'r3', label: 'Mastery', min: 80, max: 100, color: '#059669' }
      ]
    },
    'wp-cert': {
      id: 'wp-cert',
      name: 'WordPress Certification',
      type: 'right_wrong',
      typeLabel: 'Right/Wrong',
      typeIcon: '✓',
      questionCount: 12,
      completions: 892,
      meta: '12 questions · pass = all correct',
      passRule: 'This quiz passes when all questions are correct.',
      buckets: [
        { id: 'pass', state: 'pass', label: 'Passed', sub: 'User got all questions correct.' },
        { id: 'fail', state: 'fail', label: 'Failed', sub: 'User missed at least one question.' }
      ]
    },
    'marketing-archetype': {
      id: 'marketing-archetype',
      name: "What's Your Marketing Archetype?",
      type: 'personality',
      typeLabel: 'Personality',
      typeIcon: '🎭',
      questionCount: 10,
      completions: 2103,
      meta: '4 personality results · 10 questions',
      // These come from the tqb_results table — read-only here
      personalityResults: [
        { id: 'p1', label: 'The Strategist' },
        { id: 'p2', label: 'The Creator' },
        { id: 'p3', label: 'The Analyst' },
        { id: 'p4', label: 'The Communicator' }
      ]
    },
    'customer-csat': {
      id: 'customer-csat',
      name: 'Customer Satisfaction Survey',
      type: 'survey',
      typeLabel: 'Survey',
      typeIcon: '📊',
      questionCount: 6,
      completions: 412,
      meta: '6 questions · no scoring',
      // Surveys have a single fixed bucket that catches every completion,
      // regardless of which answers were picked. Mirror of right_wrong's buckets array.
      buckets: [
        {
          id: 'completion',
          state: 'completion',
          label: 'On completion',
          sub: 'Fires for every user who finishes this survey, regardless of which answers they picked.'
        }
      ]
    }
  };

  // ============================================================
  // ACTION DEFINITIONS — shared across quiz types
  // ============================================================

  const ACTIONS = {
    tag: {
      id: 'tag',
      name: 'Email tag',
      icon: '📩',
      desc: 'Tag the user in your email tool (Mailchimp, ConvertKit, ActiveCampaign, etc.).',
      mutex: 'esp',
    },
    webhook: {
      id: 'webhook',
      name: 'Send Webhook',
      icon: '↗',
      desc: 'Fire an HTTP request to any URL with the quiz result.',
      mutex: 'esp',
    },
    ultimatum: {
      id: 'ultimatum',
      name: 'Ultimatum Campaign',
      icon: '⏱',
      desc: 'Start or stop an Ultimatum countdown for the user.',
      hasSubop: true,
    },
    grant: {
      id: 'grant',
      name: 'Grant Apprentice Access',
      icon: '🎓',
      desc: 'Give the user access to another Apprentice course.',
    }
  };

  // ============================================================
  // STATE
  // ============================================================

  const STORAGE_KEY = 'tqb-result-actions-prototype-v2';

  const state = {
    view: 'list',                // 'list' | 'quiz'
    currentQuizId: 'photography-101',
    quizConfigs: {},
    bannerDismissed: false,
    dashboardQuizIds: [],        // quizzes the user has explicitly added; ordered MRU
    addPickerOpen: false,        // inline add-picker on the populated dashboard
    comboOpen: false,
    comboQuery: '',
    addComboQuery: '',
    flow: {
      bucketId: null,
      editing: null,
      stage: 'picker',
      pickedAction: null,
      pickedSubop: null,
      draftConfig: {}
    }
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        seedDefaults();
        return;
      }
      const saved = JSON.parse(raw);
      Object.assign(state, saved);
      // Ensure all quizzes have a config slot
      seedDefaults();
    } catch (e) {
      seedDefaults();
    }
  }

  function seedDefaults() {
    Object.keys(QUIZZES).forEach(id => {
      if (!state.quizConfigs[id]) {
        const q = QUIZZES[id];
        const cfg = { ranges: [], actions: {} };
        if (q.type === 'number' || q.type === 'percentage') {
          // Seed with the quiz's default ranges
          cfg.ranges = (q.defaultRanges || []).map(r => ({ ...r }));
        } else if (q.type === 'right_wrong' || q.type === 'survey') {
          // Right/Wrong has fixed Pass/Fail buckets; survey has one fixed "On completion" bucket
          cfg.ranges = q.buckets.map(b => ({ ...b }));
        } else if (q.type === 'personality') {
          cfg.ranges = q.personalityResults.map(r => ({ id: r.id, label: r.label }));
        }
        cfg.ranges.forEach(r => { cfg.actions[r.id] = cfg.actions[r.id] || []; });
        state.quizConfigs[id] = cfg;
      }
    });
    // Seed a couple of demo actions on Photography 101 so reviewers see real content
    const photo = state.quizConfigs['photography-101'];
    if (photo && photo.ranges.length && photo.actions['r3'] && photo.actions['r3'].length === 0) {
      photo.actions['r3'].push({
        id: 'a-seed-1',
        type: 'tag',
        enabled: true,
        config: { provider: 'FluentCRM', tags: ['certified', 'advanced-photographer'] }
      });
      photo.actions['r3'].push({
        id: 'a-seed-2',
        type: 'grant',
        enabled: true,
        config: { product: 'Advanced Lighting Masterclass' }
      });
    }
    if (photo && photo.actions['r1'] && photo.actions['r1'].length === 0) {
      photo.actions['r1'].push({
        id: 'a-seed-3',
        type: 'ultimatum',
        subop: 'start',
        enabled: true,
        config: { campaign: '7-day retake offer' }
      });
    }
    // WordPress Certification — Active status (both Pass and Fail wired)
    const wp = state.quizConfigs['wp-cert'];
    if (wp && wp.actions['pass'] && wp.actions['pass'].length === 0) {
      wp.actions['pass'].push({
        id: 'a-wp-pass-1',
        type: 'tag',
        enabled: true,
        config: { provider: 'ActiveCampaign', tags: ['wp-certified'] }
      });
      wp.actions['pass'].push({
        id: 'a-wp-pass-2',
        type: 'grant',
        enabled: true,
        config: { product: 'Certified Members area' }
      });
    }
    if (wp && wp.actions['fail'] && wp.actions['fail'].length === 0) {
      wp.actions['fail'].push({
        id: 'a-wp-fail-1',
        type: 'tag',
        enabled: true,
        config: { provider: 'ActiveCampaign', tags: ['wp-needs-retake'] }
      });
    }
    // Marketing Archetype — Partial status (1 of 4 results wired)
    const mark = state.quizConfigs['marketing-archetype'];
    if (mark && mark.actions['p1'] && mark.actions['p1'].length === 0) {
      mark.actions['p1'].push({
        id: 'a-mark-strat-1',
        type: 'tag',
        enabled: true,
        config: { provider: 'Mailchimp', tags: ['archetype-strategist'] }
      });
    }
    // Customer Satisfaction Survey — Active status (one action on the completion bucket)
    const csat = state.quizConfigs['customer-csat'];
    if (csat && csat.actions['completion'] && csat.actions['completion'].length === 0) {
      csat.actions['completion'].push({
        id: 'a-csat-1',
        type: 'tag',
        enabled: true,
        config: { provider: 'FluentCRM', tags: ['csat-completed'] }
      });
    }
    // Seed the dashboard with all 5 quizzes — surveys now work too
    if (!state.dashboardQuizIds || state.dashboardQuizIds.length === 0) {
      state.dashboardQuizIds = ['photography-101', 'wp-cert', 'marketing-archetype', 'css-mastery', 'customer-csat'];
    }
  }

  function saveState() {
    try {
      const toSave = {
        view: state.view,
        currentQuizId: state.currentQuizId,
        dashboardQuizIds: state.dashboardQuizIds,
        quizConfigs: state.quizConfigs,
        bannerDismissed: state.bannerDismissed
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {/* ignore */}
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function el(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function currentQuiz() { return QUIZZES[state.currentQuizId]; }
  function currentConfig() { return state.quizConfigs[state.currentQuizId]; }

  function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function unitFor(quiz) {
    if (quiz.type === 'percentage') return '%';
    if (quiz.type === 'number') return 'pts';
    return '';
  }

  // ============================================================
  // QUIZ PICKER
  // ============================================================

  function openQuizPicker() {
    const sheet = el('quizPickerSheet');
    const list = el('qpList');
    list.innerHTML = Object.values(QUIZZES).map(q => `
      <li>
        <button class="qp-item ${q.id === state.currentQuizId ? 'is-current' : ''}" data-quiz="${q.id}">
          <span class="qpi-icon" aria-hidden="true">${q.typeIcon}</span>
          <span class="qpi-body">
            <div class="qpi-title">${escapeHtml(q.name)}</div>
            <div class="qpi-meta">${escapeHtml(q.typeLabel)} · ${escapeHtml(q.meta)}</div>
          </span>
        </button>
      </li>
    `).join('');
    sheet.hidden = false;
    el('bcQuizPicker').setAttribute('aria-expanded', 'true');
    // Focus first item
    setTimeout(() => { const first = list.querySelector('.qp-item'); if (first) first.focus(); }, 0);
  }

  function closeQuizPicker() {
    el('quizPickerSheet').hidden = true;
    el('bcQuizPicker').setAttribute('aria-expanded', 'false');
  }

  function switchQuiz(id) {
    if (!QUIZZES[id]) return;
    state.currentQuizId = id;
    state.view = 'quiz';
    // Reset flow
    state.flow = { bucketId: null, editing: null, stage: 'picker', pickedAction: null, pickedSubop: null, draftConfig: {} };
    saveState();
    renderAll();
    closeQuizPicker();
    toast(`Switched to "${QUIZZES[id].name}"`, 'info', 2200);
  }

  // ============================================================
  // RENDER
  // ============================================================

  // ----- Per-quiz status used by the list view -----

  function getQuizStatus(quizId) {
    const q = QUIZZES[quizId];
    const cfg = state.quizConfigs[quizId];
    // 1) Quiz-level on/off — overrides everything else
    if (cfg && cfg.enabled === false) {
      return { pill: 'inactive', label: 'Disabled', summary: 'Triggers are turned off for this quiz.' };
    }
    const ranges = (cfg && cfg.ranges) || [];
    const totalBuckets = ranges.length;
    let bucketsWithActions = 0;
    let totalActions = 0;
    let enabledActions = 0;
    ranges.forEach(r => {
      const acts = (cfg.actions && cfg.actions[r.id]) || [];
      if (acts.length) bucketsWithActions++;
      totalActions += acts.length;
      acts.forEach(a => { if (a.enabled !== false) enabledActions++; });
    });
    const bucketWord = q.type === 'personality' ? (totalBuckets === 1 ? 'result' : 'results') : (totalBuckets === 1 ? 'range' : 'ranges');
    // 2) Active — every bucket has at least one firing action
    if (totalBuckets > 0 && bucketsWithActions === totalBuckets && enabledActions > 0) {
      return { pill: 'active', label: 'Active', summary: `${totalBuckets} ${bucketWord} · ${enabledActions} action${enabledActions === 1 ? '' : 's'} firing` };
    }
    // 3) Partial setup — everything else (no ranges yet, some buckets unconfigured, all actions paused)
    if (totalBuckets === 0) {
      return { pill: 'partial', label: 'Partial setup', summary: 'No ranges configured yet.' };
    }
    if (bucketsWithActions === 0) {
      // For surveys (1 fixed bucket), surface a friendlier "no actions on completion yet"
      if (q.type === 'survey') {
        return { pill: 'partial', label: 'Partial setup', summary: 'No actions on completion yet.' };
      }
      return { pill: 'partial', label: 'Partial setup', summary: `${totalBuckets} ${bucketWord} · no actions yet` };
    }
    return { pill: 'partial', label: 'Partial setup', summary: `${bucketsWithActions} of ${totalBuckets} ${bucketWord} configured · ${enabledActions} action${enabledActions === 1 ? '' : 's'} firing` };
  }

  function formatNum(n) { return (n || 0).toLocaleString(); }

  function buildQuizMetaLine(quiz) {
    if (quiz.type === 'number') return `${quiz.typeLabel} · ${quiz.maxPoints} pts max · ${quiz.questionCount} questions`;
    if (quiz.type === 'percentage') return `${quiz.typeLabel} · 0–100% · ${quiz.questionCount} questions`;
    if (quiz.type === 'right_wrong') return `${quiz.typeLabel} · ${quiz.questionCount} questions · pass/fail`;
    if (quiz.type === 'personality') return `${quiz.typeLabel} · ${quiz.personalityResults.length} results · ${quiz.questionCount} questions`;
    if (quiz.type === 'survey') return `${quiz.typeLabel} · ${quiz.questionCount} questions · no scoring`;
    return quiz.typeLabel;
  }

  function renderQuizListView() {
    const ids = (state.dashboardQuizIds || []).filter(id => QUIZZES[id]);
    const hasAny = ids.length > 0;
    el('dashboardEmpty').hidden = hasAny;
    el('dashboardPopulated').hidden = !hasAny;
    if (hasAny) {
      renderDashboardList(ids);
      renderAddPicker();
    } else {
      renderComboResults();
    }
  }

  function renderDashboardList(ids) {
    const list = el('dashboardList');
    list.innerHTML = ids.map(id => {
      const quiz = QUIZZES[id];
      const status = getQuizStatus(id);
      const disabledClass = (status.pill === 'inactive') ? ' is-disabled' : '';
      return `
        <li>
          <div class="recent-card${disabledClass}" role="button" tabindex="0" data-quiz-type="${quiz.type}" data-action="open-quiz" data-quiz="${id}">
            <span class="recent-card__icon" aria-hidden="true">${quiz.typeIcon}</span>
            <span class="recent-card__body">
              <h3 class="recent-card__name">${escapeHtml(quiz.name)}</h3>
              <div class="recent-card__meta">${escapeHtml(buildQuizMetaLine(quiz))} · ${formatNum(quiz.completions)} completions</div>
              <span class="recent-card__count is-${status.pill}">${escapeHtml(status.summary)}</span>
            </span>
            <span class="recent-card__pill status-pill status-pill--${status.pill}">${escapeHtml(status.label)}</span>
            <button class="icon-btn" data-action="card-menu" data-quiz="${id}" aria-label="More options for ${escapeHtml(quiz.name)}">⋯</button>
          </div>
        </li>
      `;
    }).join('');
    // Heading sub-count
    const word = ids.length === 1 ? 'quiz' : 'quizzes';
    el('dashboardHeadSub').textContent = `${ids.length} ${word}`;
  }

  function renderAddPicker() {
    el('addPicker').hidden = !state.addPickerOpen;
    if (!state.addPickerOpen) return;
    // Render combo results below the add input, filtered to NOT-yet-added quizzes
    const list = el('addQuizComboResults');
    const q = (state.addComboQuery || '').toLowerCase().trim();
    const onDashboard = new Set(state.dashboardQuizIds || []);
    const candidates = Object.values(QUIZZES).filter(quiz => {
      if (onDashboard.has(quiz.id)) return false;
      if (q && !quiz.name.toLowerCase().includes(q) && !quiz.typeLabel.toLowerCase().includes(q)) return false;
      return true;
    });
    if (candidates.length === 0) {
      list.hidden = false;
      list.innerHTML = onDashboard.size >= Object.keys(QUIZZES).length
        ? `<li class="chooser-empty">All your quizzes are already on the dashboard.</li>`
        : `<li class="chooser-empty">No quizzes match "<strong>${escapeHtml(q)}</strong>".</li>`;
      return;
    }
    list.hidden = false;
    list.innerHTML = candidates.map(quiz => {
      const status = getQuizStatus(quiz.id);
      // Hide "Needs setup" — it's the default for every untouched quiz, so it's noise.
      // Keep meaningful states: partial / active / inactive / na.
      const pillHtml = status.pill === 'needs-setup'
        ? ''
        : `<span class="chooser-result__status status-pill status-pill--${status.pill}">${escapeHtml(status.label)}</span>`;
      return `
        <li>
          <button class="chooser-result" role="option" data-quiz-type="${quiz.type}" data-action="add-from-picker" data-quiz="${quiz.id}">
            <span class="chooser-result__icon" aria-hidden="true">${quiz.typeIcon}</span>
            <span class="chooser-result__body">
              <span class="chooser-result__name">${escapeHtml(quiz.name)}</span>
              <span class="chooser-result__meta">${escapeHtml(buildQuizMetaLine(quiz))}</span>
            </span>
            ${pillHtml}
            <span class="chooser-result__chevron" aria-hidden="true">›</span>
          </button>
        </li>
      `;
    }).join('');
  }

  function renderComboResults() {
    if (!state.comboOpen) {
      el('chooserResults').hidden = true;
      return;
    }
    const q = (state.comboQuery || '').toLowerCase().trim();
    const all = Object.values(QUIZZES);
    const matches = all.filter(quiz => {
      if (!q) return true;
      return quiz.name.toLowerCase().includes(q) || quiz.typeLabel.toLowerCase().includes(q);
    });
    const list = el('chooserResults');
    list.hidden = false;
    if (matches.length === 0) {
      list.innerHTML = `<li class="chooser-empty">No quizzes match "<strong>${escapeHtml(q)}</strong>". Try a different search.</li>`;
      return;
    }
    list.innerHTML = matches.map(quiz => {
      const status = getQuizStatus(quiz.id);
      // Hide "Partial setup" in the chooser — it's the default state for every untouched
      // quiz, so it's noise. Only surface meaningful states (Active / Disabled).
      const pillHtml = status.pill === 'partial'
        ? ''
        : `<span class="chooser-result__status status-pill status-pill--${status.pill}">${escapeHtml(status.label)}</span>`;
      return `
        <li>
          <button class="chooser-result" role="option" data-quiz-type="${quiz.type}" data-action="open-quiz" data-quiz="${quiz.id}">
            <span class="chooser-result__icon" aria-hidden="true">${quiz.typeIcon}</span>
            <span class="chooser-result__body">
              <span class="chooser-result__name">${escapeHtml(quiz.name)}</span>
              <span class="chooser-result__meta">${escapeHtml(buildQuizMetaLine(quiz))}</span>
            </span>
            ${pillHtml}
            <span class="chooser-result__chevron" aria-hidden="true">›</span>
          </button>
        </li>
      `;
    }).join('');
  }

  function openCombo() {
    state.comboOpen = true;
    el('quizComboInput').setAttribute('aria-expanded', 'true');
    renderComboResults();
  }

  function closeCombo() {
    state.comboOpen = false;
    el('quizComboInput').setAttribute('aria-expanded', 'false');
    renderComboResults();
  }

  function addToDashboard(quizId) {
    if (!QUIZZES[quizId]) return;
    const arr = (state.dashboardQuizIds || []).filter(id => id !== quizId);
    arr.unshift(quizId);
    state.dashboardQuizIds = arr;
  }

  function removeFromDashboard(quizId) {
    state.dashboardQuizIds = (state.dashboardQuizIds || []).filter(id => id !== quizId);
    saveState();
    renderAll();
  }

  // ============================================================
  // CARD POPOVER (per-card 3-dot menu — Apprentice pattern)
  // ============================================================

  let cardMenuFor = null;

  function renderCardPopoverItems(quizId) {
    const cfg = state.quizConfigs[quizId];
    const isDisabled = cfg && cfg.enabled === false;
    const items = [
      `<button class="popover__item" data-action="card-open">✏️ Open setup</button>`,
      isDisabled
        ? `<button class="popover__item" data-action="card-toggle-enabled">▶ Activate triggers</button>`
        : `<button class="popover__item" data-action="card-toggle-enabled">⏸ Disable triggers</button>`,
      `<div class="popover__divider"></div>`,
      `<button class="popover__item popover__item--danger" data-action="card-remove">🗑 Remove from dashboard</button>`
    ];
    return items.join('');
  }

  function openCardMenu(quizId, anchorBtn) {
    cardMenuFor = quizId;
    const popover = el('cardPopover');
    popover.innerHTML = renderCardPopoverItems(quizId);
    popover.hidden = false;
    // Position below + right-aligned with the icon-btn
    const rect = anchorBtn.getBoundingClientRect();
    const popoverWidth = 220;
    popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
    popover.style.left = `${rect.right - popoverWidth + window.scrollX}px`;
  }

  function closeCardMenu() {
    el('cardPopover').hidden = true;
    cardMenuFor = null;
  }

  function toggleQuizEnabled(quizId) {
    const cfg = state.quizConfigs[quizId];
    if (!cfg) return;
    const wasEnabled = cfg.enabled !== false;
    cfg.enabled = !wasEnabled;
    saveState();
    renderAll();
    const quiz = QUIZZES[quizId];
    const msg = wasEnabled
      ? `Disabled triggers for "${quiz.name}". New completions won't fire any actions.`
      : `Activated triggers for "${quiz.name}".`;
    toast(msg, 'info', 5000, () => {
      cfg.enabled = wasEnabled;
      saveState();
      renderAll();
    });
  }

  function goToList() {
    state.view = 'list';
    state.flow = { bucketId: null, editing: null, stage: 'picker', pickedAction: null, pickedSubop: null, draftConfig: {} };
    saveState();
    renderAll();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function goToQuiz(quizId) {
    if (!QUIZZES[quizId]) return;
    state.currentQuizId = quizId;
    state.view = 'quiz';
    addToDashboard(quizId);
    // Reset combo / add-picker state
    state.comboOpen = false;
    state.comboQuery = '';
    state.addPickerOpen = false;
    state.addComboQuery = '';
    const input = el('quizComboInput');
    if (input) input.value = '';
    const addInput = el('addQuizComboInput');
    if (addInput) addInput.value = '';
    saveState();
    renderAll();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function renderAll() {
    // Toggle the two top-level views
    el('quizListView').hidden = state.view !== 'list';
    el('quizSettingsView').hidden = state.view !== 'quiz';

    // Breadcrumb middle-group toggles based on view
    const isQuiz = state.view === 'quiz';
    el('bcQuizPicker').hidden = !isQuiz;
    el('bcMidSep').hidden = !isQuiz;
    el('bcSettings').hidden = !isQuiz;
    el('bcMidSep2').hidden = !isQuiz;

    if (state.view === 'list') {
      renderQuizListView();
      return;
    }

    const quiz = currentQuiz();
    document.body.setAttribute('data-type', quiz.type);
    document.body.setAttribute('data-view', 'landing');

    // Quiz-level status — mirror the EXACT same pill the dashboard card uses
    // (Active / Partial setup / Needs setup / Disabled / Not applicable)
    const status = getQuizStatus(state.currentQuizId);
    const isDisabled = status.pill === 'inactive';
    el('disabledBanner').hidden = !isDisabled;
    const statusPill = el('quizStatusPill');
    if (statusPill) {
      if (quiz.type === 'survey') {
        // Surveys still get the "Not applicable" pill for parity with the dashboard
        statusPill.hidden = false;
        statusPill.className = `status-pill status-pill--${status.pill}`;
        statusPill.textContent = status.label;
      } else {
        statusPill.hidden = false;
        statusPill.className = `status-pill status-pill--${status.pill}`;
        statusPill.textContent = status.label;
      }
    }

    // Show landing, hide action flow
    el('landingView').hidden = false;
    el('actionFlowView').hidden = true;

    // Breadcrumb name
    el('bcQuizName').textContent = quiz.name;

    // Header strip
    el('qhTitle').textContent = quiz.name;
    el('typeChip').querySelector('.chip-icon').textContent = quiz.typeIcon;
    el('typeChip').querySelector('.chip-text').textContent = quiz.typeLabel;

    let readout = '';
    if (quiz.type === 'number') readout = `Total possible: ${quiz.maxPoints} points · ${quiz.questionCount} questions`;
    else if (quiz.type === 'percentage') readout = `Range: 0–100% · ${quiz.questionCount} questions`;
    else if (quiz.type === 'right_wrong') readout = `${quiz.questionCount} questions · pass/fail outcome`;
    else if (quiz.type === 'personality') readout = `${quiz.personalityResults.length} personality results · ${quiz.questionCount} questions`;
    else if (quiz.type === 'survey') readout = `${quiz.questionCount} questions · no scoring`;
    el('qhReadout').textContent = readout;

    // Banner state
    el('disambigBanner').classList.toggle('is-dismissed', state.bannerDismissed);
    if (quiz.type === 'survey') el('disambigBanner').classList.add('is-dismissed');

    // Hide all layouts
    $$('.layout').forEach(l => { l.hidden = true; });

    // Show the right one
    if (quiz.type === 'number' || quiz.type === 'percentage') {
      $$('.layout-score')[0].hidden = false;
      renderScoreLayout();
    } else if (quiz.type === 'right_wrong') {
      $$('.layout-rightwrong')[0].hidden = false;
      renderRightWrongLayout();
    } else if (quiz.type === 'personality') {
      $$('.layout-personality')[0].hidden = false;
      renderPersonalityLayout();
    } else if (quiz.type === 'survey') {
      $$('.layout-survey')[0].hidden = false;
      renderSurveyLayout();
    }
  }

  // ----- Score layout (number + percentage) -----

  function renderScoreLayout() {
    const quiz = currentQuiz();
    const cfg = currentConfig();
    const unit = unitFor(quiz);

    // Axis labels
    el('mapAxisStart').textContent = `${quiz.minPoints}${unit}`;
    el('mapAxisEnd').textContent = `${quiz.maxPoints}${unit}`;

    // Empty state vs populated
    const empty = cfg.ranges.length === 0;
    el('emptyStarter').hidden = !empty;
    el('bucketListScore').hidden = empty;

    // Score map
    paintScoreMap();

    // Bucket list
    if (!empty) {
      el('bucketListScore').innerHTML = cfg.ranges.map(r => renderBucketCard(r)).join('');
    }
  }

  function paintScoreMap(draftRange) {
    const quiz = currentQuiz();
    const cfg = currentConfig();
    const track = el('mapTrack');
    if (!track) return;
    const total = (quiz.maxPoints - quiz.minPoints) || 1;
    const unit = unitFor(quiz);

    // Skip any range currently in inline edit mode — it'll be painted as draft instead
    const ranges = cfg.ranges.filter(r => !r._editing);
    if (draftRange && !isNaN(draftRange.min) && !isNaN(draftRange.max) && draftRange.min <= draftRange.max) {
      ranges.push({ ...draftRange, _isDraft: true });
    }

    track.innerHTML = ranges.map(r => {
      const start = ((Math.max(quiz.minPoints, r.min) - quiz.minPoints) / total) * 100;
      const width = ((Math.min(quiz.maxPoints, r.max) - Math.max(quiz.minPoints, r.min)) / total) * 100;
      const color = r.color || '#2563eb';
      const cls = r._isDraft ? 'map-band map-band--draft' : 'map-band';
      return `<div class="${cls}" style="left:${start}%;width:${width}%;background:${color}" title="${escapeHtml(r.label || '')} (${r.min}–${r.max}${unit})">${escapeHtml(r.label || '')}</div>`;
    }).join('');
  }

  function renderBucketCard(r) {
    const quiz = currentQuiz();
    const cfg = currentConfig();
    const unit = unitFor(quiz);
    const actions = cfg.actions[r.id] || [];
    const isFixed = quiz.type === 'right_wrong' || quiz.type === 'survey';
    const isPersonality = quiz.type === 'personality';
    const isEditing = !!r._editing;
    const isScore = quiz.type === 'number' || quiz.type === 'percentage';

    let subline = '';
    if (isScore) {
      subline = `Range: ${r.min}–${r.max}${unit}`;
    } else if (quiz.type === 'right_wrong' || quiz.type === 'survey') {
      subline = r.sub || '';
    } else if (quiz.type === 'personality') {
      subline = `Personality result — fires for users who land on "${r.label}"`;
    }

    const tools = (!isFixed && !isPersonality) ? `
      <button class="tool-btn" data-action="edit-range" data-range="${r.id}" title="Edit range">Edit</button>
      <button class="tool-btn tool-danger" data-action="remove-range" data-range="${r.id}" title="Remove range">Remove</button>
    ` : '';

    const stateAttr = r.state ? `data-state="${r.state}"` : '';
    const editingClass = isEditing ? ' is-editing' : '';

    // Inline editor when this card is being edited (score quizzes only)
    if (isEditing && isScore) {
      return `
        <li>
          <article class="bucket-card is-editing" data-bucket="${r.id}">
            ${renderRangeEditor(r)}
          </article>
        </li>
      `;
    }

    const isEmpty = actions.length === 0;
    const emptyClass = isEmpty ? ' is-empty' : '';
    const pillClass = isEmpty ? ' bucket-pill--empty' : '';
    const pillText = isEmpty ? 'Needs setup' : `${actions.length} action${actions.length === 1 ? '' : 's'}`;

    return `
      <li>
        <article class="bucket-card${editingClass}${emptyClass}" ${stateAttr} data-bucket="${r.id}">
          <div class="bucket-head">
            <div class="bucket-meta">
              <h3 class="bucket-label">${escapeHtml(r.label)}</h3>
              <div class="bucket-sub">${escapeHtml(subline)}<span class="bucket-pill${pillClass}">${pillText}</span></div>
            </div>
            <div class="bucket-tools">${tools}</div>
          </div>
          <div class="bucket-actions">
            ${actions.map(a => renderActionRow(a, r.id)).join('')}
            <button class="add-action-btn" data-action="add-action" data-bucket="${r.id}">+ Add action</button>
          </div>
        </article>
      </li>
    `;
  }

  // ----- Range-editor slider helpers -----

  // Compute the contiguous gap (start..end) that contains the editing draft
  function getGapContainingDraft(draft) {
    const quiz = currentQuiz();
    const cfg = currentConfig();
    const others = cfg.ranges.filter(r => r.id !== draft.id && !isNaN(r.min) && !isNaN(r.max));
    let gapStart = quiz.minPoints;
    let gapEnd = quiz.maxPoints;
    for (const o of others) {
      if (o.max < draft.min) gapStart = Math.max(gapStart, o.max + 1);
      else if (o.min > draft.max) gapEnd = Math.min(gapEnd, o.min - 1);
    }
    return { gapStart, gapEnd };
  }

  // Generate quick-fill suggestions based on the gaps in the axis
  function computeRangeSuggestions(draft) {
    const quiz = currentQuiz();
    const cfg = currentConfig();
    const others = cfg.ranges
      .filter(r => r.id !== draft.id && !isNaN(r.min) && !isNaN(r.max))
      .sort((a, b) => a.min - b.min);
    const gaps = [];
    let cursor = quiz.minPoints;
    for (const r of others) {
      if (r.min > cursor) gaps.push({ start: cursor, end: r.min - 1 });
      cursor = Math.max(cursor, r.max + 1);
    }
    if (cursor <= quiz.maxPoints) gaps.push({ start: cursor, end: quiz.maxPoints });
    return gaps.map(g => {
      let label;
      if (g.start === quiz.minPoints && g.end === quiz.maxPoints) label = 'Full range';
      else if (g.start === quiz.minPoints) label = 'Cover the bottom';
      else if (g.end === quiz.maxPoints) label = 'Cover the rest';
      else label = 'Fill the gap';
      return { ...g, label };
    }).slice(0, 3);
  }

  function pixelToSliderValue(clientX, trackEl) {
    const quiz = currentQuiz();
    const rect = trackEl.getBoundingClientRect();
    if (!rect.width) return quiz.minPoints;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(quiz.minPoints + pct * (quiz.maxPoints - quiz.minPoints));
  }

  function updateSliderVisuals(r) {
    const card = document.querySelector(`.bucket-card[data-bucket="${r.id}"]`);
    if (!card) return;
    const quiz = currentQuiz();
    const total = (quiz.maxPoints - quiz.minPoints) || 1;
    const minPct = isNaN(r.min) ? 0 : ((r.min - quiz.minPoints) / total) * 100;
    const maxPct = isNaN(r.max) ? 100 : ((r.max - quiz.minPoints) / total) * 100;
    const minHandle = card.querySelector('.range-slider__handle--min');
    const maxHandle = card.querySelector('.range-slider__handle--max');
    const band = card.querySelector('.range-slider__band');
    if (minHandle) { minHandle.style.left = `${minPct}%`; minHandle.setAttribute('aria-valuenow', String(r.min)); }
    if (maxHandle) { maxHandle.style.left = `${maxPct}%`; maxHandle.setAttribute('aria-valuenow', String(r.max)); }
    if (band) {
      band.style.left = `${minPct}%`;
      band.style.width = `${Math.max(0.5, maxPct - minPct)}%`;
    }
  }

  // Apply a new value to one slider handle — clamped to its legal window
  function applySliderHandle(handle, rawValue) {
    const cfg = currentConfig();
    const draft = cfg.ranges.find(r => r._editing);
    if (!draft) return;
    const { gapStart, gapEnd } = getGapContainingDraft(draft);
    if (handle === 'min') {
      draft.min = Math.max(gapStart, Math.min(isNaN(draft.max) ? gapEnd : draft.max, rawValue));
    } else {
      draft.max = Math.max(isNaN(draft.min) ? gapStart : draft.min, Math.min(gapEnd, rawValue));
    }
    const card = document.querySelector(`.bucket-card[data-bucket="${draft.id}"]`);
    if (card) {
      const minInput = card.querySelector('[data-edit-field="min"]');
      const maxInput = card.querySelector('[data-edit-field="max"]');
      if (minInput) minInput.value = String(draft.min);
      if (maxInput) maxInput.value = String(draft.max);
    }
    updateSliderVisuals(draft);
    validateInlineRange(draft);
    paintScoreMap(!isNaN(draft.min) && !isNaN(draft.max) && draft.min <= draft.max ? draft : null);
  }

  function renderRangeEditor(r) {
    const quiz = currentQuiz();
    const unit = unitFor(quiz);
    const isNew = !!r._isNew;
    const cfg = currentConfig();
    const total = (quiz.maxPoints - quiz.minPoints) || 1;

    // Ghost zones — render every OTHER range as a muted band on the track
    const ghostZones = cfg.ranges
      .filter(o => o.id !== r.id && !isNaN(o.min) && !isNaN(o.max))
      .map(o => {
        const start = ((Math.max(quiz.minPoints, o.min) - quiz.minPoints) / total) * 100;
        const end = ((Math.min(quiz.maxPoints, o.max) - quiz.minPoints) / total) * 100;
        const width = Math.max(0.5, end - start);
        return `<div class="range-slider__ghost" style="left:${start}%; width:${width}%" title="${escapeHtml(o.label || '')} · ${o.min}–${o.max}${unit}">
          <span class="range-slider__ghost-label">${escapeHtml(o.label || '')}</span>
        </div>`;
      }).join('');

    const minPct = isNaN(r.min) ? 0 : ((r.min - quiz.minPoints) / total) * 100;
    const maxPct = isNaN(r.max) ? 100 : ((r.max - quiz.minPoints) / total) * 100;
    const showHandles = !isNaN(r.min) && !isNaN(r.max) && r.min <= r.max;

    // Suggestions — quick-fill chips for the available gaps
    const suggestions = computeRangeSuggestions(r);
    const suggestionsHTML = suggestions.length > 0 ? `
      <div class="range-suggestions">
        <span class="range-suggestions__label">Quick fill</span>
        ${suggestions.map(s => `
          <button type="button" class="range-suggestion-chip" data-action="apply-suggestion" data-min="${s.start}" data-max="${s.end}" data-range="${r.id}">
            ${escapeHtml(s.label)} <code>${s.start}–${s.end}${unit}</code>
          </button>
        `).join('')}
      </div>
    ` : '';

    return `
      <div class="range-editor" data-range="${r.id}">
        <div class="range-editor-head">
          <h3 class="range-editor-title">${isNew ? 'New range' : 'Edit range'}</h3>
          <span class="range-editor-hint">Drag the handles, type below, or pick a quick fill</span>
        </div>
        <label class="field">
          <span class="field-label">Range label</span>
          <input type="text" data-edit-field="label" value="${escapeHtml(r.label || '')}" placeholder="e.g., Advanced, Almost there, Needs review" maxlength="50" />
        </label>

        ${suggestionsHTML}

        <div class="field">
          <span class="field-label">Score range</span>
          <div class="range-slider" data-range="${r.id}">
            <div class="range-slider__track" data-slider-track>
              ${ghostZones}
              ${showHandles ? `
                <div class="range-slider__band" style="left:${minPct}%; width:${Math.max(0.5, maxPct - minPct)}%"></div>
                <button type="button" class="range-slider__handle range-slider__handle--min" style="left:${minPct}%" data-handle="min" role="slider" aria-valuemin="${quiz.minPoints}" aria-valuemax="${quiz.maxPoints}" aria-valuenow="${r.min}" aria-label="Range minimum"></button>
                <button type="button" class="range-slider__handle range-slider__handle--max" style="left:${maxPct}%" data-handle="max" role="slider" aria-valuemin="${quiz.minPoints}" aria-valuemax="${quiz.maxPoints}" aria-valuenow="${r.max}" aria-label="Range maximum"></button>
              ` : ''}
            </div>
            <div class="range-slider__axis">
              <span>${quiz.minPoints}${unit}</span>
              <span>${quiz.maxPoints}${unit}</span>
            </div>
          </div>
        </div>

        <div class="field-row">
          <label class="field field-half">
            <span class="field-label">Min</span>
            <div class="number-wrap">
              <input type="number" data-edit-field="min" inputmode="numeric" value="${isNaN(r.min) ? '' : r.min}" />
              <span class="number-unit">${unit}</span>
            </div>
            <small class="field-error" data-edit-error="min" role="alert" hidden></small>
          </label>
          <label class="field field-half">
            <span class="field-label">Max</span>
            <div class="number-wrap">
              <input type="number" data-edit-field="max" inputmode="numeric" value="${isNaN(r.max) ? '' : r.max}" />
              <span class="number-unit">${unit}</span>
            </div>
            <small class="field-error" data-edit-error="max" role="alert" hidden></small>
          </label>
        </div>
        <small class="field-help">
          Stay between ${quiz.minPoints} and ${quiz.maxPoints}${unit ? ' ' + unit : ''}. Gaps are fine; overlaps aren't.
        </small>
        <small class="field-error" data-edit-error="overlap" role="alert" hidden></small>
        <div class="range-editor-footer">
          <button class="btn-ghost" data-action="cancel-range-edit" data-range="${r.id}">Cancel</button>
          <button class="btn-primary" data-action="commit-range-edit" data-range="${r.id}" disabled>${isNew ? 'Add range' : 'Save changes'}</button>
        </div>
      </div>
    `;
  }

  function renderActionRow(a, bucketId) {
    const def = ACTIONS[a.type];
    if (!def) return '';
    let detail = '';
    if (a.type === 'tag') {
      const tags = (a.config.tags || []).map(t => `<code>${escapeHtml(t)}</code>`).join(', ');
      detail = `${escapeHtml(a.config.provider || 'ESP')} · ${tags}`;
    } else if (a.type === 'webhook') {
      detail = `${escapeHtml(a.config.method || 'POST')} ${escapeHtml(a.config.url || '')}`;
    } else if (a.type === 'ultimatum') {
      detail = `${a.subop === 'stop' ? 'Stop' : 'Start'} · ${escapeHtml(a.config.campaign || '')}`;
    } else if (a.type === 'grant') {
      detail = `Grant access to ${escapeHtml(a.config.product || '')}`;
    }
    const disabledBadge = a.enabled === false
      ? `<span class="action-row-state action-row-state--off">○ Paused</span>`
      : '';
    return `
      <div class="action-row ${a.enabled === false ? 'is-disabled' : ''}" data-action-id="${a.id}">
        <span class="action-row-icon" data-action="${a.type}" aria-hidden="true">${def.icon}</span>
        <div class="action-row-body">
          <div class="action-row-title">${escapeHtml(def.name)} ${disabledBadge}</div>
          <div class="action-row-detail">${detail}</div>
        </div>
        <div class="action-row-tools">
          <button class="tool-btn" data-action="edit-action" data-action-id="${a.id}" data-bucket="${bucketId}">Edit</button>
          <button class="tool-btn tool-danger" data-action="remove-action" data-action-id="${a.id}" data-bucket="${bucketId}">Remove</button>
        </div>
      </div>
    `;
  }

  // ----- Right/Wrong layout -----

  function renderRightWrongLayout() {
    const quiz = currentQuiz();
    el('passRuleText').textContent = quiz.passRule;
    el('bucketListRightWrong').innerHTML = currentConfig().ranges.map(r => renderBucketCard(r)).join('');
  }

  // ----- Personality layout -----

  function renderPersonalityLayout() {
    el('bucketListPersonality').innerHTML = currentConfig().ranges.map(r => renderBucketCard(r)).join('');
  }

  function renderSurveyLayout() {
    el('bucketListSurvey').innerHTML = currentConfig().ranges.map(r => renderBucketCard(r)).join('');
  }

  // ============================================================
  // INLINE RANGE EDITOR (replaces the old side-drawer approach)
  // ============================================================

  // Snapshot of pre-edit values so Cancel can revert
  let preEditSnapshot = null;

  function startEditingRange(rangeId) {
    const quiz = currentQuiz();
    if (quiz.type !== 'number' && quiz.type !== 'percentage') return;
    const cfg = currentConfig();

    // Close any other editor in flight
    cfg.ranges.forEach(r => { delete r._editing; delete r._isNew; });

    if (rangeId) {
      const r = cfg.ranges.find(rr => rr.id === rangeId);
      if (!r) return;
      preEditSnapshot = { id: r.id, label: r.label, min: r.min, max: r.max };
      r._editing = true;
      r._isNew = false;
    } else {
      // Adding a new range — find the largest gap in the score axis and seed the
      // draft to fill it. If there's no free space, bail with a clear message.
      const sortedOthers = cfg.ranges
        .filter(r => !r._editing && !isNaN(r.min) && !isNaN(r.max))
        .sort((a, b) => a.min - b.min);
      const gaps = [];
      let cursor = quiz.minPoints;
      for (const r of sortedOthers) {
        if (r.min > cursor) gaps.push({ start: cursor, end: r.min - 1 });
        cursor = Math.max(cursor, r.max + 1);
      }
      if (cursor <= quiz.maxPoints) gaps.push({ start: cursor, end: quiz.maxPoints });

      if (gaps.length === 0) {
        toast('Your ranges already cover the entire score axis. Shrink or remove a range to make room.', 'info', 4500);
        return;
      }

      // Pick the largest available gap as the default — easy to shrink later
      gaps.sort((a, b) => (b.end - b.start) - (a.end - a.start));
      const target = gaps[0];

      const draft = {
        id: 'r' + Date.now(),
        label: '',
        min: target.start,
        max: target.end,
        color: pickNextColor(),
        _editing: true,
        _isNew: true
      };
      cfg.ranges.push(draft);
      cfg.actions[draft.id] = [];
      preEditSnapshot = null;
    }
    renderAll();
    // Focus the label input + scroll into view + run initial validation
    setTimeout(() => {
      const editor = document.querySelector('.bucket-card.is-editing');
      if (editor) {
        const lbl = editor.querySelector('[data-edit-field="label"]');
        if (lbl) lbl.focus({ preventScroll: true });
        editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const bucketId = editor.getAttribute('data-bucket');
        const r = cfg.ranges.find(rr => rr.id === bucketId);
        if (r) validateInlineRange(r);
      }
    }, 0);
  }

  function cancelRangeEdit(rangeId) {
    const cfg = currentConfig();
    const idx = cfg.ranges.findIndex(r => r.id === rangeId);
    if (idx < 0) return;
    const r = cfg.ranges[idx];
    if (r._isNew) {
      // Drop the unsaved new range
      cfg.ranges.splice(idx, 1);
      delete cfg.actions[r.id];
    } else if (preEditSnapshot && r.id === preEditSnapshot.id) {
      // Revert to snapshot
      r.label = preEditSnapshot.label;
      r.min = preEditSnapshot.min;
      r.max = preEditSnapshot.max;
      delete r._editing;
      delete r._isNew;
    } else {
      delete r._editing;
      delete r._isNew;
    }
    preEditSnapshot = null;
    paintScoreMap();
    renderAll();
  }

  function commitRangeEdit(rangeId) {
    const cfg = currentConfig();
    const r = cfg.ranges.find(rr => rr.id === rangeId);
    if (!r) return;
    if (!validateInlineRange(r)) return;
    const wasNew = !!r._isNew;
    delete r._editing;
    delete r._isNew;
    preEditSnapshot = null;
    cfg.ranges.sort((a, b) => a.min - b.min);
    saveState();
    renderAll();
    toast(wasNew ? 'Range added.' : 'Range updated.', 'ok', 2200);
  }

  // Read live values from the inline editor card into the range object
  function syncEditorValues(rangeId) {
    const card = document.querySelector(`.bucket-card[data-bucket="${rangeId}"]`);
    if (!card) return;
    const cfg = currentConfig();
    const r = cfg.ranges.find(rr => rr.id === rangeId);
    if (!r) return;
    const lblEl = card.querySelector('[data-edit-field="label"]');
    const minEl = card.querySelector('[data-edit-field="min"]');
    const maxEl = card.querySelector('[data-edit-field="max"]');
    if (lblEl) r.label = lblEl.value;
    if (minEl) r.min = minEl.value === '' ? NaN : parseInt(minEl.value, 10);
    if (maxEl) r.max = maxEl.value === '' ? NaN : parseInt(maxEl.value, 10);
  }

  function validateInlineRange(r) {
    const quiz = currentQuiz();
    const cfg = currentConfig();
    const card = document.querySelector(`.bucket-card[data-bucket="${r.id}"]`);
    if (!card) return false;
    const unit = unitFor(quiz);
    let ok = true;

    const minErr = card.querySelector('[data-edit-error="min"]');
    const maxErr = card.querySelector('[data-edit-error="max"]');
    const overlapErr = card.querySelector('[data-edit-error="overlap"]');
    [minErr, maxErr, overlapErr].forEach(e => { if (e) { e.hidden = true; e.textContent = ''; } });
    card.querySelectorAll('.field').forEach(f => f.classList.remove('has-error'));

    if (!r.label || !r.label.trim()) ok = false;

    if (isNaN(r.min)) {
      ok = false;
    } else if (r.min < quiz.minPoints) {
      minErr.textContent = `Must be ≥ ${quiz.minPoints}.`; minErr.hidden = false;
      card.querySelector('[data-edit-field="min"]').closest('.field').classList.add('has-error');
      ok = false;
    } else if (r.min > quiz.maxPoints) {
      minErr.textContent = `Stay within the quiz max (${quiz.maxPoints}${unit ? ' ' + unit : ''}).`; minErr.hidden = false;
      card.querySelector('[data-edit-field="min"]').closest('.field').classList.add('has-error');
      ok = false;
    }

    if (isNaN(r.max)) {
      ok = false;
    } else if (r.max > quiz.maxPoints) {
      maxErr.textContent = `Stay within the quiz max (${quiz.maxPoints}${unit ? ' ' + unit : ''}).`; maxErr.hidden = false;
      card.querySelector('[data-edit-field="max"]').closest('.field').classList.add('has-error');
      ok = false;
    } else if (!isNaN(r.min) && r.max < r.min) {
      maxErr.textContent = `Max must be ≥ Min.`; maxErr.hidden = false;
      card.querySelector('[data-edit-field="max"]').closest('.field').classList.add('has-error');
      ok = false;
    }

    if (ok && !isNaN(r.min) && !isNaN(r.max)) {
      const overlap = cfg.ranges.find(other => {
        if (other.id === r.id) return false;
        if (other._editing) return false;
        return !(r.max < other.min || r.min > other.max);
      });
      if (overlap) {
        overlapErr.textContent = `Overlaps with "${overlap.label}" (${overlap.min}–${overlap.max}${unit ? ' ' + unit : ''}).`;
        overlapErr.hidden = false;
        ok = false;
      }
    }

    const commitBtn = card.querySelector('[data-action="commit-range-edit"]');
    if (commitBtn) commitBtn.disabled = !ok;
    return ok;
  }

  // Live-update from typed input — keep score map, slider, and validation in sync
  function handleEditorInput(rangeId) {
    syncEditorValues(rangeId);
    const cfg = currentConfig();
    const r = cfg.ranges.find(rr => rr.id === rangeId);
    if (!r) return;
    validateInlineRange(r);
    updateSliderVisuals(r);
    paintScoreMap(!isNaN(r.min) && !isNaN(r.max) && r.min <= r.max ? r : null);
  }

  // ============================================================
  // STARTER TEMPLATES
  // ============================================================

  function applyStarter(kind) {
    const quiz = currentQuiz();
    const cfg = currentConfig();
    const max = quiz.maxPoints;
    const min = quiz.minPoints;

    if (kind === 'passfail') {
      const half = Math.floor((max - min) / 2) + min;
      cfg.ranges = [
        { id: 'r-fail', label: 'Failed', min: min, max: half, color: '#dc2626' },
        { id: 'r-pass', label: 'Passed', min: half + 1, max: max, color: '#059669' }
      ];
    } else if (kind === 'three-tier') {
      const third = Math.floor((max - min) / 3);
      cfg.ranges = [
        { id: 'r-low', label: 'Low', min: min, max: min + third, color: '#dc2626' },
        { id: 'r-mid', label: 'Mid', min: min + third + 1, max: min + 2 * third, color: '#d97706' },
        { id: 'r-high', label: 'High', min: min + 2 * third + 1, max: max, color: '#059669' }
      ];
    } else if (kind === 'blank') {
      cfg.ranges = [];
      saveState();
      renderAll();
      startEditingRange(null);
      return;
    }
    cfg.ranges.forEach(r => { cfg.actions[r.id] = cfg.actions[r.id] || []; });
    saveState();
    renderAll();
    toast('Starter applied. Tap a range to add actions.', 'ok', 2600);
  }

  // ============================================================
  // ACTION FLOW
  // ============================================================

  function openActionFlow(bucketId, editingActionId) {
    state.flow.bucketId = bucketId;
    state.flow.editing = editingActionId || null;
    state.flow.stage = 'picker';
    state.flow.pickedAction = null;
    state.flow.pickedSubop = null;
    state.flow.draftConfig = {};

    // If editing, prefill
    if (editingActionId) {
      const cfg = currentConfig();
      const existing = (cfg.actions[bucketId] || []).find(a => a.id === editingActionId);
      if (existing) {
        state.flow.pickedAction = existing.type;
        state.flow.pickedSubop = existing.subop || null;
        state.flow.draftConfig = { ...(existing.config || {}) };
        state.flow.stage = 'configure';
      }
    }

    el('landingView').hidden = true;
    el('actionFlowView').hidden = false;
    renderActionFlow();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderActionFlow() {
    const cfg = currentConfig();
    const bucket = cfg.ranges.find(r => r.id === state.flow.bucketId);
    if (!bucket) return;

    // Edit title — "New action" / "Edit action"
    el('editTitle').textContent = state.flow.editing ? 'Edit action' : 'New action';

    // Hide all stages, then show the current one
    $$('.stage').forEach(st => { st.hidden = true; });

    if (state.flow.stage === 'picker') {
      $$('.stage-picker')[0].hidden = false;
      // Update picker context strip with the current quiz + range
      const quizCtx = currentQuiz();
      const cfgCtx = currentConfig();
      const bucketCtx = cfgCtx.ranges.find(r => r.id === state.flow.bucketId);
      const pCtx = el('pickerContextText');
      if (pCtx && bucketCtx) {
        let bLabel = bucketCtx.label;
        if (quizCtx.type === 'number' || quizCtx.type === 'percentage') {
          bLabel = `${bucketCtx.label} (${bucketCtx.min}–${bucketCtx.max}${unitFor(quizCtx)})`;
        }
        pCtx.innerHTML = `On <strong>quiz completion</strong> · <strong>${escapeHtml(quizCtx.name)}</strong> · Range <strong>${escapeHtml(bLabel)}</strong>`;
      }
      renderActionPicker();
    } else if (state.flow.stage === 'subop') {
      const subopStage = $$('.stage-subop')[0];
      subopStage.hidden = false;
      setTimeout(() => {
        subopStage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } else if (state.flow.stage === 'configure') {
      const configureStage = $$('.stage-configure')[0];
      configureStage.hidden = false;
      renderActionConfigure();
      // Bring the configure stage into view so the user clearly sees the transition
      setTimeout(() => {
        configureStage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }

  function actionTypeKey(t) {
    if (t === 'tag') return 'esp';
    return t;
  }

  function renderActionPicker() {
    const cfg = currentConfig();
    const existing = (cfg.actions[state.flow.bucketId] || []).filter(a => !state.flow.editing || a.id !== state.flow.editing);
    const usedTypes = new Set(existing.map(a => a.type));
    const espTaken = existing.find(a => a.type === 'tag' || a.type === 'webhook');

    const list = el('actionPickerGrid');
    list.innerHTML = Object.values(ACTIONS).map(def => {
      let disabled = false;
      let reason = '';
      if (usedTypes.has(def.id)) { disabled = true; reason = 'Already configured for this range'; }
      else if (espTaken && def.mutex === 'esp') {
        disabled = true;
        reason = `Mutually exclusive with ${ACTIONS[espTaken.type].name} (already set)`;
      }
      const iconKey = actionTypeKey(def.id);
      // Use data-action so the click flows through the global delegation — no parallel
      // local handler that can race or detach.
      return `
        <button type="button" class="action-opt" data-action="pick-action" data-pick="${def.id}" ${disabled ? 'disabled' : ''}>
          <span class="action-opt__icon action-opt__icon--${iconKey}" aria-hidden="true">${def.icon}</span>
          <span class="action-opt__body">
            <div class="action-opt__name">${escapeHtml(def.name)}</div>
            <div class="action-opt__desc">${escapeHtml(def.desc)}</div>
            ${disabled ? `<span class="action-opt__disabled-reason">${escapeHtml(reason)}</span>` : ''}
          </span>
          <span class="action-opt__chevron" aria-hidden="true">›</span>
        </button>
      `;
    }).join('');

    const help = el('pickerHelp');
    const anyDisabled = $$('.action-opt[disabled]').length > 0;
    help.hidden = !anyDisabled;
    if (anyDisabled) help.textContent = 'Some actions are hidden because they\'re already configured for this range, or mutually exclusive with one that is.';
  }

  function pickAction(type) {
    state.flow.pickedAction = type;
    const def = ACTIONS[type];
    if (def.hasSubop) {
      state.flow.stage = 'subop';
    } else {
      state.flow.stage = 'configure';
    }
    state.flow.draftConfig = defaultConfigFor(type);
    renderActionFlow();
  }

  function pickSubop(subop) {
    state.flow.pickedSubop = subop;
    state.flow.stage = 'configure';
    state.flow.draftConfig = defaultConfigFor(state.flow.pickedAction);
    renderActionFlow();
  }

  function defaultConfigFor(type) {
    if (type === 'tag') return { provider: 'FluentCRM', tags: [] };
    if (type === 'webhook') return { method: 'POST', format: 'JSON', url: '', fields: [], headers: 'none' };
    if (type === 'ultimatum') return { campaign: '' };
    if (type === 'grant') return { product: '' };
    return {};
  }

  function renderActionConfigure() {
    const def = ACTIONS[state.flow.pickedAction];
    if (!def) return;

    // Update the action pill — Apprentice-style: icon (color-coded) + name + description
    const iconKey = actionTypeKey(def.id);
    const pillIcon = el('actionPillIcon');
    pillIcon.textContent = def.icon;
    pillIcon.className = `action-pill__icon action-pill__icon--${iconKey}`;
    el('actionPillName').textContent = def.name + (state.flow.pickedSubop ? ` — ${state.flow.pickedSubop === 'stop' ? 'Stop' : 'Start'}` : '');
    el('actionPillDesc').textContent = def.desc;

    // Update the trigger-context strip with quiz + bucket info
    const quiz = currentQuiz();
    const cfg = currentConfig();
    const bucket = cfg.ranges.find(r => r.id === state.flow.bucketId);
    if (bucket) {
      let bucketLabel = bucket.label;
      if (quiz.type === 'number' || quiz.type === 'percentage') {
        bucketLabel = `${bucket.label} (${bucket.min}–${bucket.max}${unitFor(quiz)})`;
      }
      el('triggerContextText').innerHTML = `On <strong>quiz completion</strong> · <strong>${escapeHtml(quiz.name)}</strong> · Range <strong>${escapeHtml(bucketLabel)}</strong>`;
    }

    const body = el('configureBody');
    body.innerHTML = '';

    if (state.flow.pickedAction === 'tag') renderTagConfig(body);
    else if (state.flow.pickedAction === 'webhook') renderWebhookConfig(body);
    else if (state.flow.pickedAction === 'ultimatum') renderUltimatumConfig(body);
    else if (state.flow.pickedAction === 'grant') renderGrantConfig(body);
  }

  function renderTagConfig(body) {
    const cfg = state.flow.draftConfig;
    body.innerHTML = `
      <label class="field">
        <span class="field-label">Email service provider</span>
        <select id="cfgProvider">
          <option ${cfg.provider === 'FluentCRM' ? 'selected' : ''}>FluentCRM</option>
          <option ${cfg.provider === 'ActiveCampaign' ? 'selected' : ''}>ActiveCampaign</option>
          <option ${cfg.provider === 'Mailchimp' ? 'selected' : ''}>Mailchimp</option>
          <option ${cfg.provider === 'ConvertKit' ? 'selected' : ''}>ConvertKit</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Tags to apply</span>
        <div class="chip-input" id="chipInput">
          ${(cfg.tags || []).map(t => `<span class="chip" data-chip="${escapeHtml(t)}">${escapeHtml(t)}<button class="chip-remove" data-action="remove-chip" data-chip="${escapeHtml(t)}" aria-label="Remove">×</button></span>`).join('')}
          <input id="chipNewInput" type="text" placeholder="${cfg.tags && cfg.tags.length ? 'Add another tag…' : 'Type a tag and press Enter'}" />
        </div>
        <small class="field-help">Press Enter or comma to confirm a tag. Free-typed tags are accepted.</small>
      </label>
    `;
    el('cfgProvider').addEventListener('change', e => { state.flow.draftConfig.provider = e.target.value; });
    el('chipNewInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) {
          state.flow.draftConfig.tags = state.flow.draftConfig.tags || [];
          if (!state.flow.draftConfig.tags.includes(val)) {
            state.flow.draftConfig.tags.push(val);
            renderTagConfig(el('configureBody'));
            el('chipNewInput').focus();
          }
        }
      } else if (e.key === 'Backspace' && !e.target.value) {
        if ((state.flow.draftConfig.tags || []).length) {
          state.flow.draftConfig.tags.pop();
          renderTagConfig(el('configureBody'));
          el('chipNewInput').focus();
        }
      }
    });
  }

  function renderWebhookConfig(body) {
    const cfg = state.flow.draftConfig;
    body.innerHTML = `
      <label class="field">
        <span class="field-label">Webhook URL</span>
        <input type="text" id="cfgUrl" placeholder="https://hooks.example.com/incoming" value="${escapeHtml(cfg.url || '')}" />
        <small class="field-help">Must start with https:// (or http:// for local testing).</small>
      </label>
      <div class="field-row">
        <label class="field field-half">
          <span class="field-label">Method</span>
          <select id="cfgMethod">
            ${['POST','GET','PUT','PATCH','DELETE'].map(m => `<option ${cfg.method === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </label>
        <label class="field field-half">
          <span class="field-label">Format</span>
          <select id="cfgFormat">
            ${['JSON','Form','XML'].map(f => `<option ${cfg.format === f ? 'selected' : ''}>${f}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="field">
        <span class="field-label">Fields</span>
        <small class="field-help">Pre-populated with quiz-completion context. Edit values or use <code>%email%</code>, <code>%result%</code>, <code>%bucket_label%</code>, <code>%quiz_name%</code>.</small>
      </div>
    `;
    el('cfgUrl').addEventListener('input', e => { state.flow.draftConfig.url = e.target.value; });
    el('cfgMethod').addEventListener('change', e => { state.flow.draftConfig.method = e.target.value; });
    el('cfgFormat').addEventListener('change', e => { state.flow.draftConfig.format = e.target.value; });
  }

  function renderUltimatumConfig(body) {
    const cfg = state.flow.draftConfig;
    body.innerHTML = `
      <label class="field">
        <span class="field-label">Ultimatum campaign</span>
        <select id="cfgCampaign">
          <option value="">Pick a campaign…</option>
          <option ${cfg.campaign === '7-day retake offer' ? 'selected' : ''}>7-day retake offer</option>
          <option ${cfg.campaign === 'Black Friday 2026' ? 'selected' : ''}>Black Friday 2026</option>
          <option ${cfg.campaign === 'Welcome week countdown' ? 'selected' : ''}>Welcome week countdown</option>
        </select>
        <small class="field-help">Reads from the Ultimatum install's campaign list. Sub-op: <strong>${state.flow.pickedSubop === 'stop' ? 'Stop' : 'Start'}</strong>.</small>
      </label>
    `;
    el('cfgCampaign').addEventListener('change', e => { state.flow.draftConfig.campaign = e.target.value; });
  }

  function renderGrantConfig(body) {
    const cfg = state.flow.draftConfig;
    body.innerHTML = `
      <label class="field">
        <span class="field-label">Apprentice product to grant</span>
        <select id="cfgProduct">
          <option value="">Pick a product…</option>
          <option ${cfg.product === 'Advanced Lighting Masterclass' ? 'selected' : ''}>Advanced Lighting Masterclass</option>
          <option ${cfg.product === 'Lightroom Essentials' ? 'selected' : ''}>Lightroom Essentials</option>
          <option ${cfg.product === 'Portrait Posing 201' ? 'selected' : ''}>Portrait Posing 201</option>
          <option ${cfg.product === 'Certified Members area' ? 'selected' : ''}>Certified Members area</option>
        </select>
        <small class="field-help">User is granted access via <code>Thrive_Apprentice_API::grant_access()</code>.</small>
      </label>
    `;
    el('cfgProduct').addEventListener('change', e => { state.flow.draftConfig.product = e.target.value; });
  }

  function saveAction() {
    const cfg = currentConfig();
    const bucketId = state.flow.bucketId;
    cfg.actions[bucketId] = cfg.actions[bucketId] || [];

    // Validate minimally
    const t = state.flow.pickedAction;
    const c = state.flow.draftConfig;
    if (t === 'tag' && (!c.tags || c.tags.length === 0)) {
      toast('Add at least one tag before saving.', 'error', 3500);
      return;
    }
    if (t === 'webhook' && (!c.url || !/^https?:\/\//.test(c.url))) {
      toast('Webhook URL must start with http:// or https://', 'error', 3500);
      return;
    }
    if (t === 'ultimatum' && !c.campaign) {
      toast('Pick a campaign to start or stop.', 'error', 3500);
      return;
    }
    if (t === 'grant' && !c.product) {
      toast('Pick an Apprentice product to grant.', 'error', 3500);
      return;
    }

    if (state.flow.editing) {
      const idx = cfg.actions[bucketId].findIndex(a => a.id === state.flow.editing);
      if (idx >= 0) {
        cfg.actions[bucketId][idx] = {
          ...cfg.actions[bucketId][idx],
          type: t,
          subop: state.flow.pickedSubop || undefined,
          config: c
        };
      }
    } else {
      cfg.actions[bucketId].push({
        id: 'a-' + Date.now(),
        type: t,
        subop: state.flow.pickedSubop || undefined,
        enabled: true,
        config: c
      });
    }

    saveState();
    backToLanding();
    toast('Action saved.', 'ok', 2200);
  }

  function backToLanding() {
    state.flow.stage = 'picker';
    state.flow.bucketId = null;
    renderAll();
  }

  // ============================================================
  // REMOVE WITH UNDO
  // ============================================================

  let undoBucket = null;

  function removeAction(bucketId, actionId) {
    const cfg = currentConfig();
    const list = cfg.actions[bucketId] || [];
    const idx = list.findIndex(a => a.id === actionId);
    if (idx < 0) return;
    const removed = list.splice(idx, 1)[0];
    saveState();
    renderAll();
    toast(`Action removed.`, 'info', 5000, () => {
      // Undo handler
      (cfg.actions[bucketId] = cfg.actions[bucketId] || []).splice(idx, 0, removed);
      saveState();
      renderAll();
      toast('Restored.', 'ok', 1500);
    });
  }

  function removeRange(rangeId) {
    const cfg = currentConfig();
    const idx = cfg.ranges.findIndex(r => r.id === rangeId);
    if (idx < 0) return;
    const removedRange = cfg.ranges.splice(idx, 1)[0];
    const removedActions = cfg.actions[rangeId] || [];
    delete cfg.actions[rangeId];
    saveState();
    renderAll();
    toast(`Range "${removedRange.label}" removed.`, 'info', 5000, () => {
      cfg.ranges.splice(idx, 0, removedRange);
      cfg.actions[rangeId] = removedActions;
      saveState();
      renderAll();
      toast('Restored.', 'ok', 1500);
    });
  }

  // ============================================================
  // CONFIRM MODAL
  // ============================================================

  let pendingConfirm = null;

  function askConfirm(title, body, onConfirm) {
    el('confirmTitle').textContent = title;
    el('confirmBody').textContent = body;
    pendingConfirm = onConfirm;
    el('confirmModal').hidden = false;
  }

  function closeConfirm() {
    el('confirmModal').hidden = true;
    pendingConfirm = null;
  }

  // ============================================================
  // TOASTS
  // ============================================================

  function toast(message, kind, duration, undoFn) {
    kind = kind || 'info';
    duration = duration || 2500;
    const rail = el('toastRail');
    const node = document.createElement('div');
    node.className = `toast toast-${kind}`;
    node.innerHTML = `<span>${escapeHtml(message)}</span>` + (undoFn ? `<button class="toast-undo">Undo</button>` : '');
    rail.appendChild(node);
    if (undoFn) {
      node.querySelector('.toast-undo').addEventListener('click', () => {
        undoFn();
        node.classList.add('is-leaving');
        setTimeout(() => node.remove(), 200);
      });
    }
    setTimeout(() => {
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 200);
    }, duration);
  }

  // ============================================================
  // UTIL — color picker for new ranges
  // ============================================================

  function pickNextColor() {
    const palette = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#be123c'];
    const used = (currentConfig().ranges || []).map(r => r.color);
    return palette.find(c => !used.includes(c)) || palette[Math.floor(Math.random() * palette.length)];
  }

  // ============================================================
  // EVENT DELEGATION
  // ============================================================

  function attachEvents() {
    // Reset button
    el('resetDemo').addEventListener('click', () => {
      if (!confirm('Reset prototype state? Your demo changes will be cleared.')) return;
      localStorage.removeItem(STORAGE_KEY);
      state.quizConfigs = {};
      state.bannerDismissed = false;
      state.currentQuizId = 'photography-101';
      state.view = 'list';
      state.dashboardQuizIds = [];
      state.addPickerOpen = false;
      state.addComboQuery = '';
      state.comboOpen = false;
      state.comboQuery = '';
      seedDefaults();
      saveState();
      renderAll();
    });

    // Quiz picker
    el('bcQuizPicker').addEventListener('click', openQuizPicker);
    el('qpClose').addEventListener('click', closeQuizPicker);
    el('qpScrim').addEventListener('click', closeQuizPicker);
    el('qpList').addEventListener('click', e => {
      const btn = e.target.closest('[data-quiz]');
      if (btn) switchQuiz(btn.getAttribute('data-quiz'));
    });

    // Banner dismiss
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const action = a.getAttribute('data-action');
      const bucket = a.getAttribute('data-bucket');
      const actionId = a.getAttribute('data-action-id');
      const range = a.getAttribute('data-range');

      if (action === 'go-list') {
        e.preventDefault();
        goToList();
        return;
      } else if (action === 'open-quiz') {
        e.preventDefault();
        const quizId = a.getAttribute('data-quiz');
        goToQuiz(quizId);
        return;
      } else if (action === 'card-menu') {
        e.preventDefault();
        e.stopPropagation();
        const quizId = a.getAttribute('data-quiz');
        if (cardMenuFor === quizId) {
          closeCardMenu();
        } else {
          openCardMenu(quizId, a);
        }
        return;
      } else if (action === 'card-open') {
        e.preventDefault();
        const quizId = cardMenuFor;
        closeCardMenu();
        if (quizId) goToQuiz(quizId);
        return;
      } else if (action === 'card-toggle-enabled') {
        e.preventDefault();
        const quizId = cardMenuFor;
        closeCardMenu();
        if (quizId) toggleQuizEnabled(quizId);
        return;
      } else if (action === 'activate-from-banner') {
        e.preventDefault();
        toggleQuizEnabled(state.currentQuizId);
        return;
      } else if (action === 'card-remove') {
        e.preventDefault();
        const quizId = cardMenuFor;
        closeCardMenu();
        if (!quizId) return;
        const quiz = QUIZZES[quizId];
        askConfirm(
          `Remove "${quiz.name}" from your dashboard?`,
          'Your configured Quiz Triggers are kept — they just stop appearing on this dashboard. Add the quiz back any time from "+ Add a quiz".',
          () => {
            removeFromDashboard(quizId);
            toast(`Removed "${quiz.name}" from dashboard.`, 'info', 5000, () => {
              addToDashboard(quizId);
              saveState();
              renderAll();
              toast(`Restored.`, 'ok', 1500);
            });
          }
        );
        return;
      } else if (action === 'add-from-picker') {
        e.preventDefault();
        const quizId = a.getAttribute('data-quiz');
        addToDashboard(quizId);
        goToQuiz(quizId);
        return;
      } else if (action === 'toggle-add-picker') {
        e.preventDefault();
        state.addPickerOpen = !state.addPickerOpen;
        renderAddPicker();
        if (state.addPickerOpen) {
          setTimeout(() => {
            const inp = el('addQuizComboInput');
            if (inp) inp.focus();
          }, 0);
        }
        return;
      } else if (action === 'close-add-picker') {
        e.preventDefault();
        state.addPickerOpen = false;
        state.addComboQuery = '';
        const inp = el('addQuizComboInput');
        if (inp) inp.value = '';
        renderAddPicker();
        return;
      }

      if (action === 'dismiss-banner') {
        state.bannerDismissed = true;
        saveState();
        renderAll();
      } else if (action === 'open-tagged-answers') {
        e.preventDefault();
        toast('In production: opens the Tagged Answers tab.', 'info', 2200);
      } else if (action === 'open-quiz-builder') {
        e.preventDefault();
        toast('In production: opens this quiz in the Quiz Builder editor.', 'info', 2200);
      } else if (action === 'add-action') {
        openActionFlow(bucket);
      } else if (action === 'edit-action') {
        openActionFlow(bucket, actionId);
      } else if (action === 'remove-action') {
        askConfirm('Remove this action?', 'It will stop firing on new quiz completions. You can undo this for 5 seconds.', () => {
          removeAction(bucket, actionId);
        });
      } else if (action === 'edit-range') {
        startEditingRange(range);
      } else if (action === 'cancel-range-edit') {
        cancelRangeEdit(range);
      } else if (action === 'commit-range-edit') {
        commitRangeEdit(range);
      } else if (action === 'remove-range') {
        const r = currentConfig().ranges.find(rr => rr.id === range);
        if (r) {
          askConfirm(`Remove range "${r.label}"?`, 'Any actions configured on this range will also be removed. You can undo this for 5 seconds.', () => removeRange(range));
        }
      } else if (action === 'back-to-landing') {
        backToLanding();
      } else if (action === 'change-action') {
        state.flow.stage = 'picker';
        state.flow.pickedAction = null;
        state.flow.pickedSubop = null;
        state.flow.draftConfig = {};
        renderActionFlow();
      } else if (action === 'pick-action') {
        e.preventDefault();
        if (a.disabled) return;
        pickAction(a.getAttribute('data-pick'));
        return;
      } else if (action === 'apply-suggestion') {
        e.preventDefault();
        const min = parseInt(a.getAttribute('data-min'), 10);
        const max = parseInt(a.getAttribute('data-max'), 10);
        const draft = currentConfig().ranges.find(rr => rr._editing);
        if (!draft) return;
        draft.min = min;
        draft.max = max;
        // Full re-render — the editor needs to show the slider with handles now
        renderAll();
        // Focus the label so the user's next action is to name the range
        setTimeout(() => {
          const lbl = document.querySelector(`.bucket-card[data-bucket="${draft.id}"] [data-edit-field="label"]`);
          if (lbl) lbl.focus();
        }, 0);
        return;
      } else if (action === 'cancel-confirm') {
        closeConfirm();
      } else if (action === 'remove-chip') {
        const chip = a.getAttribute('data-chip');
        state.flow.draftConfig.tags = (state.flow.draftConfig.tags || []).filter(t => t !== chip);
        renderTagConfig(el('configureBody'));
      }
    });

    // Quiz chooser — combobox
    const comboInput = el('quizComboInput');
    const comboClear = el('quizComboClear');
    comboInput.addEventListener('focus', () => {
      state.comboQuery = comboInput.value;
      openCombo();
    });
    comboInput.addEventListener('input', e => {
      state.comboQuery = e.target.value;
      comboClear.hidden = !e.target.value;
      if (!state.comboOpen) openCombo();
      else renderComboResults();
    });
    comboInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        comboInput.blur();
        closeCombo();
      } else if (e.key === 'Enter') {
        const first = document.querySelector('.chooser-result');
        if (first) {
          e.preventDefault();
          first.click();
        }
      }
    });
    comboClear.addEventListener('click', () => {
      comboInput.value = '';
      state.comboQuery = '';
      comboClear.hidden = true;
      comboInput.focus();
      renderComboResults();
    });
    // Click outside the combo → close
    document.addEventListener('click', e => {
      if (!state.comboOpen) return;
      if (e.target.closest('#quizComboBox')) return;
      closeCombo();
    });

    // Click outside the card popover → close
    document.addEventListener('click', e => {
      if (cardMenuFor === null) return;
      if (e.target.closest('#cardPopover')) return;
      if (e.target.closest('[data-action="card-menu"]')) return;
      closeCardMenu();
    });

    // Add-picker combobox input (only present when picker is open)
    document.addEventListener('input', e => {
      if (e.target && e.target.id === 'addQuizComboInput') {
        state.addComboQuery = e.target.value;
        el('addQuizComboClear').hidden = !e.target.value;
        renderAddPicker();
      }
    });
    document.addEventListener('keydown', e => {
      if (e.target && e.target.id === 'addQuizComboInput' && e.key === 'Escape') {
        state.addPickerOpen = false;
        state.addComboQuery = '';
        e.target.value = '';
        renderAddPicker();
      }
    });

    // Add range / starters
    el('addRangeBtn').addEventListener('click', () => startEditingRange(null));
    $$('.starter-card').forEach(card => {
      card.addEventListener('click', () => applyStarter(card.getAttribute('data-starter')));
    });

    // Range-editor slider — drag with mouse + touch, keyboard arrows on focus
    let activeHandleDrag = null;
    function startDrag(handleEl) {
      activeHandleDrag = {
        handle: handleEl.getAttribute('data-handle'),
        trackEl: handleEl.closest('.range-slider__track')
      };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
    }
    function endDrag() {
      activeHandleDrag = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    document.addEventListener('mousedown', e => {
      const handle = e.target.closest('.range-slider__handle');
      if (!handle) return;
      e.preventDefault();
      startDrag(handle);
      handle.focus();
    });
    document.addEventListener('mousemove', e => {
      if (!activeHandleDrag) return;
      const v = pixelToSliderValue(e.clientX, activeHandleDrag.trackEl);
      applySliderHandle(activeHandleDrag.handle, v);
    });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchstart', e => {
      const handle = e.target.closest('.range-slider__handle');
      if (!handle) return;
      startDrag(handle);
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!activeHandleDrag) return;
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const v = pixelToSliderValue(touch.clientX, activeHandleDrag.trackEl);
      applySliderHandle(activeHandleDrag.handle, v);
    }, { passive: false });
    document.addEventListener('touchend', endDrag);
    // Keyboard: arrow keys nudge the focused handle (Shift for ×10)
    document.addEventListener('keydown', e => {
      const handle = document.activeElement;
      if (!handle || !handle.classList || !handle.classList.contains('range-slider__handle')) return;
      let delta = 0;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = e.shiftKey ? -10 : -1;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = e.shiftKey ? 10 : 1;
      else if (e.key === 'Home') {
        const draft = currentConfig().ranges.find(r => r._editing);
        if (draft) {
          const { gapStart } = getGapContainingDraft(draft);
          applySliderHandle(handle.getAttribute('data-handle'), gapStart);
        }
        e.preventDefault();
        return;
      } else if (e.key === 'End') {
        const draft = currentConfig().ranges.find(r => r._editing);
        if (draft) {
          const { gapEnd } = getGapContainingDraft(draft);
          applySliderHandle(handle.getAttribute('data-handle'), gapEnd);
        }
        e.preventDefault();
        return;
      }
      if (delta === 0) return;
      e.preventDefault();
      const which = handle.getAttribute('data-handle');
      const draft = currentConfig().ranges.find(r => r._editing);
      if (!draft) return;
      const current = which === 'min' ? draft.min : draft.max;
      applySliderHandle(which, current + delta);
    });

    // Inline range-editor input delegation (event bubbling — works with re-renders)
    document.addEventListener('input', e => {
      const field = e.target.closest('[data-edit-field]');
      if (!field) return;
      const card = field.closest('.bucket-card[data-bucket]');
      if (!card) return;
      handleEditorInput(card.getAttribute('data-bucket'));
    });

    // Enter to commit inside the inline editor
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const field = e.target.closest('[data-edit-field]');
      if (!field) return;
      const card = field.closest('.bucket-card[data-bucket]');
      if (!card) return;
      e.preventDefault();
      commitRangeEdit(card.getAttribute('data-bucket'));
    });

    // (.action-opt clicks now route through the global delegation as data-action="pick-action")

    // Timing collapse/expand
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const action = a.getAttribute('data-action');
      if (action === 'add-delay') {
        el('timingCollapsed').hidden = true;
        el('timingExpanded').hidden = false;
      } else if (action === 'remove-delay') {
        el('timingCollapsed').hidden = false;
        el('timingExpanded').hidden = true;
      } else if (action === 'add-condition') {
        el('conditionCollapsed').hidden = true;
        el('conditionExpanded').hidden = false;
      } else if (action === 'remove-condition') {
        el('conditionCollapsed').hidden = false;
        el('conditionExpanded').hidden = true;
      }
    });

    // (Stepper removed — Apprentice pattern uses inline back-links + Change pill instead)
    // Sub-op
    document.addEventListener('click', e => {
      const btn = e.target.closest('.subop-card');
      if (btn) pickSubop(btn.getAttribute('data-subop'));
    });

    // Save action
    el('saveActionBtn').addEventListener('click', saveAction);

    // Confirm modal
    el('confirmRemoveBtn').addEventListener('click', () => {
      if (pendingConfirm) pendingConfirm();
      closeConfirm();
    });

    // Keyboard: Escape closes overlays / cancels inline editing in priority order
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!el('confirmModal').hidden) { closeConfirm(); return; }
      if (cardMenuFor !== null) { closeCardMenu(); return; }
      if (!el('quizPickerSheet').hidden) { closeQuizPicker(); return; }
      // Inline range editor open?
      const editingCard = document.querySelector('.bucket-card.is-editing');
      if (editingCard) {
        cancelRangeEdit(editingCard.getAttribute('data-bucket'));
      }
    });

    // Keyboard: Enter/Space on a dashboard card (div role=button) opens the quiz
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.recent-card[data-action="open-quiz"]');
      if (!card) return;
      e.preventDefault();
      goToQuiz(card.getAttribute('data-quiz'));
    });
  }

  // ============================================================
  // BOOT
  // ============================================================

  function boot() {
    loadState();
    attachEvents();
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
