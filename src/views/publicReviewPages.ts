const LAST_UPDATED = "August 13, 2026";
const SUPPORT_EMAIL = "hello@theafoundry.com";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function page(title: string, summary: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(summary)}">
  <title>${escapeHtml(title)} · Todos</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --paper:#fbfaf7; --ink:#1d2623; --muted:#5d6864; --line:#d8ddd8; --accent:#276450; }
    * { box-sizing: border-box; }
    html { background: var(--paper); color: var(--ink); }
    body { margin: 0; }
    a { color: var(--accent); text-underline-offset: 3px; }
    a:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; border-radius: 2px; }
    .skip { position: absolute; left: 1rem; top: -5rem; padding: .7rem 1rem; background: var(--ink); color: var(--paper); z-index: 2; }
    .skip:focus { top: 1rem; }
    header, main, footer { width: min(100% - 2rem, 760px); margin-inline: auto; }
    header { display: flex; justify-content: space-between; gap: 1rem; padding: 1.25rem 0; border-bottom: 1px solid var(--line); }
    nav { display: flex; flex-wrap: wrap; gap: .85rem; }
    main { padding: clamp(2rem, 7vw, 4.5rem) 0; }
    h1 { max-width: 18ch; margin: 0; font-size: clamp(2rem, 7vw, 3.8rem); line-height: 1.02; letter-spacing: -.04em; }
    h2 { margin-top: 2.4rem; font-size: 1.15rem; }
    p, li { line-height: 1.65; }
    .lede { max-width: 62ch; color: var(--muted); font-size: 1.08rem; }
    .updated { color: var(--muted); font-size: .85rem; }
    footer { padding: 1.5rem 0 2.5rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .9rem; }
    @media (prefers-color-scheme: dark) { :root { --paper:#161c1a; --ink:#edf3f0; --muted:#aebbb5; --line:#3a4641; --accent:#76c5a7; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
  </style>
</head>
<body>
  <a class="skip" href="#main-content">Skip to content</a>
  <header>
    <a href="/" aria-label="Todos home"><strong>Todos</strong></a>
    <nav aria-label="Policy and support">
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/support">Support</a>
    </nav>
  </header>
  <main id="main-content">
    <h1>${escapeHtml(title)}</h1>
    <p class="lede">${escapeHtml(summary)}</p>
    <p class="updated">Last updated ${LAST_UPDATED}</p>
    ${content}
  </main>
  <footer>Todos is published by <a href="https://theafoundry.com">Thea Foundry</a>.</footer>
</body>
</html>`;
}

export function buildPrivacyPage(): string {
  return page(
    "Privacy policy",
    "How Todos handles account, task, planning, and connected-assistant data.",
    `<h2>Information Todos handles</h2>
    <p>Todos stores the information you provide to create and use an account, including your email address, optional name, tasks, projects, planning preferences, and the changes you make to them. It also stores security and operational records needed to authenticate requests, maintain connected-assistant sessions, prevent replay, diagnose failures, and operate the service.</p>
    <h2>Connected assistants</h2>
    <p>When you connect Todos to ChatGPT or another compatible assistant, Todos uses OAuth to authorize the connection. The assistant receives only the tool results needed for the action you request. The native Todos tool contract returns minimized task and plan fields and does not return task notes, account credentials, or internal telemetry.</p>
    <h2>How information is used</h2>
    <p>Information is used to provide task capture, planning, completion, rescheduling, account security, support, reliability, and abuse prevention. Todos does not sell personal information.</p>
    <h2>Service providers and disclosure</h2>
    <p>Todos may use infrastructure and communications providers to host the service, store data, deliver account email, and monitor reliability. Information may also be disclosed when required by law or necessary to protect users and the service.</p>
    <h2>Your choices</h2>
    <p>You can disconnect an assistant without deleting your Todos account. An authenticated data export is available in Todos. To request access, correction, or deletion, contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. Requests may require account verification.</p>
    <h2>Retention and security</h2>
    <p>Todos retains information while it is needed to provide the service, secure accounts, meet legal obligations, and resolve disputes. Reasonable technical and organizational safeguards are used, but no online service can guarantee absolute security.</p>
    <h2>Changes and contact</h2>
    <p>Material changes will be reflected on this page by updating its date. Privacy questions can be sent to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>`,
  );
}

export function buildTermsPage(): string {
  return page(
    "Terms of use",
    "The terms that apply when you use Todos and its connected-assistant tools.",
    `<h2>Using Todos</h2>
    <p>You may use Todos only in compliance with applicable law and these terms. You are responsible for your account, the accuracy of information you provide, and activity performed through connections you authorize.</p>
    <h2>Connected assistants</h2>
    <p>Assistant output and tool selection can be imperfect. Review important task changes before relying on them. You can revoke a connected assistant from Todos, and the assistant provider may apply separate terms to its service.</p>
    <h2>Acceptable use</h2>
    <p>Do not misuse the service, attempt unauthorized access, interfere with operation, bypass rate or security controls, introduce malicious content, or use Todos to violate another person’s rights.</p>
    <h2>Your content</h2>
    <p>You retain responsibility for the task and project content you submit. You permit Todos to process that content only as needed to operate, secure, support, and improve the service.</p>
    <h2>Availability and changes</h2>
    <p>The service may change, be interrupted, or be discontinued. Where practical, material changes to these terms will be reflected by an updated date on this page.</p>
    <h2>Disclaimers and liability</h2>
    <p>Todos is provided on an “as is” and “as available” basis to the extent permitted by law. To the extent permitted by law, Thea Foundry is not liable for indirect, incidental, special, consequential, or punitive damages arising from use of the service.</p>
    <h2>Contact</h2>
    <p>Questions about these terms can be sent to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>`,
  );
}

export function buildSupportPage(): string {
  return page(
    "Support",
    "Help with Todos accounts, connected assistants, privacy, and task planning.",
    `<h2>Contact support</h2>
    <p>Email <a href="mailto:${SUPPORT_EMAIL}?subject=Todos%20support">${SUPPORT_EMAIL}</a>. Include a short description of the issue and the approximate time it occurred. Do not send passwords, access tokens, refresh tokens, or other secrets.</p>
    <h2>Connected-assistant troubleshooting</h2>
    <ol>
      <li>Confirm you are connecting <code>https://todos.theafoundry.com/mcp/app</code>.</li>
      <li>Disconnect and relink Todos if authorization expired or requested permissions changed.</li>
      <li>Confirm the Todos account has the tasks or projects you expect to use.</li>
    </ol>
    <h2>Privacy requests</h2>
    <p>For data access, correction, export, or deletion requests, email <a href="mailto:${SUPPORT_EMAIL}?subject=Todos%20privacy%20request">${SUPPORT_EMAIL}</a> from your account address. We may ask you to verify the account before acting.</p>
    <h2>Security reports</h2>
    <p>Send security concerns privately to <a href="mailto:${SUPPORT_EMAIL}?subject=Todos%20security%20report">${SUPPORT_EMAIL}</a>. Please avoid including live credentials or personal data that is not necessary to explain the issue.</p>`,
  );
}
