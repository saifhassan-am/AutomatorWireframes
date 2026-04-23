/* ==========================================================
   Apprentice — Incoming Webhooks — Interactive Prototype
   ========================================================== */

(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────
  const state = {
    view: 'empty',              // 'empty' | 'list' | 'edit'
    tab: 'setup',               // 'setup' | 'mapping' | 'security' | 'logs'
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

  const GUIDE_STEPS = [
    { title: 'Welcome! 👋', text: 'This is an interactive prototype of the new Incoming Webhooks feature for Thrive Apprentice. Click "Add Your First Webhook" to begin.' },
    { title: 'Name your webhook', text: 'Give it a descriptive name so you remember which external tool it\'s for. Try "ThriveCart — Photography Masterclass".' },
    { title: 'Choose the action', text: 'Pick what happens when data arrives. For new purchases, "Find or Create User, Then Grant Access" is ideal.' },
    { title: 'Listen for a test', text: 'Click the big "Listen for Test Request" button — it\'s the only one you need right now. In the demo, use "Simulate Incoming" to see a payload arrive.' },
    { title: 'Review auto-matched fields', text: 'We automatically matched email, first name, and last name. Review them below, then click "Continue to Security →" to move on.' },
    { title: 'Save & activate', text: 'Review the security settings, then click "Save & Activate Webhook" — the single button at the bottom. Your webhook is now live.' },
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
  }

  function setTab(tab) {
    state.tab = tab;
    $$('.tab').forEach(t => t.classList.toggle('tab--active', t.dataset.tab === tab));
    $$('.tab-panel').forEach(p => p.classList.toggle('tab-panel--active', p.dataset.panel === tab));

    if (tab === 'mapping') renderMappingTab();
    if (tab === 'logs') renderLogsTab();
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
      security: { mode: 'shared', secret: generateSecret() },
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

    populateEditForm(state.draft);
    setTab('setup');
    setTestState('idle');
    setView('edit');
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

    populateEditForm(state.draft);
    setTab('setup');
    setTestState(state.capturedPayload ? 'captured' : 'idle');
    setView('edit');
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

    toggleCreateUserBlock();
    toggleMappingBadge();
    updateLogCount();
  }

  function toggleCreateUserBlock() {
    const isGrantFlow = $('#actionType').value === 'find_create_grant';
    $('#createUserWrap').hidden = !isGrantFlow;
    $('#nestedBlock').hidden = !isGrantFlow || !$('#createUser').checked;
  }

  function updateSaveButton() {
    // Intentional no-op.
    //
    // Previously this disabled the "Save & Activate Webhook" button on the
    // Security tab whenever Name or Product was missing. Problem: Product
    // lives on the SETUP tab, so a user on Security couldn't see *why* the
    // button was disabled, couldn't fix it from there, and got stuck.
    //
    // We now keep the button always clickable. Validation happens on click
    // inside saveWebhook() — which produces a clear error toast and jumps
    // the user back to Setup with focus on the missing field. ADHD-friendly:
    // clicks always produce a clear outcome, never silent failure.
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
    state.draft.security = { mode: 'shared', secret: $('#secretValue').value };
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
      // Give the tab switch a frame to render, then focus + scroll to the field
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
      // Auto-seed a couple of log entries for demo realism
      setTimeout(() => simulateLog(saveable.id, true), 1200);
    }

    state.draft = null;
    renderList();
    maybeGuideNext();
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

    // Auto-simulate a capture after 8 seconds so impatient demo users still see it
    state.listenTimeoutId = setTimeout(() => {
      if (state.testState === 'listening') simulatePayloadCapture();
    }, 8000);
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

    // Smart auto-match runs immediately so when the user arrives on the
    // mapping tab everything is already filled in
    autoMatchFields();

    setTestState('captured');

    const matchedCount = Object.keys(state.mappings).length;
    if (state.autoMatched.email) {
      toast(`Payload captured — auto-matched ${matchedCount} field${matchedCount === 1 ? '' : 's'} including email`, 'success', 4000);
    } else {
      toast(`Payload captured from ThriveCart`, 'success');
    }

    toggleMappingBadge();
    maybeGuideNext();
  }

  // ─── Field mapping ───────────────────────────────────────
  function toggleMappingBadge() {
    const hasPayload = !!state.capturedPayload;
    const hasAllRequired = APPRENTICE_FIELDS
      .filter(f => f.required)
      .every(f => state.mappings[f.key]);
    $('#mappingBadge').hidden = !hasPayload || hasAllRequired;
  }

  // Recursively find the best-matching path in the payload
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
              // score: earlier pattern = better match, shallower path = better
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

  // Flatten payload into selectable paths (for inline dropdowns)
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

  // Look up a value by dot-notation path
  function getValueByPath(obj, path) {
    return path.split('.').reduce((acc, k) => (acc != null ? acc[k] : undefined), obj);
  }

  // Run smart auto-match after payload is captured
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

    // Show the detected-email banner only when email was auto-matched
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

    updateSaveMappingButton();
  }

  function renderSmartMatch() {
    // Title — count of matched primary fields
    const matchedCount = PRIMARY_FIELDS.filter(f => state.mappings[f]).length;
    const titleEl = $('#smartMatchTitle');
    if (matchedCount === PRIMARY_FIELDS.length) {
      titleEl.innerHTML = `Auto-matched <strong>${matchedCount}</strong> fields from your payload`;
    } else if (matchedCount > 0) {
      titleEl.innerHTML = `Auto-matched <strong>${matchedCount}</strong> of ${PRIMARY_FIELDS.length} fields — review below`;
    } else {
      titleEl.innerHTML = `We couldn't auto-match — choose fields manually`;
    }

    // Primary fields (always visible)
    const primaryContainer = $('#smartFields');
    primaryContainer.innerHTML = '';
    PRIMARY_FIELDS.forEach(fieldKey => {
      primaryContainer.appendChild(buildSmartFieldRow(fieldKey));
    });

    // "Add more fields" button + content
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

    // Label
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
      // Inline dropdown editor
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
      // Matched display
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
      // Unmapped — show "Choose field" button
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
      state.autoMatched[fieldKey] = false; // user picked manually
    } else {
      delete state.mappings[fieldKey];
      delete state.autoMatched[fieldKey];
    }
    state.editingField = null;
    renderSmartMatch();
    toggleMappingBadge();
    updateSaveMappingButton();
  }

  function removeField(fieldKey) {
    delete state.mappings[fieldKey];
    delete state.autoMatched[fieldKey];
    renderSmartMatch();
    toggleMappingBadge();
    updateSaveMappingButton();
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
          const origTree = tree;
          // Temporarily swap insertion target
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

  function autoMapFields() {
    APPRENTICE_FIELDS.forEach(f => {
      if (f.autoMap) state.mappings[f.key] = f.autoMap;
    });
    renderMappingTab();
    toggleMappingBadge();
    toast('Fields auto-mapped based on matching names', 'success');
    maybeGuideNext();
  }

  function updateSaveMappingButton() {
    const hasAllRequired = APPRENTICE_FIELDS
      .filter(f => f.required)
      .every(f => state.mappings[f.key]);
    $('#saveMappingBtn').disabled = !hasAllRequired;
  }

  function saveMapping() {
    syncDraftFromForm();
    toast('Fields saved. One last step — review security.', 'success');
    setTab('security');
  }

  // ─── Security tab ────────────────────────────────────────
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
    document.querySelector('[data-action="toggle-secret"]').textContent = '🙈 Hide';
    toast('New secret generated. Update your sender!', 'warn', 4000);
  }

  function handleSecurityRadioChange() {
    $$('.radio-option').forEach(opt => {
      const radio = opt.querySelector('input[type="radio"]');
      opt.classList.toggle('radio-option--selected', radio.checked);
      const extras = opt.querySelector('.radio-option__extras');
      if (extras) extras.hidden = !radio.checked;
    });
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

    // Age old logs
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
    $('#guideText').textContent = s.text;
    $('#guideNextBtn').textContent = step === GUIDE_STEPS.length - 1 ? 'Finish' : 'Got it';
    g.hidden = false;
    state.guide = { step, active: true };
  }
  function hideGuide() {
    $('#guide').hidden = true;
    state.guide.active = false;
  }
  function maybeGuideNext() {
    if (!state.guide.active) return;
    // Only advance on specific key moments, handled from callers
  }
  function advanceGuide() {
    const next = state.guide.step + 1;
    if (next >= GUIDE_STEPS.length) hideGuide();
    else showGuide(next);
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
        case 'create-webhook':        createDraft(); break;
        case 'back-to-list':          state.draft = null; renderList(); break;
        case 'copy-url':              copyToClipboard($('#webhookUrl').value, 'Webhook URL copied'); break;
        case 'start-listening':       startListening(); break;
        case 'cancel-listening':      cancelListening(); break;
        case 'simulate-payload':      simulatePayloadCapture(); break;
        case 'paste-sample':          simulatePayloadCapture(); toast('Sample payload pasted', 'info'); break;
        case 'go-mapping':            setTab('mapping'); break;
        case 'go-setup':              setTab('setup'); break;
        case 'auto-map':              autoMapFields(); break;
        case 'save-mapping':          saveMapping(); break;
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

    // Form listeners
    $('#webhookName').addEventListener('input', () => {
      updateSaveButton();
      $('#crumbActive').textContent = $('#webhookName').value || 'New Webhook';
      if (state.guide.active && state.guide.step === 1 && $('#webhookName').value.length > 3) advanceGuide();
    });
    $('#productId').addEventListener('change', () => {
      updateSaveButton();
      if (state.guide.active && state.guide.step === 2) advanceGuide();
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

    // Reset
    $('#resetBtn').addEventListener('click', resetAll);

    // Escape key → close modal, cancel listening
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#deleteModal').hidden) closeDeleteModal();
        else if (state.testState === 'listening') cancelListening();
        else if (!$('#guide').hidden) hideGuide();
      }
    });

    // Kick off guide for specific clicks
    document.addEventListener('click', (e) => {
      if (!state.guide.active) return;
      if (state.guide.step === 0 && e.target.closest('[data-action="create-webhook"]')) advanceGuide();
      if (state.guide.step === 3 && e.target.closest('[data-action="simulate-payload"]')) {} // handled by simulatePayloadCapture
      if (state.guide.step === 4 && e.target.closest('[data-action="save-mapping"]')) advanceGuide();
      if (state.guide.step === 5 && e.target.closest('[data-action="save-webhook"]')) advanceGuide();
    }, true);
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
    // Fresh load → show guide after a tick
    setTimeout(() => showGuide(0), 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
