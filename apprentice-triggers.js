/* ==========================================================
   Apprentice — Triggers — Interactive Prototype
   Sibling of incoming-webhooks.js + form-thrive-action.js. The
   third in the family. Reuses both siblings' patterns:
     - state machine + `view` switching (incoming-webhooks)
     - picker → sub-op → configure flow (form-thrive-action)
     - timing + condition disclosure blocks (form-thrive-action)
     - test drawer + result banners (form-thrive-action)
     - undo toast on remove (form-thrive-action)
     - per-row 3-dot popover (incoming-webhooks)
     - spotlight tour (both siblings)
   New for this prototype:
     - triggers landing page (three capability cards)
     - completion-scope cascading dropdowns (Course → Module → Lesson)
     - Grant Apprentice Access action with same-product validation
   ========================================================== */

(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────
  const GUIDE_SEEN_KEY = 'apprentice_triggers_guide_seen';

  // ─── Demo data ──────────────────────────────────────────
  const PRODUCTS = [
    { id: 'photo-master',       name: 'Photography Masterclass' },
    { id: 'photo-advanced',     name: 'Advanced Photography' },
    { id: 'portrait',           name: 'Portrait Lighting' },
    { id: 'beginner-photo',     name: 'Beginner Photography' },
    { id: 'intermediate-photo', name: 'Intermediate Photography' },
  ];

  // `dripEnabled: true` marks courses with a drip campaign configured. The
  // Drip Unlock trigger filters its course picker down to this subset.
  const COURSE_STRUCTURE = {
    'beginner-photo': {
      name: 'Beginner Photography',
      dripEnabled: true,
      modules: [
        { id: 'm1', name: 'Camera basics', lessons: [
          { id: 'l1', name: 'Aperture' }, { id: 'l2', name: 'Shutter speed' }, { id: 'l3', name: 'ISO' }
        ]},
        { id: 'm2', name: 'Composition', lessons: [
          { id: 'l4', name: 'Rule of thirds' }, { id: 'l5', name: 'Leading lines' }
        ]},
      ],
    },
    'photo-master': {
      name: 'Photography Masterclass',
      dripEnabled: true,
      modules: [
        { id: 'm1', name: 'Studio setup', lessons: [{ id: 'l1', name: 'Lighting' }, { id: 'l2', name: 'Backdrops' }] },
      ],
    },
  };

  const ESPS = [
    { id: 'activecampaign', label: 'ActiveCampaign' },
    { id: 'mailchimp',      label: 'Mailchimp' },
    { id: 'fluentcrm',      label: 'FluentCRM' },
    { id: 'convertkit',     label: 'ConvertKit' },
  ];
  const ESP_TAGS = {
    activecampaign: ['enrolled-python', 'photo-student', 'beginner-graduate', 'former-student', 'active-member', 'halfway-through-photography', 'lesson-6-unlocked'],
    mailchimp:      ['students', 'completed-beginner', 'inactive'],
    fluentcrm:      ['enrolled', 'graduated', 'lapsed'],
    convertkit:     ['photography-student', 'graduated-beginner'],
  };

  const ULTIMATUM_CAMPAIGNS = [
    'Welcome 7-day',
    'Black Friday Flash Sale',
    'Final Call — Photography',
    'Winback 14-day',
  ];

  // ─── Trigger catalogue ──────────────────────────────────
  const TRIGGERS = {
    granted: {
      id: 'granted',
      name: 'When user receives access',
      description: 'Fires whenever any user gains access to any Apprentice product — regardless of how that access was granted.',
      icon: '🎓',
      lifecycle: 'forward',  // → defaults sub-ops to Add / Start
      hasScope: false,
      hasGrantAction: true,
      hasSourceCondition: true,
    },
    revoked: {
      id: 'revoked',
      name: 'When access is revoked',
      description: 'Fires whenever any user loses access to an Apprentice product — refunds, expired subscriptions, manual revokes, all included.',
      icon: '🔒',
      lifecycle: 'reverse',  // → defaults sub-ops to Remove / Stop
      hasScope: false,
      hasGrantAction: false, // semantically off-brand
      hasSourceCondition: true,
    },
    completion: {
      id: 'completion',
      name: 'When student completes content',
      description: 'Fires when a student completes a course, module, or lesson. The highest-volume Apprentice automation.',
      icon: '🏆',
      lifecycle: 'forward',
      hasScope: true,
      hasGrantAction: true,
      hasSourceCondition: false,
    },
    drip_unlock: {
      id: 'drip_unlock',
      name: 'When drip content unlocks',
      description: 'Fires when a drip-scheduled lesson unlocks for a user.',
      icon: '🔓',
      lifecycle: 'forward',         // → defaults sub-ops to Add / Start
      hasScope: false,              // Drip Unlock is always lesson-scope in v1
      hasGrantAction: true,
      hasSourceCondition: false,    // unlock is system-driven, no "source" concept
    },
  };

  // ─── Action catalogue ───────────────────────────────────
  // Mirrors form-thrive-action's ACTIONS shape but scoped to this feature's
  // four action types. `subOps` collapses paired-lifecycle actions into one
  // picker row; the sub-op is selected on an intermediate screen.
  const ACTIONS = [
    {
      key: 'esp_tag',
      name: 'ESP Tag',
      desc: 'Add or remove a tag for this user in your connected ESP.',
      icon: '📩',
      iconClass: 'esp',
      subOps: [
        { key: 'add',    name: 'Add tag',    icon: '➕', desc: 'Apply a tag to this user in your ESP.' },
        { key: 'remove', name: 'Remove tag', icon: '➖', desc: 'Remove a tag from this user in your ESP.' },
      ],
      configShape: 'esp_tag',
      availableOn: ['granted', 'revoked', 'completion', 'drip_unlock'],
    },
    {
      key: 'webhook',
      name: 'Send Webhook',
      desc: 'POST to a URL with the trigger context — for Zapier, internal CRMs, or Slack.',
      icon: '↗',
      iconClass: 'webhook',
      subOps: null,
      configShape: 'webhook',
      availableOn: ['granted', 'revoked', 'completion', 'drip_unlock'],
    },
    {
      key: 'ultimatum_campaign',
      name: 'Ultimatum Campaign',
      desc: 'Start or stop an Ultimatum scarcity countdown for this user.',
      icon: '⏱',
      iconClass: 'ultimatum',
      subOps: [
        { key: 'start', name: 'Start campaign', icon: '▶', desc: 'Begin a countdown for this user.' },
        { key: 'stop',  name: 'Stop campaign',  icon: '⏹', desc: 'Cancel a running countdown for this user.' },
      ],
      configShape: 'ultimatum_campaign',
      availableOn: ['granted', 'revoked', 'completion', 'drip_unlock'],
    },
    {
      key: 'grant_apprentice_access',
      name: 'Grant Apprentice Access',
      desc: 'Unlock another Apprentice product — the "finish A → unlock B" pattern.',
      icon: '🎓',
      iconClass: 'grant',
      subOps: null,
      configShape: 'grant_apprentice_access',
      availableOn: ['granted', 'completion', 'drip_unlock'],
    },
  ];

  // ─── Tour steps ─────────────────────────────────────────
  const GUIDE_STEPS = [
    {
      title: 'Welcome',
      text: 'This is the new <strong>Triggers</strong> page where you wire native Thrive actions to Apprentice events — access changes, completion, and <strong>drip content unlocks</strong>. Click any trigger card to begin.',
      target: '#triggerCards',
    },
    {
      title: 'Trigger detail',
      text: 'This is the list of automations under one trigger. Each row is a rule. Click <strong>+ Add Automation</strong> to create one.',
      target: '[data-view="trigger-detail"] .auto-list',
    },
    {
      title: 'Pick what to do',
      text: 'Pick what to do — tag in your ESP, send a webhook, start an Ultimatum campaign, or grant another course.',
      target: '#stepAction',
    },
    {
      title: 'Optional Timing & Condition',
      text: 'Want it to fire later or only sometimes? Add a delay or a condition with the small links below the action.',
      target: '#timingWrap',
    },
    {
      title: 'Save & test',
      text: 'Click <strong>Save &amp; Activate</strong> to make it live, then use <strong>Test this automation</strong> on the row to simulate it without firing real actions.',
      target: '[data-action="save-automation"]',
    },
  ];

  // ─── State ──────────────────────────────────────────────
  // view machine: 'triggers-landing' | 'trigger-detail' | 'automation-edit'
  // stage machine (within automation-edit): 'picker' | 'subop' | 'configure'
  const state = {
    view: 'triggers-landing',
    stage: 'picker',
    activeTriggerId: null,             // 'granted' | 'revoked' | 'completion' | 'drip_unlock'
    automations: {                     // per-trigger lists, seeded with demo data
      granted: [],
      revoked: [],
      completion: [],
      drip_unlock: [],
    },
    draft: null,                       // current automation being edited
    editingId: null,                   // existing automation id being edited (null on Add)
    lastRemoved: null,                 // shadow copy for undo
    lastRemovedTriggerId: null,
    deleteId: null,                    // id staged for delete confirmation
    popoverFor: null,                  // automation id whose popover is open
    guide: { step: 0, active: false },
  };

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
  const uid = () => Math.random().toString(36).slice(2, 10);
  const escapeAttr = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  // ─── Toasts ─────────────────────────────────────────────
  function toast(message, kind = 'info', duration = 3000) {
    const container = $('#toasts');
    const node = el('div', { class: `toast toast--${kind}`, role: 'status' });
    const iconChar = { success: '✓', error: '✗', info: 'ⓘ', warn: '⚠' }[kind] || 'ⓘ';
    const iconSpan = el('span', { class: 'toast__icon', text: iconChar });
    const msgSpan = el('span', { class: 'toast__msg' });

    let onMount = null;
    if (typeof message === 'string') {
      msgSpan.innerHTML = message;
    } else if (message instanceof Node) {
      msgSpan.appendChild(message);
    } else if (message && typeof message === 'object') {
      if (message.html instanceof Node) msgSpan.appendChild(message.html);
      else if (typeof message.html === 'string') msgSpan.innerHTML = message.html;
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
    node._dismiss = dismiss;
    return node;
  }

  // ─── View switching ─────────────────────────────────────
  function setView(view) {
    state.view = view;
    $$('.view').forEach(v => v.classList.toggle('view--active', v.dataset.view === view));
    const labels = {
      'triggers-landing': 'Triggers',
      'trigger-detail':   currentTrigger()?.name || 'Triggers',
      'automation-edit':  state.editingId ? 'Edit automation' : 'New automation',
    };
    $('#crumbActive').textContent = labels[view] || 'Triggers';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (state.guide.active) requestAnimationFrame(repositionSpotlight);
  }

  function setStage(stage) {
    state.stage = stage;
    $$('.stage').forEach(s => s.hidden = s.dataset.stage !== stage);
    if (stage === 'picker')    renderPickerStage();
    if (stage === 'subop')     renderSubOp();
    if (stage === 'configure') renderConfigure();
    if (state.guide.active) requestAnimationFrame(repositionSpotlight);
  }

  function currentTrigger() { return TRIGGERS[state.activeTriggerId]; }

  // ─── Triggers landing ───────────────────────────────────
  function renderTriggersLanding() {
    const container = $('#triggerCards');
    container.innerHTML = '';
    Object.values(TRIGGERS).forEach(trig => {
      const list = state.automations[trig.id] || [];
      const activeCount = list.filter(a => a.enabled).length;
      const card = el('button', {
        class: 'trigger-card',
        type: 'button',
        'data-trigger-id': trig.id,
      });
      const countLabel = activeCount === 1 ? '1 automation active'
                        : `${activeCount} automations active`;
      card.innerHTML = `
        <span class="trigger-card__icon" aria-hidden="true">${trig.icon}</span>
        <div class="trigger-card__body">
          <h3 class="trigger-card__name">${trig.name}</h3>
          <p class="trigger-card__desc">${trig.description}</p>
          <span class="trigger-card__count ${activeCount === 0 ? 'trigger-card__count--zero' : ''}">
            <span class="trigger-card__count-dot" aria-hidden="true"></span>
            ${countLabel}
          </span>
        </div>
        <span class="trigger-card__chevron" aria-hidden="true">›</span>
      `;
      card.addEventListener('click', () => openTriggerDetail(trig.id));
      container.appendChild(card);
    });
  }

  // ─── Trigger detail (list of automations) ───────────────
  function openTriggerDetail(triggerId) {
    state.activeTriggerId = triggerId;
    renderTriggerDetail();
    setView('trigger-detail');
    maybeGuideNext('open-trigger-detail');
  }

  function renderTriggerDetail() {
    const trig = currentTrigger();
    if (!trig) return;
    $('#detailTitle').textContent = trig.name;
    $('#detailSub').textContent = trig.description;
    $('#detailIcon').textContent = trig.icon;

    const list = state.automations[trig.id] || [];
    const container = $('#autoList');
    container.innerHTML = '';

    if (list.length === 0) {
      container.appendChild(buildEmptyState(trig));
      // Hide the top-right "Add Automation" button when empty state shows
      // its own CTA — keeps a single primary action visible.
      $('#detailAddBtn').hidden = true;
      return;
    }
    $('#detailAddBtn').hidden = false;

    // Group automations by target (product for granted/revoked, course for
    // completion/drip_unlock). Order groups alphabetically by target name;
    // within each group preserve list order (newest-first — matches the
    // `unshift` in saveAutomation).
    const groups = buildGroupedAutomations(list, trig);
    groups.forEach(group => container.appendChild(buildAutoGroup(group, trig)));
  }

  // ─── Grouping by target ─────────────────────────────────
  // The "target" key for grouping. Note: completion + drip_unlock both
  // group by *course* regardless of completion scope — the spec is that
  // a course-level + a lesson-level automation under the same course
  // should land in the same group.
  function getGroupKey(automation) {
    if (automation.triggerId === 'granted' || automation.triggerId === 'revoked') {
      return automation.product || '__none__';
    }
    if (automation.triggerId === 'completion' || automation.triggerId === 'drip_unlock') {
      return automation.course || '__none__';
    }
    return '__none__';
  }
  function getGroupName(automation) {
    if (automation.triggerId === 'granted' || automation.triggerId === 'revoked') {
      return PRODUCTS.find(p => p.id === automation.product)?.name || '(no product)';
    }
    if (automation.triggerId === 'completion' || automation.triggerId === 'drip_unlock') {
      return COURSE_STRUCTURE[automation.course]?.name || '(no course)';
    }
    return '(unknown)';
  }

  function buildGroupedAutomations(list, trig) {
    const map = new Map();
    list.forEach((auto, idx) => {
      const key = getGroupKey(auto);
      if (!map.has(key)) {
        map.set(key, { key, name: getGroupName(auto), items: [], firstIdx: idx });
      }
      map.get(key).items.push(auto);
    });
    // Alphabetical by target name (case-insensitive, locale-aware).
    const groups = [...map.values()];
    groups.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return groups;
  }

  function buildAutoGroup(group, trig) {
    const wrap = el('div', { class: 'auto-group', 'data-group-key': group.key });
    const activeCount = group.items.filter(a => a.enabled).length;
    const disabledCount = group.items.length - activeCount;
    const countText = disabledCount > 0
      ? `${activeCount} active · ${disabledCount} disabled`
      : `${activeCount} active`;
    const countClass = disabledCount > 0 && activeCount === 0
      ? 'auto-group__count auto-group__count-disabled'
      : 'auto-group__count';

    const header = el('div', { class: 'auto-group__header' });
    header.innerHTML = `
      <div class="auto-group__header-text">
        <h3 class="auto-group__name">${escapeAttr(group.name)}</h3>
        <span class="${countClass}">${countText}</span>
      </div>
      <button class="auto-group__add" type="button"
              data-action="add-automation-group"
              data-group-key="${escapeAttr(group.key)}"
              aria-label="Add automation for ${escapeAttr(group.name)}">+ Add</button>
    `;
    wrap.appendChild(header);

    const rows = el('div', { class: 'auto-group__rows' });
    group.items.forEach(automation => rows.appendChild(buildAutoRow(automation)));
    wrap.appendChild(rows);
    return wrap;
  }

  function buildEmptyState(trig) {
    const wrap = el('div', { class: 'empty-state' });
    wrap.innerHTML = `
      <div class="empty-state__illustration">
        <svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">
          <circle cx="40" cy="40" r="36" fill="#FFE8D6"/>
          <path d="M24 40h16l4-8 4 16 4-8h8" stroke="#E67E22" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="40" cy="40" r="36" fill="none" stroke="#E67E22" stroke-width="2" stroke-dasharray="4 4"/>
        </svg>
      </div>
      <h3 class="empty-state__title">No automations on this trigger yet</h3>
      <p class="empty-state__text">Configure what happens when ${emptyStateContext(trig)}.</p>
      <button class="btn btn--primary btn--large" data-action="add-automation">
        <span class="btn__icon">+</span> Add your first automation
      </button>
    `;
    return wrap;
  }
  function emptyStateContext(trig) {
    if (trig.id === 'granted')     return 'a user receives access — tag them, send a webhook, start a campaign, or unlock another course';
    if (trig.id === 'revoked')     return 'a user loses access — untag them, send a webhook, or stop a campaign';
    if (trig.id === 'completion')  return 'a student completes content — tag them, send a webhook, start an upsell campaign, or grant the next course';
    if (trig.id === 'drip_unlock') return 'a drip-scheduled lesson unlocks — tag the student, start a halfway-through campaign, send a webhook, or grant another product';
    return 'this trigger fires';
  }

  function buildAutoRow(automation) {
    const action = ACTIONS.find(a => a.key === automation.actionKey);
    const row = el('div', {
      class: `auto-row ${automation.enabled ? '' : 'auto-row--disabled'}`,
      'data-id': automation.id,
    });
    const iconClass = action ? `auto-row__icon--${action.iconClass}` : '';
    const icon = action ? action.icon : '⚡';
    row.innerHTML = `
      <div class="auto-row__pill">
        <span class="pill ${automation.enabled ? 'pill--enabled' : 'pill--disabled'}">
          ${automation.enabled ? '● Active' : '○ Disabled'}
        </span>
      </div>
      <span class="auto-row__icon ${iconClass}" aria-hidden="true">${icon}</span>
      <div class="auto-row__body">
        <p class="auto-row__primary">${buildAutomationPrimary(automation)}</p>
        <p class="auto-row__secondary">${buildAutomationSecondary(automation)}</p>
      </div>
      <div class="auto-row__actions">
        <button class="icon-btn" data-action="row-menu" data-id="${automation.id}" aria-label="More options">⋯</button>
      </div>
    `;
    return row;
  }

  // Plain-English primary line — "Add tag enrolled-python in ActiveCampaign".
  function buildAutomationPrimary(a) {
    if (a.actionKey === 'esp_tag') {
      const espLabel = ESPS.find(e => e.id === a.esp)?.label || a.esp || '(no ESP)';
      const tag = a.tag || '(no tag)';
      const verb = a.subOperation === 'remove' ? 'Remove tag' : 'Add tag';
      return `${verb} <code>${tag}</code> in ${espLabel}`;
    }
    if (a.actionKey === 'webhook') {
      const url = a.url || '(no URL)';
      const shortUrl = url.length > 48 ? url.substring(0, 45) + '…' : url;
      return `Send webhook to <code>${shortUrl}</code>`;
    }
    if (a.actionKey === 'ultimatum_campaign') {
      const verb = a.subOperation === 'stop' ? 'Stop' : 'Start';
      return `${verb} ${a.campaign || '(no campaign)'}`;
    }
    if (a.actionKey === 'grant_apprentice_access') {
      const targetName = PRODUCTS.find(p => p.id === a.targetProduct)?.name || '(no product)';
      return `Grant access to ${targetName}`;
    }
    return '(unknown action)';
  }

  // Secondary line — scope + timing context.
  // The trigger detail renders rows inside per-target groups, so we don't
  // repeat the group's target name here — we only show the *distinguishing*
  // scope info (e.g. for Completion: which course/module/lesson within the
  // course-level group; for Drip Unlock: which module/lesson within the
  // course-level group). Granted/Revoked rows omit the scope phrase entirely
  // since the group header already names the product.
  function buildAutomationSecondary(a) {
    let scopeText = '';
    if (a.triggerId === 'granted' || a.triggerId === 'revoked') {
      // No per-row scope text — group header carries the product name.
      scopeText = '';
    } else if (a.triggerId === 'completion') {
      if (a.completionScope === 'lesson') {
        const moduleObj = COURSE_STRUCTURE[a.course]?.modules.find(m => m.id === a.module);
        const lessonName = moduleObj?.lessons.find(l => l.id === a.lesson)?.name || '(lesson)';
        const moduleName = moduleObj?.name || '(module)';
        scopeText = `on completion of ${lessonName} (lesson in ${moduleName} module)`;
      } else if (a.completionScope === 'module') {
        const moduleObj = COURSE_STRUCTURE[a.course]?.modules.find(m => m.id === a.module);
        scopeText = `on completion of ${moduleObj?.name || '(module)'} (module)`;
      } else {
        scopeText = `on completion of the course`;
      }
    } else if (a.triggerId === 'drip_unlock') {
      const moduleObj = a.course && a.module
        ? COURSE_STRUCTURE[a.course]?.modules.find(m => m.id === a.module)
        : null;
      const lessonName = moduleObj?.lessons.find(l => l.id === a.lesson)?.name || '(lesson)';
      const moduleName = moduleObj?.name || '(module)';
      scopeText = `on unlock of Lesson ${lessonName} (in ${moduleName} module)`;
    }

    let timingText = '';
    if (a.timing && a.timing.mode === 'delay') {
      const sep = scopeText ? ' · ' : '';
      timingText = `${sep}${formatDelayPhrase(a.timing)} after`;
    }

    let condText = '';
    if (a.condition) {
      const fieldLabel = condFieldLabel(a.condition.field);
      const opLabel = condOpLabel(a.condition.op);
      const sep = (scopeText || timingText) ? ' · ' : '';
      condText = `${sep}only if ${fieldLabel} ${opLabel} "${a.condition.value || ''}"`;
    }

    return scopeText + timingText + condText;
  }

  function condFieldLabel(key) {
    return key === 'user_role' ? 'User role'
         : key === 'source'    ? 'Source'
         : key;
  }
  function condOpLabel(op) {
    return op === 'equals' ? 'equals'
         : op === 'not_equals' ? 'does not equal'
         : op === 'contains' ? 'contains'
         : op;
  }
  function formatDelayPhrase(timing) {
    if (!timing || timing.mode !== 'delay') return '';
    const n = timing.delayValue;
    const singular = (timing.delayUnit || 'days').replace(/s$/, '');
    const unit = n === 1 ? singular : singular + 's';
    return `${n} ${unit}`;
  }

  // ─── Automation edit flow ───────────────────────────────
  function startAddAutomation() {
    const trig = currentTrigger();
    if (!trig) return;
    state.editingId = null;
    state.draft = makeEmptyDraft(trig.id);
    enterEditView();
    maybeGuideNext('add-automation');
  }

  // Per-group "+ Add" — pre-fills target so the user lands on the action
  // picker without having to re-pick the product/course they're already
  // working in. The target step still renders (so they can change it) but
  // is pre-filled and the action picker is immediately usable. For Drip
  // Unlock and module/lesson Completion the user still has to pick the
  // sub-target levels — group key is course-level only.
  function startAddAutomationForGroup(groupKey) {
    const trig = currentTrigger();
    if (!trig) return;
    state.editingId = null;
    const draft = makeEmptyDraft(trig.id);
    if (trig.id === 'granted' || trig.id === 'revoked') {
      draft.product = groupKey;
    } else if (trig.id === 'completion') {
      draft.course = groupKey;
      // Default to course scope so picker is immediately satisfiable —
      // user can change scope (module/lesson) and then pick those.
      draft.completionScope = 'course';
    } else if (trig.id === 'drip_unlock') {
      draft.course = groupKey;
      // module + lesson still need to be picked (drip is always lesson-scope).
    }
    state.draft = draft;
    enterEditView();
    maybeGuideNext('add-automation');
  }
  function startEditAutomation(automationId) {
    const list = state.automations[state.activeTriggerId] || [];
    const auto = list.find(a => a.id === automationId);
    if (!auto) return;
    state.editingId = automationId;
    state.draft = JSON.parse(JSON.stringify(auto));
    enterEditView();
  }
  function enterEditView() {
    const trig = currentTrigger();
    $('#backLinkTriggerName').textContent = trig.name;
    $('#editTitle').textContent = state.editingId ? 'Edit automation' : 'New automation';
    $('#editSub').textContent  = state.editingId
      ? 'Tweak this automation. Save & Activate when you\'re done.'
      : 'Configure what happens when this trigger fires.';
    setView('automation-edit');

    // If editing an existing automation we jump to configure (they've already
    // picked an action). On Add we land on the picker stage.
    if (state.editingId && state.draft.actionKey) {
      setStage('configure');
    } else {
      setStage('picker');
    }
  }

  function makeEmptyDraft(triggerId) {
    return {
      id: uid(),
      triggerId,
      enabled: true,
      // Step A — Completion only
      completionScope: 'course',
      // Step B — target
      product: '',          // for granted/revoked
      course: '',           // for completion
      module: '',           // for completion (module / lesson scope)
      lesson: '',           // for completion (lesson scope)
      // Step C — action
      actionKey: '',
      subOperation: null,
      // Step D — config
      esp: '',
      tag: '',
      url: '',
      campaign: '',
      targetProduct: '',
      // Optional
      timing: { mode: 'immediate' },
      condition: null,
    };
  }

  // ─── Picker stage ───────────────────────────────────────
  function renderPickerStage() {
    const trig = currentTrigger();
    if (!trig) return;

    // Step A — show only on Completion
    const stepScope = $('#stepScope');
    if (trig.hasScope) {
      stepScope.hidden = false;
      // Reflect current scope
      $$('input[name="completionScope"]').forEach(r => {
        r.checked = r.value === state.draft.completionScope;
      });
      // Renumber: Step 1 = Scope, Step 2 = Target, Step 3 = Action
      stepScope.querySelector('.step__num').textContent = '1';
      $('#stepTargetNum').textContent = '2';
      $('#stepActionNum').textContent = '3';
    } else {
      stepScope.hidden = true;
      $('#stepTargetNum').textContent = '1';
      $('#stepActionNum').textContent = '2';
    }

    // Step B — render target dropdowns
    renderTargetFields();

    // Step C — render action picker
    renderActionList();
  }

  function renderTargetFields() {
    const container = $('#targetFields');
    container.innerHTML = '';
    const trig = currentTrigger();

    // Granted / Revoked: single "For product" dropdown
    if (trig.id === 'granted' || trig.id === 'revoked') {
      $('#stepTargetTitle').textContent = 'For product';
      $('#stepTargetSub').textContent = `Which Apprentice product should this automation watch for ${trig.id === 'granted' ? 'access events' : 'revoke events'}?`;
      const field = el('div', { class: 'target-field' });
      field.innerHTML = `
        <div class="select-wrap">
          <select class="input input--select" id="productSelect">
            <option value="">— Select a product —</option>
            ${PRODUCTS.map(p => `<option value="${p.id}" ${state.draft.product === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
          </select>
        </div>
      `;
      container.appendChild(field);
      $('#productSelect').addEventListener('change', e => {
        state.draft.product = e.target.value;
        // Re-evaluate the action picker — stacking limits are scope-scoped.
        renderActionList();
      });
      return;
    }

    // Drip Unlock — always lesson scope (no toggle in v1). Course picker
    // is filtered to drip-enabled courses only.
    if (trig.id === 'drip_unlock') {
      $('#stepTargetTitle').textContent = 'For lesson';
      $('#stepTargetSub').textContent = 'Pick the course (drip-enabled only), then the module, then the specific lesson — fires when this exact lesson unlocks for a user.';

      const dripCourseIds = Object.keys(COURSE_STRUCTURE).filter(cid => COURSE_STRUCTURE[cid].dripEnabled);

      // Edge case — no drip-enabled courses configured. Inline empty-state.
      if (dripCourseIds.length === 0) {
        const empty = el('div', { class: 'target-empty-state' });
        empty.innerHTML = `
          <p class="target-empty-state__text">You don't have any drip campaigns configured yet. Set up Drip in Apprentice → Course → Drip first, then come back here.</p>
        `;
        container.appendChild(empty);
        return;
      }

      // Course dropdown — drip-enabled only
      const courseField = el('div', { class: 'target-field' });
      courseField.innerHTML = `
        <label class="field-label">Course</label>
        <div class="select-wrap">
          <select class="input input--select" id="courseSelect">
            <option value="">— Select a drip-enabled course —</option>
            ${dripCourseIds.map(cid => `<option value="${cid}" ${state.draft.course === cid ? 'selected' : ''}>${COURSE_STRUCTURE[cid].name}</option>`).join('')}
          </select>
        </div>
        <p class="configure__hint">Only courses that have a drip campaign configured appear here.</p>
      `;
      container.appendChild(courseField);

      // Module dropdown
      const modules = state.draft.course ? (COURSE_STRUCTURE[state.draft.course]?.modules || []) : [];
      const modField = el('div', { class: `target-field ${!state.draft.course ? 'target-field--disabled' : ''}` });
      modField.innerHTML = `
        <label class="field-label">Module</label>
        <div class="select-wrap">
          <select class="input input--select" id="moduleSelect" ${!state.draft.course ? 'disabled' : ''}>
            <option value="">${state.draft.course ? '— Select a module —' : '— Pick a course first —'}</option>
            ${modules.map(m => `<option value="${m.id}" ${state.draft.module === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}
          </select>
        </div>
      `;
      container.appendChild(modField);

      // Lesson dropdown
      const moduleObj = state.draft.course && state.draft.module
        ? COURSE_STRUCTURE[state.draft.course]?.modules.find(m => m.id === state.draft.module)
        : null;
      const lessons = moduleObj?.lessons || [];
      const lessField = el('div', { class: `target-field ${!state.draft.module ? 'target-field--disabled' : ''}` });
      lessField.innerHTML = `
        <label class="field-label">Lesson</label>
        <div class="select-wrap">
          <select class="input input--select" id="lessonSelect" ${!state.draft.module ? 'disabled' : ''}>
            <option value="">${state.draft.module ? '— Select a lesson —' : '— Pick a module first —'}</option>
            ${lessons.map(l => `<option value="${l.id}" ${state.draft.lesson === l.id ? 'selected' : ''}>${l.name}</option>`).join('')}
          </select>
        </div>
      `;
      container.appendChild(lessField);

      // Wire change listeners (cascade-clear). Each level also re-renders
      // the action picker because the scope-target-key changes as the user
      // narrows the cascade and stacking limits are scope-scoped.
      $('#courseSelect')?.addEventListener('change', e => {
        state.draft.course = e.target.value;
        state.draft.module = '';
        state.draft.lesson = '';
        renderTargetFields();
        renderActionList();
      });
      $('#moduleSelect')?.addEventListener('change', e => {
        state.draft.module = e.target.value;
        state.draft.lesson = '';
        renderTargetFields();
        renderActionList();
      });
      $('#lessonSelect')?.addEventListener('change', e => {
        state.draft.lesson = e.target.value;
        renderActionList();
      });
      return;
    }

    // Completion — cascading dropdowns by scope
    const courseIds = Object.keys(COURSE_STRUCTURE);

    $('#stepTargetTitle').textContent = 'For ' + (
      state.draft.completionScope === 'lesson' ? 'lesson' :
      state.draft.completionScope === 'module' ? 'module' :
      'course'
    );
    $('#stepTargetSub').textContent = state.draft.completionScope === 'course'
      ? 'Pick the course whose completion should fire this automation.'
      : state.draft.completionScope === 'module'
        ? 'Pick the course, then the specific module whose completion should fire this automation.'
        : 'Pick the course, module, and lesson — fires only on this exact lesson completion.';

    // Course dropdown — always shown
    const courseField = el('div', { class: 'target-field' });
    courseField.innerHTML = `
      <label class="field-label">Course</label>
      <div class="select-wrap">
        <select class="input input--select" id="courseSelect">
          <option value="">— Select a course —</option>
          ${courseIds.map(cid => `<option value="${cid}" ${state.draft.course === cid ? 'selected' : ''}>${COURSE_STRUCTURE[cid].name}</option>`).join('')}
        </select>
      </div>
    `;
    container.appendChild(courseField);

    // Module dropdown — if scope is module or lesson
    if (state.draft.completionScope === 'module' || state.draft.completionScope === 'lesson') {
      const modules = state.draft.course ? (COURSE_STRUCTURE[state.draft.course]?.modules || []) : [];
      const modField = el('div', { class: `target-field ${!state.draft.course ? 'target-field--disabled' : ''}` });
      modField.innerHTML = `
        <label class="field-label">Module</label>
        <div class="select-wrap">
          <select class="input input--select" id="moduleSelect" ${!state.draft.course ? 'disabled' : ''}>
            <option value="">${state.draft.course ? '— Select a module —' : '— Pick a course first —'}</option>
            ${modules.map(m => `<option value="${m.id}" ${state.draft.module === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}
          </select>
        </div>
      `;
      container.appendChild(modField);
    }

    // Lesson dropdown — if scope is lesson
    if (state.draft.completionScope === 'lesson') {
      const moduleObj = state.draft.course && state.draft.module
        ? COURSE_STRUCTURE[state.draft.course]?.modules.find(m => m.id === state.draft.module)
        : null;
      const lessons = moduleObj?.lessons || [];
      const lessField = el('div', { class: `target-field ${!state.draft.module ? 'target-field--disabled' : ''}` });
      lessField.innerHTML = `
        <label class="field-label">Lesson</label>
        <div class="select-wrap">
          <select class="input input--select" id="lessonSelect" ${!state.draft.module ? 'disabled' : ''}>
            <option value="">${state.draft.module ? '— Select a lesson —' : '— Pick a module first —'}</option>
            ${lessons.map(l => `<option value="${l.id}" ${state.draft.lesson === l.id ? 'selected' : ''}>${l.name}</option>`).join('')}
          </select>
        </div>
      `;
      container.appendChild(lessField);
    }

    // Wire change listeners with cascade-clear behaviour. Each level also
    // re-renders the action picker because the scope-target-key changes as
    // the cascade narrows and stacking limits are scope-scoped.
    $('#courseSelect')?.addEventListener('change', e => {
      state.draft.course = e.target.value;
      // Cascade: clear module + lesson when course changes
      state.draft.module = '';
      state.draft.lesson = '';
      renderTargetFields();
      renderActionList();
    });
    $('#moduleSelect')?.addEventListener('change', e => {
      state.draft.module = e.target.value;
      // Cascade: clear lesson when module changes
      state.draft.lesson = '';
      if (state.draft.completionScope === 'lesson') renderTargetFields();
      renderActionList();
    });
    $('#lessonSelect')?.addEventListener('change', e => {
      state.draft.lesson = e.target.value;
      renderActionList();
    });
  }

  // ─── Stacking rules (per-scope action limits + ESP/Webhook mutex) ──
  // The picker enforces "one of each compatible action type" per
  // (trigger, scope-target-key), with ESP Tag and Send Webhook in a mutex
  // group. See spec for the full table. Helpers below are also re-used by
  // saveAutomation as a defense-in-depth backstop.

  // Stable, human-readable scope-target-key for the current draft.
  // Returns null if the draft hasn't picked enough info yet — callers treat
  // null as "no scope yet, can't constrain".
  function getScopeKey(draft) {
    if (!draft) return null;
    const trig = TRIGGERS[draft.triggerId];
    if (!trig) return null;
    if (trig.id === 'granted' || trig.id === 'revoked') {
      return draft.product || null;
    }
    if (trig.id === 'completion') {
      if (!draft.course) return null;
      if (draft.completionScope === 'course')  return 'course:' + draft.course;
      if (draft.completionScope === 'module')  return draft.module ? 'module:' + draft.course + '/' + draft.module : null;
      if (draft.completionScope === 'lesson')  {
        return (draft.module && draft.lesson)
          ? 'lesson:' + draft.course + '/' + draft.module + '/' + draft.lesson
          : null;
      }
      return null;
    }
    if (trig.id === 'drip_unlock') {
      if (!draft.course || !draft.module || !draft.lesson) return null;
      return 'lesson:' + draft.course + '/' + draft.module + '/' + draft.lesson;
    }
    return null;
  }

  // Action-type ids already configured under (triggerId, scopeKey), excluding
  // the optional excludeAutomationId (used during edit so the type currently
  // being edited doesn't lock itself out).
  function getUsedActionTypes(triggerId, scopeKey, excludeAutomationId) {
    if (!scopeKey) return [];
    const list = state.automations[triggerId] || [];
    const used = [];
    list.forEach(auto => {
      if (excludeAutomationId && auto.id === excludeAutomationId) return;
      const autoScope = getScopeKey(auto);
      if (autoScope !== scopeKey) return;
      if (auto.actionKey && !used.includes(auto.actionKey)) used.push(auto.actionKey);
    });
    return used;
  }

  // Filter ACTIONS for the picker: respect availableOn + the per-scope
  // stacking rules + the ESP-Tag/Webhook mutex.
  function getAvailableActionTypes(triggerId, scopeKey, excludeAutomationId) {
    const candidates = ACTIONS.filter(a => a.availableOn.includes(triggerId));
    // No scope yet → we can't constrain. Show everything (target-not-picked
    // case is handled separately by validation; this just keeps the picker
    // usable while the user is still filling in target dropdowns).
    if (!scopeKey) return candidates;
    const used = getUsedActionTypes(triggerId, scopeKey, excludeAutomationId);
    return candidates.filter(a => {
      if (used.includes(a.key)) return false;
      // Mutex: ESP Tag ↔ Send Webhook
      if (a.key === 'esp_tag'  && used.includes('webhook'))  return false;
      if (a.key === 'webhook'  && used.includes('esp_tag'))  return false;
      return true;
    });
  }

  // Human-readable label for the current scope target — used in the picker
  // empty state and save-time backstop toasts.
  function getScopeTargetDisplay(draft) {
    if (!draft) return 'this target';
    const trig = TRIGGERS[draft.triggerId];
    if (!trig) return 'this target';
    if (trig.id === 'granted' || trig.id === 'revoked') {
      return PRODUCTS.find(p => p.id === draft.product)?.name || 'this product';
    }
    if (trig.id === 'completion') {
      const courseName = COURSE_STRUCTURE[draft.course]?.name || 'this course';
      if (draft.completionScope === 'lesson') {
        const m = COURSE_STRUCTURE[draft.course]?.modules.find(x => x.id === draft.module);
        const l = m?.lessons.find(x => x.id === draft.lesson);
        return `${l?.name || 'this lesson'} (lesson in ${m?.name || 'module'})`;
      }
      if (draft.completionScope === 'module') {
        const m = COURSE_STRUCTURE[draft.course]?.modules.find(x => x.id === draft.module);
        return `${m?.name || 'this module'} (module of ${courseName})`;
      }
      return `${courseName} (course)`;
    }
    if (trig.id === 'drip_unlock') {
      const courseName = COURSE_STRUCTURE[draft.course]?.name || 'this course';
      const m = COURSE_STRUCTURE[draft.course]?.modules.find(x => x.id === draft.module);
      const l = m?.lessons.find(x => x.id === draft.lesson);
      return `${l?.name || 'this lesson'} (lesson in ${m?.name || 'module'} of ${courseName})`;
    }
    return 'this target';
  }

  // Friendly label for an action type id — used in backstop toasts.
  function getActionTypeName(actionKey) {
    return ACTIONS.find(a => a.key === actionKey)?.name || actionKey;
  }

  function renderActionList() {
    const trig = currentTrigger();
    const list = $('#actionList');
    list.innerHTML = '';

    const scopeKey = getScopeKey(state.draft);
    const candidatesAll = ACTIONS.filter(a => a.availableOn.includes(trig.id));
    const available = getAvailableActionTypes(trig.id, scopeKey, state.editingId);
    const filteredCount = candidatesAll.length - available.length;

    // All slots used for this scope → empty-state with a back-to-target link.
    // Only show when we actually have a scope (no scope ⇒ we couldn't filter,
    // so treat it as "still picking target").
    if (scopeKey && available.length === 0) {
      const targetDisplay = getScopeTargetDisplay(state.draft);
      const empty = el('div', { class: 'picker__empty' });
      empty.innerHTML = `
        <p class="picker__empty-text">All compatible actions are already configured for ${escapeAttr(targetDisplay)}. Edit an existing automation or pick a different target.</p>
        <div class="picker__empty-actions">
          <button class="text-link text-link--muted" type="button" data-action="cancel-automation">Cancel</button>
          <button class="text-link" type="button" data-action="edit-trigger-context">← Pick a different target</button>
        </div>
      `;
      list.appendChild(empty);
      return;
    }

    // Some — but not all — actions filtered out → muted caption above rows.
    if (scopeKey && filteredCount > 0) {
      const targetDisplay = getScopeTargetDisplay(state.draft);
      const note = el('p', { class: 'picker__filter-note' });
      note.textContent = `Some actions are hidden because they're already configured for ${targetDisplay}.`;
      list.appendChild(note);
    }

    available.forEach(action => {
      const btn = el('button', {
        class: 'action-opt',
        type: 'button',
        'data-action-key': action.key,
      });
      btn.innerHTML = `
        <span class="action-opt__icon action-opt__icon--${action.iconClass}">${action.icon}</span>
        <div class="action-opt__body">
          <div class="action-opt__name">${action.name}</div>
          <div class="action-opt__desc">${action.desc}</div>
        </div>
        <span class="action-opt__chevron" aria-hidden="true">›</span>
      `;
      btn.addEventListener('click', () => pickAction(action.key));
      list.appendChild(btn);
    });
  }

  // ─── Picker → sub-op / configure ────────────────────────
  function pickAction(actionKey) {
    const action = ACTIONS.find(a => a.key === actionKey);
    if (!action) return;
    state.draft.actionKey = actionKey;
    if (action.subOps && action.subOps.length) {
      // Default sub-op based on trigger lifecycle
      const trig = currentTrigger();
      const defaultSubOp = pickDefaultSubOp(action, trig);
      state.draft.subOperation = defaultSubOp;
      setStage('subop');
    } else {
      state.draft.subOperation = null;
      setStage('configure');
    }
    maybeGuideNext('pick-action');
  }

  function pickDefaultSubOp(action, trig) {
    if (!action.subOps) return null;
    // Forward lifecycle (granted, completion) → first sub-op (Add / Start)
    // Reverse lifecycle (revoked) → second sub-op (Remove / Stop)
    return trig.lifecycle === 'reverse' ? action.subOps[1].key : action.subOps[0].key;
  }

  function renderSubOp() {
    const action = ACTIONS.find(a => a.key === state.draft.actionKey);
    if (!action || !action.subOps) {
      setStage('picker');
      return;
    }
    const headerIcon = $('#subopHeaderIcon');
    headerIcon.textContent = action.icon;
    headerIcon.className = `subop__header-icon subop__header-icon--${action.iconClass}`;
    $('#subopHeaderName').textContent = action.name;
    $('#subopHeaderSub').textContent = subOpPrompt(action);

    const list = $('#subopList');
    list.innerHTML = '';
    action.subOps.forEach(op => {
      const btn = el('button', {
        class: `subop-card subop-card--${action.iconClass}`,
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
    setTimeout(() => list.querySelector('.subop-card')?.focus(), 30);
  }
  function subOpPrompt(action) {
    if (action.key === 'esp_tag')            return "What should happen with this user's tag?";
    if (action.key === 'ultimatum_campaign') return 'What should happen with this campaign?';
    return 'What should happen?';
  }
  function pickSubOp(subOpKey) {
    state.draft.subOperation = subOpKey;
    setStage('configure');
  }

  // ─── Configure stage ────────────────────────────────────
  function renderConfigure() {
    const action = ACTIONS.find(a => a.key === state.draft.actionKey);
    if (!action) { setStage('picker'); return; }

    // Trigger context summary line
    $('#triggerContextText').innerHTML = buildTriggerContextLine();

    // Action pill — for paired actions, prefix the sub-op verb
    const subOp = currentSubOp(action);
    $('#pillIcon').textContent = subOp ? subOp.icon : action.icon;
    $('#pillIcon').className = `action-pill__icon action-pill__icon--${action.iconClass}`;
    $('#pillName').textContent = subOp
      ? `${capitalize(subOp.name)} — ${action.name}`
      : action.name;
    $('#pillDesc').textContent = subOp ? subOp.desc : action.desc;

    // Per-action config target
    const section = $('#configSection');
    section.innerHTML = '';
    renderConfigFields(section, action);

    // Timing — reflect current state. Update suffix per trigger.
    $('#timingSuffix').textContent = timingSuffix();
    if (state.draft.timing?.mode === 'delay') {
      $('#timingCollapsed').hidden = true;
      $('#timingExpanded').hidden = false;
      $('#delayValue').value = state.draft.timing.delayValue ?? 2;
      $('#delayUnit').value  = state.draft.timing.delayUnit  ?? 'days';
    } else {
      $('#timingCollapsed').hidden = false;
      $('#timingExpanded').hidden = true;
    }

    // Condition — populate field options per trigger, then render
    populateConditionFields();
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
  }

  function buildTriggerContextLine() {
    const trig = currentTrigger();
    if (trig.id === 'granted') {
      const pname = state.draft.product
        ? PRODUCTS.find(p => p.id === state.draft.product)?.name
        : '<em>(no product picked)</em>';
      return `On <strong>access granted</strong> for <strong>${pname}</strong>`;
    }
    if (trig.id === 'revoked') {
      const pname = state.draft.product
        ? PRODUCTS.find(p => p.id === state.draft.product)?.name
        : '<em>(no product picked)</em>';
      return `On <strong>access revoked</strong> for <strong>${pname}</strong>`;
    }
    if (trig.id === 'completion') {
      const courseName = state.draft.course
        ? COURSE_STRUCTURE[state.draft.course]?.name
        : '<em>(no course)</em>';
      if (state.draft.completionScope === 'lesson') {
        const moduleObj = COURSE_STRUCTURE[state.draft.course]?.modules.find(m => m.id === state.draft.module);
        const lessonName = moduleObj?.lessons.find(l => l.id === state.draft.lesson)?.name || '<em>(lesson)</em>';
        return `On <strong>completion</strong> of <strong>${lessonName}</strong> (lesson in ${courseName})`;
      }
      if (state.draft.completionScope === 'module') {
        const moduleObj = COURSE_STRUCTURE[state.draft.course]?.modules.find(m => m.id === state.draft.module);
        return `On <strong>completion</strong> of <strong>${moduleObj?.name || '(module)'}</strong> (module in ${courseName})`;
      }
      return `On <strong>completion</strong> of <strong>${courseName}</strong> (course)`;
    }
    if (trig.id === 'drip_unlock') {
      const courseName = state.draft.course
        ? COURSE_STRUCTURE[state.draft.course]?.name
        : '<em>(no course)</em>';
      const moduleObj = state.draft.course && state.draft.module
        ? COURSE_STRUCTURE[state.draft.course]?.modules.find(m => m.id === state.draft.module)
        : null;
      const moduleName = moduleObj?.name || '<em>(module)</em>';
      const lessonName = moduleObj?.lessons.find(l => l.id === state.draft.lesson)?.name || '<em>(lesson)</em>';
      return `On <strong>drip unlock</strong> of <strong>${lessonName}</strong> (in ${moduleName} module of ${courseName})`;
    }
    return '';
  }

  function timingSuffix() {
    const trig = currentTrigger();
    if (trig.id === 'granted')     return 'after access is granted';
    if (trig.id === 'revoked')     return 'after access is revoked';
    if (trig.id === 'completion')  return 'after the student completes';
    if (trig.id === 'drip_unlock') return 'after the lesson unlocks';
    return 'after the trigger fires';
  }

  function currentSubOp(action) {
    if (!action || !action.subOps || !state.draft.subOperation) return null;
    return action.subOps.find(o => o.key === state.draft.subOperation) || null;
  }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  // ─── Per-action config field renderers ──────────────────
  function renderConfigFields(section, action) {
    if (action.configShape === 'esp_tag') {
      const verb = state.draft.subOperation === 'remove' ? 'remove' : 'add';
      const espOptions = ESPS.map(e => `<option value="${e.id}" ${state.draft.esp === e.id ? 'selected' : ''}>${e.label}</option>`).join('');
      const tagsForEsp = ESP_TAGS[state.draft.esp] || [];
      const tagOptions = tagsForEsp.map(t => `<option value="${t}" ${state.draft.tag === t ? 'selected' : ''}>${t}</option>`).join('');

      const block = el('div');
      block.innerHTML = `
        <h4 class="configure__section-title">Which tag should we ${verb}, and where?</h4>
        <div class="configure__field">
          <label class="field-label">ESP</label>
          <div class="select-wrap">
            <select class="input input--select" id="espSelect">
              <option value="">— Select an ESP —</option>
              ${espOptions}
            </select>
          </div>
        </div>
        <div class="configure__field">
          <label class="field-label">Tag</label>
          <div class="select-wrap">
            <select class="input input--select" id="tagSelect" ${!state.draft.esp ? 'disabled' : ''}>
              <option value="">${state.draft.esp ? '— Select a tag —' : '— Pick an ESP first —'}</option>
              ${tagOptions}
            </select>
          </div>
          <p class="configure__hint">Pulled from your connected ESP. Update tags in your ESP and refresh — they propagate here.</p>
        </div>
      `;
      section.appendChild(block);
      $('#espSelect').addEventListener('change', e => {
        state.draft.esp = e.target.value;
        // Clear tag — prior tag may not exist in the new ESP
        state.draft.tag = '';
        renderConfigure();
      });
      $('#tagSelect').addEventListener('change', e => {
        state.draft.tag = e.target.value;
      });
      return;
    }

    if (action.configShape === 'webhook') {
      const block = el('div');
      block.innerHTML = `
        <h4 class="configure__section-title">Where should we POST the trigger context?</h4>
        <div class="configure__field">
          <label class="field-label">URL</label>
          <input type="text" class="input" id="urlInput"
                 placeholder="https://your-tool.example.com/webhook"
                 value="${escapeAttr(state.draft.url || '')}">
          <p class="configure__hint">We'll send a POST with the JSON body below. Failures are logged but won't block other automations.</p>
        </div>
        <div class="payload-preview" aria-label="Webhook payload preview">
          <span class="payload-preview__label">Payload</span>
{
  <span class="payload-preview__key">"email"</span>:   <span class="payload-preview__str">"alice@example.com"</span>,
  <span class="payload-preview__key">"name"</span>:    <span class="payload-preview__str">"Alice Jones"</span>,
  <span class="payload-preview__key">"product"</span>: <span class="payload-preview__str">"${escapeAttr(buildPayloadProductValue())}"</span>,
  <span class="payload-preview__key">"event"</span>:   <span class="payload-preview__str">"${state.draft.triggerId}"</span>,
  <span class="payload-preview__key">"source"</span>:  <span class="payload-preview__str">"woocommerce"</span>
}
        </div>
      `;
      section.appendChild(block);
      $('#urlInput').addEventListener('input', e => {
        state.draft.url = e.target.value;
      });
      return;
    }

    if (action.configShape === 'ultimatum_campaign') {
      const verb = state.draft.subOperation === 'stop' ? 'stop' : 'start';
      const block = el('div');
      block.innerHTML = `
        <h4 class="configure__section-title">Which Ultimatum campaign to ${verb}?</h4>
        <div class="select-wrap">
          <select class="input input--select" id="campaignSelect">
            <option value="">— Select a campaign —</option>
            ${ULTIMATUM_CAMPAIGNS.map(c => `<option value="${c}" ${state.draft.campaign === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
      `;
      section.appendChild(block);
      $('#campaignSelect').addEventListener('change', e => {
        state.draft.campaign = e.target.value;
      });
      return;
    }

    if (action.configShape === 'grant_apprentice_access') {
      // For Completion + Drip Unlock we exclude the source course from
      // the dropdown. For Granted we allow any product (the source product
      // is the trigger *target*, not the action target — distinct concepts)
      // but still hint.
      const trig = currentTrigger();
      const sourceProductId = (trig.id === 'completion' || trig.id === 'drip_unlock')
        ? state.draft.course
        : state.draft.product;
      const eligible = PRODUCTS.filter(p => p.id !== sourceProductId);

      const verbHint = trig.id === 'completion'  ? 'completed'
                     : trig.id === 'drip_unlock' ? 'unlocked'
                     : 'granted';

      const block = el('div');
      block.innerHTML = `
        <h4 class="configure__section-title">Which Apprentice product should we grant?</h4>
        <div class="select-wrap">
          <select class="input input--select" id="targetProductSelect">
            <option value="">— Select a product —</option>
            ${eligible.map(p => `<option value="${p.id}" ${state.draft.targetProduct === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
          </select>
        </div>
        <p class="configure__hint">Choose a different product than the one being ${verbHint}.</p>
      `;
      section.appendChild(block);
      $('#targetProductSelect').addEventListener('change', e => {
        state.draft.targetProduct = e.target.value;
      });
      return;
    }
  }

  function buildPayloadProductValue() {
    const trig = currentTrigger();
    if (trig.id === 'completion' || trig.id === 'drip_unlock') {
      const c = COURSE_STRUCTURE[state.draft.course];
      return c?.name || 'Beginner Photography';
    }
    return PRODUCTS.find(p => p.id === state.draft.product)?.name || 'Photography Masterclass';
  }

  // ─── Condition handlers ─────────────────────────────────
  // Trigger-aware: Source is hidden on Completion (no source concept there).
  function populateConditionFields() {
    const trig = currentTrigger();
    const select = $('#condField');
    if (!select) return;
    const opts = [
      { value: 'user_role', label: 'User role' },
    ];
    if (trig.hasSourceCondition) opts.push({ value: 'source', label: 'Source' });

    // Preserve current value if still valid; otherwise reset to user_role
    const currentField = state.draft.condition?.field || opts[0].value;
    const validValues = opts.map(o => o.value);
    const finalField = validValues.includes(currentField) ? currentField : opts[0].value;
    if (state.draft.condition && state.draft.condition.field !== finalField) {
      state.draft.condition.field = finalField;
      // Reset value because field changed
      state.draft.condition.value = condValueOptions(finalField)[0] || '';
    }
    select.innerHTML = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  }
  function condValueOptions(field) {
    if (field === 'user_role') return ['Subscriber', 'Customer', 'Student', 'Administrator'];
    if (field === 'source')    return ['WooCommerce', 'Stripe', 'Webhook', 'Form', 'Admin', 'API'];
    return [];
  }
  function renderConditionValue() {
    const wrap = $('#condValueWrap');
    wrap.innerHTML = '';
    if (!state.draft.condition) return;
    const opts = condValueOptions(state.draft.condition.field);
    const sel = el('select', { class: 'input input--select input--sm', id: 'condValue' });
    opts.forEach(o => {
      const opt = el('option', { value: o, text: o });
      if (o === state.draft.condition.value) opt.selected = true;
      sel.appendChild(opt);
    });
    wrap.appendChild(sel);
    sel.addEventListener('change', () => {
      state.draft.condition.value = sel.value;
    });
    if (!state.draft.condition.value && opts.length) {
      state.draft.condition.value = sel.value;
    }
  }

  function addCondition() {
    const trig = currentTrigger();
    const defaultField = 'user_role';
    state.draft.condition = {
      field: defaultField,
      op: 'equals',
      value: condValueOptions(defaultField)[0],
    };
    renderConfigure();
  }
  function removeCondition() {
    state.draft.condition = null;
    renderConfigure();
    toast('Condition removed', 'info', 2000);
  }
  function addDelay() {
    state.draft.timing = { mode: 'delay', delayValue: 2, delayUnit: 'days' };
    renderConfigure();
    setTimeout(() => $('#delayValue')?.focus(), 30);
  }
  function removeDelay() {
    state.draft.timing = { mode: 'immediate' };
    renderConfigure();
    toast('Delay removed — fires immediately.', 'info', 2000);
  }
  function syncTimingFromDOM() {
    if (state.draft.timing?.mode !== 'delay') return;
    const raw = parseInt($('#delayValue')?.value, 10);
    const num = Number.isFinite(raw) && raw >= 1 ? raw : 1;
    state.draft.timing.delayValue = num;
    state.draft.timing.delayUnit  = $('#delayUnit')?.value || 'days';
  }

  // ─── Save & Activate (validate-on-click) ────────────────
  function saveAutomation() {
    const trig = currentTrigger();
    if (!trig) return;
    syncTimingFromDOM();

    // Step A: Scope already enforced by radio buttons (default 'course').
    // Step B: target picked?
    if (trig.id === 'granted' || trig.id === 'revoked') {
      if (!state.draft.product) {
        toast('Please pick a product before saving.', 'error', 4500);
        gotoPickerAndFocus('#productSelect');
        return;
      }
    }
    if (trig.id === 'completion') {
      if (!state.draft.course) {
        toast('Please pick a course before saving.', 'error', 4500);
        gotoPickerAndFocus('#courseSelect');
        return;
      }
      if ((state.draft.completionScope === 'module' || state.draft.completionScope === 'lesson') && !state.draft.module) {
        toast('Please pick a module before saving.', 'error', 4500);
        gotoPickerAndFocus('#moduleSelect');
        return;
      }
      if (state.draft.completionScope === 'lesson' && !state.draft.lesson) {
        toast('Please pick a lesson before saving.', 'error', 4500);
        gotoPickerAndFocus('#lessonSelect');
        return;
      }
    }
    if (trig.id === 'drip_unlock') {
      if (!state.draft.course) {
        toast('Please pick a drip-enabled course before saving.', 'error', 4500);
        gotoPickerAndFocus('#courseSelect');
        return;
      }
      if (!state.draft.module) {
        toast('Please pick a module before saving.', 'error', 4500);
        gotoPickerAndFocus('#moduleSelect');
        return;
      }
      if (!state.draft.lesson) {
        toast('Please pick a lesson before saving.', 'error', 4500);
        gotoPickerAndFocus('#lessonSelect');
        return;
      }
    }

    // Step C: action picked?
    if (!state.draft.actionKey) {
      toast('Please pick an action before saving.', 'error', 4500);
      gotoPickerAndFocus('#actionList .action-opt');
      return;
    }

    const action = ACTIONS.find(a => a.key === state.draft.actionKey);

    // Step D: action target picked?
    if (action.configShape === 'esp_tag') {
      if (!state.draft.esp) {
        toast('Please pick an ESP before saving.', 'error', 4500);
        focusInConfigure('#espSelect');
        return;
      }
      if (!state.draft.tag) {
        toast('Please pick a tag before saving.', 'error', 4500);
        focusInConfigure('#tagSelect');
        return;
      }
    }
    if (action.configShape === 'webhook') {
      const url = (state.draft.url || '').trim();
      if (!url) {
        toast('Please enter a webhook URL before saving.', 'error', 4500);
        focusInConfigure('#urlInput');
        return;
      }
    }
    if (action.configShape === 'ultimatum_campaign') {
      if (!state.draft.campaign) {
        toast('Please pick an Ultimatum campaign before saving.', 'error', 4500);
        focusInConfigure('#campaignSelect');
        return;
      }
    }
    if (action.configShape === 'grant_apprentice_access') {
      if (!state.draft.targetProduct) {
        toast('Please pick a target product before saving.', 'error', 4500);
        focusInConfigure('#targetProductSelect');
        return;
      }
      // Same-product validation — Completion + Drip Unlock (per spec).
      if ((trig.id === 'completion' || trig.id === 'drip_unlock') && state.draft.targetProduct === state.draft.course) {
        toast('That would grant access to the same product. Pick a different one.', 'error', 5000);
        focusInConfigure('#targetProductSelect');
        return;
      }
    }

    // Stacking-rule backstop — defense in depth. Even if the picker filter
    // was bypassed (manual state mutation, stale DOM), refuse to save when
    // the (trigger, scope-target) already has this action type or the mutex
    // would be violated.
    {
      const scopeKey = getScopeKey(state.draft);
      if (scopeKey) {
        const used = getUsedActionTypes(trig.id, scopeKey, state.editingId);
        const targetDisplay = getScopeTargetDisplay(state.draft);
        if (used.includes(state.draft.actionKey)) {
          const actionName = getActionTypeName(state.draft.actionKey);
          toast(`You already have a ${actionName} configured for ${targetDisplay}. Edit the existing one instead.`, 'error', 5500);
          return;
        }
        const isMutex =
          (state.draft.actionKey === 'esp_tag' && used.includes('webhook')) ||
          (state.draft.actionKey === 'webhook' && used.includes('esp_tag'));
        if (isMutex) {
          toast(`You can have either an ESP Tag or a Send Webhook on the same ${targetDisplay}, not both. Edit the existing one to switch.`, 'error', 5500);
          return;
        }
      }
    }

    // Persist — replace if editing, prepend if new
    const list = state.automations[trig.id] || [];
    if (state.editingId) {
      const idx = list.findIndex(a => a.id === state.editingId);
      if (idx >= 0) list[idx] = { ...state.draft };
      toast('Automation updated', 'success', 3000);
    } else {
      list.unshift({ ...state.draft });
      toast('Automation saved and is now live', 'success', 3500);
    }
    state.automations[trig.id] = list;

    state.draft = null;
    state.editingId = null;
    renderTriggerDetail();
    setView('trigger-detail');
    maybeGuideNext('save-automation');
  }

  // Helpers — when validation fails on a target field that lives on the
  // picker stage, jump back there and focus.
  function gotoPickerAndFocus(selector) {
    setStage('picker');
    setTimeout(() => {
      const target = $(selector);
      if (target) {
        target.focus();
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);
  }
  function focusInConfigure(selector) {
    setTimeout(() => {
      const target = $(selector);
      if (target) {
        target.focus();
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 60);
  }

  // ─── Picker → configure navigation helpers ──────────────
  function changeAction() {
    // For paired actions, Change goes back to sub-op selector (preserving target/timing/condition).
    // For standalone, Change goes back to the picker.
    const action = ACTIONS.find(a => a.key === state.draft.actionKey);
    if (!action) { setStage('picker'); return; }
    if (action.subOps && action.subOps.length) {
      state.draft.subOperation = null;
      setStage('subop');
      return;
    }
    setStage('picker');
  }
  function backToPicker() {
    state.draft.actionKey = '';
    state.draft.subOperation = null;
    setStage('picker');
  }
  function editTriggerContext() {
    // Jump back to picker stage so the user can change scope / target.
    // Action is preserved — we only re-edit the upstream scope.
    setStage('picker');
    setTimeout(() => {
      const trig = currentTrigger();
      const target = (trig.id === 'completion' || trig.id === 'drip_unlock')
        ? $('#courseSelect')
        : $('#productSelect');
      target?.focus();
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }

  // ─── Per-row popover ────────────────────────────────────
  function showRowMenu(button, automationId) {
    state.popoverFor = automationId;
    const popover = $('#rowPopover');
    const rect = button.getBoundingClientRect();
    popover.hidden = false;
    popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
    popover.style.left = `${rect.right - 200 + window.scrollX}px`;
    const list = state.automations[state.activeTriggerId] || [];
    const auto = list.find(a => a.id === automationId);
    if (!auto) return;
    popover.querySelector('[data-action="popover-toggle"]').textContent =
      auto.enabled ? '⏸ Disable' : '▶ Enable';
  }
  function hideRowMenu() {
    $('#rowPopover').hidden = true;
    state.popoverFor = null;
  }

  // ─── Remove with undo toast ─────────────────────────────
  function openRemoveModal(id) {
    state.deleteId = id;
    $('#removeModal').hidden = false;
  }
  function closeRemoveModal() {
    state.deleteId = null;
    $('#removeModal').hidden = true;
  }
  function confirmRemove() {
    const list = state.automations[state.activeTriggerId] || [];
    const idx = list.findIndex(a => a.id === state.deleteId);
    if (idx >= 0) {
      state.lastRemoved = JSON.parse(JSON.stringify(list[idx]));
      state.lastRemovedTriggerId = state.activeTriggerId;
      list.splice(idx, 1);
    }
    closeRemoveModal();
    renderTriggerDetail();

    // Toast with Undo link
    const body = el('span');
    body.appendChild(document.createTextNode('Automation removed.'));
    const undoBtn = el('button', { class: 'toast__undo', type: 'button', text: 'Undo' });
    body.appendChild(undoBtn);
    toast({
      html: body,
      onMount: (node) => {
        undoBtn.addEventListener('click', e => {
          e.stopPropagation();
          if (!state.lastRemoved) return;
          const restored = JSON.parse(JSON.stringify(state.lastRemoved));
          state.automations[state.lastRemovedTriggerId] = state.automations[state.lastRemovedTriggerId] || [];
          state.automations[state.lastRemovedTriggerId].unshift(restored);
          state.lastRemoved = null;
          state.lastRemovedTriggerId = null;
          renderTriggerDetail();
          node._dismiss && node._dismiss();
          toast('Automation restored.', 'success', 2500);
        });
      },
    }, 'info', 5000);
    setTimeout(() => { state.lastRemoved = null; state.lastRemovedTriggerId = null; }, 5200);
  }

  // ─── Test drawer ────────────────────────────────────────
  function openTestDrawer(automationId) {
    const list = state.automations[state.activeTriggerId] || [];
    const auto = list.find(a => a.id === automationId);
    if (!auto) return;
    state.draft = JSON.parse(JSON.stringify(auto));   // borrow draft slot for test context
    $('#drawerResult').hidden = true;
    $('#drawerResult').innerHTML = '';

    // Update sample-data field labels per trigger
    const trig = TRIGGERS[auto.triggerId];
    if (trig.id === 'completion') {
      $('#testContextLabel').textContent = 'Course/module/lesson they completed';
      const courseName = COURSE_STRUCTURE[auto.course]?.name || '';
      let ctxValue = courseName;
      if (auto.completionScope === 'module') {
        const m = COURSE_STRUCTURE[auto.course]?.modules.find(x => x.id === auto.module);
        ctxValue = `${m?.name || ''} (in ${courseName})`;
      } else if (auto.completionScope === 'lesson') {
        const m = COURSE_STRUCTURE[auto.course]?.modules.find(x => x.id === auto.module);
        const l = m?.lessons.find(x => x.id === auto.lesson);
        ctxValue = `${l?.name || ''} (in ${courseName})`;
      }
      $('#testContext').value = ctxValue;
      $('#testSourceWrap').hidden = true;
    } else if (trig.id === 'drip_unlock') {
      $('#testContextLabel').textContent = 'Lesson that just unlocked';
      const courseName = COURSE_STRUCTURE[auto.course]?.name || '';
      const m = COURSE_STRUCTURE[auto.course]?.modules.find(x => x.id === auto.module);
      const l = m?.lessons.find(x => x.id === auto.lesson);
      $('#testContext').value = `${l?.name || ''} (in ${m?.name || ''} module of ${courseName})`;
      $('#testSourceWrap').hidden = true;
    } else {
      $('#testContextLabel').textContent = 'Product they joined';
      $('#testContext').value = PRODUCTS.find(p => p.id === auto.product)?.name || '';
      $('#testSourceWrap').hidden = false;
    }
    $('#testRoleWrap').hidden = false;

    // Drawer subhead — per trigger
    $('#drawerSub').textContent = trig.id === 'completion'
      ? 'Run with sample data and see what would happen on this completion.'
      : trig.id === 'drip_unlock'
        ? 'Run with sample data and see what would happen on this drip unlock.'
        : `Run with sample data and see what would happen on this ${trig.id === 'granted' ? 'access grant' : 'access revoke'}.`;

    $('#testDrawer').hidden = false;
    setTimeout(() => $('#testEmail')?.focus(), 50);
  }
  function closeTestDrawer() {
    $('#testDrawer').hidden = true;
    state.draft = null;
  }

  function runTest() {
    const auto = state.draft;
    if (!auto) return;
    const action = ACTIONS.find(a => a.key === auto.actionKey);
    const trig = TRIGGERS[auto.triggerId];
    const email = $('#testEmail').value.trim();
    if (!email) {
      showResult('error', 'Missing email', 'Enter a student email to run the test.');
      return;
    }
    const role = $('#testRole').value;
    const source = (!$('#testSourceWrap').hidden) ? $('#testSource').value : '';

    // Evaluate condition if present
    if (auto.condition) {
      const { field, op, value } = auto.condition;
      const actual = field === 'user_role' ? role
                   : field === 'source'    ? source
                   : '';
      let met = false;
      if (op === 'equals')     met = actual === value;
      if (op === 'not_equals') met = actual !== value;
      if (op === 'contains')   met = actual.toLowerCase().includes((value || '').toLowerCase());
      if (!met) {
        const fieldLabel = condFieldLabel(field);
        const opLabel = condOpLabel(op);
        showResult(
          'info',
          "Condition didn't match — automation would not have fired",
          `Your test data has <strong>${fieldLabel}</strong> = "${actual || '(empty)'}", but the condition requires it ${opLabel} "${value}". <br><br>Change the sample data above and re-run to test the "fires" path.`
        );
        toast('Test complete — condition not met', 'info', 2500);
        return;
      }
    }

    // Success — compose plain-English banner
    const simulatedCaption = '<span class="result-banner__simulated">(simulated — nothing actually changed)</span>';
    const body = buildTestSuccessBody(action, auto, email);
    showResult('success', 'Test passed — automation would fire', simulatedCaption + body);
  }

  function buildTestSuccessBody(action, auto, email) {
    const e = `<code>${email}</code>`;
    const delayed = auto.timing && auto.timing.mode === 'delay';
    const inPhrase = delayed ? ` <strong>in ${formatDelayPhrase(auto.timing)}</strong>` : '';

    // Drip Unlock — spec-defined "because <Lesson> of <Course> unlocked" tail.
    const becauseTail = auto.triggerId === 'drip_unlock'
      ? buildDripUnlockBecauseTail(auto)
      : '';

    if (action.key === 'esp_tag') {
      const espLabel = ESPS.find(es => es.id === auto.esp)?.label || auto.esp;
      const verb = auto.subOperation === 'remove' ? 'remove' : 'apply';
      return `Would ${verb} tag <code>${auto.tag}</code> on ${e} in <strong>${espLabel}</strong>${inPhrase}${becauseTail}.`;
    }
    if (action.key === 'webhook') {
      const url = auto.url || '(no URL)';
      return `Would POST the trigger payload for ${e} to <code>${url}</code>${inPhrase}${becauseTail}.`;
    }
    if (action.key === 'ultimatum_campaign') {
      const verb = auto.subOperation === 'stop' ? 'stop' : 'start';
      if (delayed) return `Would schedule <strong>${auto.campaign}</strong> to ${verb} for ${e}${inPhrase}${becauseTail}.`;
      if (verb === 'stop') return `Would stop <strong>${auto.campaign}</strong> for ${e}${becauseTail}.`;
      return `Would start <strong>${auto.campaign}</strong> for ${e}${becauseTail}. Their countdown begins on their next page visit.`;
    }
    if (action.key === 'grant_apprentice_access') {
      const targetName = PRODUCTS.find(p => p.id === auto.targetProduct)?.name;
      return `Would grant ${e} access to <strong>${targetName}</strong>${inPhrase}${becauseTail}. (Idempotent — re-firing won't double-grant.)`;
    }
    return `The action would run with the sample data above${inPhrase}${becauseTail}.`;
  }

  function buildDripUnlockBecauseTail(auto) {
    const courseName = COURSE_STRUCTURE[auto.course]?.name || '(course)';
    const m = COURSE_STRUCTURE[auto.course]?.modules.find(x => x.id === auto.module);
    const l = m?.lessons.find(x => x.id === auto.lesson);
    const lessonName = l?.name || '(lesson)';
    return ` because <strong>Lesson — ${lessonName}</strong> of <em>${courseName}</em> unlocked`;
  }

  function showResult(kind, title, bodyHtml) {
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
    const s = GUIDE_STEPS[step];
    $('#guideTitle').textContent = `${s.title} · Step ${step + 1} of ${GUIDE_STEPS.length}`;
    $('#guideText').innerHTML = s.text;
    $('#guideNextBtn').textContent = step === GUIDE_STEPS.length - 1 ? 'Finish' : 'Got it';
    $('#guide').hidden = false;
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
  function maybeGuideNext(trigger) {
    if (!state.guide.active) return;
    if (trigger === 'open-trigger-detail' && state.guide.step === 0) advanceGuide();
    if (trigger === 'add-automation'      && state.guide.step === 1) advanceGuide();
    if (trigger === 'pick-action'         && state.guide.step === 2) advanceGuide();
    if (trigger === 'save-automation'     && state.guide.step === 4) hideGuide(true);
    // Step 3 (Timing & Condition) is informational — auto-advance after a few seconds.
  }
  function renderGuideProgress(step) {
    const dots = $$('#guideProgress .guide__dot');
    dots.forEach((dot, i) => {
      dot.classList.remove('guide__dot--current', 'guide__dot--done');
      if (i < step) dot.classList.add('guide__dot--done');
      else if (i === step) dot.classList.add('guide__dot--current');
    });
  }
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

  // ─── Seed demo data ─────────────────────────────────────
  // Per spec: 2-3 pre-existing automations so list views aren't empty on load.
  // Granted: tag + delayed Ultimatum start. Completion: grant + tag.
  // Revoked: empty (so empty state is visible on at least one trigger).
  function seedDemoData() {
    state.automations.granted = [
      {
        id: uid(),
        triggerId: 'granted',
        enabled: true,
        completionScope: 'course',
        product: 'photo-master',
        course: '', module: '', lesson: '',
        actionKey: 'esp_tag',
        subOperation: 'add',
        esp: 'activecampaign',
        tag: 'photo-student',
        url: '', campaign: '', targetProduct: '',
        timing: { mode: 'immediate' },
        condition: null,
      },
      {
        id: uid(),
        triggerId: 'granted',
        enabled: true,
        completionScope: 'course',
        product: 'photo-master',
        course: '', module: '', lesson: '',
        actionKey: 'ultimatum_campaign',
        subOperation: 'start',
        esp: '', tag: '', url: '',
        campaign: 'Welcome 7-day',
        targetProduct: '',
        timing: { mode: 'delay', delayValue: 1, delayUnit: 'days' },
        condition: null,
      },
    ];
    state.automations.completion = [
      {
        id: uid(),
        triggerId: 'completion',
        enabled: true,
        completionScope: 'course',
        product: '',
        course: 'beginner-photo', module: '', lesson: '',
        actionKey: 'grant_apprentice_access',
        subOperation: null,
        esp: '', tag: '', url: '', campaign: '',
        targetProduct: 'intermediate-photo',
        timing: { mode: 'delay', delayValue: 7, delayUnit: 'days' },
        condition: null,
      },
      {
        id: uid(),
        triggerId: 'completion',
        enabled: true,
        completionScope: 'course',
        product: '',
        course: 'beginner-photo', module: '', lesson: '',
        actionKey: 'esp_tag',
        subOperation: 'add',
        esp: 'activecampaign',
        tag: 'beginner-graduate',
        url: '', campaign: '', targetProduct: '',
        timing: { mode: 'immediate' },
        condition: null,
      },
    ];
    state.automations.revoked = [];
    // Drip Unlock — seed one realistic automation so the list isn't empty.
    // "Add tag halfway-through-photography in ActiveCampaign · on unlock of
    //  Lesson Aperture (in Camera basics module of Beginner Photography)"
    state.automations.drip_unlock = [
      {
        id: uid(),
        triggerId: 'drip_unlock',
        enabled: true,
        completionScope: 'lesson',   // unused for drip but keeps shape consistent
        product: '',
        course: 'beginner-photo',
        module: 'm1',                // Camera basics
        lesson: 'l1',                // Aperture
        actionKey: 'esp_tag',
        subOperation: 'add',
        esp: 'activecampaign',
        tag: 'halfway-through-photography',
        url: '', campaign: '', targetProduct: '',
        timing: { mode: 'immediate' },
        condition: null,
      },
    ];
  }

  // ─── Reset ──────────────────────────────────────────────
  function resetAll() {
    seedDemoData();
    state.draft = null;
    state.editingId = null;
    state.activeTriggerId = null;
    state.lastRemoved = null;
    state.lastRemovedTriggerId = null;
    state.deleteId = null;
    hideRowMenu();
    closeRemoveModal();
    closeTestDrawer();
    try { localStorage.removeItem(GUIDE_SEEN_KEY); } catch (_) { /* ignore */ }
    renderTriggersLanding();
    setView('triggers-landing');
    toast('Prototype reset. Starting fresh.', 'info');
    setTimeout(() => showGuide(0), 400);
  }

  // ─── Event wiring ───────────────────────────────────────
  function wireEvents() {
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      switch (action) {
        case 'back-to-landing': setView('triggers-landing'); renderTriggersLanding(); break;
        case 'back-to-detail':  setView('trigger-detail');   renderTriggerDetail(); break;
        case 'add-automation':  startAddAutomation(); break;
        case 'add-automation-group':
          startAddAutomationForGroup(target.dataset.groupKey);
          break;
        case 'back-to-picker':  backToPicker(); break;
        case 'change-action':   changeAction(); break;
        case 'edit-trigger-context': editTriggerContext(); break;
        case 'add-delay':       addDelay(); break;
        case 'remove-delay':    removeDelay(); break;
        case 'add-condition':   addCondition(); break;
        case 'remove-condition': removeCondition(); break;
        case 'save-automation': saveAutomation(); break;
        case 'cancel-automation':
          state.draft = null;
          state.editingId = null;
          setView('trigger-detail');
          renderTriggerDetail();
          break;
        case 'row-menu':
          e.stopPropagation();
          showRowMenu(target, target.dataset.id);
          break;
        case 'popover-edit':
          startEditAutomation(state.popoverFor);
          hideRowMenu();
          break;
        case 'popover-test':
          openTestDrawer(state.popoverFor);
          hideRowMenu();
          break;
        case 'popover-toggle': {
          const list = state.automations[state.activeTriggerId] || [];
          const auto = list.find(a => a.id === state.popoverFor);
          if (auto) {
            auto.enabled = !auto.enabled;
            renderTriggerDetail();
            toast(auto.enabled ? 'Automation enabled' : 'Automation disabled', 'info');
          }
          hideRowMenu();
          break;
        }
        case 'popover-remove':
          openRemoveModal(state.popoverFor);
          hideRowMenu();
          break;
        case 'close-modal':     closeRemoveModal(); break;
        case 'confirm-remove':  confirmRemove(); break;
        case 'close-drawer':    closeTestDrawer(); break;
        case 'run-test':        runTest(); break;
        case 'guide-next':      advanceGuide(); break;
        case 'guide-skip':      hideGuide(true); break;
      }
    });

    // Dismiss popover on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#rowPopover') && !e.target.closest('[data-action="row-menu"]')) {
        hideRowMenu();
      }
    });

    // Scope radio changes (Completion only)
    document.addEventListener('change', (e) => {
      if (e.target.name === 'completionScope') {
        state.draft.completionScope = e.target.value;
        // Clear downstream selections when scope changes
        if (state.draft.completionScope === 'course')   { state.draft.module = ''; state.draft.lesson = ''; }
        if (state.draft.completionScope === 'module')   { state.draft.lesson = ''; }
        renderTargetFields();
        // Scope change shifts the scope-target-key (course → module → lesson),
        // so re-evaluate which actions are still available.
        renderActionList();
      }
      if (e.target.id === 'condField') {
        state.draft.condition.field = e.target.value;
        const opts = condValueOptions(e.target.value);
        state.draft.condition.value = opts[0] || '';
        renderConditionValue();
      }
      if (e.target.id === 'condOp') {
        state.draft.condition.op = e.target.value;
      }
      if (e.target.id === 'condValue') {
        state.draft.condition.value = e.target.value;
      }
      if (e.target.id === 'delayUnit')  syncTimingFromDOM();
      if (e.target.id === 'delayValue') syncTimingFromDOM();
    });
    document.addEventListener('input', (e) => {
      if (e.target.id === 'delayValue') syncTimingFromDOM();
    });

    // Reset
    $('#resetBtn').addEventListener('click', resetAll);

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#removeModal').hidden) closeRemoveModal();
        else if (!$('#testDrawer').hidden) closeTestDrawer();
        else if (state.popoverFor) hideRowMenu();
        else if (!$('#guide').hidden) hideGuide(true);
        else if (state.view === 'automation-edit') {
          if (state.stage === 'subop') backToPicker();
          else if (state.stage === 'configure') changeAction();
          else { state.draft = null; state.editingId = null; setView('trigger-detail'); renderTriggerDetail(); }
        } else if (state.view === 'trigger-detail') {
          setView('triggers-landing');
          renderTriggersLanding();
        }
      }
    });

    // Reposition spotlight
    window.addEventListener('resize', repositionSpotlight);
    window.addEventListener('scroll', repositionSpotlight, true);

    // Focus trap for remove modal
    $('#removeModal')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      if ($('#removeModal').hidden) return;
      const focusables = $$('#removeModal [data-action="close-modal"], #removeModal [data-action="confirm-remove"]');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  // ─── Init ───────────────────────────────────────────────
  function init() {
    seedDemoData();
    wireEvents();
    renderTriggersLanding();
    setView('triggers-landing');

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
