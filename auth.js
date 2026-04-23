/* ============================================================
   Thrive Automator Wireframes — client-side access gate
   ------------------------------------------------------------
   This is obscurity, not security. The files are still served
   publicly by GitHub Pages; a determined snooper can bypass the
   gate via DevTools or curl. Its purpose is to keep the link
   out of casual hands — not to protect cryptographic secrets.

   Only the SHA-256 hash of the password is stored here. The
   plaintext password is shared out-of-band (Slack / email).
   ============================================================ */

(function () {
  'use strict';

  // SHA-256 of the shared password. Never commit the plaintext.
  var PASSWORD_HASH = 'ea94f5a217bb302bf23416fb752012275b6cc2abf5011fc0d223c8489f78830e';

  // Shared across all three pages — logging in once unlocks everything.
  var LS_KEY = 'tva_wireframes_auth_v1';

  // Fast path: already authed → do nothing, page renders normally.
  try {
    if (localStorage.getItem(LS_KEY) === PASSWORD_HASH) {
      return;
    }
  } catch (e) {
    // localStorage unavailable (private mode, etc.) — fall through to gate.
  }

  // Hide existing body content immediately via injected CSS.
  // This fires before the body parses, minimising any flash of content.
  var hideStyle = document.createElement('style');
  hideStyle.id = '__tva_gate_hide';
  hideStyle.textContent = 'body > *:not(#__tva_gate){display:none !important;}';
  (document.head || document.documentElement).appendChild(hideStyle);

  // Gate styling. Inline so we don't depend on a separate file loading.
  var gateStyle = document.createElement('style');
  gateStyle.id = '__tva_gate_css';
  gateStyle.textContent =
    '#__tva_gate{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;' +
    'background:#1a1a2e;color:#ecf0f1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'padding:24px;}' +
    '#__tva_gate .card{background:#242845;border:1px solid #3a3f5c;border-radius:12px;' +
    'padding:36px 32px;max-width:400px;width:100%;box-shadow:0 20px 48px rgba(0,0,0,.4);}' +
    '#__tva_gate .logo{width:48px;height:48px;margin:0 auto 20px;border-radius:10px;' +
    'background:linear-gradient(135deg,#e67e22 0%,#2980b9 100%);display:flex;align-items:center;' +
    'justify-content:center;font-size:24px;font-weight:700;color:#fff;}' +
    '#__tva_gate h1{font-size:18px;font-weight:600;margin:0 0 6px;text-align:center;letter-spacing:-.2px;}' +
    '#__tva_gate p{margin:0 0 24px;text-align:center;font-size:13px;color:#95a5a6;line-height:1.5;}' +
    '#__tva_gate label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;' +
    'letter-spacing:.4px;color:#7f8c8d;margin-bottom:6px;}' +
    '#__tva_gate input{width:100%;padding:12px 14px;border:1px solid #3a3f5c;border-radius:8px;' +
    'background:#1a1a2e;color:#ecf0f1;font-size:14px;font-family:inherit;' +
    'transition:border-color .15s ease,box-shadow .15s ease;box-sizing:border-box;}' +
    '#__tva_gate input:focus{outline:none;border-color:#e67e22;box-shadow:0 0 0 3px rgba(230,126,34,.2);}' +
    '#__tva_gate button{width:100%;margin-top:16px;padding:12px 18px;background:#e67e22;color:#fff;' +
    'border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;' +
    'transition:background .15s ease;}' +
    '#__tva_gate button:hover{background:#d35400;}' +
    '#__tva_gate button:disabled{opacity:.6;cursor:not-allowed;}' +
    '#__tva_gate .err{margin-top:12px;padding:8px 12px;border-radius:6px;background:rgba(231,76,60,.15);' +
    'border:1px solid rgba(231,76,60,.4);color:#e74c3c;font-size:12px;text-align:center;}' +
    '#__tva_gate .err[hidden]{display:none;}' +
    '#__tva_gate .foot{margin-top:20px;padding-top:16px;border-top:1px solid #3a3f5c;' +
    'font-size:11px;color:#7f8c8d;text-align:center;line-height:1.5;}';
  (document.head || document.documentElement).appendChild(gateStyle);

  // Build the gate DOM once the body exists.
  function buildGate() {
    if (document.getElementById('__tva_gate')) return;

    var overlay = document.createElement('div');
    overlay.id = '__tva_gate';
    overlay.innerHTML =
      '<div class="card">' +
        '<div class="logo">⌘</div>' +
        '<h1>Thrive Automator · Phase 2 Prototypes</h1>' +
        '<p>Enter the shared access password to preview the wireframes.</p>' +
        '<form id="__tva_gate_form" autocomplete="off">' +
          '<label for="__tva_gate_pw">Access password</label>' +
          '<input type="password" id="__tva_gate_pw" autocomplete="current-password" autofocus required>' +
          '<div class="err" id="__tva_gate_err" hidden>That password didn\'t match. Try again.</div>' +
          '<button type="submit" id="__tva_gate_btn">Unlock</button>' +
        '</form>' +
        '<div class="foot">Private preview for internal review.<br>Ask Saif for the password if you don\'t have it.</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var form = document.getElementById('__tva_gate_form');
    var input = document.getElementById('__tva_gate_pw');
    var err = document.getElementById('__tva_gate_err');
    var btn = document.getElementById('__tva_gate_btn');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var pw = input.value;
      if (!pw) return;

      btn.disabled = true;
      err.hidden = true;

      var hash;
      try {
        var enc = new TextEncoder();
        var buf = await crypto.subtle.digest('SHA-256', enc.encode(pw));
        var bytes = new Uint8Array(buf);
        hash = Array.from(bytes).map(function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
      } catch (ex) {
        err.textContent = 'Hashing failed in this browser. Try a modern browser.';
        err.hidden = false;
        btn.disabled = false;
        return;
      }

      if (hash === PASSWORD_HASH) {
        try { localStorage.setItem(LS_KEY, PASSWORD_HASH); } catch (e) { /* ignore */ }
        // Remove the gate and the hiding stylesheet.
        var g = document.getElementById('__tva_gate');
        if (g) g.remove();
        var hs = document.getElementById('__tva_gate_hide');
        if (hs) hs.remove();
        // Make absolutely sure the body is visible.
        document.body.style.visibility = 'visible';
      } else {
        err.hidden = false;
        btn.disabled = false;
        input.focus();
        input.select();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildGate);
  } else {
    buildGate();
  }
})();
