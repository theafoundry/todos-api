function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHiddenFields(fields: Record<string, string | undefined>) {
  return Object.entries(fields)
    .filter(([, value]) => typeof value === "string")
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(
          value || "",
        )}">`,
    )
    .join("");
}

function renderGoogleButton(url: string, label: string) {
  return `<a href="${escapeHtml(url)}" style="display:flex;align-items:center;justify-content:center;gap:10px;padding:12px 18px;border:1px solid #cbd5e1;border-radius:999px;text-decoration:none;color:#111827;font-weight:600;background:white;">
  <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
  ${escapeHtml(label)}
</a>`;
}

function renderDivider() {
  return `<div style="display:flex;align-items:center;gap:12px;margin:16px 0;"><hr style="flex:1;border:none;border-top:1px solid #e5e7eb;"><span style="color:#6b7280;font-size:0.875rem;">or</span><hr style="flex:1;border:none;border-top:1px solid #e5e7eb;"></div>`;
}

function renderPageShell(title: string, body: string, headExtra?: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>${headExtra ? "\n    " + headExtra : ""}
    <style>
      :root {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: linear-gradient(180deg, #f7f8fc 0%, #eef1f7 100%);
        color: #111827;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      main {
        width: min(100%, 560px);
        background: white;
        border-radius: 18px;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
        padding: 28px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 1.65rem;
      }
      p,
      li,
      label {
        line-height: 1.5;
      }
      .error {
        margin: 16px 0;
        padding: 12px 14px;
        border-radius: 12px;
        background: #fef2f2;
        color: #991b1b;
      }
      .card {
        margin: 18px 0;
        padding: 16px;
        border-radius: 14px;
        background: #f8fafc;
        border: 1px solid #e5e7eb;
      }
      form {
        display: grid;
        gap: 12px;
      }
      label {
        display: grid;
        gap: 6px;
        font-weight: 600;
      }
      input {
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        padding: 12px;
        font: inherit;
      }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 16px;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .primary {
        background: #111827;
        color: white;
      }
      .secondary {
        background: #e5e7eb;
        color: #111827;
      }
      code {
        background: #f3f4f6;
        border-radius: 6px;
        padding: 2px 6px;
      }
      ul {
        padding-left: 18px;
      }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
}

export function renderOAuthErrorPage(input: {
  title: string;
  message: string;
  hint?: string;
}) {
  return renderPageShell(
    input.title,
    `<h1>${escapeHtml(input.title)}</h1>
     <div class="error">${escapeHtml(input.message)}</div>
     ${
       input.hint
         ? `<p>${escapeHtml(input.hint)}</p>`
         : "<p>Return to the assistant and start the connection flow again.</p>"
     }`,
  );
}

export function renderOAuthLoginPage(input: {
  error?: string;
  formAction: string;
  hiddenFields: Record<string, string | undefined>;
  clientName?: string;
  registerUrl?: string;
  googleUrl?: string;
}) {
  const clientCopy = input.clientName
    ? `Sign in to connect <strong>${escapeHtml(input.clientName)}</strong> to your Planwren account.`
    : "Sign in to connect your assistant to your Planwren account.";
  return renderPageShell(
    "Connect Assistant",
    `<h1>Connect Assistant</h1>
     <p>${clientCopy}</p>
     ${input.error ? `<div class="error">${escapeHtml(input.error)}</div>` : ""}
     ${input.googleUrl ? renderGoogleButton(input.googleUrl, "Sign in with Google") : ""}
     ${input.googleUrl ? renderDivider() : ""}
     <form method="post" action="${escapeHtml(input.formAction)}">
       ${renderHiddenFields(input.hiddenFields)}
       <label>
         Email
         <input type="email" name="email" autocomplete="email" required>
       </label>
       <label>
         Password
         <input type="password" name="password" autocomplete="current-password" required>
       </label>
       <div class="actions">
         <button class="primary" type="submit">Sign In</button>
       </div>
     </form>
     ${input.registerUrl ? `<p style="margin-top:16px;text-align:center"><a href="${escapeHtml(input.registerUrl)}">Create account</a></p>` : ""}`,
  );
}

export function renderOAuthRegisterPage(input: {
  error?: string;
  formAction: string;
  hiddenFields: Record<string, string | undefined>;
  clientName?: string;
  loginUrl?: string;
  googleUrl?: string;
}) {
  const clientCopy = input.clientName
    ? `Create an account to connect <strong>${escapeHtml(input.clientName)}</strong> to Planwren.`
    : "Create an account to connect your assistant to Planwren.";
  return renderPageShell(
    "Create Account",
    `<h1>Create Account</h1>
     <p>${clientCopy}</p>
     ${input.error ? `<div class="error">${escapeHtml(input.error)}</div>` : ""}
     ${input.googleUrl ? renderGoogleButton(input.googleUrl, "Sign up with Google") : ""}
     ${input.googleUrl ? renderDivider() : ""}
     <form method="post" action="${escapeHtml(input.formAction)}">
       ${renderHiddenFields(input.hiddenFields)}
       <label>
         Name
         <input type="text" name="name" autocomplete="name" required>
       </label>
       <label>
         Email
         <input type="email" name="email" autocomplete="email" required>
       </label>
       <label>
         Password
         <input type="password" name="password" autocomplete="new-password" required minlength="8">
       </label>
       <div class="actions">
         <button class="primary" type="submit">Create Account</button>
       </div>
     </form>
     ${input.loginUrl ? `<p style="margin-top:16px;text-align:center"><a href="${escapeHtml(input.loginUrl)}">Already have an account? Sign in</a></p>` : ""}`,
  );
}

export function renderOAuthRedirectPage(input: {
  redirectUri: string;
  nonce: string;
}) {
  const safe = escapeHtml(input.redirectUri);
  return renderPageShell(
    "Redirecting…",
    `<h1>Authorization complete</h1>
     <p>Redirecting you back to the assistant…</p>
     <p><a class="primary" href="${safe}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#111827;color:white;text-decoration:none;font-weight:600;">Return to assistant</a></p>
     <script nonce="${escapeHtml(input.nonce)}">
       try { window.location.replace(${JSON.stringify(input.redirectUri)}); } catch(_){}
     </script>`,
    `<meta http-equiv="refresh" content="0; url=${safe}">`,
  );
}

export function renderOAuthConsentPage(input: {
  clientName?: string;
  userEmail: string;
  scopes: string[];
  formAction: string;
  hiddenFields: Record<string, string | undefined>;
}) {
  return renderPageShell(
    "Authorize Assistant",
    `<h1>Authorize Assistant</h1>
     <p>${
       input.clientName
         ? `<strong>${escapeHtml(input.clientName)}</strong> wants access to your Planwren account.`
         : "An assistant client wants access to your Planwren account."
     }</p>
     <div class="card">
       <p><strong>Signed in as:</strong> ${escapeHtml(input.userEmail)}</p>
       <p><strong>Requested scopes:</strong></p>
       <ul>${input.scopes
         .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
         .join("")}</ul>
     </div>
     <form method="post" action="${escapeHtml(input.formAction)}">
       ${renderHiddenFields(input.hiddenFields)}
       <div class="actions">
         <button class="primary" type="submit" name="decision" value="approve">Allow Access</button>
         <button class="secondary" type="submit" name="decision" value="deny">Deny</button>
       </div>
     </form>`,
  );
}
