/* ==========================================================
   Architect — Form → Thrive Action — Interactive Prototype
   Sibling of incoming-webhooks.js. Same state-machine shape,
   different domain: form connection panel + action picker.
   ========================================================== */

(function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────
  const GUIDE_SEEN_KEY = 'thrive_action_guide_seen';
  const CROSSLINK_DISMISSED_KEY = 'thrive_action_crosslink_dismissed';

  // ─── State ───────────────────────────────────────────────
  // taState machine:
  //   empty → picking → (picking_operation for paired actions) → configuring → configured
  //   A merged action (Apprentice / Ultimatum) routes through picking_operation
  //   so Grant/Revoke and Start/Stop are nested decisions, not top-level picks.
  const state = {
    tab: 'thrive',             // 'api' | 'html' | 'webhook' | 'thrive'
    taState: 'empty',          // 'empty' | 'picking' | 'picking_operation' | 'configuring' | 'configured'
    draft: null,               // { actionKey, subOperation?, product, campaign, template, tag, goalName, goalValue, condition?, timing }
    saved: null,               // the saved Thrive Action (or null)
    lastRemoved: null,         // shadow copy for undo after remove (P2.6) — preserves subOperation
    testResult: null,          // 'success' | 'info' | 'error' | null
    searchQuery: '',
    guide: { step: 0, active: false },
    pluginInfoReturnFocus: null, // element to restore focus to when the plugin-info modal closes
  };

  // ─── Static data ────────────────────────────────────────
  // The mock form's fields, shared with the condition editor + test drawer
  const FORM_FIELDS = [
    { key: 'email',      label: 'Email',                 type: 'text' },
    { key: 'first_name', label: 'First Name',            type: 'text' },
    { key: 'goal',       label: "What's your goal?",     type: 'select',
      options: ['Learn photography', 'Improve composition', 'Start a photography business', 'Just exploring'] },
  ];

  const PRODUCTS = [
    { id: 'photo-master',   label: 'Photography Masterclass' },
    { id: 'photo-advanced', label: 'Advanced Photography' },
    { id: 'portrait',       label: 'Portrait Lighting' },
  ];

  const CAMPAIGNS = [
    { id: 'black-friday',    label: 'Black Friday Flash Sale' },
    { id: 'spring-launch',   label: 'Spring Course Launch' },
    { id: 'final-call-photo', label: 'Final Call — Photography Masterclass' },
  ];

  // Ovation testimonial-request email templates
  const TEMPLATES = [
    { id: 'post-course', label: 'Post-Course Review Request' },
    { id: 'check-in-30', label: '30-day Check-in' },
    { id: 'fulfilment',  label: 'Product Fulfilment Follow-up' },
  ];

  // Quiz-Builder tagged-answer demo options. Mirrors the kind of tag keys
  // users define inside Quiz Builder (`style:portrait`, `level:beginner` …).
  const QUIZ_TAGS = [
    { id: 'style:portrait',     label: 'style:portrait' },
    { id: 'style:landscape',    label: 'style:landscape' },
    { id: 'level:beginner',     label: 'level:beginner' },
    { id: 'level:intermediate', label: 'level:intermediate' },
    { id: 'level:advanced',     label: 'level:advanced' },
  ];

  // Installed/available Thrive plugins — used to gate actions.
  // Quiz Builder moved from locked → installed; Thrive Comments takes its
  // place as the locked plugin that showcases the install path.
  const INSTALLED = {
    apprentice:   true,
    ultimatum:    true,
    optimize:     true,
    ovation:      true,
    quiz_builder: true,
    comments:     false,
  };

  // Copy for each plugin's "not installed" info modal. Reused by the
  // locked-row flow — one entry per plugin, so adding a future locked
  // plugin is a single addition here, not another modal template.
  const PLUGIN_INFO = {
    comments: {
      title: "Thrive Comments isn't installed",
      bullets: [
        "Lets this form unlock access to a specific comment thread — useful for course alumni, VIP discussions, or gated Q&A.",
        "Install from WP Admin → Plugins → Add New, search \"Thrive Comments\".",
      ],
      installLabel: 'Install Thrive Comments →',
    },
  };

  // Action catalogue — merged picker. Paired lifecycle actions (Grant/Revoke,
  // Start/Stop) are collapsed into single picker items with a `subOps` array;
  // the sub-operation is chosen on an intermediate screen. Standalone actions
  // (Optimize, Ovation, Quiz Tag) have `subOps: null`. Comments is locked
  // (plugin not installed) — `locked` is surfaced explicitly but computed
  // from INSTALLED at render time.
  const ACTIONS = [
    {
      key: 'apprentice_access',
      plugin: 'apprentice',
      name: 'Apprentice Access',
      desc: "Grant or revoke a user's course access.",
      icon: '🎓',
      iconClass: 'action-opt__icon--apprentice',
      subOps: [
        { key: 'grant',  name: 'Grant access',  icon: '➕', desc: 'Give the user access to an Apprentice product.' },
        { key: 'revoke', name: 'Revoke access', icon: '🚫', desc: "Remove access from a product. Their progress is preserved." },
      ],
      configShape: 'apprentice_product',
    },
    {
      key: 'ultimatum_campaign',
      plugin: 'ultimatum',
      name: 'Ultimatum Campaign',
      desc: 'Start or stop a countdown for this user.',
      icon: '⏱',
      iconClass: 'action-opt__icon--ultimatum',
      subOps: [
        { key: 'start', name: 'Start campaign', icon: '▶', desc: 'Begin a countdown for the submitter.' },
        { key: 'stop',  name: 'Stop campaign',  icon: '⏹', desc: 'Cancel an in-progress countdown for this user.' },
      ],
      configShape: 'ultimatum_campaign',
    },
    {
      key: 'optimize_conversion',
      plugin: 'optimize',
      name: 'Record Optimize conversion',
      desc: 'Count this submission as a conversion for active A/B tests on this page.',
      icon: '🎯',
      iconClass: 'action-opt__icon--optimize',
      subOps: null,
      configShape: 'optimize_goal',
    },
    {
      key: 'ovation_request',
      plugin: 'ovation',
      name: 'Send Ovation testimonial request',
      desc: 'Email this user asking them to leave a testimonial.',
      icon: '⭐',
      iconClass: 'action-opt__icon--ovation',
      subOps: null,
      configShape: 'ovation_template',
    },
    {
      key: 'tag_quiz_result',
      plugin: 'quiz_builder',
      name: 'Tag user in Quiz result',
      desc: "Apply a tag from your quiz's tagged-answer logic.",
      icon: '❓',
      iconClass: 'action-opt__icon--quiz_builder',
      subOps: null,
      configShape: 'quiz_tag',
    },
    {
      key: 'comments_unlock_thread',
      plugin: 'comments',
      name: 'Unlock gated comment thread',
      desc: 'Allow this user to see and post in a protected comment thread.',
      icon: '💬',
      iconClass: 'action-opt__icon--comments',
      subOps: null,
      configShape: null, // never reached; locked until Thrive Comments installed
      locked: true,
    },
  ];

  const GUIDE_STEPS = [
    {
      title: 'Welcome',
      text: "Welcome! You're on the new <strong>Thrive Action</strong> tab — this is where you wire this form into your other Thrive plugins without Automator.",
      target: null, // no specific element — dimmed backdrop only
    },
    {
      title: 'Add an action',
      text: 'Click the pulsing "+ Add Thrive Action" button. This is the only active CTA on screen right now.',
      target: '[data-ta-state="empty"] [data-action="add-action"]',
    },
    {
      title: 'Pick what to do',
      text: "Pick an action — we've found six Thrive actions for your site. Some (like Apprentice Access and Ultimatum Campaign) will ask you one more question — Grant or Revoke? Start or Stop? — before you configure.",
      target: '[data-ta-state="picking"] .picker__list',
    },
    {
      title: 'Configure it',
      text: 'Pick a product, optionally add a condition, then hit the pulsing "Save Thrive Action" button.',
      target: '[data-ta-state="configuring"] .configure',
    },
    {
      title: 'Test it safely',
      text: 'After saving, use "Test this action" to run it with sample data — no user is created, no access granted.',
      target: '[data-ta-state="configured"] [data-action="test-action"]',
    },
  ];

  // ─── DOM helpers ────────────────────────────────────────
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

  // ─── Toasts ─────────────────────────────────────────────
  // Accepts a string (treated as safe pre-built HTML) or an HTMLElement for
  // the message body. Pass { html: string | Node, onMount?: (node) => void }
  // as the first arg for richer variants (e.g. undo links, install links).
  function toast(message, kind = 'info', duration = 3000) {
    const container = $('#toasts');
    const node = el('div', { class: `toast toast--${kind}` });
    const iconChar = { success: '✓', error: '✗', info: 'ⓘ', warn: '⚠' }[kind] || 'ⓘ';

    const iconSpan = el('span', { class: 'toast__icon', text: iconChar });
    const msgSpan = el('span', { class: 'toast__msg' });

    let onMount = null;
    if (typeof message === 'string') {
      msgSpan.innerHTML = message;
    } else if (message instanceof Node) {
      msgSpan.appendChild(message);
    } else if (message && typeof message === 'object') {
      if (message.html instanceof Node) {
        msgSpan.appendChild(message.html);
      } else if (typeof message.html === 'string') {
        msgSpan.innerHTML = message.html;
      }
      if (typeof message.onMount === 'function') onMount = message.onMount;
    }

    node.appendChild(iconSpan);
    node.appendChild(msgSpan);
    container.appendChild(node);

    if (onMount) onMount(node);

    requestAnimationFrame(() => node.classList.add('toast--in'));
    const timer = setTimeout(dismiss, duration);
    function dismiss() {
      clearTimeout(timer);
      node.classList.remove('toast--in');
      node.classList.add('toast--out');
      setTimeout(() => node.remove(), 300);
    }
    // Allow callers to dismiss the toast programmatically
    node._dismiss = dismiss;
    return node;
  }

  // ─── Tab switching (panel tabs: API / HTML / Webhook / Thrive) ─
  function setTab(tab) {
    state.tab = tab;
    $$('.tab').forEach(t => t.classList.toggle('tab--active', t.dataset.tab === tab));
    $$('.tab-panel').forEach(p => p.classList.toggle('tab-panel--active', p.dataset.panel === tab));
  }

  // ─── Thrive-Action state machine ────────────────────────
  function setTaState(s) {
    state.taState = s;
    $$('[data-ta-state]').forEach(n => {
      n.hidden = n.dataset.taState !== s;
    });

    // Trigger re-renders for the state we just entered
    if (s === 'picking')           renderActionList();
    if (s === 'picking_operation') renderSubOpSelector();
    if (s === 'configuring')       renderConfigure();
    if (s === 'configured')        renderSummary();

    // Spotlight may need to point at a now-visible element — reposition
    // after the DOM has laid out.
    if (state.guide.active) {
      requestAnimationFrame(repositionSpotlight);
    }
  }

  // ─── STATE: empty → picking ────────────────────────────
  function goToPicking() {
    state.draft = null;
    state.searchQuery = '';
    const search = $('#actionSearch');
    if (search) search.value = '';
    setTaState('picking');
    setTimeout(() => $('#actionSearch')?.focus(), 50);
  }

  // ─── STATE: picking ─────────────────────────────────────
  function renderActionList() {
    const list = $('#actionList');
    list.innerHTML = '';

    const q = state.searchQuery.toLowerCase();
    const visible = ACTIONS.filter(a =>
      !q || a.name.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q)
    );

    if (visible.length === 0) {
      const empty = el('div', {
        class: 'stub',
        html: `
          <div class="stub__icon">🔎</div>
          <h3 class="stub__title">No actions match "${state.searchQuery}"</h3>
          <p class="stub__text">Try a different search term.</p>
        `
      });
      list.appendChild(empty);
      return;
    }

    visible.forEach(a => {
      const available = INSTALLED[a.plugin];
      const btn = el('button', {
        class: `action-opt ${available ? '' : 'action-opt--disabled'}`,
        'data-action-key': a.key,
        type: 'button',
        disabled: !available,
      });
      const pluginLabel = pluginDisplayName(a.plugin);
      btn.innerHTML = `
        <span class="action-opt__icon ${a.iconClass}">${a.icon}</span>
        <div class="action-opt__body">
          <div class="action-opt__name">${a.name}</div>
          <div class="action-opt__desc">${a.desc}${
            !available
              ? ` — <strong>Install ${pluginLabel}</strong> to enable.`
              : ''
          }</div>
        </div>
        ${available
          ? '<span class="action-opt__chevron" aria-hidden="true">›</span>'
          : '<span class="action-opt__lock" title="Requires plugin"><span aria-hidden="true">🔒</span> Requires plugin</span>'}
      `;
      if (available) {
        btn.addEventListener('click', () => pickAction(a.key));
      } else {
        btn.addEventListener('click', () => showLockedToast(a));
      }
      list.appendChild(btn);
    });
  }

  // Nice human label for a plugin key — used in locked-row copy and modal text.
  function pluginDisplayName(plugin) {
    if (plugin === 'quiz_builder') return 'Quiz Builder';
    if (plugin === 'comments')     return 'Thrive Comments';
    // Capitalise the rest ("apprentice" → "Apprentice", etc.)
    return plugin ? plugin.charAt(0).toUpperCase() + plugin.slice(1) : '';
  }

  // P1.2 — locked row click emits a toast with a clickable install link.
  // Clicking the link closes the toast and opens the plugin-info modal.
  function showLockedToast(action) {
    const pluginLabel = pluginDisplayName(action.plugin);
    const info = PLUGIN_INFO[action.plugin] || {};
    const body = el('span');
    body.appendChild(document.createTextNode(`${action.name} requires ${pluginLabel}.`));
    const link = el('button', {
      class: 'toast__link',
      type: 'button',
      text: info.installLabel || `Install ${pluginLabel} →`,
    });
    body.appendChild(link);
    const toastNode = toast({
      html: body,
      onMount: (node) => {
        link.addEventListener('click', (e) => {
          e.stopPropagation();
          node._dismiss && node._dismiss();
          openPluginInfoModal(action.plugin);
        });
      },
    }, 'info', 5000);
    return toastNode;
  }

  // Generic plugin-info modal. One shell (#pluginInfoModal) driven by the
  // PLUGIN_INFO map — so Quiz Builder (previously locked) and Thrive Comments
  // (newly locked) share the same component. Adding another locked plugin is
  // a single PLUGIN_INFO entry, no new DOM.
  function openPluginInfoModal(pluginKey) {
    const modal = $('#pluginInfoModal');
    if (!modal) return;
    const info = PLUGIN_INFO[pluginKey];
    if (!info) return;
    // Remember where focus lived so we can restore it on close.
    state.pluginInfoReturnFocus = document.activeElement;
    $('#pluginInfoTitle').textContent = info.title;
    const list = $('#pluginInfoList');
    list.innerHTML = '';
    info.bullets.forEach(b => {
      list.appendChild(el('li', { html: b }));
    });
    modal.hidden = false;
    setTimeout(() => $('#pluginInfoGotIt')?.focus(), 30);
  }
  function closePluginInfoModal() {
    const modal = $('#pluginInfoModal');
    if (!modal) return;
    modal.hidden = true;
    // Restore focus to the element that opened the modal (usually the toast
    // link — which has been dismissed; fall back to the matching locked row).
    const prior = state.pluginInfoReturnFocus;
    state.pluginInfoReturnFocus = null;
    if (prior && document.contains(prior) && typeof prior.focus === 'function') {
      prior.focus();
    } else {
      // Focus the first locked row in the picker if we're on that screen.
      const lockedRow = document.querySelector('[data-ta-state="picking"] .action-opt--disabled');
      lockedRow?.focus();
    }
  }

  function pickAction(actionKey) {
    const action = ACTIONS.find(a => a.key === actionKey);
    if (!action) return;
    state.draft = makeEmptyDraft(actionKey);
    if (action.subOps && action.subOps.length) {
      // Merged action — route through the sub-op selector.
      setTaState('picking_operation');
    } else {
      setTaState('configuring');
    }
    maybeGuideNext('pick-action');
  }

  // Canonical draft shape. One slot per configShape so switching actions
  // doesn't leave stale values behind on cross-field reads.
  //
  // `timing` defaults to { mode: 'immediate' } for every new draft; when the
  // user expands the Timing block it becomes { mode: 'delay', delayValue: 2,
  // delayUnit: 'days' }. `delayValue` / `delayUnit` are only meaningful when
  // mode === 'delay' but are always readable — keeping them in the shape
  // simplifies the shadow-copy path for Remove/Undo.
  function makeEmptyDraft(actionKey, overrides = {}) {
    return {
      actionKey,
      subOperation: null, // 'grant' | 'revoke' | 'start' | 'stop' | null
      product:   '',      // apprentice_product
      campaign:  '',      // ultimatum_campaign
      template:  '',      // ovation_template
      tag:       '',      // quiz_tag
      goalName:  '',      // optimize_goal (optional)
      goalValue: '',      // optimize_goal (optional)
      condition: null,    // { field, op, value } or null
      timing:    { mode: 'immediate' }, // see cloneTiming() for delay shape
      ...overrides,
    };
  }

  // Deep-clone helper for the timing slot — used by Edit, Remove+Undo,
  // and saveAction so each path keeps its own object (no shared refs).
  function cloneTiming(t) {
    if (!t) return { mode: 'immediate' };
    if (t.mode === 'delay') {
      return { mode: 'delay', delayValue: t.delayValue, delayUnit: t.delayUnit };
    }
    return { mode: 'immediate' };
  }

  // Is this action schedulable? Optimize conversions are definitionally tied
  // to the submission moment (delaying would misattribute A/B tests), so the
  // Timing block is hidden entirely for that action. All other actions show it.
  function actionSupportsTiming(action) {
    if (!action) return false;
    return action.key !== 'optimize_conversion';
  }

  // ─── STATE: picking_operation ──────────────────────────
  // Light intermediate screen: header + two big choice cards. Clicking a
  // card IS the decision — no confirm button. Keyboard: Tab moves between
  // cards, Enter selects (native <button> behaviour).
  function renderSubOpSelector() {
    if (!state.draft) return;
    const action = ACTIONS.find(a => a.key === state.draft.actionKey);
    if (!action || !action.subOps) {
      // Shouldn't land here without subOps — recover gracefully.
      setTaState('picking');
      return;
    }

    $('#subopHeaderIcon').textContent = action.icon;
    $('#subopHeaderIcon').className = 'subop__header-icon subop__header-icon--' + action.plugin;
    $('#subopHeaderName').textContent = action.name;
    $('#subopHeaderSub').textContent = subOpPrompt(action);

    const list = $('#subopList');
    list.innerHTML = '';
    action.subOps.forEach(op => {
      const btn = el('button', {
        class: `subop-card subop-card--${action.plugin}`,
        type: 'button',
        'data-subop-key': op.key,
      });
      btn.innerHTML = `
        <span class="subop-card__icon" aria-hidden="true">${op.icon}</span>
        <div class="subop-card__body">
          <div class="subop-card__name">${op.name}</div>
          <div class="subop-card__desc">${op.desc}</div>
        </div>
        <span class="subop-card__chevron" aria-hidden="true">›</span>
      `;
      btn.addEventListener('click', () => pickSubOp(op.key));
      list.appendChild(btn);
    });

    // Focus the first card so keyboard users land inside the choice set.
    setTimeout(() => list.querySelector('.subop-card')?.focus(), 30);
  }

  // Header sub-prompt per merged action. Kept here so adding a third
  // merged action is one case, not a DOM hunt.
  function subOpPrompt(action) {
    if (action.key === 'apprentice_access')   return "What should happen with this user's access?";
    if (action.key === 'ultimatum_campaign')  return 'What should happen with this campaign?';
    return 'What should happen?';
  }

  function pickSubOp(subOpKey) {
    if (!state.draft) return;
    state.draft.subOperation = subOpKey;
    setTaState('configuring');
  }

  function backToPicker() {
    // Clear actionKey so coming back via the picker starts clean.
    state.draft = null;
    setTaState('picking');
  }

  // ─── STATE: configuring ─────────────────────────────────
  function renderConfigure() {
    if (!state.draft) return;
    const action = ACTIONS.find(a => a.key === state.draft.actionKey);
    if (!action) return;

    // Header pill — for merged actions, prefer the sub-op icon + verb so
    // the user always sees which lifecycle branch they're configuring.
    const subOp = currentSubOp(action, state.draft);
    $('#pillIcon').textContent = subOp ? subOp.icon : action.icon;
    $('#pillName').textContent = subOp ? `${subOp.name.charAt(0).toUpperCase() + subOp.name.slice(1)} — ${action.name}` : action.name;
    $('#pillDesc').textContent = subOp ? subOp.desc : action.desc;

    // Pill icon tint via class, not inline style. One class per plugin family.
    const pill = $('#pillIcon');
    pill.className = 'action-pill__icon ' + pluginTintClass('action-pill__icon', action.plugin);

    // Action-specific config section — delegated to per-action renderers so
    // adding a 7th action is one new case, not a hunt through this function.
    const section = $('#configSection');
    section.innerHTML = '';
    renderConfigFields(section, action);

    // Timing — reflect current state. Hidden entirely for Optimize (the
    // conversion event must fire at submission time to match A/B attribution).
    renderTiming(action);

    // Condition — reflect current state
    if (state.draft.condition) {
      $('#conditionCollapsed').hidden = true;
      $('#conditionExpanded').hidden = false;
      $('#condField').value = state.draft.condition.field;
      $('#condOp').value    = state.draft.condition.op;
      renderConditionValue();
    } else {
      $('#conditionCollapsed').hidden = false;
      $('#conditionExpanded').hidden = true;
    }

    // P1.1 — gate Save pulse on primary target being chosen
    updateSavePulse();
  }

  // P1.1 — toggle btn--pulse on the Save button based on whether the
  // primary target has been picked. Save remains a solid filled primary
  // button at all times; only the pulse is conditional.
  //
  // Optimize is a special case: both its fields are optional, so nothing
  // gates "I'm ready to save." — Save pulses from entry.
  function updateSavePulse() {
    const saveBtn = document.querySelector('[data-ta-state="configuring"] [data-action="save-action"]');
    if (!saveBtn) return;
    if (!state.draft) {
      saveBtn.classList.remove('btn--pulse');
      return;
    }
    const action = ACTIONS.find(a => a.key === state.draft.actionKey);
    if (!action) {
      saveBtn.classList.remove('btn--pulse');
      return;
    }
    let targetPicked = false;
    if      (action.configShape === 'apprentice_product') targetPicked = !!state.draft.product;
    else if (action.configShape === 'ultimatum_campaign') targetPicked = !!state.draft.campaign;
    else if (action.configShape === 'ovation_template')   targetPicked = !!state.draft.template;
    else if (action.configShape === 'quiz_tag')           targetPicked = !!state.draft.tag;
    else if (action.configShape === 'optimize_goal')      targetPicked = true; // both fields optional — pulse immediately
    else                                                  targetPicked = true; // actions with no config
    saveBtn.classList.toggle('btn--pulse', targetPicked);
  }

  // Resolve the currently-picked sub-operation for a merged action, if any.
  function currentSubOp(action, draft) {
    if (!action || !action.subOps || !draft || !draft.subOperation) return null;
    return action.subOps.find(s => s.key === draft.subOperation) || null;
  }

  // Returns the BEM-suffix tint class to apply for a given plugin, reused by
  // the action-pill icon and the configured summary icon. One source of truth
  // means adding a 7th plugin only touches this mapping.
  function pluginTintClass(baseBlock, plugin) {
    return `${baseBlock}--${plugin || 'apprentice'}`;
  }

  // Per-action config-section renderer. Attaches change listeners inline
  // so each field wires its own state.draft slot + pulse update.
  function renderConfigFields(section, action) {
    if (action.configShape === 'apprentice_product') {
      // Title phrasing differs per sub-op so "Revoke" doesn't read as "Add".
      const title = state.draft.subOperation === 'revoke'
        ? 'Which Apprentice product to revoke?'
        : 'Which Apprentice product to grant?';
      const group = el('div');
      group.innerHTML = `
        <h4 class="configure__section-title">${title}</h4>
        <div class="select-wrap">
          <select class="input input--select" id="productSelect">
            <option value="">— Select a product —</option>
            ${PRODUCTS.map(p => `<option value="${p.id}" ${state.draft.product === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </div>
      `;
      section.appendChild(group);
      $('#productSelect').addEventListener('change', e => {
        state.draft.product = e.target.value;
        updateSavePulse();
      });
      return;
    }

    if (action.configShape === 'ultimatum_campaign') {
      const title = state.draft.subOperation === 'stop'
        ? 'Which Ultimatum campaign to stop?'
        : 'Which Ultimatum campaign to start?';
      const group = el('div');
      group.innerHTML = `
        <h4 class="configure__section-title">${title}</h4>
        <div class="select-wrap">
          <select class="input input--select" id="campaignSelect">
            <option value="">— Select a campaign —</option>
            ${CAMPAIGNS.map(c => `<option value="${c.id}" ${state.draft.campaign === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>
        </div>
      `;
      section.appendChild(group);
      $('#campaignSelect').addEventListener('change', e => {
        state.draft.campaign = e.target.value;
        updateSavePulse();
      });
      return;
    }

    if (action.configShape === 'ovation_template') {
      const group = el('div');
      group.innerHTML = `
        <h4 class="configure__section-title">Which testimonial request template?</h4>
        <div class="select-wrap">
          <select class="input input--select" id="templateSelect">
            <option value="">— Select a template —</option>
            ${TEMPLATES.map(t => `<option value="${t.id}" ${state.draft.template === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select>
        </div>
      `;
      section.appendChild(group);
      $('#templateSelect').addEventListener('change', e => {
        state.draft.template = e.target.value;
        updateSavePulse();
      });
      return;
    }

    if (action.configShape === 'quiz_tag') {
      // Demo data mirrors a Quiz Builder tagged-answer setup. The helper
      // text explains that editing tags in Quiz Builder propagates here.
      const group = el('div');
      group.innerHTML = `
        <h4 class="configure__section-title">Which quiz tag should fire?</h4>
        <div class="select-wrap">
          <select class="input input--select" id="quizTagSelect">
            <option value="">— Select a tag —</option>
            ${QUIZ_TAGS.map(t => `<option value="${t.id}" ${state.draft.tag === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select>
        </div>
        <p class="configure__hint">Pulled from your quizzes' tagged-answer settings. Update once in Quiz Builder — changes propagate to every form using this tag.</p>
      `;
      section.appendChild(group);
      $('#quizTagSelect').addEventListener('change', e => {
        state.draft.tag = e.target.value;
        updateSavePulse();
      });
      return;
    }

    if (action.configShape === 'optimize_goal') {
      // Two stacked fields, both optional. Helper text under each reinforces
      // "nothing is required" so Save is obviously already live.
      const group = el('div');
      group.innerHTML = `
        <div class="configure__field">
          <h4 class="configure__section-title">Goal name (optional)</h4>
          <input type="text" class="input" id="goalNameInput"
                 placeholder="e.g. Newsletter signup"
                 value="${escapeAttr(state.draft.goalName || '')}">
          <p class="configure__hint">Leave blank to count against the page-level conversion only.</p>
        </div>
        <div class="configure__field">
          <h4 class="configure__section-title">Conversion value in $ (optional)</h4>
          <input type="number" class="input" id="goalValueInput"
                 min="0" step="0.01" placeholder="0"
                 value="${escapeAttr(state.draft.goalValue || '')}">
          <p class="configure__hint">Used for revenue-weighted A/B tests. Leave blank if unsure.</p>
        </div>
      `;
      section.appendChild(group);
      $('#goalNameInput').addEventListener('input', e => {
        state.draft.goalName = e.target.value;
      });
      $('#goalValueInput').addEventListener('input', e => {
        state.draft.goalValue = e.target.value;
      });
      return;
    }

    // Fallthrough: no config section (e.g. locked quiz action — never
    // actually reached in practice because it's gated by INSTALLED).
  }

  // Tiny HTML-attribute escaper for values we round-trip through innerHTML.
  function escapeAttr(v) {
    return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // Render the Timing block — collapsed by default, expanded when the
  // draft's timing.mode is 'delay'. Hidden entirely for actions that
  // don't support scheduling (Optimize conversion).
  function renderTiming(action) {
    const wrap = $('#timingWrap');
    const collapsed = $('#timingCollapsed');
    const expanded = $('#timingExpanded');
    if (!wrap || !collapsed || !expanded) return;

    if (!actionSupportsTiming(action)) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;

    const timing = state.draft?.timing || { mode: 'immediate' };
    if (timing.mode === 'delay') {
      collapsed.hidden = true;
      expanded.hidden = false;
      const numInput = $('#delayValue');
      const unitSelect = $('#delayUnit');
      if (numInput) numInput.value = String(timing.delayValue ?? 2);
      if (unitSelect) unitSelect.value = timing.delayUnit ?? 'days';
    } else {
      collapsed.hidden = false;
      expanded.hidden = true;
    }
  }

  function addDelay() {
    if (!state.draft) return;
    state.draft.timing = { mode: 'delay', delayValue: 2, delayUnit: 'days' };
    renderConfigure();
    // Drop focus into the number input so keyboard users can tweak the
    // value immediately. Mirrors "focus the first card" after sub-op pick.
    setTimeout(() => $('#delayValue')?.focus(), 30);
  }

  function removeDelay() {
    if (!state.draft) return;
    state.draft.timing = { mode: 'immediate' };
    renderConfigure();
    toast('Delay removed — fires immediately.', 'info', 2000);
  }

  // Read the Timing inputs back into the draft. Called on change and again
  // inside saveAction() to capture any in-flight value the user didn't blur.
  function syncTimingFromDOM() {
    if (!state.draft) return;
    if (state.draft.timing?.mode !== 'delay') return;
    const raw = parseInt($('#delayValue')?.value, 10);
    const num = Number.isFinite(raw) && raw >= 1 ? raw : 1;
    const unit = $('#delayUnit')?.value || 'days';
    state.draft.timing.delayValue = num;
    state.draft.timing.delayUnit  = unit;
  }

  // Grammatically correct unit rendering — "1 day" vs "2 days".
  function formatDelayPhrase(timing) {
    if (!timing || timing.mode !== 'delay') return '';
    const n = timing.delayValue;
    // 'minutes' → 'minute', strip trailing 's' only when singular.
    const unitSingular = (timing.delayUnit || 'days').replace(/s$/, '');
    const unit = n === 1 ? unitSingular : unitSingular + 's';
    return `${n} ${unit}`;
  }

  function renderConditionValue() {
    const wrap = $('#condValueWrap');
    wrap.innerHTML = '';
    const fieldKey = $('#condField').value;
    const field = FORM_FIELDS.find(f => f.key === fieldKey);
    if (!field) return;

    const currentValue = state.draft?.condition?.value || '';

    if (field.type === 'select') {
      const sel = el('select', { class: 'input input--select input--sm', id: 'condValue' });
      field.options.forEach(opt => {
        const o = el('option', { value: opt, text: opt });
        if (opt === currentValue) o.selected = true;
        sel.appendChild(o);
      });
      wrap.appendChild(sel);
      sel.addEventListener('change', updateConditionValue);
      // Pre-populate value if currently empty
      if (!currentValue && state.draft?.condition) {
        state.draft.condition.value = sel.value;
      }
    } else {
      const inp = el('input', {
        class: 'input input--sm',
        id: 'condValue',
        type: 'text',
        placeholder: 'Value…',
        value: currentValue,
      });
      wrap.appendChild(inp);
      inp.addEventListener('input', updateConditionValue);
    }
  }

  function updateConditionValue() {
    if (!state.draft) return;
    const value = $('#condValue')?.value ?? '';
    if (!state.draft.condition) return;
    state.draft.condition.field = $('#condField').value;
    state.draft.condition.op    = $('#condOp').value;
    state.draft.condition.value = value;
  }

  function addCondition() {
    if (!state.draft) return;
    const defaultField = 'goal';
    const field = FORM_FIELDS.find(f => f.key === defaultField);
    const defaultValue = field.type === 'select' ? field.options[0] : '';
    state.draft.condition = { field: defaultField, op: 'equals', value: defaultValue };
    renderConfigure();
  }

  function removeCondition() {
    if (!state.draft) return;
    state.draft.condition = null;
    renderConfigure();
    toast('Condition removed', 'info', 2000);
  }

  function saveAction() {
    if (!state.draft) return;
    // Capture latest condition values from DOM (they may not have fired change)
    if (state.draft.condition) {
      state.draft.condition.field = $('#condField').value;
      state.draft.condition.op    = $('#condOp').value;
      state.draft.condition.value = $('#condValue')?.value ?? state.draft.condition.value;
    }
    // Same idea for Timing — capture any in-flight input that didn't blur.
    syncTimingFromDOM();

    // Validate — never disable save button; produce a clear outcome on click.
    // Optimize has no required field, so it's intentionally absent here.
    const action = ACTIONS.find(a => a.key === state.draft.actionKey);
    if (action.configShape === 'apprentice_product' && !state.draft.product) {
      toast('Please pick a product before saving.', 'error', 4000);
      const sel = $('#productSelect');
      sel?.focus();
      sel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (action.configShape === 'ultimatum_campaign' && !state.draft.campaign) {
      toast('Please pick a campaign before saving.', 'error', 4000);
      const sel = $('#campaignSelect');
      sel?.focus();
      sel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (action.configShape === 'ovation_template' && !state.draft.template) {
      toast('Please pick a testimonial template before saving.', 'error', 4000);
      const sel = $('#templateSelect');
      sel?.focus();
      sel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (action.configShape === 'quiz_tag' && !state.draft.tag) {
      toast('Please pick a tag before saving.', 'error', 4000);
      const sel = $('#quizTagSelect');
      sel?.focus();
      sel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    state.saved = {
      ...state.draft,
      condition: state.draft.condition ? { ...state.draft.condition } : null,
      timing: cloneTiming(state.draft.timing),
    };
    state.draft = null;
    toast('Thrive Action saved — this form will now fire it on submit.', 'success', 3500);
    setTaState('configured');
    maybeGuideNext('save-action');
  }

  function cancelConfiguring() {
    state.draft = null;
    // If we had a saved action before entering edit mode, go back to configured.
    if (state.saved) setTaState('configured');
    else             setTaState('empty');
  }

  function changeAction() {
    // For merged actions (Apprentice, Ultimatum) Change returns to the
    // sub-op selector — the user flips Grant↔Revoke / Start↔Stop in one
    // click without losing their picked product / campaign / condition.
    // From there "← Back to actions" returns to the full picker (2 clicks
    // total to fully change category).
    //
    // For standalone actions (Optimize / Ovation / Quiz Tag) Change goes
    // back to the picker as before. Comments is locked and never reaches
    // this screen.
    if (!state.draft) {
      setTaState('picking');
      return;
    }
    const action = ACTIONS.find(a => a.key === state.draft.actionKey);
    if (action && action.subOps && action.subOps.length) {
      // Preserve everything except the sub-operation so the two cards
      // re-appear in a "flip the switch" mode.
      state.draft.subOperation = null;
      setTaState('picking_operation');
      return;
    }
    setTaState('picking');
  }

  // ─── STATE: configured (summary) ────────────────────────
  function renderSummary() {
    if (!state.saved) { setTaState('empty'); return; }
    const action = ACTIONS.find(a => a.key === state.saved.actionKey);
    if (!action) return;

    // For merged actions surface the sub-op icon + verb in the summary
    // card — the icon matches the chosen branch (➕ Grant, 🚫 Revoke, ▶ Start,
    // ⏹ Stop), so a glance at the card tells you the lifecycle direction.
    const subOp = currentSubOp(action, state.saved);
    $('#summaryIcon').textContent = subOp ? subOp.icon : action.icon;
    $('#summaryName').textContent = summaryActionName(action, subOp);

    // Build the per-action "flow" line. Arrow direction reflects whether the
    // action adds (→) or removes (←) state. Optimize is a standalone event
    // with optional secondary fields, so it uses inline separators instead.
    $('#summaryFlow').textContent = buildFlowLine(action);

    // Icon colour — one class per plugin family.
    const icon = $('#summaryIcon');
    icon.className = 'configured__icon ' + pluginTintClass('configured__icon', action.plugin);

    // Combined timing + condition line. Builder is kept pure so the same
    // sentence could be reused in a submission-log preview later.
    $('#summaryConditionText').innerHTML = buildSummaryFiresLine(action);
  }

  // Compose the "when it fires" sentence shown on the summary card. Merges
  // timing + condition into one line:
  //   Immediate, no condition  → "Fires immediately on submission"
  //   Delayed, no condition    → "Fires 2 days after submission"
  //   Immediate + condition    → "Fires immediately — only if goal equals 'X'"
  //   Delayed + condition      → "Fires 2 days after submission — only if …"
  //
  // Kept pure (returns a string, no DOM writes) so it's safe to call from
  // the summary renderer or from future submission-log previews.
  function buildSummaryFiresLine(action) {
    const s = state.saved;
    if (!s) return '';

    // Timing half — hide "after submission" phrasing entirely for Optimize
    // since that action doesn't support delays. Fall back to the old copy.
    let timingHalf;
    if (!actionSupportsTiming(action)) {
      timingHalf = 'Fires on every submission';
    } else if (s.timing && s.timing.mode === 'delay') {
      timingHalf = `Fires ${formatDelayPhrase(s.timing)} after submission`;
    } else {
      timingHalf = 'Fires immediately on submission';
    }

    if (!s.condition) return timingHalf;

    // Condition half — "only if field equals 'value'". We lowercase the first
    // letter because it sits mid-sentence after an em-dash.
    const field = FORM_FIELDS.find(f => f.key === s.condition.field);
    const opLabel = {
      'equals': 'equals',
      'not_equals': 'does not equal',
      'contains': 'contains'
    }[s.condition.op] || s.condition.op;
    const fieldLabel = field?.label || s.condition.field;
    const condHalf = `only if <strong>${fieldLabel}</strong> ${opLabel} <strong>"${s.condition.value || '(empty)'}"</strong>`;

    // Optimize has no delay, so the sentence becomes
    // "Fires on every submission — only if …" which reads fine.
    return `${timingHalf} — ${condHalf}`;
  }

  // Compose the "Action name" shown in the summary header. Merged actions
  // prefix the sub-operation verb so "Grant Apprentice Access" reads the
  // same as it did pre-merge.
  function summaryActionName(action, subOp) {
    if (!action) return '';
    if (action.key === 'apprentice_access') {
      if (subOp && subOp.key === 'grant')  return 'Grant Apprentice Access';
      if (subOp && subOp.key === 'revoke') return 'Revoke Apprentice Access';
    }
    if (action.key === 'ultimatum_campaign') {
      if (subOp && subOp.key === 'start') return 'Start Ultimatum Campaign';
      if (subOp && subOp.key === 'stop')  return 'Stop Ultimatum Campaign';
    }
    return action.name;
  }

  // Compose the plain-English "flow" string shown on the summary card.
  // Arrow direction is semantic — "→" for add/start/send/tag, "←" for
  // revoke/stop. The summary-header icon carries the verb; this line
  // carries the object (product / campaign / tag / template).
  function buildFlowLine(action) {
    const s = state.saved;
    if (!s) return '';

    if (action.key === 'apprentice_access') {
      const p = PRODUCTS.find(p => p.id === s.product);
      const label = p ? p.label : '(no product)';
      return s.subOperation === 'revoke' ? `← ${label}` : `→ ${label}`;
    }
    if (action.key === 'ultimatum_campaign') {
      const c = CAMPAIGNS.find(c => c.id === s.campaign);
      const label = c ? c.label : '(no campaign)';
      return s.subOperation === 'stop' ? `← ${label}` : `→ ${label}`;
    }
    if (action.key === 'ovation_request') {
      const t = TEMPLATES.find(t => t.id === s.template);
      return `→ ${t ? t.label : '(no template)'}`;
    }
    if (action.key === 'tag_quiz_result') {
      const tg = QUIZ_TAGS.find(t => t.id === s.tag);
      // Arrow forward — a tag is additive (applied to the user's record).
      return `→ ${tg ? tg.label : '(no tag)'}`;
    }
    if (action.key === 'optimize_conversion') {
      // Omit goal/value segments that are blank. If both blank, show nothing
      // after the action name (caller's icon + name already covers context).
      const parts = [];
      if (s.goalName)  parts.push(`Goal: ${s.goalName}`);
      if (s.goalValue) parts.push(`Value: $${s.goalValue}`);
      return parts.length ? '· ' + parts.join(' · ') : '';
    }
    return '';
  }

  function editAction() {
    if (!state.saved) return;
    state.draft = {
      ...state.saved,
      condition: state.saved.condition ? { ...state.saved.condition } : null,
      timing: cloneTiming(state.saved.timing),
    };
    setTaState('configuring');
  }

  function removeActionConfirm() {
    if (!state.saved) return;
    const action = ACTIONS.find(a => a.key === state.saved.actionKey);
    $('#removeModalName').textContent = action ? `"${action.name}"` : 'this action';
    $('#removeModal').hidden = false;
    // P2.8 — focus Keep action (safe default), trap focus in modal
    setTimeout(() => {
      const keepBtn = $('#removeModal [data-action="close-modal"]');
      keepBtn?.focus();
    }, 30);
  }
  function closeRemoveModal() {
    $('#removeModal').hidden = true;
  }
  function confirmRemove() {
    // P2.6 — keep a shadow copy for Undo. Timing round-trips via cloneTiming
    // so restoring a removed action brings back its delay config unchanged.
    state.lastRemoved = state.saved
      ? {
          ...state.saved,
          condition: state.saved.condition ? { ...state.saved.condition } : null,
          timing: cloneTiming(state.saved.timing),
        }
      : null;
    state.saved = null;
    closeRemoveModal();
    setTaState('empty');

    // Toast with undo link (5s)
    const body = el('span');
    body.appendChild(document.createTextNode('Thrive Action removed.'));
    const undoBtn = el('button', {
      class: 'toast__undo',
      type: 'button',
      text: 'Undo',
    });
    body.appendChild(undoBtn);
    toast({
      html: body,
      onMount: (node) => {
        undoBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!state.lastRemoved) return;
          state.saved = {
            ...state.lastRemoved,
            condition: state.lastRemoved.condition ? { ...state.lastRemoved.condition } : null,
            timing: cloneTiming(state.lastRemoved.timing),
          };
          state.lastRemoved = null;
          setTaState('configured');
          node._dismiss && node._dismiss();
          toast('Thrive Action restored.', 'success', 2500);
        });
      },
    }, 'info', 5000);

    // After the toast window passes, clear the undo buffer
    setTimeout(() => { state.lastRemoved = null; }, 5200);
  }

  // ─── Test drawer ────────────────────────────────────────
  function openTestDrawer() {
    if (!state.saved) return;
    $('#drawerResult').hidden = true;
    $('#drawerResult').innerHTML = '';
    state.testResult = null;
    $('#testDrawer').hidden = false;
    setTimeout(() => $('#testEmail')?.focus(), 50);
    maybeGuideNext('open-test');
  }
  function closeTestDrawer() {
    $('#testDrawer').hidden = true;
  }

  function runTest() {
    if (!state.saved) return;
    const email     = $('#testEmail').value.trim();
    const firstName = $('#testFirstName').value.trim();
    const goal      = $('#testGoal').value;
    const sample = { email, first_name: firstName, goal };

    // Evaluate condition if present
    let conditionMet = true;
    let conditionReason = '';
    if (state.saved.condition) {
      const { field, op, value } = state.saved.condition;
      const actual = sample[field] ?? '';
      const fieldLabel = FORM_FIELDS.find(f => f.key === field)?.label || field;
      if (op === 'equals')       conditionMet = actual === value;
      if (op === 'not_equals')   conditionMet = actual !== value;
      if (op === 'contains')     conditionMet = actual.toLowerCase().includes(value.toLowerCase());
      if (!conditionMet) {
        const opLabel = { equals: 'equals', not_equals: 'does not equal', contains: 'contains' }[op];
        conditionReason = `Your test data has <strong>${fieldLabel}</strong> = "${actual || '(empty)'}", but the condition requires it ${opLabel} "${value}".`;
      }
    }

    // Basic input validation
    if (!email) {
      showResult('error', 'Missing email', 'The form requires an email address — please fill it in to run the test.');
      return;
    }

    const action = ACTIONS.find(a => a.key === state.saved.actionKey);

    if (!conditionMet) {
      showResult(
        'info',
        "Condition didn't match — action would not have fired",
        conditionReason + ' <br><br>Change the sample data above and re-run to test the "fires" path.'
      );
      toast('Test complete — condition not met', 'info', 2500);
      return;
    }

    // Success — compose a plain-English description of what would happen.
    // P2.5 — prepend a muted "(simulated — nothing actually changed)" caption.
    const simulatedCaption = '<span class="result-banner__simulated">(simulated — nothing actually changed)</span>';
    const body = buildSuccessBannerBody(action, email);
    showResult(
      'success',
      'Test passed — action would fire',
      simulatedCaption + body
    );
    // P2.4 — keep the banner (richer context); do not fire a redundant toast
    // on success. Failure + condition-skip cases still toast (see above).
  }

  // Per-action success-banner copy. `email` is wrapped in <code> for scannability.
  // Keep this function pure — no DOM writes — so the same strings could be
  // reused in submission-log previews or analytics samples later.
  //
  // When the saved action has a delay the copy shifts from the active voice
  // ("Would grant …") to a scheduling voice ("Would schedule … in 2 days")
  // for Ultimatum and Ovation, because those are long-lived effects that
  // benefit from the "schedule" framing. Apprentice and Quiz Tag stay in
  // "Would grant … in 2 days" form because the effect is atomic.
  function buildSuccessBannerBody(action, email) {
    const s = state.saved;
    const e = `<code>${email}</code>`;
    const delayed = s.timing && s.timing.mode === 'delay';
    const inPhrase = delayed ? ` <strong>in ${formatDelayPhrase(s.timing)}</strong>` : '';

    if (action.key === 'apprentice_access') {
      const p = PRODUCTS.find(p => p.id === s.product);
      const label = p ? p.label : '(no product)';
      if (s.subOperation === 'revoke') {
        return `Would revoke ${e}'s access to <strong>${label}</strong>${inPhrase}. Their progress would be preserved.`;
      }
      return `Would grant ${e} access to <strong>${label}</strong>${inPhrase}.`;
    }
    if (action.key === 'ultimatum_campaign') {
      const c = CAMPAIGNS.find(c => c.id === s.campaign);
      const label = c ? c.label : '(no campaign)';
      if (delayed) {
        // "Schedule … to start/stop for X in 2 days" — cleaner than mixing the
        // delay into a sentence that already has "begins on next page visit".
        const verb = s.subOperation === 'stop' ? 'stop' : 'start';
        return `Would schedule <strong>${label}</strong> to ${verb} for ${e}${inPhrase}.`;
      }
      if (s.subOperation === 'stop') {
        return `Would stop <strong>${label}</strong> for ${e}. They'd stop seeing the countdown and any ESP deadline sync would clear.`;
      }
      return `Would start <strong>${label}</strong> for ${e}. Their countdown begins on their next page visit.`;
    }
    if (action.key === 'optimize_conversion') {
      // Optimize never has a delay — conversion events are always immediate.
      let line = `Would record a conversion for ${e} in any active A/B test on this page.`;
      const parts = [];
      if (s.goalName)  parts.push(`Goal: ${s.goalName}`);
      if (s.goalValue) parts.push(`Value: $${s.goalValue}`);
      if (parts.length) line += `<br><span class="result-banner__secondary">${parts.join(' · ')}</span>`;
      return line;
    }
    if (action.key === 'ovation_request') {
      const t = TEMPLATES.find(t => t.id === s.template);
      const label = t ? t.label : '(no template)';
      if (delayed) {
        return `Would schedule the "<strong>${label}</strong>" testimonial email to be sent to ${e}${inPhrase}.`;
      }
      return `Would send the "<strong>${label}</strong>" testimonial email to ${e}.`;
    }
    if (action.key === 'tag_quiz_result') {
      const tg = QUIZ_TAGS.find(t => t.id === s.tag);
      const label = tg ? tg.label : '(no tag)';
      return `Would apply tag <code>${label}</code> to ${e} in the connected ESP${inPhrase}. (Uses your Quiz Builder tagged-answer settings.)`;
    }
    return `The <strong>${action.name}</strong> action would run with the sample data above.`;
  }

  function showResult(kind, title, bodyHtml) {
    state.testResult = kind;
    const resultEl = $('#drawerResult');
    const iconChar = { success: '✓', info: 'ⓘ', error: '✗' }[kind] || 'ⓘ';
    resultEl.innerHTML = `
      <div class="result-banner result-banner--${kind}">
        <span class="result-banner__icon">${iconChar}</span>
        <div class="result-banner__body">
          <h5 class="result-banner__title">${title}</h5>
          <p class="result-banner__text">${bodyHtml}</p>
        </div>
      </div>
    `;
    resultEl.hidden = false;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  // ─── Guide / coach marks ────────────────────────────────
  function showGuide(step) {
    if (step >= GUIDE_STEPS.length) return hideGuide(true);
    const g = $('#guide');
    const s = GUIDE_STEPS[step];
    $('#guideTitle').textContent = `${s.title} · Step ${step + 1} of ${GUIDE_STEPS.length}`;
    // Guide text may contain safe HTML (e.g. <strong>)
    $('#guideText').innerHTML  = s.text;
    $('#guideNextBtn').textContent = step === GUIDE_STEPS.length - 1 ? 'Finish' : 'Got it';
    g.hidden = false;
    state.guide = { step, active: true };
    renderGuideProgress(step);
    updateSpotlight(s.target);
  }
  function hideGuide(markSeen = false) {
    $('#guide').hidden = true;
    state.guide.active = false;
    hideSpotlight();
    if (markSeen) {
      try { localStorage.setItem(GUIDE_SEEN_KEY, '1'); } catch (_) { /* ignore */ }
    }
  }
  function advanceGuide() {
    const next = state.guide.step + 1;
    if (next >= GUIDE_STEPS.length) hideGuide(true);
    else showGuide(next);
  }
  function skipGuide() {
    hideGuide(true);
  }
  function maybeGuideNext(trigger) {
    if (!state.guide.active) return;
    // Auto-advance at meaningful moments
    if (trigger === 'open-thrive' && state.guide.step === 0) advanceGuide();
    if (trigger === 'add-action'  && state.guide.step === 1) advanceGuide();
    if (trigger === 'pick-action' && state.guide.step === 2) advanceGuide();
    if (trigger === 'save-action' && state.guide.step === 3) advanceGuide();
    if (trigger === 'open-test'   && state.guide.step === 4) advanceGuide();
  }

  // 5-dot progress indicator in the guide card (P1.3)
  function renderGuideProgress(step) {
    const dots = $$('#guideProgress .guide__dot');
    dots.forEach((dot, i) => {
      dot.classList.remove('guide__dot--current', 'guide__dot--done');
      if (i < step) dot.classList.add('guide__dot--done');
      else if (i === step) dot.classList.add('guide__dot--current');
    });
  }

  // Spotlight overlay — darkens the page except for the current target.
  // If the step has no target (Welcome, Finish), renders a plain dim backdrop.
  // See P1.3 in the audit.
  function updateSpotlight(targetSelector) {
    const spotlight = $('#spotlight');
    const hole = $('#spotlightHole');
    if (!spotlight || !hole) return;

    if (!targetSelector) {
      // Welcome / non-targeted steps — dim backdrop only (no hole).
      spotlight.hidden = false;
      spotlight.classList.add('spotlight--backdrop-only');
      spotlight.classList.remove('spotlight--active');
      return;
    }

    const target = document.querySelector(targetSelector);
    if (!target || target.offsetParent === null) {
      // Target not in the DOM / not visible yet — fall back to backdrop only.
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

  // ─── Reset ──────────────────────────────────────────────
  function resetAll() {
    state.draft = null;
    state.saved = null;
    state.lastRemoved = null;
    state.testResult = null;
    state.searchQuery = '';
    closeTestDrawer();
    closeRemoveModal();
    closePluginInfoModal();
    // P1.3 — clear the "guide seen" flag so the demo always runs fresh.
    // P2.2 — same for the crosslink-banner dismissed flag.
    try {
      localStorage.removeItem(GUIDE_SEEN_KEY);
      localStorage.removeItem(CROSSLINK_DISMISSED_KEY);
    } catch (_) { /* ignore */ }
    applyCrosslinkBannerState();
    setTab('thrive');
    setTaState('empty');
    toast('Prototype reset. Starting fresh.', 'info');
    setTimeout(() => showGuide(0), 400);
  }

  // ─── Event wiring ───────────────────────────────────────
  function wireEvents() {

    // Tab clicks (panel tabs)
    $$('.tab').forEach(t => t.addEventListener('click', () => {
      setTab(t.dataset.tab);
      if (t.dataset.tab === 'thrive') maybeGuideNext('open-thrive');
    }));

    // Delegated [data-action] clicks
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;

      switch (action) {
        // Cross-tab shortcut links
        case 'jump-thrive':          setTab('thrive'); maybeGuideNext('open-thrive'); break;

        // Empty → Picking
        case 'add-action':           goToPicking(); maybeGuideNext('add-action'); break;

        // Picking
        case 'cancel-picking':
          state.draft = null;
          setTaState(state.saved ? 'configured' : 'empty');
          break;

        // Sub-op selector (merged actions)
        case 'back-to-picker':       backToPicker(); break;

        // Configuring
        case 'change-action':        changeAction(); break;
        case 'add-condition':        addCondition(); break;
        case 'remove-condition':     removeCondition(); break;
        case 'add-delay':            addDelay(); break;
        case 'remove-delay':         removeDelay(); break;
        case 'save-action':          saveAction(); break;
        case 'cancel-configuring':   cancelConfiguring(); break;

        // Configured (summary)
        case 'test-action':          openTestDrawer(); break;
        case 'edit-action':          editAction(); break;
        case 'remove-action-confirm': removeActionConfirm(); break;
        case 'add-another-info':
          toast('v1.1 will let you stack multiple Thrive Actions on one form.', 'info', 3500);
          break;

        // Remove modal
        case 'close-modal':          closeRemoveModal(); break;
        case 'confirm-remove':       confirmRemove(); break;

        // Plugin-info modal (P1.2) — shared across locked plugins
        case 'close-plugin-info-modal': closePluginInfoModal(); break;

        // Legacy-tab crosslink banner (P2.2)
        case 'dismiss-crosslink':    dismissCrosslinkBanner(); break;

        // Test drawer
        case 'run-test':             runTest(); break;
        case 'close-drawer':         closeTestDrawer(); break;

        // Guide
        case 'guide-next':           advanceGuide(); break;
        case 'guide-skip':           skipGuide(); break;
      }
    });

    // Picker search
    document.addEventListener('input', (e) => {
      if (e.target.id === 'actionSearch') {
        state.searchQuery = e.target.value;
        renderActionList();
      }
      // Condition field/op/value live updates
      if (e.target.id === 'condValue') updateConditionValue();
      // Timing delay value — clamp at the model layer; browsers enforce min=1
      // on step, but typing "0" or a negative still needs a guard.
      if (e.target.id === 'delayValue') syncTimingFromDOM();
    });

    document.addEventListener('change', (e) => {
      if (e.target.id === 'condField') {
        // Field changed → rebuild the value editor (select vs text)
        state.draft.condition.field = e.target.value;
        const field = FORM_FIELDS.find(f => f.key === e.target.value);
        if (field.type === 'select') {
          state.draft.condition.value = field.options[0];
        } else {
          state.draft.condition.value = '';
        }
        renderConditionValue();
      }
      if (e.target.id === 'condOp') {
        state.draft.condition.op = e.target.value;
      }
      if (e.target.id === 'condValue') updateConditionValue();
      // Timing — unit change fires `change`; value change fires `input` (above).
      if (e.target.id === 'delayUnit')  syncTimingFromDOM();
      if (e.target.id === 'delayValue') syncTimingFromDOM();
    });

    // Mock-form submit button — wired to nudge toward the panel
    $('.mock-form__submit')?.addEventListener('click', () => {
      if (state.saved) {
        toast('Submit simulated — the saved Thrive Action would fire. Use "Test this action" to preview.', 'info', 4500);
      } else {
        toast('Submit simulated — no Thrive Action configured yet. Add one on the right →', 'warn', 4500);
      }
    });

    // Reset
    $('#resetBtn').addEventListener('click', resetAll);

    // Escape closes drawer / modal / cancels editing / closes guide
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#removeModal').hidden)              closeRemoveModal();
      else if (!$('#pluginInfoModal').hidden)     closePluginInfoModal();
      else if (!$('#testDrawer').hidden)          closeTestDrawer();
      else if (!$('#guide').hidden)               hideGuide(true);
      else if (state.taState === 'picking_operation') backToPicker();
      else if (state.taState === 'picking') {
        state.draft = null;
        setTaState(state.saved ? 'configured' : 'empty');
      }
    });

    // P2.8 — focus trap for Remove modal. Tab cycles between the two
    // action buttons; Shift+Tab wraps the other way. The backdrop is not
    // focusable, so focus stays inside the dialog.
    $('#removeModal')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      if ($('#removeModal').hidden) return;
      const focusables = $$('#removeModal [data-action="close-modal"], #removeModal [data-action="confirm-remove"]');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Focus trap for the shared plugin-info modal (Thrive Comments etc.).
    // Only one focusable inside, so Tab + Shift-Tab just re-focus it.
    $('#pluginInfoModal')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      if ($('#pluginInfoModal').hidden) return;
      const btn = $('#pluginInfoGotIt');
      if (!btn) return;
      e.preventDefault();
      btn.focus();
    });

    // Reposition spotlight on resize / scroll / tab transitions
    window.addEventListener('resize', repositionSpotlight);
    window.addEventListener('scroll', repositionSpotlight, true);

    // Panel close (X) — just surfaces a toast in this prototype
    $('.panel__close')?.addEventListener('click', () => {
      toast('In the real editor this would close the Connection panel.', 'info');
    });
  }

  // ─── Crosslink banner (P2.2) ────────────────────────────
  function applyCrosslinkBannerState() {
    let dismissed = false;
    try { dismissed = localStorage.getItem(CROSSLINK_DISMISSED_KEY) === '1'; } catch (_) { /* ignore */ }
    $$('[data-crosslink-banner]').forEach(banner => {
      banner.hidden = dismissed;
    });
  }
  function dismissCrosslinkBanner() {
    try { localStorage.setItem(CROSSLINK_DISMISSED_KEY, '1'); } catch (_) { /* ignore */ }
    applyCrosslinkBannerState();
  }

  // ─── Init ───────────────────────────────────────────────
  function init() {
    wireEvents();
    setTab('thrive');         // Default to the new tab for the demo
    setTaState('empty');
    applyCrosslinkBannerState();

    // P1.3 — only auto-launch the guide for first-time users. Reset clears
    // the flag so the demo always runs fresh when explicitly requested.
    let seen = false;
    try { seen = localStorage.getItem(GUIDE_SEEN_KEY) === '1'; } catch (_) { /* ignore */ }
    if (!seen) {
      setTimeout(() => showGuide(0), 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
