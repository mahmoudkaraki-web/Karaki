// The two pages a browser opens: the join link (what an invite message points to) and the
// privacy page. Plain HTML in the app's look (linen, ink, terracotta, slim squared buttons),
// no outside fonts, scripts or trackers. The join page never shows anyone's name.

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// the code as people read it: XXXX-XXXX, only the letters and digits invite codes use
export function shapeCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

function shell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>
  :root { --linen:#F5F0E7; --paper:#FFFCF6; --inset:#ECE5D8; --ink:#1F1B16; --soft:#5C5348; --faint:#8A7F72; --terracotta:#B4532A; --on:#FBF5EC; --hair:rgba(60,40,20,.12); }
  @media (prefers-color-scheme: dark) { :root { --linen:#15130F; --paper:#1F1C17; --inset:#0E0D0A; --ink:#F2EADF; --soft:#BDB2A4; --faint:#8C8275; --terracotta:#D27A4E; --on:#1A120C; --hair:rgba(255,240,220,.10); } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--linen); color:var(--ink); font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing:antialiased; }
  main { max-width:440px; margin:0 auto; padding:calc(48px + env(safe-area-inset-top)) 24px calc(32px + env(safe-area-inset-bottom)); }
  .mark { font-family: "New York", Georgia, "Times New Roman", serif; font-weight:600; font-size:40px; letter-spacing:-.6px; margin:0; }
  .rule { width:32px; height:3px; border-radius:2px; background:var(--terracotta); margin:12px 0 20px; }
  p { color:var(--soft); margin:0 0 16px; }
  h2 { font-family: "New York", Georgia, serif; font-size:20px; margin:28px 0 8px; }
  .btn { font:inherit; display:flex; align-items:center; justify-content:center; height:44px; padding:0 16px; border-radius:8px; font-weight:600; font-size:16px; text-decoration:none; margin-top:12px; border:0; width:100%; cursor:pointer; }
  .primary { background:var(--terracotta); color:var(--on); }
  .quiet { background:transparent; color:var(--ink); border:1px solid var(--hair); }
  .step { color:var(--faint); font-size:13px; margin:20px 0 0; }
  .code { font-family: "New York", Georgia, serif; font-variant-numeric: lining-nums tabular-nums; font-size:34px; letter-spacing:4px; font-weight:600; background:var(--inset); border-radius:10px; padding:14px 16px; margin-top:8px; text-align:center; user-select:all; -webkit-user-select:all; }
  .small { font-size:13px; color:var(--faint); }
  ul { color:var(--soft); padding-left:20px; margin:0 0 16px; }
  li { margin-bottom:6px; }
  a { color:var(--terracotta); }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export function joinPage({ code, open, installUrl }) {
  if (!open) {
    return shell('Karaki', `
  <h1 class="mark">Karaki</h1><div class="rule"></div>
  <p>This invite has ended. Ask for a new one.</p>`);
  }
  const shaped = shapeCode(code);
  const install = installUrl
    ? `<a class="btn primary" href="${esc(installUrl)}">Install Karaki</a>`
    : '<p class="small">The install link is not set yet. Ask the person who sent you this invite.</p>';
  return shell('Join Karaki', `
  <h1 class="mark">Karaki</h1><div class="rule"></div>
  <p>You are invited to Karaki, the family's private app for messages and calls.</p>
  <p class="step">1. Install the app (once)</p>
  ${install}
  <p class="step">2. Open it with your invite</p>
  <a class="btn ${installUrl ? 'quiet' : 'primary'}" href="karaki://join/${esc(shaped)}">Open Karaki</a>
  <p class="step">If Karaki opens without the code, type it in:</p>
  <div class="code" id="code">${esc(shaped)}</div>
  <button class="btn quiet" id="copy" type="button">Copy the code</button>
  <p class="small" style="margin-top:20px">The code works once and only for a few days.</p>
  <script>
    document.getElementById('copy').addEventListener('click', function () {
      var b = this, c = document.getElementById('code').textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(function () { b.textContent = 'Copied'; }, function () {
        var r = document.createRange(); r.selectNodeContents(document.getElementById('code'));
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Press and hold the code to copy';
      });
    });
  </script>`);
}

export function privacyPage({ contact }) {
  return shell('Karaki privacy', `
  <h1 class="mark">Karaki</h1><div class="rule"></div>
  <p>Karaki is a private app for one family: messages, photos, voice notes and calls between its members. Nobody can join without an invite from the family.</p>
  <h2>What is kept</h2>
  <ul>
    <li>The names of the family members.</li>
    <li>Messages, photos and voice notes sent in Karaki.</li>
    <li>A record of calls: who called whom, when, and how long. The calls themselves (sound and video) are not recorded.</li>
    <li>Device tokens, so a phone can be signed in and receive notifications and calls.</li>
  </ul>
  <h2>Where</h2>
  <p>On the family's own private server. It is not shared with anyone.</p>
  <h2>What Karaki never does</h2>
  <ul>
    <li>No advertising.</li>
    <li>No tracking or analytics.</li>
    <li>No selling or sharing of anything with anyone.</li>
  </ul>
  <h2>Being removed</h2>
  <p>Ask the family admin. They remove you from the family in the app, which signs you out on every phone.</p>
  <h2>Contact</h2>
  <p><a href="mailto:${esc(contact)}">${esc(contact)}</a></p>`);
}
