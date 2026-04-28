/* ==========================================================
   Apprentice — Incoming Webhooks — Interactive Prototype
   ========================================================== */

(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────
  const state = {
    view: 'empty',              // 'empty' | 'list' | 'edit'
    tab: 'setup',               // 'setup' | 'mapping' | 'logs'
    testState: 'idle',          // 'idle' | 'listening' | 'captured'
    webhooks: [],               // list of saved webhooks
    activeId: null,             // id of webhook being edited
    draft: null,                // unsaved webhook being built
    capturedPayload: null,      // captured JSON payload
    mappings: {},               // field mappings { apprenticeKey: 'dot.path' }
    autoMatched: {},            // { apprenticeKey: true } → was auto-matched
    selectedPayloadKey: null,   // currently selected JSON key for click-map (advanced)
    advancedMode: false,        // show the advanced 2-column mapping UI
    showMoreFields: false,      // show optional fields in smart view
    editingField: null,         // currently being edited via inline dropdown
    advancedSecOpen: false,     // is the advanced security disclosure expanded
    setupStep1Expanded: true,   // is Setup Step 1 in expanded edit mode (vs collapsed summary)
    setupStep2Revealed: false,  // is Setup Step 2 visible yet (revealed on Next click from Step 1)
    countdownInterval: null,
    listenTimeoutId: null,
    logs: {},                   // { webhookId: [{...logEntry}] }
    deleteId: null,             // id staged for deletion
    guide: { step: 0, active: false },
  };

  // ─── Smart match patterns ────────────────────────────────
  const MATCH_PATTERNS = {
    email:      [/^email$/i, /_email$/i, /^e_?mail$/i, /^user_email$/i, /^buyer_email$/i, /^customer_email$/i],
    first_name: [/^first_name$/i, /^firstname$/i, /^first$/i, /^given_name$/i, /^fname$/i],
    last_name:  [/^last_name$/i, /^lastname$/i, /^last$/i, /^family_name$/i, /^surname$/i, /^lname$/i],
  };

  // Fields in the default smart-match view (required + common)
  const PRIMARY_FIELDS = ['email', 'first_name', 'last_name'];
  // Fields revealed under "+ Add more fields"
  const SECONDARY_FIELDS = ['product_override'];

  // ─── Demo data ───────────────────────────────────────────
  const SAMPLE_PAYLOAD = {
    event_type: 'order.completed',
    customer: {
      email: 'alice@example.com',
      first_name: 'Alice',
      last_name: 'Jones',
    },
    order: {
      product_id: '42',
      total: '97.00',
    },
    timestamp: '2026-04-17T10:30:00Z',
  };

  const APPRENTICE_FIELDS = [
    { key: 'email', label: 'Email', required: true, autoMap: 'customer.email' },
    { key: 'first_name', label: 'First Name', required: false, autoMap: 'customer.first_name' },
    { key: 'last_name', label: 'Last Name', required: false, autoMap: 'customer.last_name' },
    { key: 'product_override', label: 'Product Override', required: false, autoMap: null },
  ];

  // 5-step coach-mark tour. Mirrors form-thrive-action.html: each step has a
  // `target` selector for the spotlight overlay. Steps that span the whole
  // screen (welcome, finish) leave target = null → backdrop-only dim.
  const GUIDE_STEPS = [
    {
      title: 'Welcome',
      text: 'This is the new <strong>Incoming Webhooks</strong> screen. Click "Add Your First Webhook" to begin — we\'ll walk you through it.',
      target: '[data-action="create-webhook"]',
    },
    {
      title: 'Tell us what should happen',
      text: 'Step 1 — name this webhook, pick the action, and choose the product. When you\'re done, click <strong>Next: Webhook details →</strong> at the bottom to reveal Step 2.',
      target: '.setup-step[data-step="1"]',
    },
    {
      title: 'Connect your external tool',
      text: 'Step 2 — paste the <strong>URL</strong>, <strong>Header name</strong>, and <strong>Signing secret</strong> into ThriveCart, Stripe, or whichever tool will send you webhooks. Advanced security settings are tucked away below.',
      target: '.connection-card',
    },
    {
      title: 'Send a test request',
      text: 'Click the big "Listen for Test Request" button. In this demo, "⚡ Simulate Incoming" pretends a real request arrived so you can see the capture flow.',
      target: '[data-action="start-listening"]',
    },
    {
      title: 'Review fields & save',
      text: 'After the payload is captured, we auto-match fields like email and name. Review them on the Field Mapping tab, then hit <strong>Save &amp; Activate Webhook</strong> — your webhook is live.',
      target: null,
    },
  ];

  // ─── DOM helpers ─────────────────────────────────────────
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k.startsWith('data-')) node.setAttribute(k, v);
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else node[k] = v;
    });
    children.flat().forEach(c => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  const uid = () => Math.random().toString(36).slice(2, 10);
  const generateUrl = (uuid) => `${window.location.origin.replace(/https?:\/\//, 'https://')}/wp-json/tva/v1/webhooks/${uuid}`;
  const generateSecret = () => 'tva_whk_' + Array.from({ length: 32 }, () =>
    '0123456789abcdef'[Math.floor(Math.random() * 16)]
  ).join('');

  const productLabels = {
    'photo-master': 'Photography Masterclass',
    'photo-advanced': 'Advanced Photography',
    'portrait': 'Portrait Lighting',
  };
  const actionLabels = {
    'find_create_grant': 'Find or Create User, Then Grant Access',
    'grant': 'Grant Access',
    'revoke': 'Revoke Access',
  };

  // ─── Toasts ──────────────────────────────────────────────
  function toast(message, kind = 'info', duration = 3000) {
    const container = $('#toasts');
    const node = el('div', { class: `toast toast--${kind}` });
    const icon = { success: '✓', error: '✗', info: 'ⓘ', warn: '⚠' }[kind] || 'ⓘ';
    node.innerHTML = `<span class="toast__icon">${icon}</span><span class="toast__msg">${message}</span>`;
    container.appendChild(node);
    requestAnimationFrame(() => node.classList.add('toast--in'));
    setTimeout(() => {
      node.classList.remove('toast--in');
      node.classList.add('toast--out');
      setTimeout(() => node.remove(), 300);
    }, duration);
  }

  // ─── View switching ──────────────────────────────────────
  function setView(view) {
    state.view = view;
    $$('.view').forEach(v => v.classList.toggle('view--active', v.dataset.view === view));
    $('#crumbActive').textContent = view === 'edit'
      ? (state.draft?.name || state.webhooks.find(w => w.id === state.activeId)?.name || 'New Webhook')
      : 'Incoming Webhooks';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (state.guide.active) {
      requestAnimationFrame(repositionSpotlight);
    }
  }

  function setTab(tab) {
    state.tab = tab;
    $$('.tab').forEach(t => t.classList.toggle('tab--active', t.dataset.tab === tab));
    $$('.tab-panel').forEach(p => p.classList.toggle('tab-panel--active', p.dataset.panel === tab));

    if (tab === 'mapping') renderMappingTab();
    if (tab === 'logs') renderLogsTab();

    if (state.guide.active) {
      requestAnimationFrame(repositionSpotlight);
    }
  }

  function setTestState(testState) {
    state.testState = testState;
    $$('.test-block__state').forEach(s => {
      s.hidden = s.dataset.testState !== testState;
    });
  }

  // ─── Webhook list rendering ──────────────────────────────
  function renderList() {
    const list = $('#webhookList');
    list.innerHTML = '';

    if (state.webhooks.length === 0) {
      setView('empty');
      return;
    }

    state.webhooks.forEach(wh => {
      const logs = state.logs[wh.id] || [];
      const successCount = logs.filter(l => l.success).length;
      const failCount = logs.filter(l => !l.success).length;
      const lastTriggered = logs.length > 0
        ? `Last triggered ${logs[0].relativeTime}`
        : 'Never triggered';

      const card = el('article', {
        class: `webhook-card ${!wh.enabled ? 'webhook-card--disabled' : ''}`,
        'data-id': wh.id,
      });

      const productName = wh.productId ? (productLabels[wh.productId] || wh.productId) : '(no product selected)';
      const actionLabel = actionLabels[wh.actionType] || 'Grant Access';

      card.innerHTML = `
        <div class="webhook-card__status">
          <span class="pill ${wh.enabled ? 'pill--enabled' : 'pill--disabled'}">
            ${wh.enabled ? '● Enabled' : '○ Disabled'}
          </span>
        </div>
        <div class="webhook-card__body">
          <h3 class="webhook-card__name">${wh.name || 'Untitled webhook'}</h3>
          <div class="webhook-card__meta">
            <span class="meta-item"><strong>${actionLabel}:</strong> ${productName}</span>
            <span class="meta-item meta-item--muted">${lastTriggered}</span>
          </div>
          ${logs.length > 0 ? `
            <div class="webhook-card__stats">
              ${successCount > 0 ? `<span class="stat stat--success">✓ ${successCount} successful</span>` : ''}
              ${failCount > 0 ? `<span class="stat stat--fail">✗ ${failCount} failed</span>` : ''}
              <span class="stat stat--muted">${logs.length} request${logs.length === 1 ? '' : 's'}</span>
            </div>` : ''}
        </div>
        <div class="webhook-card__actions">
          <button class="icon-btn" data-action="card-menu" data-id="${wh.id}" aria-label="More options">⋯</button>
        </div>
      `;
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="card-menu"]')) return;
        openEdit(wh.id);
      });
      list.appendChild(card);
    });

    setView('list');
  }

  // ─── Draft / edit form ───────────────────────────────────
  function createDraft() {
    const id = uid();
    state.draft = {
      id,
      name: '',
      enabled: false,
      uuid: uid() + uid(),
      actionType: 'find_create_grant',
      productId: '',
      createUser: true,
      mappings: {},
      security: { mode: 'shared', secret: generateSecret(), headerName: 'X-Webhook-Secret' },
      isNew: true,
    };
    state.activeId = id;
    state.capturedPayload = null;
    state.mappings = {};
    state.autoMatched = {};
    state.selectedPayloadKey = null;
    state.advancedMode = false;
    state.showMoreFields = false;
    state.editingField = null;
    state.advancedSecOpen = false;
    // New webhook → start in Step 1 expanded, Step 2 hidden until "Next" clicked.
    state.setupStep1Expanded = true;
    state.setupStep2Revealed = false;

    populateEditForm(state.draft);
    setTab('setup');
    setTestState('idle');
    setView('edit');
    renderSetupSteps();
    updateSaveButton();
  }

  function openEdit(id) {
    const wh = state.webhooks.find(w => w.id === id);
    if (!wh) return;
    state.draft = { ...wh, isNew: false };
    state.activeId = id;
    state.capturedPayload = wh.capturedPayload || null;
    state.mappings = { ...(wh.mappings || {}) };
    state.autoMatched = { ...(wh.autoMatched || {}) };
    state.advancedMode = false;
    state.showMoreFields = false;
    state.editingField = null;
    state.selectedPayloadKey = null;
    state.advancedSecOpen = false;
    // Existing webhook → Step 1 in summary mode, Step 2 fully visible.
    state.setupStep1Expanded = false;
    state.setupStep2Revealed = true;

    populateEditForm(state.draft);
    setTab('setup');
    setTestState(state.capturedPayload ? 'captured' : 'idle');
    setView('edit');
    renderSetupSteps();
    updateSaveButton();
  }

  function populateEditForm(wh) {
    $('#webhookName').value = wh.name || '';
    $('#webhookEnabled').checked = !!wh.enabled;
    $('#enabledLabel').textContent = wh.enabled ? 'Enabled' : 'Disabled';
    $('#webhookUrl').value = generateUrl(wh.uuid);
    $('#actionType').value = wh.actionType;
    $('#productId').value = wh.productId || '';
    $('#createUser').checked = !!wh.createUser;
    $('#secretValue').value = wh.security?.secret || generateSecret();
    $('#secretValue').type = 'password';
    const headerName = wh.security?.headerName || 'X-Webhook-Secret';
    const headerInput = $('#secretHeaderName');           // editable, inside Advanced
    if (headerInput) headerInput.value = headerName;
    const headerDisplay = $('#webhookHeaderName');         // read-only, in Connection card
    if (headerDisplay) headerDisplay.value = headerName;

    // Reset advanced-sec disclosure to collapsed
    closeAdvancedSec();

    // Reset reveal button label
    const toggleBtn = document.querySelector('[data-action="toggle-secret"]');
    if (toggleBtn) toggleBtn.textContent = '👁 Reveal';

    // Update title row display
    updateTitleDisplay();

    toggleCreateUserBlock();
    toggleMappingBadge();
    updateLogCount();
  }

  function updateTitleDisplay() {
    const display = $('#editTitleDisplay');
    if (!display) return;
    const name = ($('#webhookName')?.value || '').trim();
    display.textContent = name || 'New Webhook';
  }

  // ─── Setup wizard: Step 1 ⇄ Step 2 progressive reveal ────
  // Step 1 has two views (edit / summary) and Step 2 is hidden until the
  // user clicks "Next: Webhook details →" on Step 1. This function syncs
  // the DOM to whatever's in `state.setupStep1Expanded` /
  // `state.setupStep2Revealed`. Called after createDraft / openEdit and
  // after every advance / edit transition.
  function renderSetupSteps() {
    const step1Section = $('#setupStep1');
    const editView     = $('#setupStep1Edit');
    const summaryView  = $('#setupStep1Summary');
    const doneLink     = $('#setupStep1DoneLink');
    const step2        = $('#setupStep2');
    if (!step1Section || !editView || !summaryView || !step2) return;

    if (state.setupStep1Expanded) {
      editView.hidden    = false;
      summaryView.hidden = true;
    } else {
      editView.hidden    = true;
      summaryView.hidden = false;
      // Refresh the summary line each time we collapse Step 1.
      const line = $('#setupStep1SummaryLine');
      if (line) line.textContent = buildStep1Summary();
    }

    step2.hidden = !state.setupStep2Revealed;

    // "Re-editing" state: user has already advanced past Step 1 (Step 2 is
    // revealed) and clicked Edit to revise. Hide the Next-button footer
    // (Step 2 is already open below) and show the small Done link instead.
    const reEditing = state.setupStep1Expanded && state.setupStep2Revealed;
    step1Section.classList.toggle('setup-step--re-editing', reEditing);
    if (doneLink) doneLink.hidden = !reEditing;

    // Reposition the spotlight in case the active guide step targets an
    // element whose visibility just changed.
    if (state.guide.active) {
      requestAnimationFrame(repositionSpotlight);
    }
  }

  // "Done" link in the expanded Step 1 (visible only when Step 2 is
  // already revealed) — collapses Step 1 back to its summary view.
  function collapseStep1ToSummary() {
    state.setupStep1Expanded = false;
    renderSetupSteps();
    setTimeout(() => {
      const summary = $('#setupStep1Summary');
      if (summary) summary.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  // One-line summary text shown in Step 1's collapsed view, e.g.
  // "Find or Create User → Photography Masterclass".
  function buildStep1Summary() {
    const action = $('#actionType')?.value || 'find_create_grant';
    const productId = $('#productId')?.value || '';
    const actionLabel = actionLabels[action] || action;
    const productName = productLabels[productId] || (productId ? productId : '(no product selected)');
    return `${actionLabel} → ${productName}`;
  }

  // "Next: Webhook details →" click — validate Name + Product, then advance.
  function advanceToStep2() {
    const name = ($('#webhookName').value || '').trim();
    const product = $('#productId').value;

    const missing = [];
    if (!name)    missing.push('a Name');
    if (!product) missing.push('a Product');

    if (missing.length > 0) {
      toast(
        `Almost there! Please add ${missing.join(' and ')} before continuing.`,
        'error',
        4000
      );
      // Focus the first missing field so the user can fix it immediately.
      setTimeout(() => {
        const target = !name ? $('#webhookName') : $('#productId');
        if (target) {
          target.focus();
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 60);
      return;
    }

    state.setupStep1Expanded  = false;
    state.setupStep2Revealed  = true;
    renderSetupSteps();
    // Smooth-scroll Step 2 into view so the user sees the connection card.
    setTimeout(() => {
      const step2 = $('#setupStep2');
      if (step2) step2.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    maybeGuideNext('advance-to-step2');
  }

  // "Edit" link on Step 1 summary — re-expand Step 1. Step 2 stays revealed
  // (the user wants to tweak Step 1 without losing visibility of what's
  // below).
  function editStep1() {
    state.setupStep1Expanded = true;
    renderSetupSteps();
    setTimeout(() => {
      const nameInput = $('#webhookName');
      if (nameInput) {
        nameInput.focus();
        nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);
  }

  function toggleCreateUserBlock() {
    const isGrantFlow = $('#actionType').value === 'find_create_grant';
    $('#createUserWrap').hidden = !isGrantFlow;
    $('#nestedBlock').hidden = !isGrantFlow || !$('#createUser').checked;
  }

  function updateSaveButton() {
    // Intentional no-op (kept for backwards compatibility with existing
    // callers). The "Save & Activate Webhook" button now lives on the
    // Field Mapping tab and is always clickable. Validation happens on
    // click inside saveWebhook() — which produces a clear error toast and
    // jumps the user back to Setup with focus on the missing field.
  }

  function syncDraftFromForm() {
    if (!state.draft) return;
    state.draft.name = $('#webhookName').value.trim();
    state.draft.enabled = $('#webhookEnabled').checked;
    state.draft.actionType = $('#actionType').value;
    state.draft.productId = $('#productId').value;
    state.draft.createUser = $('#createUser').checked;
    state.draft.mappings = state.mappings;
    state.draft.autoMatched = state.autoMatched;
    state.draft.capturedPayload = state.capturedPayload;
    const checkedRadio = document.querySelector('input[name="sec"]:checked');
    const mode = checkedRadio ? checkedRadio.value : 'shared';
    const headerInput = $('#secretHeaderName');
    state.draft.security = {
      mode,
      secret: $('#secretValue').value,
      headerName: headerInput ? headerInput.value : 'X-Webhook-Secret',
    };
  }

  function saveWebhook() {
    syncDraftFromForm();

    // Validate required fields. If any are missing, jump back to Setup
    // and focus the first offender so the fix is one click away.
    const missing = [];
    if (!state.draft.name)      missing.push('a Name');
    if (!state.draft.productId) missing.push('a Product');

    if (missing.length > 0) {
      toast(
        `Almost there! Please add ${missing.join(' and ')} on the Setup tab.`,
        'error',
        4500
      );
      setTab('setup');
      // Expand Step 1 so the missing field is actually visible — if Step 1
      // is in summary mode, the input we want to focus is in a hidden subtree.
      state.setupStep1Expanded = true;
      renderSetupSteps();
      setTimeout(() => {
        const target = !state.draft.name ? $('#webhookName') : $('#productId');
        if (target) {
          target.focus();
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 60);
      return;
    }

    // Enforce enabled on first save
    if (state.draft.isNew) {
      state.draft.enabled = true;
      state.draft.isNew = false;
    }

    const existing = state.webhooks.findIndex(w => w.id === state.draft.id);
    const saveable = { ...state.draft };
    delete saveable.isNew;

    if (existing >= 0) {
      state.webhooks[existing] = saveable;
      toast('Webhook updated', 'success');
    } else {
      state.webhooks.unshift(saveable);
      toast('Webhook saved and is now live', 'success');
      setTimeout(() => simulateLog(saveable.id, true), 1200);
    }

    state.draft = null;
    renderList();
    maybeGuideNext('save-webhook');
  }

  // ─── Listening / capture flow ────────────────────────────
  function startListening() {
    setTestState('listening');
    let remaining = 60;
    $('#countdownValue').textContent = '0:60';

    state.countdownInterval = setInterval(() => {
      remaining--;
      const mm = Math.floor(remaining / 60);
      const ss = String(remaining % 60).padStart(2, '0');
      $('#countdownValue').textContent = `${mm}:${ss}`;
      if (remaining <= 0) {
        cancelListening();
        toast('Listening timed out. No request received.', 'warn');
      }
    }, 1000);

    state.listenTimeoutId = setTimeout(() => {
      if (state.testState === 'listening') simulatePayloadCapture();
    }, 8000);

    maybeGuideNext('start-listening');
  }

  function cancelListening() {
    clearInterval(state.countdownInterval);
    clearTimeout(state.listenTimeoutId);
    state.countdownInterval = null;
    state.listenTimeoutId = null;
    setTestState('idle');
  }

  function simulatePayloadCapture() {
    clearInterval(state.countdownInterval);
    clearTimeout(state.listenTimeoutId);
    state.capturedPayload = JSON.parse(JSON.stringify(SAMPLE_PAYLOAD));

    autoMatchFields();

    setTestState('captured');

    const matchedCount = Object.keys(state.mappings).length;
    if (state.autoMatched.email) {
      toast(`Payload captured — auto-matched ${matchedCount} field${matchedCount === 1 ? '' : 's'} including email`, 'success', 4000);
    } else {
      toast(`Payload captured from ThriveCart`, 'success');
    }

    toggleMappingBadge();
    maybeGuideNext('payload-captured');
  }

  // ─── Field mapping ───────────────────────────────────────
  function toggleMappingBadge() {
    const hasPayload = !!state.capturedPayload;
    const hasAllRequired = APPRENTICE_FIELDS
      .filter(f => f.required)
      .every(f => state.mappings[f.key]);
    $('#mappingBadge').hidden = !hasPayload || hasAllRequired;
  }

  function findBestMatch(payload, patterns) {
    const candidates = [];
    function walk(obj, path = '') {
      if (!obj || typeof obj !== 'object') return;
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = path ? `${path}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          walk(value, fullPath);
        } else if (value != null) {
          for (let i = 0; i < patterns.length; i++) {
            if (patterns[i].test(key)) {
              candidates.push({
                path: fullPath,
                value: String(value),
                score: 1000 - i * 50 - fullPath.split('.').length * 5,
              });
              break;
            }
          }
        }
      }
    }
    walk(payload);
    return candidates.sort((a, b) => b.score - a.score)[0] || null;
  }

  function getAllPayloadPaths(obj, path = '') {
    const paths = [];
    if (!obj || typeof obj !== 'object') return paths;
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        paths.push(...getAllPayloadPaths(value, fullPath));
      } else if (value != null) {
        paths.push({ path: fullPath, value: String(value) });
      }
    }
    return paths;
  }

  function getValueByPath(obj, path) {
    return path.split('.').reduce((acc, k) => (acc != null ? acc[k] : undefined), obj);
  }

  function autoMatchFields() {
    state.autoMatched = {};
    state.mappings = {};

    Object.entries(MATCH_PATTERNS).forEach(([apprenticeKey, patterns]) => {
      const match = findBestMatch(state.capturedPayload, patterns);
      if (match) {
        state.mappings[apprenticeKey] = match.path;
        state.autoMatched[apprenticeKey] = true;
      }
    });
  }

  function renderMappingTab() {
    const empty = $('#mappingEmpty');
    const content = $('#mappingContent');

    if (!state.capturedPayload) {
      empty.hidden = false;
      content.hidden = true;
      return;
    }
    empty.hidden = true;
    content.hidden = false;

    const emailAutoMatched = state.autoMatched.email && state.mappings.email;
    const banner = $('#detectBanner');
    if (emailAutoMatched) {
      banner.hidden = false;
      $('#detectedEmailPath').textContent = state.mappings.email;
    } else {
      banner.hidden = true;
    }

    if (state.advancedMode) {
      $('#smartMatchView').hidden = true;
      $('#advancedView').hidden = false;
      renderJsonTree();
      renderFieldSlots();
    } else {
      $('#smartMatchView').hidden = false;
      $('#advancedView').hidden = true;
      renderSmartMatch();
    }
  }

  function renderSmartMatch() {
    const matchedCount = PRIMARY_FIELDS.filter(f => state.mappings[f]).length;
    const titleEl = $('#smartMatchTitle');
    if (matchedCount === PRIMARY_FIELDS.length) {
      titleEl.innerHTML = `Auto-matched <strong>${matchedCount}</strong> fields from your payload`;
    } else if (matchedCount > 0) {
      titleEl.innerHTML = `Auto-matched <strong>${matchedCount}</strong> of ${PRIMARY_FIELDS.length} fields — review below`;
    } else {
      titleEl.innerHTML = `We couldn't auto-match — choose fields manually`;
    }

    const primaryContainer = $('#smartFields');
    primaryContainer.innerHTML = '';
    PRIMARY_FIELDS.forEach(fieldKey => {
      primaryContainer.appendChild(buildSmartFieldRow(fieldKey));
    });

    const available = SECONDARY_FIELDS.filter(f => !state.mappings[f]);
    const added = SECONDARY_FIELDS.filter(f => state.mappings[f]);
    const moreContainer = $('#moreFields');
    moreContainer.innerHTML = '';

    if (state.showMoreFields || added.length > 0) {
      SECONDARY_FIELDS.forEach(fieldKey => {
        moreContainer.appendChild(buildSmartFieldRow(fieldKey));
      });
      moreContainer.hidden = false;
    } else {
      moreContainer.hidden = true;
    }

    const toggleBtn = $('#toggleMoreBtn');
    const toggleLabel = $('#toggleMoreLabel');
    const toggleCount = $('#toggleMoreCount');
    if (SECONDARY_FIELDS.length === 0) {
      toggleBtn.style.display = 'none';
    } else if (state.showMoreFields) {
      toggleLabel.textContent = '− Hide optional fields';
      toggleCount.textContent = '';
    } else {
      toggleLabel.textContent = '+ Add more fields';
      toggleCount.textContent = `(${available.length} available)`;
    }
  }

  function buildSmartFieldRow(fieldKey) {
    const field = APPRENTICE_FIELDS.find(f => f.key === fieldKey);
    const mapped = state.mappings[fieldKey];
    const isAutoMatched = state.autoMatched[fieldKey];
    const isEditing = state.editingField === fieldKey;
    const matchedValue = mapped ? getValueByPath(state.capturedPayload, mapped) : null;

    const row = el('div', {
      class: `smart-field ${mapped ? 'smart-field--matched' : 'smart-field--unmapped'} ${isEditing ? 'smart-field--editing' : ''}`,
    });

    const labelRow = el('div', { class: 'smart-field__label' });
    labelRow.innerHTML = `
      <span class="smart-field__name">${field.label}</span>
      ${field.required
        ? '<span class="smart-field__tag smart-field__tag--req">required</span>'
        : '<span class="smart-field__tag smart-field__tag--opt">optional</span>'}
      ${isAutoMatched && mapped && !isEditing
        ? '<span class="smart-field__tag smart-field__tag--auto">✨ auto</span>'
        : ''}
    `;
    row.appendChild(labelRow);

    if (isEditing) {
      const pickerWrap = el('div', { class: 'smart-field__picker' });
      const paths = getAllPayloadPaths(state.capturedPayload);
      let options = '<option value="">— Not mapped —</option>';
      paths.forEach(p => {
        const selected = p.path === mapped ? 'selected' : '';
        const valuePreview = p.value.length > 24 ? p.value.substring(0, 24) + '…' : p.value;
        options += `<option value="${p.path}" ${selected}>${p.path}  →  "${valuePreview}"</option>`;
      });
      pickerWrap.innerHTML = `
        <div class="select-wrap">
          <select class="input input--select input--sm" data-smart-select="${fieldKey}">${options}</select>
        </div>
        <div class="smart-field__picker-actions">
          <button class="btn btn--ghost btn--sm" data-action="smart-cancel-edit">Cancel</button>
          <button class="btn btn--primary btn--sm" data-action="smart-save-edit" data-field="${fieldKey}">Done</button>
        </div>
      `;
      row.appendChild(pickerWrap);
    } else if (mapped) {
      const match = el('div', { class: 'smart-field__match' });
      const valuePreview = matchedValue == null ? '—' : String(matchedValue);
      match.innerHTML = `
        <code class="smart-field__path">${mapped}</code>
        <span class="smart-field__arrow">→</span>
        <span class="smart-field__value" title="${valuePreview}">${valuePreview}</span>
      `;
      row.appendChild(match);

      const actions = el('div', { class: 'smart-field__actions' });
      actions.innerHTML = `
        <button class="smart-field__link" data-action="smart-change" data-field="${fieldKey}">Change</button>
        ${!field.required
          ? `<button class="smart-field__link smart-field__link--muted" data-action="smart-remove" data-field="${fieldKey}">Remove</button>`
          : ''}
      `;
      row.appendChild(actions);
    } else {
      const unmapped = el('div', { class: 'smart-field__match smart-field__match--empty' });
      unmapped.innerHTML = `
        <span class="smart-field__placeholder">Not mapped</span>
        ${field.required
          ? '<span class="smart-field__warn">⚠ Required — please choose</span>'
          : ''}
      `;
      row.appendChild(unmapped);

      const actions = el('div', { class: 'smart-field__actions' });
      actions.innerHTML = `<button class="smart-field__link" data-action="smart-change" data-field="${fieldKey}">Choose field</button>`;
      row.appendChild(actions);
    }

    return row;
  }

  function startEditField(fieldKey) {
    state.editingField = fieldKey;
    renderSmartMatch();
  }

  function saveEditField(fieldKey) {
    const select = $(`[data-smart-select="${fieldKey}"]`);
    if (!select) return;
    const newValue = select.value;
    if (newValue) {
      state.mappings[fieldKey] = newValue;
      state.autoMatched[fieldKey] = false;
    } else {
      delete state.mappings[fieldKey];
      delete state.autoMatched[fieldKey];
    }
    state.editingField = null;
    renderSmartMatch();
    toggleMappingBadge();
  }

  function removeField(fieldKey) {
    delete state.mappings[fieldKey];
    delete state.autoMatched[fieldKey];
    renderSmartMatch();
    toggleMappingBadge();
  }

  function cancelEditField() {
    state.editingField = null;
    renderSmartMatch();
  }

  function toggleAdvancedMode() {
    state.advancedMode = !state.advancedMode;
    state.editingField = null;
    renderMappingTab();
  }

  function toggleMoreFields() {
    state.showMoreFields = !state.showMoreFields;
    renderSmartMatch();
  }

  function renderJsonTree() {
    const tree = $('#jsonTree');
    tree.innerHTML = '';

    const mappedPaths = new Set(Object.values(state.mappings));

    function renderNode(obj, path = '') {
      Object.entries(obj).forEach(([key, value]) => {
        const fullPath = path ? `${path}.${key}` : key;

        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const branch = el('div', { class: 'json-node json-node--branch' });
          branch.innerHTML = `<span class="json-caret">▼</span> <span class="json-key">${key}</span>`;
          tree.appendChild(branch);

          const children = el('div', { class: 'json-children' });
          tree.appendChild(children);
          const prevAppend = tree.appendChild.bind(tree);
          tree.appendChild = n => children.appendChild(n);
          renderNode(value, fullPath);
          tree.appendChild = prevAppend;
        } else {
          const isMapped = mappedPaths.has(fullPath);
          const isSelected = state.selectedPayloadKey === fullPath;
          const mappedToLabel = isMapped
            ? APPRENTICE_FIELDS.find(f => state.mappings[f.key] === fullPath)?.label
            : null;

          const node = el('div', {
            class: `json-node json-node--draggable ${isMapped ? 'json-node--mapped' : ''} ${isSelected ? 'json-node--selected' : ''}`,
            'data-path': fullPath,
          });
          node.innerHTML = `
            <span class="json-key">${key}</span>
            <span class="json-value">"${value}"</span>
            ${mappedToLabel ? `<span class="json-mapped">→ ${mappedToLabel}</span>` : ''}
          `;
          node.addEventListener('click', () => selectPayloadKey(fullPath));
          tree.appendChild(node);
        }
      });
    }

    renderNode(state.capturedPayload);
  }

  function renderFieldSlots() {
    const container = $('#fieldSlots');
    container.innerHTML = '';

    APPRENTICE_FIELDS.forEach(field => {
      const mapped = state.mappings[field.key];
      const node = el('div', { class: 'map-field' });
      node.innerHTML = `
        <div class="map-field__label">
          ${field.label}
          ${field.required
            ? '<span class="map-field__req">required</span>'
            : '<span class="map-field__opt">optional</span>'}
        </div>
        <div class="map-field__slot ${mapped ? 'map-field__slot--filled' : 'map-field__slot--empty'}" data-target="${field.key}">
          ${mapped
            ? `<span class="chip chip--mapped">${mapped}</span>
               <button class="chip-remove" data-clear="${field.key}" aria-label="Remove mapping">×</button>`
            : `<span class="map-field__placeholder">${
                 state.selectedPayloadKey
                   ? `Click to map "${state.selectedPayloadKey}" here`
                   : 'Click a payload field first, then click here'
               }</span>`}
        </div>
      `;

      const slot = node.querySelector('.map-field__slot');
      slot.addEventListener('click', (e) => {
        if (e.target.classList.contains('chip-remove')) return;
        mapField(field.key);
      });
      const clearBtn = node.querySelector('.chip-remove');
      if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          delete state.mappings[field.key];
          renderMappingTab();
          toggleMappingBadge();
        });
      }
      container.appendChild(node);
    });
  }

  function selectPayloadKey(path) {
    state.selectedPayloadKey = (state.selectedPayloadKey === path) ? null : path;
    renderJsonTree();
    renderFieldSlots();
  }

  function mapField(apprenticeKey) {
    if (!state.selectedPayloadKey) {
      toast('First click a payload field on the left', 'info');
      return;
    }
    state.mappings[apprenticeKey] = state.selectedPayloadKey;
    state.selectedPayloadKey = null;
    renderMappingTab();
    toggleMappingBadge();
  }

  // ─── Security tab functions (now embedded in advanced-sec) ──
  function toggleSecret() {
    const input = $('#secretValue');
    const button = document.querySelector('[data-action="toggle-secret"]');
    if (input.type === 'password') {
      input.type = 'text';
      button.textContent = '🙈 Hide';
    } else {
      input.type = 'password';
      button.textContent = '👁 Reveal';
    }
  }

  function regenSecret() {
    $('#secretValue').value = generateSecret();
    $('#secretValue').type = 'text';
    const toggleBtn = document.querySelector('[data-action="toggle-secret"]');
    if (toggleBtn) toggleBtn.textContent = '🙈 Hide';
    if (state.draft) {
      state.draft.security = state.draft.security || {};
      state.draft.security.secret = $('#secretValue').value;
    }
    // Slightly longer warn-styled toast — the user *must* update their sender.
    toast('New secret generated. Update your sender!', 'warn', 4000);
  }

  function copySecret() {
    copyToClipboard($('#secretValue').value, 'Signing secret copied');
  }

  function handleSecurityRadioChange() {
    $$('.radio-option').forEach(opt => {
      const radio = opt.querySelector('input[type="radio"]');
      opt.classList.toggle('radio-option--selected', radio.checked);
      const extras = opt.querySelector('.radio-option__extras');
      if (extras) extras.hidden = !radio.checked;
    });
  }

  // ─── Advanced security disclosure (Setup Step 2) ──────────
  function openAdvancedSec() {
    state.advancedSecOpen = true;
    $('#advancedSecCollapsed').hidden = true;
    $('#advancedSecExpanded').hidden = false;
    if (state.guide.active) requestAnimationFrame(repositionSpotlight);
  }
  function closeAdvancedSec() {
    state.advancedSecOpen = false;
    const collapsed = $('#advancedSecCollapsed');
    const expanded = $('#advancedSecExpanded');
    if (collapsed) collapsed.hidden = false;
    if (expanded) expanded.hidden = true;
  }

  // ─── Logs ────────────────────────────────────────────────
  function updateLogCount() {
    const logs = state.logs[state.activeId] || [];
    const badge = $('#logCount');
    if (logs.length > 0) {
      badge.textContent = logs.length;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function renderLogsTab() {
    const list = $('#logsList');
    const logs = state.logs[state.activeId] || [];

    if (logs.length === 0) {
      list.innerHTML = `
        <div class="logs-empty">
          <div class="logs-empty__icon">📊</div>
          <h3>No requests yet</h3>
          <p>Once your webhook starts receiving requests, they'll appear here.</p>
          <button class="btn btn--ghost" data-action="simulate-log">⚡ Simulate a test request</button>
        </div>
      `;
      return;
    }

    list.innerHTML = '';
    logs.forEach(log => {
      const row = el('div', {
        class: `log-row log-row--${log.success ? 'success' : 'failed'}`,
      });
      row.innerHTML = `
        <span class="log-row__status-dot"></span>
        <div class="log-row__time">${log.relativeTime}</div>
        <div class="log-row__summary">
          ${log.success
            ? `<code>customer.email="${log.email}"</code><span class="log-row__arrow">→</span><span>${log.resultMessage}</span>`
            : `<span class="fail-text">${log.resultMessage}</span>`}
        </div>
        <div class="log-row__user">${log.success
          ? `User: <strong>${log.userLabel}</strong>`
          : `<span class="fail-text">HTTP ${log.httpCode}</span>`}</div>
        <div class="log-row__actions">
          <button class="btn btn--ghost btn--sm" data-log-replay="${log.id}">Replay</button>
          <button class="btn btn--ghost btn--sm" data-log-detail="${log.id}">👁</button>
        </div>
      `;
      list.appendChild(row);
    });
  }

  const EMAIL_POOL = ['alice@example.com', 'bob@example.com', 'carol@example.com', 'dave@example.com', 'eve@example.com'];
  const NAME_POOL = ['Alice Jones', 'Bob Smith', 'Carol Patel', 'Dave Chen', 'Eve Nakamura'];

  function simulateLog(webhookId, forceSuccess = false) {
    const id = webhookId || state.activeId;
    if (!id) return;
    const success = forceSuccess || Math.random() > 0.2;
    const idx = Math.floor(Math.random() * EMAIL_POOL.length);

    const log = {
      id: uid(),
      success,
      email: EMAIL_POOL[idx],
      userLabel: success ? NAME_POOL[idx] : null,
      resultMessage: success
        ? 'Granted access to Photography Masterclass'
        : 'Required field "email" not found',
      httpCode: success ? 200 : 400,
      relativeTime: 'just now',
    };
    state.logs[id] = state.logs[id] || [];
    state.logs[id].unshift(log);

    state.logs[id].forEach((l, i) => {
      if (i === 0) l.relativeTime = 'just now';
      else if (i === 1) l.relativeTime = '2 min ago';
      else if (i === 2) l.relativeTime = '17 min ago';
      else if (i === 3) l.relativeTime = '3h ago';
      else l.relativeTime = `${i - 2} day${i - 2 === 1 ? '' : 's'} ago`;
    });

    if (state.view === 'edit' && state.tab === 'logs' && state.activeId === id) renderLogsTab();
    if (state.view === 'list') renderList();
    updateLogCount();

    if (state.view !== 'list' && state.tab !== 'logs') {
      toast(success ? 'Webhook fired successfully' : 'Webhook fired but failed', success ? 'success' : 'error');
    }
  }

  // ─── Card popover menu ───────────────────────────────────
  let popoverFor = null;
  function showCardMenu(button, webhookId) {
    popoverFor = webhookId;
    const popover = $('#cardPopover');
    const rect = button.getBoundingClientRect();
    popover.hidden = false;
    popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
    popover.style.left = `${rect.right - 180 + window.scrollX}px`;
    const wh = state.webhooks.find(w => w.id === webhookId);
    popover.querySelector('[data-action="popover-toggle"]').textContent = wh.enabled ? '⏸ Disable' : '▶ Enable';
  }
  function hideCardMenu() {
    $('#cardPopover').hidden = true;
    popoverFor = null;
  }

  // ─── Delete modal ────────────────────────────────────────
  function openDeleteModal(id) {
    const wh = state.webhooks.find(w => w.id === id);
    if (!wh) return;
    state.deleteId = id;
    $('#deleteModalName').textContent = `"${wh.name}"`;
    $('#deleteModal').hidden = false;
  }
  function closeDeleteModal() {
    state.deleteId = null;
    $('#deleteModal').hidden = true;
  }
  function confirmDelete() {
    state.webhooks = state.webhooks.filter(w => w.id !== state.deleteId);
    delete state.logs[state.deleteId];
    closeDeleteModal();
    renderList();
    toast('Webhook deleted', 'info');
  }

  // ─── Guide / coach marks ─────────────────────────────────
  function showGuide(step) {
    if (step >= GUIDE_STEPS.length) return hideGuide();
    const g = $('#guide');
    const s = GUIDE_STEPS[step];
    $('#guideTitle').textContent = `${s.title} · Step ${step + 1} of ${GUIDE_STEPS.length}`;
    $('#guideText').innerHTML = s.text; // safe HTML allowed (e.g. <strong>)
    $('#guideNextBtn').textContent = step === GUIDE_STEPS.length - 1 ? 'Finish' : 'Got it';
    g.hidden = false;
    state.guide = { step, active: true };
    renderGuideProgress(step);
    updateSpotlight(s.target);
  }
  function hideGuide() {
    $('#guide').hidden = true;
    state.guide.active = false;
    hideSpotlight();
  }
  function advanceGuide() {
    const next = state.guide.step + 1;
    if (next >= GUIDE_STEPS.length) hideGuide();
    else showGuide(next);
  }
  function maybeGuideNext(trigger) {
    if (!state.guide.active) return;
    // Auto-advance at meaningful moments. Each step listens for ONE
    // specific event so the tour never feels racy.
    if (trigger === 'create-webhook'    && state.guide.step === 0) advanceGuide();
    // Step 1 advances when the user clicks "Next: Webhook details →" —
    // not just when the fields are filled. Matches the wizard's intent:
    // the user has explicitly committed to Step 1 before seeing Step 2.
    if (trigger === 'advance-to-step2'  && state.guide.step === 1) advanceGuide();
    if (trigger === 'start-listening'   && state.guide.step === 3) advanceGuide();
    if (trigger === 'payload-captured'  && state.guide.step === 3) advanceGuide();
    if (trigger === 'save-webhook'      && state.guide.step === 4) hideGuide();
  }

  function renderGuideProgress(step) {
    const dots = $$('#guideProgress .guide__dot');
    dots.forEach((dot, i) => {
      dot.classList.remove('guide__dot--current', 'guide__dot--done');
      if (i < step) dot.classList.add('guide__dot--done');
      else if (i === step) dot.classList.add('guide__dot--current');
    });
  }

  // Spotlight overlay — darkens the page except for the current target.
  // Borrowed wholesale from form-thrive-action.js.
  function updateSpotlight(targetSelector) {
    const spotlight = $('#spotlight');
    const hole = $('#spotlightHole');
    if (!spotlight || !hole) return;

    if (!targetSelector) {
      spotlight.hidden = false;
      spotlight.classList.add('spotlight--backdrop-only');
      spotlight.classList.remove('spotlight--active');
      return;
    }

    const target = document.querySelector(targetSelector);
    if (!target || target.offsetParent === null) {
      spotlight.hidden = false;
      spotlight.classList.add('spotlight--backdrop-only');
      spotlight.classList.remove('spotlight--active');
      return;
    }

    const rect = target.getBoundingClientRect();
    const padding = 8;
    spotlight.hidden = false;
    spotlight.classList.remove('spotlight--backdrop-only');
    spotlight.classList.add('spotlight--active');
    hole.style.top    = `${Math.max(0, rect.top - padding)}px`;
    hole.style.left   = `${Math.max(0, rect.left - padding)}px`;
    hole.style.width  = `${rect.width + padding * 2}px`;
    hole.style.height = `${rect.height + padding * 2}px`;
  }

  function hideSpotlight() {
    const spotlight = $('#spotlight');
    if (!spotlight) return;
    spotlight.hidden = true;
    spotlight.classList.remove('spotlight--active', 'spotlight--backdrop-only');
  }

  function repositionSpotlight() {
    if (!state.guide.active) return;
    const step = GUIDE_STEPS[state.guide.step];
    if (step) updateSpotlight(step.target);
  }

  // ─── Reset ───────────────────────────────────────────────
  function resetAll() {
    state.webhooks = [];
    state.logs = {};
    state.draft = null;
    state.activeId = null;
    state.capturedPayload = null;
    state.mappings = {};
    state.selectedPayloadKey = null;
    state.setupStep1Expanded = true;
    state.setupStep2Revealed = false;
    cancelListening();
    hideCardMenu();
    closeDeleteModal();
    setView('empty');
    toast('Prototype reset. Starting fresh.', 'info');
    setTimeout(() => showGuide(0), 400);
  }

  // ─── Event wiring ────────────────────────────────────────
  function wireEvents() {

    // Delegate all [data-action] clicks
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;

      switch (action) {
        case 'create-webhook':        createDraft(); maybeGuideNext('create-webhook'); break;
        case 'back-to-list':          state.draft = null; renderList(); break;
        case 'copy-url':              copyToClipboard($('#webhookUrl').value, 'Webhook URL copied'); break;
        case 'copy-secret':           copySecret(); break;
        case 'copy-header-name':      copyToClipboard($('#webhookHeaderName').value, 'Header name copied'); break;
        case 'advance-to-step2':      advanceToStep2(); break;
        case 'edit-step1':            editStep1(); break;
        case 'collapse-step1':        collapseStep1ToSummary(); break;
        case 'start-listening':       startListening(); break;
        case 'cancel-listening':      cancelListening(); break;
        case 'simulate-payload':      simulatePayloadCapture(); break;
        case 'paste-sample':          simulatePayloadCapture(); toast('Sample payload pasted', 'info'); break;
        case 'go-mapping':            setTab('mapping'); break;
        case 'go-setup':              setTab('setup'); break;
        case 'smart-change':          startEditField(target.dataset.field); break;
        case 'smart-save-edit':       saveEditField(target.dataset.field); break;
        case 'smart-cancel-edit':     cancelEditField(); break;
        case 'smart-remove':          removeField(target.dataset.field); break;
        case 'toggle-advanced':       toggleAdvancedMode(); break;
        case 'toggle-more-fields':    toggleMoreFields(); break;
        case 'replay-payload':        toast('Replayed payload with current mapping (demo)', 'info'); break;
        case 'save-webhook':          saveWebhook(); break;
        case 'toggle-secret':         toggleSecret(); break;
        case 'regen-secret':          regenSecret(); break;
        case 'open-advanced-sec':     openAdvancedSec(); break;
        case 'close-advanced-sec':    closeAdvancedSec(); break;
        case 'simulate-log':          simulateLog(); break;
        case 'close-modal':           closeDeleteModal(); break;
        case 'confirm-delete':        confirmDelete(); break;
        case 'guide-next':            advanceGuide(); break;
        case 'guide-skip':            hideGuide(); break;
        case 'card-menu': {
          e.stopPropagation();
          showCardMenu(target, target.dataset.id);
          break;
        }
        case 'popover-edit':          openEdit(popoverFor); hideCardMenu(); break;
        case 'popover-toggle': {
          const wh = state.webhooks.find(w => w.id === popoverFor);
          if (wh) { wh.enabled = !wh.enabled; renderList(); toast(wh.enabled ? 'Webhook enabled' : 'Webhook disabled', 'info'); }
          hideCardMenu();
          break;
        }
        case 'popover-copy': {
          const wh = state.webhooks.find(w => w.id === popoverFor);
          if (wh) copyToClipboard(generateUrl(wh.uuid), 'URL copied to clipboard');
          hideCardMenu();
          break;
        }
        case 'popover-delete':        openDeleteModal(popoverFor); hideCardMenu(); break;
      }
    });

    // Dismiss popover on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#cardPopover') && !e.target.closest('[data-action="card-menu"]')) {
        hideCardMenu();
      }
    });

    // Tab clicks
    $$('.tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

    // Form listeners — guide advance on Step 1 fill (name + product both set)
    $('#webhookName').addEventListener('input', () => {
      updateTitleDisplay();
      $('#crumbActive').textContent = $('#webhookName').value || 'New Webhook';
      checkStep1Complete();
    });
    $('#productId').addEventListener('change', () => {
      checkStep1Complete();
    });
    $('#actionType').addEventListener('change', toggleCreateUserBlock);
    $('#createUser').addEventListener('change', toggleCreateUserBlock);
    $('#webhookEnabled').addEventListener('change', (e) => {
      $('#enabledLabel').textContent = e.target.checked ? 'Enabled' : 'Disabled';
    });

    // Log row handlers (delegated)
    document.addEventListener('click', (e) => {
      const replay = e.target.closest('[data-log-replay]');
      const detail = e.target.closest('[data-log-detail]');
      if (replay) { toast('Replayed request (demo)', 'info'); }
      if (detail) { toast('Detail view — prototype limited', 'info'); }
    });

    // Security radios
    $$('.radio-option input[type="radio"]').forEach(r => r.addEventListener('change', handleSecurityRadioChange));

    // Mirror header-name changes from the editable Advanced input to the
    // read-only display in the Connection card. The connection card shows
    // the *current* header name even when Advanced is collapsed, so users
    // know what header to set in their external tool without opening Advanced.
    const editableHeader = $('#secretHeaderName');
    if (editableHeader) {
      editableHeader.addEventListener('input', () => {
        const display = $('#webhookHeaderName');
        if (display) display.value = editableHeader.value || 'X-Webhook-Secret';
      });
    }

    // Reset
    $('#resetBtn').addEventListener('click', resetAll);

    // Reposition spotlight on scroll/resize while guide is active
    window.addEventListener('scroll', repositionSpotlight, { passive: true });
    window.addEventListener('resize', repositionSpotlight);

    // Escape key → close modal, cancel listening, or hide guide
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#deleteModal').hidden) closeDeleteModal();
        else if (state.testState === 'listening') cancelListening();
        else if (!$('#guide').hidden) hideGuide();
      }
    });
  }

  // Tour helper: advance from Step 1 once both name and product are set.
  function checkStep1Complete() {
    if (!state.guide.active) return;
    if (state.guide.step !== 1) return;
    const nameOk = ($('#webhookName').value || '').trim().length > 2;
    const productOk = !!$('#productId').value;
    if (nameOk && productOk) maybeGuideNext('fill-step-1');
  }

  function copyToClipboard(text, successMessage) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => toast(successMessage || 'Copied', 'success'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast(successMessage || 'Copied', 'success');
    }
  }

  // ─── Init ────────────────────────────────────────────────
  function init() {
    wireEvents();
    renderList();
    setTimeout(() => showGuide(0), 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
