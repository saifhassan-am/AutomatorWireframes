/* ============================================================
   Ultimatum Triggers — prototype interactions
   Dashboard → per-campaign view (Evergreen vs non-Evergreen split)
   → action picker flow + source picker flow.
============================================================ */

(function () {
  'use strict';

  // ============================================================
  // SEED DATA — realistic Ultimatum campaigns covering all 3 types
  // ============================================================

  const CAMPAIGNS = {
    'cart-abandonment': {
      id: 'cart-abandonment',
      name: 'Cart Abandonment Recovery',
      type: 'evergreen',
      typeLabel: 'Evergreen',
      typeIcon: '♾',
      meta: 'Per-user 48-hour countdown · 312 users in flight'
    },
    'course-launch': {
      id: 'course-launch',
      name: 'Course Launch 7-Day Window',
      type: 'evergreen',
      typeLabel: 'Evergreen',
      typeIcon: '♾',
      meta: 'Per-user 7-day countdown · 1,247 users in flight'
    },
    'vip-birthday': {
      id: 'vip-birthday',
      name: 'VIP Birthday Discount',
      type: 'evergreen',
      typeLabel: 'Evergreen',
      typeIcon: '♾',
      meta: 'Per-user 24-hour countdown · 89 users in flight'
    },
    'black-friday': {
      id: 'black-friday',
      name: 'Black Friday 2026 Sale',
      type: 'fixed',
      typeLabel: 'Fixed-Date',
      typeIcon: '📅',
      meta: 'Site-wide · ends Friday Nov 27 at 23:59 EST'
    },
    'friday-flash': {
      id: 'friday-flash',
      name: 'Friday Flash Sale',
      type: 'recurring',
      typeLabel: 'Recurring',
      typeIcon: '🔁',
      meta: 'Every Friday 9am–noon EST · shared window'
    }
  };

  const SOURCES = {
    pagevisit: { id: 'pagevisit', name: 'Page Visit', icon: '👁', desc: 'Start the countdown when a user first visits a specific page on the site.', iconKey: 'pagevisit' },
    webhook:   { id: 'webhook',   name: 'Incoming Webhook', icon: '🔌', desc: 'An external system POSTs an email or user ID to a per-campaign URL to start the countdown.', iconKey: 'webhook' },
    leads:     { id: 'leads',     name: 'Thrive Leads Form Conversion', icon: '✉', desc: 'Start the countdown when a user submits a specific Thrive Leads form.', iconKey: 'leads' }
  };

  const ACTIONS = {
    tag:     { id: 'tag',     name: 'Email tag', icon: '📩', desc: 'Tag the user in your email tool (Mailchimp, ActiveCampaign, ConvertKit, etc.).', iconKey: 'esp' },
    webhook: { id: 'webhook', name: 'Send Webhook', icon: '↗', desc: 'Fire an HTTP request to any URL with the campaign expiry context.', iconKey: 'webhook' }
  };

  // ============================================================
  // STATE
  // ============================================================

  const STORAGE_KEY = 'ultimatum-triggers-prototype-v1';

  const state = {
    view: 'list',
    currentCampaignId: null,
    dashboardCampaignIds: [],
    campaignConfigs: {},
    bannerDismissed: false,
    addPickerOpen: false,
    emptyComboOpen: false,
    flow: { mode: null, stage: 'picker', editingId: null, pickedType: null, draftConfig: {} }
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) Object.assign(state, JSON.parse(raw));
    } catch (_) {}
    seedDefaults();
  }

  function seedDefaults() {
    Object.keys(CAMPAIGNS).forEach(id => {
      if (!state.campaignConfigs[id]) {
        state.campaignConfigs[id] = {
          enabled: true,
          sources: (id === 'course-launch' || id === 'cart-abandonment') ? [
            { id: 's-default-' + id, type: 'pagevisit', enabled: true, config: { page: '/offer' } }
          ] : [],
          actions: []
        };
      }
    });

    if (!state.dashboardCampaignIds || state.dashboardCampaignIds.length === 0) {
      state.dashboardCampaignIds = ['course-launch', 'cart-abandonment', 'black-friday', 'vip-birthday', 'friday-flash'];
    }

    const cl = state.campaignConfigs['course-launch'];
    if (cl && cl.actions.length === 0) {
      cl.sources.push({ id: 's-cl-webhook', type: 'webhook', enabled: true, config: { endpoint: '/wp-json/tu/v1/campaigns/course-launch/start' } });
      cl.actions.push({ id: 'a-cl-1', type: 'tag', enabled: true, config: { provider: 'ActiveCampaign', tags: ['missed-course-launch'] } });
      cl.actions.push({ id: 'a-cl-2', type: 'webhook', enabled: true, config: { url: 'https://hooks.zapier.com/winback', method: 'POST' } });
    }
    const ca = state.campaignConfigs['cart-abandonment'];
    if (ca && ca.actions.length === 0) {
      ca.actions.push({ id: 'a-ca-1', type: 'tag', enabled: true, config: { provider: 'Mailchimp', tags: ['cart-abandoner', 'expired-window'] } });
    }
    const vip = state.campaignConfigs['vip-birthday'];
    if (vip && vip.actions.length === 0) {
      vip.enabled = false;
      vip.actions.push({ id: 'a-vip-1', type: 'tag', enabled: true, config: { provider: 'FluentCRM', tags: ['birthday-missed'] } });
    }
  }

  function saveState() {
    try {
      const toSave = {
        view: state.view,
        currentCampaignId: state.currentCampaignId,
        dashboardCampaignIds: state.dashboardCampaignIds,
        campaignConfigs: state.campaignConfigs,
        bannerDismissed: state.bannerDismissed
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (_) {}
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function el(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function escapeHtml(s) {
    if (typeof s !== 'string') return s;
    return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function currentCampaign() { return CAMPAIGNS[state.currentCampaignId]; }
  function currentConfig() { return state.campaignConfigs[state.currentCampaignId]; }

  // ============================================================
  // STATUS
  // ============================================================

  function getCampaignStatus(id) {
    const c = CAMPAIGNS[id];
    const cfg = state.campaignConfigs[id];
    if (!c || !cfg) return { pill: 'na', label: 'Unknown', summary: '' };
    if (c.type !== 'evergreen') {
      return { pill: 'na', label: 'Type not supported', summary: 'Triggers apply to Evergreen campaigns only.' };
    }
    if (cfg.enabled === false) {
      return { pill: 'disabled', label: 'Disabled', summary: 'Triggers are paused for this campaign.' };
    }
    const sourcesActive = cfg.sources.filter(s => s.enabled !== false).length;
    const actionsActive = cfg.actions.filter(a => a.enabled !== false).length;
    if (sourcesActive === 0 && actionsActive === 0) {
      return { pill: 'needs-setup', label: 'Needs setup', summary: 'No trigger sources or expiry actions yet.' };
    }
    if (sourcesActive > 0 && actionsActive > 0) {
      return { pill: 'active', label: 'Active', summary: `${sourcesActive} source${sourcesActive === 1 ? '' : 's'} · ${actionsActive} expiry action${actionsActive === 1 ? '' : 's'} firing` };
    }
    return { pill: 'partial', label: 'Partial setup', summary: `${sourcesActive} source${sourcesActive === 1 ? '' : 's'} · ${actionsActive} action${actionsActive === 1 ? '' : 's'} configured` };
  }

  // ============================================================
  // ROUTING
  // ============================================================

  function goToList() {
    state.view = 'list';
    state.currentCampaignId = null;
    state.flow = { mode: null, stage: 'picker', editingId: null, pickedType: null, draftConfig: {} };
    saveState();
    renderAll();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  function goToCampaign(id) {
    if (!CAMPAIGNS[id]) return;
    state.currentCampaignId = id;
    state.view = 'campaign';
    addToDashboard(id);
    saveState();
    renderAll();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  function addToDashboard(id) {
    const arr = (state.dashboardCampaignIds || []).filter(x => x !== id);
    arr.unshift(id);
    state.dashboardCampaignIds = arr;
  }
  function removeFromDashboard(id) {
    state.dashboardCampaignIds = (state.dashboardCampaignIds || []).filter(x => x !== id);
    saveState();
    renderAll();
  }
  function toggleCampaignEnabled(id) {
    const cfg = state.campaignConfigs[id];
    if (!cfg) return;
    const wasEnabled = cfg.enabled !== false;
    cfg.enabled = !wasEnabled;
    saveState();
    renderAll();
    const c = CAMPAIGNS[id];
    const msg = wasEnabled
      ? `Paused triggers for "${c.name}". Countdown still runs; no actions will fire on expiry.`
      : `Activated triggers for "${c.name}".`;
    toast(msg, 'info', 5000, () => { cfg.enabled = wasEnabled; saveState(); renderAll(); });
  }

  // ============================================================
  // RENDER ROOT
  // ============================================================

  function renderAll() {
    if (state.view === 'campaign' && currentCampaign()) {
      document.body.setAttribute('data-cmp-type', currentCampaign().type);
    } else {
      document.body.removeAttribute('data-cmp-type');
    }
    el('dashboardView').hidden = state.view !== 'list';
    el('campaignView').hidden = state.view !== 'campaign';
    el('actionFlowView').hidden = state.view !== 'action-flow';
    el('sourceFlowView').hidden = state.view !== 'source-flow';

    const isCampaign = state.view !== 'list';
    el('bcCampaignName').hidden = !isCampaign;
    el('bcMidSep').hidden = !isCampaign;
    if (isCampaign && currentCampaign()) el('bcCampaignName').textContent = currentCampaign().name;

    if (state.view === 'list') renderDashboard();
    else if (state.view === 'campaign') renderCampaignView();
    else if (state.view === 'action-flow') renderActionFlow();
    else if (state.view === 'source-flow') renderSourceFlow();
  }

  // ============================================================
  // DASHBOARD
  // ============================================================

  function renderDashboard() {
    el('evergreenBanner').classList.toggle('is-dismissed', !!state.bannerDismissed);
    const ids = (state.dashboardCampaignIds || []).filter(id => CAMPAIGNS[id]);
    const hasAny = ids.length > 0;
    el('dashboardEmpty').hidden = hasAny;
    el('dashboardPopulated').hidden = !hasAny;
    if (hasAny) { renderDashboardList(ids); renderAddPicker(); }
  }

  function renderDashboardList(ids) {
    const list = el('dashboardList');
    list.innerHTML = ids.map(id => renderCampaignCard(id)).join('');
    const word = ids.length === 1 ? 'campaign' : 'campaigns';
    el('dashboardHeadSub').textContent = `${ids.length} ${word}`;
  }

  function renderCampaignCard(id) {
    const c = CAMPAIGNS[id];
    const status = getCampaignStatus(id);
    const disabledClass = (status.pill === 'disabled') ? ' is-disabled' : '';
    return `
      <li>
        <div class="cmp-card${disabledClass}" role="button" tabindex="0" data-type="${c.type}" data-action="open-campaign" data-id="${id}">
          <span class="cmp-card__icon" aria-hidden="true">${c.typeIcon}</span>
          <span class="cmp-card__body">
            <h3 class="cmp-card__name">${escapeHtml(c.name)}</h3>
            <div class="cmp-card__meta">${escapeHtml(c.typeLabel)} · ${escapeHtml(c.meta)}</div>
            <span class="cmp-card__count is-${status.pill}">${escapeHtml(status.summary)}</span>
          </span>
          <span class="cmp-card__pill status-pill status-pill--${status.pill}">${escapeHtml(status.label)}</span>
          <button class="icon-btn" data-action="card-menu" data-id="${id}" aria-label="More options for ${escapeHtml(c.name)}">⋯</button>
        </div>
      </li>
    `;
  }

  function openComboFor(which) {
    const input = el(which === 'empty' ? 'emptyComboInput' : 'addComboInput');
    const list = el(which === 'empty' ? 'emptyComboResults' : 'addComboResults');
    const q = (input.value || '').toLowerCase().trim();
    const onDashboard = new Set(state.dashboardCampaignIds || []);
    const all = Object.values(CAMPAIGNS);
    const candidates = which === 'empty'
      ? all.filter(c => !q || c.name.toLowerCase().includes(q))
      : all.filter(c => !onDashboard.has(c.id) && (!q || c.name.toLowerCase().includes(q)));
    if (candidates.length === 0) {
      list.innerHTML = which === 'empty'
        ? `<li class="combo-empty">No campaigns match "<strong>${escapeHtml(q)}</strong>".</li>`
        : `<li class="combo-empty">${onDashboard.size >= all.length ? 'All your campaigns are already on the dashboard.' : `No campaigns match "<strong>${escapeHtml(q)}</strong>".`}</li>`;
      list.hidden = false;
      return;
    }
    list.innerHTML = candidates.map(c => `
      <li>
        <button class="combo-result" data-type="${c.type}" data-action="${which === 'empty' ? 'pick-and-go' : 'pick-and-add'}" data-id="${c.id}">
          <span class="combo-result__icon" aria-hidden="true">${c.typeIcon}</span>
          <span class="combo-result__body">
            <span class="combo-result__name">${escapeHtml(c.name)}</span>
            <span class="combo-result__meta">${escapeHtml(c.typeLabel + ' · ' + c.meta)}</span>
          </span>
          <span class="combo-result__chevron" aria-hidden="true">›</span>
        </button>
      </li>
    `).join('');
    list.hidden = false;
  }

  function renderAddPicker() {
    el('addPicker').hidden = !state.addPickerOpen;
    if (state.addPickerOpen) openComboFor('add');
    else el('addComboResults').hidden = true;
  }

  // ============================================================
  // CAMPAIGN VIEW
  // ============================================================

  function renderCampaignView() {
    const c = currentCampaign();
    if (!c) return;
    const cfg = currentConfig();
    const status = getCampaignStatus(c.id);
    const isEvergreen = c.type === 'evergreen';

    el('cmpTitle').textContent = c.name;
    el('cmpTypeChip').querySelector('.chip-icon').textContent = c.typeIcon;
    el('cmpTypeChip').querySelector('.chip-text').textContent = c.typeLabel;
    el('cmpReadout').textContent = c.meta;

    const pill = el('cmpStatusPill');
    if (isEvergreen) {
      pill.hidden = false;
      pill.className = `status-pill status-pill--${status.pill}`;
      pill.textContent = status.label;
    } else {
      pill.hidden = true;
    }

    const isDisabled = cfg && cfg.enabled === false && isEvergreen;
    el('disabledBanner').hidden = !isDisabled;

    el('nonEvergreenExplainer').hidden = isEvergreen;
    if (!isEvergreen) {
      const why = c.type === 'fixed'
        ? 'This campaign runs on a shared deadline — when the clock hits the deadline, it ends for everyone at the same moment. There is no per-user start moment to wire a trigger source to, and no per-user expiry to fire actions on.'
        : 'This campaign runs on a repeating shared schedule — every user sees the same open window at the same time. There is no per-user start or per-user expiry to attach actions to.';
      el('nonEvergreenWhy').textContent = why;
    }

    el('evergreenBody').hidden = !isEvergreen;
    if (isEvergreen) {
      renderSourceList();
      renderActionList();
    }
  }

  function renderSourceList() {
    const cfg = currentConfig();
    const list = el('sourceList');
    if (!cfg.sources.length) {
      list.innerHTML = `<li><div class="row" style="opacity:.55"><span class="row__icon row__icon--pagevisit">👁</span><div class="row__body"><div class="row__title">No trigger sources yet</div><div class="row__detail">Without a source, the campaign won't start for any user. Click "+ Add a trigger source" below.</div></div></div></li>`;
      return;
    }
    list.innerHTML = cfg.sources.map(s => {
      const def = SOURCES[s.type];
      if (!def) return '';
      const disabledClass = s.enabled === false ? ' is-disabled' : '';
      const stateBadge = s.enabled === false ? `<span class="row__state">○ Paused</span>` : '';
      let detail = '';
      if (s.type === 'pagevisit') detail = `Starts on first visit to <code>${escapeHtml(s.config.page || '/offer')}</code>`;
      else if (s.type === 'webhook') detail = `POST to <code>${escapeHtml(s.config.endpoint || '/wp-json/tu/v1/campaigns/' + state.currentCampaignId + '/start')}</code>`;
      else if (s.type === 'leads') detail = `Triggered by form: <code>${escapeHtml(s.config.formName || 'Lead Magnet — Newsletter')}</code>`;
      return `
        <li>
          <div class="row${disabledClass}" data-source-id="${s.id}">
            <span class="row__icon row__icon--${def.iconKey}">${def.icon}</span>
            <div class="row__body">
              <div class="row__title">${escapeHtml(def.name)}${stateBadge}</div>
              <div class="row__detail">${detail}</div>
            </div>
            <div class="row__tools">
              <button class="tool-btn" data-action="edit-source" data-source-id="${s.id}">Edit</button>
              <button class="tool-btn tool-danger" data-action="remove-source" data-source-id="${s.id}">Remove</button>
            </div>
          </div>
        </li>
      `;
    }).join('');
  }

  function renderActionList() {
    const cfg = currentConfig();
    const list = el('actionList');
    if (!cfg.actions.length) {
      list.innerHTML = `<li><div class="row" style="opacity:.55"><span class="row__icon row__icon--tag">📩</span><div class="row__body"><div class="row__title">No expiry actions yet</div><div class="row__detail">Without an expiry action, nothing fires when a user's countdown ends. Click "+ Add an expiry action" below.</div></div></div></li>`;
      return;
    }
    list.innerHTML = cfg.actions.map(a => {
      const def = ACTIONS[a.type];
      if (!def) return '';
      const disabledClass = a.enabled === false ? ' is-disabled' : '';
      const stateBadge = a.enabled === false ? `<span class="row__state">○ Paused</span>` : '';
      let detail = '';
      if (a.type === 'tag') {
        const tags = (a.config.tags || []).map(t => `<code>${escapeHtml(t)}</code>`).join(', ');
        detail = `${escapeHtml(a.config.provider || 'ESP')} · ${tags}`;
      } else if (a.type === 'webhook') {
        detail = `${escapeHtml(a.config.method || 'POST')} ${escapeHtml(a.config.url || '')}`;
      }
      return `
        <li>
          <div class="row${disabledClass}" data-action-id="${a.id}">
            <span class="row__icon row__icon--${def.iconKey === 'esp' ? 'tag' : 'webhook'}">${def.icon}</span>
            <div class="row__body">
              <div class="row__title">${escapeHtml(def.name)}${stateBadge}</div>
              <div class="row__detail">${detail}</div>
            </div>
            <div class="row__tools">
              <button class="tool-btn" data-action="edit-action-item" data-action-id="${a.id}">Edit</button>
              <button class="tool-btn tool-danger" data-action="remove-action-item" data-action-id="${a.id}">Remove</button>
            </div>
          </div>
        </li>
      `;
    }).join('');
  }

  // ============================================================
  // ACTION FLOW
  // ============================================================

  function openActionFlow(editingId) {
    state.view = 'action-flow';
    state.flow.mode = 'action';
    state.flow.stage = 'picker';
    state.flow.editingId = editingId || null;
    state.flow.pickedType = null;
    state.flow.draftConfig = {};
    if (editingId) {
      const a = currentConfig().actions.find(x => x.id === editingId);
      if (a) {
        state.flow.pickedType = a.type;
        state.flow.stage = 'configure';
        state.flow.draftConfig = JSON.parse(JSON.stringify(a.config || {}));
      }
    }
    renderAll();
  }

  function renderActionFlow() {
    const c = currentCampaign();
    if (!c) return;
    el('actionEditTitle').textContent = state.flow.editingId ? 'Edit expiry action' : 'New expiry action';
    el('actionContextText').innerHTML = `On <strong>${escapeHtml(c.name)}</strong> countdown expiry <strong>without conversion</strong>`;
    el('configContextText').innerHTML = `On <strong>${escapeHtml(c.name)}</strong> countdown expiry <strong>without conversion</strong>`;
    $$('.stage', el('actionFlowView')).forEach(s => { s.hidden = true; });
    if (state.flow.stage === 'picker') {
      el('actionFlowView').querySelector('.stage-picker').hidden = false;
      renderActionPicker();
    } else if (state.flow.stage === 'configure') {
      el('actionFlowView').querySelector('.stage-configure').hidden = false;
      renderActionConfigure();
    }
  }

  function renderActionPicker() {
    const cfg = currentConfig();
    const existing = cfg.actions.filter(a => !state.flow.editingId || a.id !== state.flow.editingId);
    const usedTypes = new Set(existing.map(a => a.type));
    el('actionPicker').innerHTML = Object.values(ACTIONS).map(def => {
      const disabled = usedTypes.has(def.id);
      return `
        <button type="button" class="action-opt" data-action="pick-action-type" data-type="${def.id}" ${disabled ? 'disabled' : ''}>
          <span class="action-opt__icon action-opt__icon--${def.iconKey}" aria-hidden="true">${def.icon}</span>
          <span class="action-opt__body">
            <div class="action-opt__name">${escapeHtml(def.name)}</div>
            <div class="action-opt__desc">${escapeHtml(def.desc)}${disabled ? ' · already configured' : ''}</div>
          </span>
          <span class="action-opt__chevron" aria-hidden="true">›</span>
        </button>
      `;
    }).join('');
  }

  function renderActionConfigure() {
    const def = ACTIONS[state.flow.pickedType];
    if (!def) return;
    const pillIcon = el('actionPillIcon');
    pillIcon.textContent = def.icon;
    pillIcon.className = `action-pill__icon action-pill__icon--${def.iconKey}`;
    el('actionPillName').textContent = def.name;
    el('actionPillDesc').textContent = def.desc;
    const body = el('configureBody');
    body.innerHTML = '';
    if (state.flow.pickedType === 'tag') renderTagConfig(body);
    else if (state.flow.pickedType === 'webhook') renderWebhookConfig(body);
  }

  function renderTagConfig(body) {
    const cfg = state.flow.draftConfig;
    body.innerHTML = `
      <label class="field">
        <span class="field-label">Email service provider</span>
        <select id="cfgProvider">
          ${['FluentCRM','ActiveCampaign','Mailchimp','ConvertKit'].map(p => `<option ${cfg.provider === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span class="field-label">Tags to apply</span>
        <div class="chip-input" id="chipInput">
          ${(cfg.tags || []).map(t => `<span class="chip" data-chip="${escapeHtml(t)}">${escapeHtml(t)}<button class="chip-remove" data-action="remove-chip" data-chip="${escapeHtml(t)}">×</button></span>`).join('')}
          <input id="chipNewInput" type="text" placeholder="${(cfg.tags || []).length ? 'Add another tag…' : 'Type a tag and press Enter'}" />
        </div>
        <small class="field-help">Press Enter or comma to confirm a tag.</small>
      </label>
    `;
    el('cfgProvider').addEventListener('change', e => { state.flow.draftConfig.provider = e.target.value; });
    el('chipNewInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const v = e.target.value.trim();
        if (v) {
          state.flow.draftConfig.tags = state.flow.draftConfig.tags || [];
          if (!state.flow.draftConfig.tags.includes(v)) {
            state.flow.draftConfig.tags.push(v);
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

  // ============================================================
  // SEND WEBHOOK CONFIG (Apprentice Triggers pattern)
  // URL + Method/Format grid + Fields (key/value w/ token picker)
  // + Headers (None/Custom) + Send test
  // ============================================================
  function defaultWebhookFields() {
    return [
      { key: 'email',         value: '%email%' },
      { key: 'campaign_id',   value: '%campaign_id%' },
      { key: 'campaign_name', value: '%campaign_name%' },
      { key: 'expired_at',    value: '%expired_at%' }
    ];
  }

  function renderWebhookConfig(body) {
    const cfg = state.flow.draftConfig;
    cfg.url         = cfg.url         || '';
    cfg.method      = cfg.method      || 'POST';
    cfg.format      = cfg.format      || 'json';
    cfg.fields      = Array.isArray(cfg.fields)  ? cfg.fields  : defaultWebhookFields();
    cfg.headersMode = cfg.headersMode || 'none';
    cfg.headers     = Array.isArray(cfg.headers) ? cfg.headers : [];

    const methodOpts = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE']
      .map(m => `<option value="${m}" ${cfg.method === m ? 'selected' : ''}>${m}</option>`).join('');
    const formatOpts = [{ v:'json', label:'JSON' }, { v:'form', label:'Form' }, { v:'xml', label:'XML' }]
      .map(f => `<option value="${f.v}" ${cfg.format === f.v ? 'selected' : ''}>${f.label}</option>`).join('');

    const fieldsHtml = cfg.fields.map((f, i) => webhookRowHtml(f, i, 'fields')).join('');
    const headersHtml = cfg.headers.map((h, i) => webhookRowHtml(h, i, 'headers')).join('');
    const headersHidden = cfg.headersMode !== 'custom';

    body.innerHTML = `
      <h4 class="webhook-section-title">Webhook details</h4>

      <div class="field">
        <label class="field-label" for="hookUrl">Webhook URL</label>
        <input type="text" class="input" id="hookUrl" placeholder="https://your-tool.example.com/webhook (requires https://)" value="${escapeHtml(cfg.url)}" />
      </div>

      <div class="webhook-row-grid">
        <div class="field">
          <label class="field-label" for="hookMethod">Request type</label>
          <select class="input input--select" id="hookMethod">${methodOpts}</select>
        </div>
        <div class="field">
          <label class="field-label" for="hookFormat">Request format</label>
          <select class="input input--select" id="hookFormat">${formatOpts}</select>
        </div>
      </div>

      <div class="field">
        <label class="field-label">
          Fields
          <span class="field-label__help" title="Each row is a key/value pair sent in the request body. Use the { } picker to insert a dynamic value like the user's email.">ⓘ</span>
        </label>
        <div class="webhook-rows" id="hookFieldRows">${fieldsHtml}</div>
        <a href="#" class="webhook-add-link" data-action="add-hook-field">+ Add field</a>
      </div>

      <div class="field">
        <label class="field-label">Headers</label>
        <div class="webhook-headers-mode">
          <label class="webhook-radio">
            <input type="radio" name="hookHeadersMode" value="none" ${cfg.headersMode === 'none' ? 'checked' : ''}>
            <span>None</span>
          </label>
          <label class="webhook-radio">
            <input type="radio" name="hookHeadersMode" value="custom" ${cfg.headersMode === 'custom' ? 'checked' : ''}>
            <span>Custom</span>
          </label>
        </div>
        <div class="webhook-headers-wrap" id="hookHeadersWrap" ${headersHidden ? 'hidden' : ''}>
          <div class="webhook-rows" id="hookHeaderRows">${headersHtml}</div>
          <a href="#" class="webhook-add-link" data-action="add-hook-header">+ Add header</a>
        </div>
      </div>

      <div class="field webhook-test-field">
        <button type="button" class="btn-icon" data-action="hook-send-test" id="hookTestBtn">Send test</button>
        <span class="webhook-test-status" id="hookTestStatus" hidden>
          <span class="webhook-test-status__dot" aria-hidden="true"></span>
          <span class="webhook-test-status__text"></span>
          <a href="#" class="webhook-test-status__details" data-action="hook-test-details" hidden>Details</a>
        </span>
      </div>
      <p class="field-help">If the URL fails, we'll log it — your other expiry actions still run.</p>
    `;

    el('hookUrl').addEventListener('input', e => { cfg.url = e.target.value.trim(); clearTestStatus(); });
    el('hookMethod').addEventListener('change', e => { cfg.method = e.target.value; clearTestStatus(); });
    el('hookFormat').addEventListener('change', e => { cfg.format = e.target.value; clearTestStatus(); });
    document.querySelectorAll('input[name="hookHeadersMode"]').forEach(r => {
      r.addEventListener('change', e => {
        cfg.headersMode = e.target.value;
        if (cfg.headersMode === 'custom' && cfg.headers.length === 0) {
          cfg.headers = [{ key: '', value: '' }];
        }
        renderWebhookConfig(body);
      });
    });
    wireWebhookRowInputs(el('hookFieldRows'), 'fields');
    wireWebhookRowInputs(el('hookHeaderRows'), 'headers');
  }

  function webhookRowHtml(row, i, listKey) {
    return `
      <div class="webhook-row" data-row-index="${i}" data-row-list="${listKey}">
        <input type="text" class="input webhook-row__key" placeholder="Key" value="${escapeHtml(row.key || '')}" data-row-input="key" data-row-index="${i}" data-row-list="${listKey}">
        <span class="webhook-row__op" aria-hidden="true">=</span>
        <div class="webhook-row__value-wrap">
          <input type="text" class="input webhook-row__value" placeholder="Value" value="${escapeHtml(row.value || '')}" data-row-input="value" data-row-index="${i}" data-row-list="${listKey}">
          <button type="button" class="webhook-row__picker" data-action="open-token-picker" data-row-list="${listKey}" data-row-index="${i}" title="Insert a dynamic value" aria-label="Insert a dynamic value">{ }</button>
        </div>
        <button type="button" class="webhook-row__remove" data-action="${listKey === 'fields' ? 'remove-hook-field' : 'remove-hook-header'}" data-row-index="${i}" aria-label="Remove row">×</button>
      </div>
    `;
  }
  function wireWebhookRowInputs(container, listKey) {
    if (!container) return;
    container.querySelectorAll('input[data-row-input]').forEach(inp => {
      inp.addEventListener('input', e => {
        const which = e.target.dataset.rowInput;
        const idx = parseInt(e.target.dataset.rowIndex, 10);
        const list = state.flow.draftConfig[listKey] || [];
        if (!list[idx]) return;
        list[idx][which] = e.target.value;
        clearTestStatus();
      });
    });
  }
  function clearTestStatus() {
    const s = document.getElementById('hookTestStatus');
    if (!s) return;
    s.hidden = true;
    s.classList.remove('webhook-test-status--ok', 'webhook-test-status--err');
    const txt = s.querySelector('.webhook-test-status__text');
    if (txt) txt.textContent = '';
    const det = s.querySelector('.webhook-test-status__details');
    if (det) det.hidden = true;
    state.lastTest = null;
  }

  // Available tokens for the Expiry-Action webhook context
  const WEBHOOK_TOKENS = [
    { token: '%email%',         desc: 'The user\'s email address (from their first form submission or webhook payload).' },
    { token: '%user_id%',       desc: 'WordPress user ID, if the user is registered.' },
    { token: '%campaign_id%',   desc: 'The Ultimatum campaign\'s internal ID.' },
    { token: '%campaign_name%', desc: 'The Ultimatum campaign\'s human-readable name.' },
    { token: '%started_at%',    desc: 'ISO 8601 timestamp when this user\'s countdown started.' },
    { token: '%expired_at%',    desc: 'ISO 8601 timestamp when this user\'s countdown expired.' }
  ];

  let tokenPickerTarget = null; // { listKey, index }
  function openTokenPicker(listKey, index, anchor) {
    tokenPickerTarget = { listKey, index };
    const pop = el('cardPopover');
    pop.innerHTML = WEBHOOK_TOKENS.map(t => `
      <button class="popover__item" data-action="insert-token" data-token="${escapeHtml(t.token)}">
        <code style="font-weight:600">${escapeHtml(t.token)}</code>
        <small style="display:block;color:var(--ink-3);margin-top:2px">${escapeHtml(t.desc)}</small>
      </button>
    `).join('');
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${r.bottom + window.scrollY + 6}px`;
    pop.style.left = `${Math.max(8, r.right - 320 + window.scrollX)}px`;
    pop.style.minWidth = '320px';
  }
  function insertToken(token) {
    if (!tokenPickerTarget) return;
    const { listKey, index } = tokenPickerTarget;
    const list = state.flow.draftConfig[listKey] || [];
    if (!list[index]) return;
    list[index].value = ((list[index].value || '') + token).trim();
    closePopover();
    tokenPickerTarget = null;
    renderWebhookConfig(el('configureBody'));
  }

  function runWebhookTest() {
    const cfg = state.flow.draftConfig;
    if (!cfg.url || !/^https?:\/\//.test(cfg.url)) {
      toast('Enter a valid URL (starting with https://) before testing.', 'error', 4500);
      el('hookUrl')?.focus();
      return;
    }
    const btn = el('hookTestBtn');
    const status = el('hookTestStatus');
    const text = status.querySelector('.webhook-test-status__text');
    const details = status.querySelector('.webhook-test-status__details');
    btn.disabled = true; btn.textContent = 'Sending…';
    status.hidden = false;
    status.classList.remove('webhook-test-status--ok', 'webhook-test-status--err');
    if (text) text.textContent = 'Sending sample payload to your endpoint…';
    if (details) details.hidden = true;
    const startedAt = Date.now();
    setTimeout(() => {
      const duration = Date.now() - startedAt;
      const ok = true; // prototype always succeeds; in production this hits the URL
      state.lastTest = {
        ok, statusCode: 200, statusText: 'OK', method: cfg.method, url: cfg.url, duration: `${duration}ms`,
        body: JSON.stringify({ ok: true, received: true, campaign_id: state.currentCampaignId }, null, 2),
        error: null
      };
      btn.disabled = false; btn.textContent = 'Send test';
      status.classList.add(ok ? 'webhook-test-status--ok' : 'webhook-test-status--err');
      if (text) text.textContent = ok ? `Sample payload accepted (200 OK · ${duration}ms)` : 'Test failed';
      if (details) details.hidden = false;
    }, 800);
  }
  function openTestDetails() {
    const t = state.lastTest;
    if (!t) return;
    askConfirm('Webhook test details', `Status: ${t.statusCode} ${t.statusText}\nMethod: ${t.method}\nEndpoint: ${t.url}\nDuration: ${t.duration}\n\nResponse:\n${t.body}`, null);
    // Re-purpose confirm modal for read-only display — hide the Remove button
    const rm = el('confirmRemoveBtn');
    if (rm) { rm.textContent = 'Close'; rm.classList.remove('btn--danger'); rm.classList.add('btn--ghost'); }
  }

  function saveAction() {
    const cfg = currentConfig();
    const t = state.flow.pickedType;
    const c = state.flow.draftConfig;
    if (t === 'tag' && (!c.tags || !c.tags.length)) { toast('Add at least one tag before saving.', 'error', 3500); return; }
    if (t === 'webhook' && (!c.url || !/^https?:\/\//.test(c.url))) { toast('Webhook URL must start with http:// or https://', 'error', 3500); return; }
    if (state.flow.editingId) {
      const i = cfg.actions.findIndex(a => a.id === state.flow.editingId);
      if (i >= 0) cfg.actions[i] = { ...cfg.actions[i], type: t, config: c };
    } else {
      cfg.actions.push({ id: 'a-' + Date.now(), type: t, enabled: true, config: c });
    }
    saveState();
    state.view = 'campaign';
    renderAll();
    toast('Expiry action saved.', 'ok', 2400);
  }

  // ============================================================
  // SOURCE FLOW
  // ============================================================

  function openSourceFlow(editingId) {
    state.view = 'source-flow';
    state.flow.mode = 'source';
    state.flow.stage = 'picker';
    state.flow.editingId = editingId || null;
    state.flow.pickedType = null;
    state.flow.draftConfig = {};
    if (editingId) {
      const s = currentConfig().sources.find(x => x.id === editingId);
      if (s) {
        state.flow.pickedType = s.type;
        state.flow.stage = 'configure';
        state.flow.draftConfig = JSON.parse(JSON.stringify(s.config || {}));
      }
    }
    renderAll();
  }

  function renderSourceFlow() {
    el('sourceEditTitle').textContent = state.flow.editingId ? 'Edit trigger source' : 'Add a trigger source';
    el('sourcePicker').hidden = state.flow.stage !== 'picker';
    el('sourceConfigStage').hidden = state.flow.stage !== 'configure';
    if (state.flow.stage === 'picker') renderSourcePicker();
    else if (state.flow.stage === 'configure') renderSourceConfigure();
  }

  function renderSourcePicker() {
    const cfg = currentConfig();
    const existing = cfg.sources.filter(s => !state.flow.editingId || s.id !== state.flow.editingId);
    const usedTypes = new Set(existing.map(s => s.type));
    el('sourcePicker').innerHTML = Object.values(SOURCES).map(def => {
      const disabled = usedTypes.has(def.id);
      return `
        <button type="button" class="action-opt" data-action="pick-source-type" data-type="${def.id}" ${disabled ? 'disabled' : ''}>
          <span class="action-opt__icon action-opt__icon--${def.iconKey}" aria-hidden="true">${def.icon}</span>
          <span class="action-opt__body">
            <div class="action-opt__name">${escapeHtml(def.name)}</div>
            <div class="action-opt__desc">${escapeHtml(def.desc)}${disabled ? ' · already configured' : ''}</div>
          </span>
          <span class="action-opt__chevron" aria-hidden="true">›</span>
        </button>
      `;
    }).join('');
  }

  function renderSourceConfigure() {
    const def = SOURCES[state.flow.pickedType];
    if (!def) return;
    const pillIcon = el('sourcePillIcon');
    pillIcon.textContent = def.icon;
    pillIcon.className = `action-pill__icon action-pill__icon--${def.iconKey}`;
    el('sourcePillName').textContent = def.name;
    el('sourcePillDesc').textContent = def.desc;
    const body = el('sourceConfigBody');
    body.innerHTML = '';
    if (state.flow.pickedType === 'pagevisit') renderPageVisitConfig(body);
    else if (state.flow.pickedType === 'webhook') renderWebhookSourceConfig(body);
    else if (state.flow.pickedType === 'leads') renderLeadsConfig(body);
  }

  function renderPageVisitConfig(body) {
    const cfg = state.flow.draftConfig;
    body.innerHTML = `
      <label class="field">
        <span class="field-label">Page path</span>
        <input type="text" id="cfgPage" placeholder="/offer or /thank-you" value="${escapeHtml(cfg.page || '')}" />
        <small class="field-help">The countdown starts when a user first visits this page (per-user, recorded with a long-lived cookie).</small>
      </label>
    `;
    el('cfgPage').addEventListener('input', e => { state.flow.draftConfig.page = e.target.value; });
  }

  function renderWebhookSourceConfig(body) {
    const id = state.currentCampaignId;
    const cfg = state.flow.draftConfig;
    cfg.endpoint = cfg.endpoint || `/wp-json/tu/v1/campaigns/${id}/start`;
    cfg.headerName = cfg.headerName || 'X-Campaign-Secret';
    cfg.secret = cfg.secret || ('camp_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10));
    cfg.authMode = cfg.authMode || 'shared';
    cfg.rateLimit = cfg.rateLimit || '60';
    cfg.secretRevealed = !!cfg.secretRevealed;

    body.innerHTML = `
      <!-- Connection card — the user's one-trip-to-the-external-tool surface -->
      <div class="connection-card">
        <h4 class="connection-card__title">Connection details for your external system</h4>

        <label class="field-label" for="cmpEndpoint">Endpoint URL</label>
        <div class="input-group">
          <input type="text" class="input input--mono" id="cmpEndpoint" readonly value="${escapeHtml(cfg.endpoint)}" />
          <button type="button" class="btn-icon" data-action="copy-endpoint">📋 Copy</button>
        </div>

        <label class="field-label field-label--spaced" for="cmpHeaderName">Header name</label>
        <div class="input-group">
          <input type="text" class="input input--mono" id="cmpHeaderName" value="${escapeHtml(cfg.headerName)}" />
          <button type="button" class="btn-icon" data-action="copy-header-name">📋 Copy</button>
        </div>

        <label class="field-label field-label--spaced" for="cmpSecret">Signing secret <span class="field-label__sub">(value for the header above)</span></label>
        <div class="input-group">
          <input type="${cfg.secretRevealed ? 'text' : 'password'}" class="input input--mono" id="cmpSecret" readonly value="${escapeHtml(cfg.secret)}" />
          <button type="button" class="btn-icon" data-action="toggle-secret">${cfg.secretRevealed ? '🙈 Hide' : '👁 Reveal'}</button>
          <button type="button" class="btn-icon" data-action="copy-secret">📋 Copy</button>
          <button type="button" class="btn-icon" data-action="regen-secret" title="Generate a new secret">🔄 Regenerate</button>
        </div>

        <p class="connection-card__hint">
          In your external tool: paste the <strong>Endpoint URL</strong> into its webhook URL field, then add a custom header with the <strong>Header name</strong> and <strong>Signing secret</strong> above as the name/value pair. POST a body like <code>{ "email": "user@example.com" }</code> to start the countdown for that user.
        </p>
      </div>

      <!-- Advanced security disclosure — collapsed by default -->
      <div class="advanced-sec">
        <div class="advanced-sec__collapsed" id="advancedSecCollapsed">
          <button type="button" class="text-link text-link--primary" data-action="open-advanced-sec">+ Change security mode or rate limit</button>
          <span class="advanced-sec__hint">Shared Secret &amp; 60 requests/min by default — fine for most users</span>
        </div>

        <div class="advanced-sec__expanded" id="advancedSecExpanded" hidden>
          <div class="advanced-sec__head">
            <span class="advanced-sec__head-title">Advanced security</span>
            <button type="button" class="text-link text-link--muted" data-action="close-advanced-sec">Hide advanced</button>
          </div>

          <p class="advanced-sec__label">How should we verify incoming requests are legitimate?</p>
          <div class="radio-options">
            <label class="radio-option ${cfg.authMode === 'none' ? 'radio-option--selected' : ''}">
              <input type="radio" name="cmpAuthMode" value="none" data-action="auth-mode" ${cfg.authMode === 'none' ? 'checked' : ''} />
              <div class="radio-option__body">
                <div class="radio-option__title">None</div>
                <div class="radio-option__desc">Anyone with the endpoint URL can start the countdown for any user.</div>
                <div class="radio-option__warn">⚠ Only use for internal tools or low-risk integrations.</div>
              </div>
            </label>

            <label class="radio-option ${cfg.authMode === 'shared' ? 'radio-option--selected' : ''}">
              <input type="radio" name="cmpAuthMode" value="shared" data-action="auth-mode" ${cfg.authMode === 'shared' ? 'checked' : ''} />
              <div class="radio-option__body">
                <div class="radio-option__title">Shared Secret <span class="badge badge--recommended">Recommended</span></div>
                <div class="radio-option__desc">Sender must include the matching secret in a header. Works with Stripe, ThriveCart, SamCart, and most CRMs.</div>
              </div>
            </label>

            <label class="radio-option ${cfg.authMode === 'hmac' ? 'radio-option--selected' : ''}">
              <input type="radio" name="cmpAuthMode" value="hmac" data-action="auth-mode" ${cfg.authMode === 'hmac' ? 'checked' : ''} />
              <div class="radio-option__body">
                <div class="radio-option__title">HMAC-SHA256 <span class="badge badge--pro">Advanced</span></div>
                <div class="radio-option__desc">Payload is cryptographically signed. Recommended for Stripe, GitHub, and enterprise integrations.</div>
              </div>
            </label>
          </div>

          <hr class="advanced-sec__divider" />

          <label class="field-label" for="cmpRateLimit">Rate limit</label>
          <select class="input input--sm" id="cmpRateLimit" data-action="rate-limit">
            <option value="30" ${cfg.rateLimit === '30' ? 'selected' : ''}>30 requests per minute</option>
            <option value="60" ${cfg.rateLimit === '60' ? 'selected' : ''}>60 requests per minute (default)</option>
            <option value="120" ${cfg.rateLimit === '120' ? 'selected' : ''}>120 requests per minute</option>
            <option value="600" ${cfg.rateLimit === '600' ? 'selected' : ''}>600 requests per minute (high-volume)</option>
          </select>
          <p class="field-help">Requests above this limit return 429 Too Many Requests.</p>
        </div>
      </div>
    `;

    // Persist header-name edits
    const h = el('cmpHeaderName');
    if (h) h.addEventListener('input', e => { cfg.headerName = e.target.value; });
  }

  function renderLeadsConfig(body) {
    const cfg = state.flow.draftConfig;
    body.innerHTML = `
      <label class="field">
        <span class="field-label">Thrive Leads form</span>
        <select id="cfgForm">
          <option value="">Pick a form…</option>
          <option ${cfg.formName === 'Lead Magnet — Newsletter' ? 'selected' : ''}>Lead Magnet — Newsletter</option>
          <option ${cfg.formName === 'Footer Opt-in' ? 'selected' : ''}>Footer Opt-in</option>
          <option ${cfg.formName === 'Exit Intent Popup' ? 'selected' : ''}>Exit Intent Popup</option>
        </select>
        <small class="field-help">The countdown starts when a user submits this form for the first time.</small>
      </label>
    `;
    el('cfgForm').addEventListener('change', e => { state.flow.draftConfig.formName = e.target.value; });
  }

  function saveSource() {
    const cfg = currentConfig();
    const t = state.flow.pickedType;
    const c = state.flow.draftConfig;
    if (t === 'pagevisit' && !c.page) { toast('Enter a page path.', 'error', 3500); return; }
    if (t === 'leads' && !c.formName) { toast('Pick a Thrive Leads form.', 'error', 3500); return; }
    if (state.flow.editingId) {
      const i = cfg.sources.findIndex(s => s.id === state.flow.editingId);
      if (i >= 0) cfg.sources[i] = { ...cfg.sources[i], type: t, config: c };
    } else {
      cfg.sources.push({ id: 's-' + Date.now(), type: t, enabled: true, config: c });
    }
    saveState();
    state.view = 'campaign';
    renderAll();
    toast('Trigger source saved.', 'ok', 2400);
  }

  // ============================================================
  // POPOVER
  // ============================================================

  let popoverFor = null;
  function openPopover(id, anchor) {
    popoverFor = id;
    const c = CAMPAIGNS[id];
    const cfg = state.campaignConfigs[id];
    const isEvergreen = c.type === 'evergreen';
    const isDisabled = cfg.enabled === false;
    const items = [`<button class="popover__item" data-action="pop-open">✏️ Open setup</button>`];
    if (isEvergreen) {
      items.push(isDisabled
        ? `<button class="popover__item" data-action="pop-toggle">▶ Activate triggers</button>`
        : `<button class="popover__item" data-action="pop-toggle">⏸ Disable triggers</button>`
      );
    }
    items.push(`<div class="popover__divider"></div>`);
    items.push(`<button class="popover__item popover__item--danger" data-action="pop-remove">🗑 Remove from dashboard</button>`);
    const pop = el('cardPopover');
    pop.innerHTML = items.join('');
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${r.bottom + window.scrollY + 6}px`;
    pop.style.left = `${r.right - 220 + window.scrollX}px`;
  }
  function closePopover() {
    el('cardPopover').hidden = true;
    popoverFor = null;
  }

  // ============================================================
  // CONFIRM + TOASTS
  // ============================================================

  let pendingConfirm = null;
  function askConfirm(title, body, fn) {
    el('confirmTitle').textContent = title;
    el('confirmBody').textContent = body;
    pendingConfirm = fn;
    el('confirmModal').hidden = false;
  }
  function closeConfirm() {
    el('confirmModal').hidden = true;
    pendingConfirm = null;
  }
  function toast(msg, kind, duration, undoFn) {
    kind = kind || 'info';
    duration = duration || 2400;
    const rail = el('toastRail');
    const node = document.createElement('div');
    node.className = `toast toast-${kind}`;
    node.innerHTML = `<span>${escapeHtml(msg)}</span>` + (undoFn ? `<button class="toast-undo">Undo</button>` : '');
    rail.appendChild(node);
    if (undoFn) node.querySelector('.toast-undo').addEventListener('click', () => { undoFn(); node.remove(); });
    setTimeout(() => node.remove(), duration);
  }

  // ============================================================
  // EVENTS
  // ============================================================

  function attachEvents() {
    el('resetDemo').addEventListener('click', () => {
      if (!confirm('Reset prototype state? Demo changes will be cleared.')) return;
      localStorage.removeItem(STORAGE_KEY);
      state.dashboardCampaignIds = [];
      state.campaignConfigs = {};
      state.bannerDismissed = false;
      state.view = 'list';
      state.currentCampaignId = null;
      seedDefaults();
      saveState();
      renderAll();
    });

    document.addEventListener('click', e => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const action = a.getAttribute('data-action');

      if (action === 'go-list') { e.preventDefault(); goToList(); return; }
      if (action === 'open-campaign') { e.preventDefault(); goToCampaign(a.getAttribute('data-id')); return; }
      if (action === 'pick-and-go') { e.preventDefault(); goToCampaign(a.getAttribute('data-id')); return; }
      if (action === 'pick-and-add') { e.preventDefault(); state.addPickerOpen = false; goToCampaign(a.getAttribute('data-id')); return; }
      if (action === 'card-menu') { e.preventDefault(); e.stopPropagation(); const id = a.getAttribute('data-id'); if (popoverFor === id) closePopover(); else openPopover(id, a); return; }
      if (action === 'pop-open') { e.preventDefault(); const id = popoverFor; closePopover(); if (id) goToCampaign(id); return; }
      if (action === 'pop-toggle') { e.preventDefault(); const id = popoverFor; closePopover(); if (id) toggleCampaignEnabled(id); return; }
      if (action === 'pop-remove') {
        e.preventDefault();
        const id = popoverFor; closePopover();
        if (!id) return;
        const c = CAMPAIGNS[id];
        askConfirm(`Remove "${c.name}" from your dashboard?`, 'Your configured trigger sources and expiry actions are kept — they just stop appearing on this dashboard. Re-add the campaign any time.', () => {
          removeFromDashboard(id);
          toast(`Removed "${c.name}".`, 'info', 5000, () => { addToDashboard(id); saveState(); renderAll(); });
        });
        return;
      }
      if (action === 'activate-from-banner') { e.preventDefault(); toggleCampaignEnabled(state.currentCampaignId); return; }
      if (action === 'dismiss-banner') { e.preventDefault(); state.bannerDismissed = true; saveState(); renderDashboard(); return; }
      if (action === 'toggle-add-picker') { e.preventDefault(); state.addPickerOpen = !state.addPickerOpen; renderAddPicker(); if (state.addPickerOpen) setTimeout(() => el('addComboInput').focus(), 0); return; }
      if (action === 'close-add-picker') { e.preventDefault(); state.addPickerOpen = false; renderAddPicker(); return; }
      if (action === 'add-source') { e.preventDefault(); openSourceFlow(); return; }
      if (action === 'edit-source') { e.preventDefault(); openSourceFlow(a.getAttribute('data-source-id')); return; }
      if (action === 'remove-source') {
        e.preventDefault();
        const id = a.getAttribute('data-source-id');
        askConfirm('Remove this trigger source?', 'The campaign will no longer start for users via this source. You can undo for 5 seconds.', () => {
          const cfg = currentConfig();
          const i = cfg.sources.findIndex(s => s.id === id);
          if (i >= 0) {
            const removed = cfg.sources.splice(i, 1)[0];
            saveState(); renderAll();
            toast('Source removed.', 'info', 5000, () => { cfg.sources.splice(i, 0, removed); saveState(); renderAll(); });
          }
        });
        return;
      }
      if (action === 'add-action') { e.preventDefault(); openActionFlow(); return; }
      if (action === 'edit-action-item') { e.preventDefault(); openActionFlow(a.getAttribute('data-action-id')); return; }
      if (action === 'remove-action-item') {
        e.preventDefault();
        const id = a.getAttribute('data-action-id');
        askConfirm('Remove this expiry action?', 'It will stop firing on countdown expiry. Undo available for 5 seconds.', () => {
          const cfg = currentConfig();
          const i = cfg.actions.findIndex(x => x.id === id);
          if (i >= 0) {
            const removed = cfg.actions.splice(i, 1)[0];
            saveState(); renderAll();
            toast('Action removed.', 'info', 5000, () => { cfg.actions.splice(i, 0, removed); saveState(); renderAll(); });
          }
        });
        return;
      }
      if (action === 'pick-action-type') {
        e.preventDefault();
        if (a.disabled) return;
        state.flow.pickedType = a.getAttribute('data-type');
        state.flow.stage = 'configure';
        state.flow.draftConfig = state.flow.pickedType === 'tag' ? { provider: 'FluentCRM', tags: [] } : { method: 'POST', url: '' };
        renderAll();
        return;
      }
      if (action === 'pick-source-type') {
        e.preventDefault();
        if (a.disabled) return;
        state.flow.pickedType = a.getAttribute('data-type');
        state.flow.stage = 'configure';
        state.flow.draftConfig = state.flow.pickedType === 'pagevisit' ? { page: '/offer' } : (state.flow.pickedType === 'leads' ? { formName: '' } : {});
        renderAll();
        return;
      }
      if (action === 'change-action' || action === 'change-source') { e.preventDefault(); state.flow.stage = 'picker'; state.flow.pickedType = null; renderAll(); return; }
      if (action === 'back-to-campaign') { e.preventDefault(); state.view = 'campaign'; renderAll(); return; }
      if (action === 'add-delay') { e.preventDefault(); el('timingCollapsed').hidden = true; el('timingExpanded').hidden = false; return; }
      if (action === 'remove-delay') { e.preventDefault(); el('timingCollapsed').hidden = false; el('timingExpanded').hidden = true; return; }
      if (action === 'add-condition') { e.preventDefault(); el('conditionCollapsed').hidden = true; el('conditionExpanded').hidden = false; return; }
      if (action === 'remove-condition') { e.preventDefault(); el('conditionCollapsed').hidden = false; el('conditionExpanded').hidden = true; return; }
      if (action === 'remove-chip') {
        const chip = a.getAttribute('data-chip');
        state.flow.draftConfig.tags = (state.flow.draftConfig.tags || []).filter(t => t !== chip);
        renderTagConfig(el('configureBody'));
        return;
      }
      if (action === 'cancel-confirm') { e.preventDefault(); closeConfirm(); return; }

      // Connection card + advanced security handlers
      if (action === 'copy-endpoint') {
        e.preventDefault();
        const v = el('cmpEndpoint').value;
        navigator.clipboard?.writeText(v).then(() => toast('Endpoint URL copied.', 'ok', 2200));
        return;
      }
      if (action === 'copy-header-name') {
        e.preventDefault();
        const v = el('cmpHeaderName').value;
        navigator.clipboard?.writeText(v).then(() => toast('Header name copied.', 'ok', 2200));
        return;
      }
      if (action === 'copy-secret') {
        e.preventDefault();
        const v = el('cmpSecret').value;
        navigator.clipboard?.writeText(v).then(() => toast('Signing secret copied. Keep it private.', 'ok', 2400));
        return;
      }
      if (action === 'toggle-secret') {
        e.preventDefault();
        state.flow.draftConfig.secretRevealed = !state.flow.draftConfig.secretRevealed;
        renderWebhookSourceConfig(el('sourceConfigBody'));
        return;
      }
      if (action === 'regen-secret') {
        e.preventDefault();
        if (!confirm('Regenerate the signing secret? Any system using the old one will start failing immediately.')) return;
        state.flow.draftConfig.secret = 'camp_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
        renderWebhookSourceConfig(el('sourceConfigBody'));
        toast('New secret generated. Update any external systems using the old one.', 'info', 5000);
        return;
      }
      if (action === 'open-advanced-sec') {
        e.preventDefault();
        el('advancedSecCollapsed').hidden = true;
        el('advancedSecExpanded').hidden = false;
        return;
      }
      if (action === 'close-advanced-sec') {
        e.preventDefault();
        el('advancedSecCollapsed').hidden = false;
        el('advancedSecExpanded').hidden = true;
        return;
      }
      if (action === 'auth-mode') {
        // Radio inputs — read fresh from the DOM via the parent label
        const v = a.value;
        state.flow.draftConfig.authMode = v;
        // Re-render to reflect the selected styling on the radio-option labels
        renderWebhookSourceConfig(el('sourceConfigBody'));
        // Keep the advanced disclosure expanded (since the user is mid-edit)
        el('advancedSecCollapsed').hidden = true;
        el('advancedSecExpanded').hidden = false;
        return;
      }
      if (action === 'rate-limit') {
        state.flow.draftConfig.rateLimit = a.value;
        return;
      }

      // Send Webhook configurator actions
      if (action === 'add-hook-field') {
        e.preventDefault();
        state.flow.draftConfig.fields = state.flow.draftConfig.fields || [];
        state.flow.draftConfig.fields.push({ key: '', value: '' });
        renderWebhookConfig(el('configureBody'));
        return;
      }
      if (action === 'remove-hook-field') {
        e.preventDefault();
        const i = parseInt(a.getAttribute('data-row-index'), 10);
        state.flow.draftConfig.fields.splice(i, 1);
        renderWebhookConfig(el('configureBody'));
        return;
      }
      if (action === 'add-hook-header') {
        e.preventDefault();
        state.flow.draftConfig.headers = state.flow.draftConfig.headers || [];
        state.flow.draftConfig.headers.push({ key: '', value: '' });
        renderWebhookConfig(el('configureBody'));
        return;
      }
      if (action === 'remove-hook-header') {
        e.preventDefault();
        const i = parseInt(a.getAttribute('data-row-index'), 10);
        state.flow.draftConfig.headers.splice(i, 1);
        renderWebhookConfig(el('configureBody'));
        return;
      }
      if (action === 'open-token-picker') {
        e.preventDefault();
        e.stopPropagation();
        const listKey = a.getAttribute('data-row-list');
        const idx = parseInt(a.getAttribute('data-row-index'), 10);
        openTokenPicker(listKey, idx, a);
        return;
      }
      if (action === 'insert-token') {
        e.preventDefault();
        insertToken(a.getAttribute('data-token'));
        return;
      }
      if (action === 'hook-send-test') { e.preventDefault(); runWebhookTest(); return; }
      if (action === 'hook-test-details') { e.preventDefault(); openTestDetails(); return; }
    });

    el('saveActionBtn').addEventListener('click', saveAction);
    el('saveSourceBtn').addEventListener('click', saveSource);
    el('confirmRemoveBtn').addEventListener('click', () => { if (pendingConfirm) pendingConfirm(); closeConfirm(); });

    const empty = el('emptyComboInput');
    empty.addEventListener('focus', () => { state.emptyComboOpen = true; openComboFor('empty'); });
    empty.addEventListener('input', () => openComboFor('empty'));
    empty.addEventListener('blur', () => setTimeout(() => { state.emptyComboOpen = false; el('emptyComboResults').hidden = true; }, 200));

    const addInput = el('addComboInput');
    addInput.addEventListener('input', () => openComboFor('add'));

    document.addEventListener('click', e => {
      if (!popoverFor) return;
      if (e.target.closest('#cardPopover')) return;
      if (e.target.closest('[data-action="card-menu"]')) return;
      closePopover();
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!el('confirmModal').hidden) { closeConfirm(); return; }
      if (popoverFor) { closePopover(); return; }
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.cmp-card[data-action="open-campaign"]');
      if (!card) return;
      e.preventDefault();
      goToCampaign(card.getAttribute('data-id'));
    });
  }

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
