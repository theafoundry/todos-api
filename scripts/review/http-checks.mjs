const DEFAULT_BASE_URL = "https://todos.theafoundry.com";
const MCP_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};

export function reviewBaseUrl() {
  const raw = (process.env.REVIEW_BASE_URL || DEFAULT_BASE_URL).trim();
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("REVIEW_BASE_URL must use HTTPS (localhost is exempt)");
  }
  return url.origin;
}

export async function fetchChecked(url, init = {}, expectedStatus = 200) {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    ...init,
  });
  if (response.status !== expectedStatus) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(
      `${init.method || "GET"} ${url} returned ${response.status}; expected ${expectedStatus}. ${body}`,
    );
  }
  return response;
}

export async function jsonChecked(url, init = {}, expectedStatus = 200) {
  const response = await fetchChecked(url, init, expectedStatus);
  return response.json();
}

export function requireFields(record, fields, label) {
  for (const field of fields) {
    if (record?.[field] === undefined || record?.[field] === null) {
      throw new Error(`${label} is missing ${field}`);
    }
  }
}

export async function mcpRequest(baseUrl, id, method, params = {}) {
  const response = await fetchChecked(`${baseUrl}/mcp/app`, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  const line = text.split("\n").find((entry) => entry.startsWith("data: "));
  if (!line)
    throw new Error(`${method} returned no MCP JSON or SSE data event`);
  return JSON.parse(line.slice(6));
}

export async function checkChallenge() {
  const baseUrl = reviewBaseUrl();
  const expected = process.env.DOMAIN_VERIFICATION_TOKEN || "";
  if (!expected) {
    throw new Error(
      "DOMAIN_VERIFICATION_TOKEN is required so the challenge body can be checked exactly",
    );
  }
  if (expected !== expected.trim() || /[\r\n]/.test(expected)) {
    throw new Error(
      "DOMAIN_VERIFICATION_TOKEN must not contain whitespace padding or newlines",
    );
  }
  const response = await fetchChecked(
    `${baseUrl}/.well-known/openai-apps-challenge`,
  );
  const body = await response.text();
  if (body !== expected)
    throw new Error("Challenge body is not the exact token");
  if (!(response.headers.get("content-type") || "").startsWith("text/plain")) {
    throw new Error("Challenge response is not text/plain");
  }
  console.log(`challenge: exact token verified at ${baseUrl}`);
}

export async function checkDiscovery() {
  const baseUrl = reviewBaseUrl();
  const protectedResource = await jsonChecked(
    `${baseUrl}/.well-known/oauth-protected-resource/mcp/app`,
  );
  requireFields(
    protectedResource,
    ["resource", "authorization_servers", "scopes_supported"],
    "protected-resource metadata",
  );
  if (protectedResource.resource !== `${baseUrl}/mcp/app`) {
    throw new Error("Protected-resource identifier does not match /mcp/app");
  }
  const issuer = protectedResource.authorization_servers[0];
  const authorizationServer = await jsonChecked(
    `${issuer}/.well-known/oauth-authorization-server`,
  );
  const oidc = await jsonChecked(`${issuer}/.well-known/openid-configuration`);
  requireFields(
    authorizationServer,
    ["issuer", "authorization_endpoint", "token_endpoint"],
    "authorization-server metadata",
  );
  requireFields(oidc, ["issuer", "userinfo_endpoint"], "OIDC metadata");
  console.log(
    `discovery: protected resource, OAuth, and OIDC verified at ${baseUrl}`,
  );
}

export async function checkOAuth() {
  const baseUrl = reviewBaseUrl();
  const metadata = await jsonChecked(
    `${baseUrl}/.well-known/oauth-authorization-server`,
  );
  for (const method of ["S256"]) {
    if (!metadata.code_challenge_methods_supported?.includes(method)) {
      throw new Error(`OAuth metadata does not advertise PKCE ${method}`);
    }
  }
  if (!metadata.grant_types_supported?.includes("refresh_token")) {
    throw new Error("OAuth metadata does not advertise refresh_token");
  }
  console.log("oauth: public metadata advertises PKCE and refresh tokens");
  console.log(
    "oauth: browser login, cancellation, refresh, and relink remain manual acceptance checks",
  );
}

export async function checkUserInfo() {
  const baseUrl = reviewBaseUrl();
  const oidc = await jsonChecked(`${baseUrl}/.well-known/openid-configuration`);
  const response = await fetchChecked(oidc.userinfo_endpoint, {}, 401);
  const challenge = response.headers.get("www-authenticate") || "";
  if (!challenge.toLowerCase().startsWith("bearer")) {
    throw new Error(
      "Unauthenticated UserInfo response has no Bearer challenge",
    );
  }
  console.log(
    "userinfo: endpoint discovery and unauthenticated Bearer challenge verified",
  );
  console.log(
    "userinfo: authenticated claims remain a manual acceptance check",
  );
}

export async function checkWidget() {
  const baseUrl = reviewBaseUrl();
  const expectedUiDomain = (
    process.env.REVIEW_EXPECTED_UI_DOMAIN || "https://todos.theafoundry.com"
  ).trim();
  const initialized = await mcpRequest(baseUrl, 1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "todos-review-check", version: "1.0.0" },
  });
  requireFields(
    initialized.result,
    ["serverInfo", "capabilities"],
    "initialize result",
  );
  const tools = await mcpRequest(baseUrl, 2, "tools/list");
  const names = tools.result?.tools?.map((tool) => tool.name) || [];
  const expected = [
    "list_today",
    "plan_today",
    "capture_task",
    "complete_task",
    "reschedule_task",
    "render_today_plan",
  ];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected tool surface: ${JSON.stringify(names)}`);
  }
  const resources = await mcpRequest(baseUrl, 3, "resources/list");
  const resource = resources.result?.resources?.find(
    (entry) => entry.uri === "ui://todos/today-plan/v1.html",
  );
  if (resource?._meta?.ui?.domain !== expectedUiDomain) {
    throw new Error(
      `Today Plan resource ui.domain does not match ${expectedUiDomain}`,
    );
  }
  if (
    resource._meta.ui.csp.connectDomains.length !== 0 ||
    resource._meta.ui.csp.resourceDomains.length !== 0
  ) {
    throw new Error(
      "Today Plan CSP expanded beyond its self-contained widget contract",
    );
  }
  console.log(
    "widget: six-tool surface, resource, ui.domain, and empty CSP verified",
  );
  console.log(
    "widget: authenticated tool mutations remain manual acceptance checks",
  );
}

export async function checkPolicies() {
  const baseUrl = reviewBaseUrl();
  for (const path of ["privacy", "terms", "support"]) {
    const response = await fetchChecked(`${baseUrl}/${path}`);
    const body = await response.text();
    if (!body.includes("hello@theafoundry.com") || body.includes("TBD")) {
      throw new Error(`${path} page is incomplete`);
    }
  }
  console.log("policies: privacy, terms, and support pages verified");
}
