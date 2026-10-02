import { McpScope } from "../types";
import {
  DEFAULT_MCP_SCOPES,
  formatMcpOAuthScopes,
  hasAllMcpScopes,
  McpOAuthScope,
  normalizeMcpOAuthScopes,
  normalizeMcpScopes,
} from "../mcp/mcpScopes";
import { ValidationError, validateId } from "./validation";
import { config } from "../config";
import { getMcpAppResource } from "../mcp/appContract";

const MAX_ASSISTANT_NAME_LENGTH = 100;
const MAX_CLIENT_ID_LENGTH = 5000;
// OAuth state is opaque client data. OpenAI's portal relay currently encodes
// signed routing context into this value, so allow a bounded URL-safe payload
// while still rejecting unreasonably large authorization requests.
const MAX_STATE_LENGTH = 4096;
const MAX_CLIENT_NAME_LENGTH = 120;
const PKCE_MIN_LENGTH = 43;
const PKCE_MAX_LENGTH = 128;
const OAUTH_CLIENT_GRANT_AUTHORIZATION_CODE = "authorization_code";
const OAUTH_CLIENT_GRANT_REFRESH_TOKEN = "refresh_token";

export interface CreateMcpTokenDto {
  scopes: McpScope[];
  assistantName?: string;
  clientId?: string;
}

export interface CreateMcpAuthorizationCodeDto {
  clientId: string;
  redirectUri: string;
  scopes: McpScope[];
  assistantName?: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource?: string;
}

export type ExchangeMcpTokenDto =
  | {
      grantType: "authorization_code";
      code: string;
      clientId: string;
      redirectUri: string;
      codeVerifier: string;
      resource?: string;
    }
  | {
      grantType: "refresh_token";
      refreshToken: string;
      clientId: string;
      resource?: string;
    };

export interface RegisterMcpClientDto {
  redirectUris: string[];
  clientName?: string;
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: "none";
}

export interface OAuthAuthorizeRequestDto {
  responseType: "code";
  clientId: string;
  redirectUri: string;
  scopes: McpOAuthScope[];
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource?: string;
}

export type RevokeMcpSessionDto =
  | {
      sessionId: string;
      revokeAll?: false;
    }
  | {
      revokeAll: true;
    };

export interface RevokeMcpOAuthTokenDto {
  token: string;
  clientId?: string;
  tokenTypeHint?: "refresh_token" | "access_token";
}

function ensureObject(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError("Request body must be an object");
  }
  return data as Record<string, unknown>;
}

function normalizeStringField(input: {
  value: unknown;
  field: string;
  maxLength?: number;
  required?: boolean;
}): string | undefined {
  if (input.value === undefined || input.value === null) {
    if (input.required) {
      throw new ValidationError(`${input.field} is required`);
    }
    return undefined;
  }

  if (typeof input.value !== "string") {
    throw new ValidationError(`${input.field} must be a string`);
  }

  const normalized = input.value.trim();
  if (!normalized) {
    throw new ValidationError(`${input.field} cannot be empty`);
  }

  if (input.maxLength && normalized.length > input.maxLength) {
    throw new ValidationError(
      `${input.field} cannot exceed ${input.maxLength} characters`,
    );
  }

  return normalized;
}

function normalizeRedirectUri(value: unknown): string {
  const redirectUri = normalizeStringField({
    value,
    field: "redirectUri",
    required: true,
    maxLength: 1000,
  });

  let parsed: URL;
  try {
    parsed = new URL(redirectUri!);
  } catch (_error) {
    throw new ValidationError("redirectUri must be a valid absolute URL");
  }

  const isLoopbackHttp =
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLoopbackHttp) {
    throw new ValidationError(
      "redirectUri must use https or localhost http for development",
    );
  }

  return redirectUri!;
}

function normalizeRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("redirect_uris must be a non-empty array");
  }

  return Array.from(new Set(value.map((entry) => normalizeRedirectUri(entry))));
}

function normalizePkceField(input: {
  value: unknown;
  field: "codeChallenge" | "codeVerifier";
}): string {
  const normalized = normalizeStringField({
    value: input.value,
    field: input.field,
    required: true,
    maxLength: PKCE_MAX_LENGTH,
  });

  if (
    normalized!.length < PKCE_MIN_LENGTH ||
    normalized!.length > PKCE_MAX_LENGTH
  ) {
    throw new ValidationError(
      `${input.field} must be between ${PKCE_MIN_LENGTH} and ${PKCE_MAX_LENGTH} characters`,
    );
  }

  if (!/^[A-Za-z0-9\-._~]+$/.test(normalized!)) {
    throw new ValidationError(`${input.field} must use the PKCE character set`);
  }

  return normalized!;
}

function normalizeAssistantName(value: unknown): string | undefined {
  return normalizeStringField({
    value,
    field: "assistantName",
    maxLength: MAX_ASSISTANT_NAME_LENGTH,
  });
}

function normalizeClientName(value: unknown): string | undefined {
  return normalizeStringField({
    value,
    field: "client_name",
    maxLength: MAX_CLIENT_NAME_LENGTH,
  });
}

function normalizeClientId(
  value: unknown,
  required: boolean,
): string | undefined {
  return normalizeStringField({
    value,
    field: "clientId",
    required,
    maxLength: MAX_CLIENT_ID_LENGTH,
  });
}

function normalizeState(value: unknown): string | undefined {
  return normalizeStringField({
    value,
    field: "state",
    maxLength: MAX_STATE_LENGTH,
  });
}

function normalizeOAuthResource(value: unknown): string | undefined {
  const resource = normalizeStringField({
    value,
    field: "resource",
    maxLength: 1000,
  });
  if (!resource) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(resource);
  } catch (_error) {
    throw new ValidationError("resource must be a valid absolute URL");
  }
  const canonical = parsed.toString();
  const supported = new Set([
    new URL("/mcp", config.baseUrl).toString(),
    getMcpAppResource(config.baseUrl),
  ]);
  if (!supported.has(canonical)) {
    throw new ValidationError("resource is not a supported MCP resource");
  }
  return canonical;
}

function normalizeGrantTypes(value: unknown): string[] {
  if (value === undefined) {
    return [OAUTH_CLIENT_GRANT_AUTHORIZATION_CODE];
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("grant_types must be a non-empty array");
  }

  const requestedGrantTypes = Array.from(
    new Set(
      value.map((entry) => {
        if (typeof entry !== "string" || !entry.trim()) {
          throw new ValidationError("grant_types entries must be strings");
        }
        return entry.trim();
      }),
    ),
  );

  const allowedGrantTypes = new Set([
    OAUTH_CLIENT_GRANT_AUTHORIZATION_CODE,
    OAUTH_CLIENT_GRANT_REFRESH_TOKEN,
  ]);
  if (
    requestedGrantTypes.some((grantType) => !allowedGrantTypes.has(grantType))
  ) {
    throw new ValidationError(
      'grant_types must only include "authorization_code" and optional "refresh_token"',
    );
  }

  if (!requestedGrantTypes.includes(OAUTH_CLIENT_GRANT_AUTHORIZATION_CODE)) {
    throw new ValidationError('grant_types must include "authorization_code"');
  }

  return [
    OAUTH_CLIENT_GRANT_AUTHORIZATION_CODE,
    ...(requestedGrantTypes.includes(OAUTH_CLIENT_GRANT_REFRESH_TOKEN)
      ? [OAUTH_CLIENT_GRANT_REFRESH_TOKEN]
      : []),
  ];
}

function normalizeResponseTypes(value: unknown): string[] {
  if (value === undefined) {
    return ["code"];
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("response_types must be a non-empty array");
  }

  const responseTypes = Array.from(
    new Set(
      value.map((entry) => {
        if (typeof entry !== "string" || !entry.trim()) {
          throw new ValidationError("response_types entries must be strings");
        }
        return entry.trim();
      }),
    ),
  );

  if (responseTypes.some((responseType) => responseType !== "code")) {
    throw new ValidationError('response_types must only include "code"');
  }

  return responseTypes;
}

function normalizeTokenEndpointAuthMethod(value: unknown): "none" {
  if (value === undefined) {
    return "none";
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(
      "token_endpoint_auth_method must be a string when provided",
    );
  }
  if (value.trim() !== "none") {
    throw new ValidationError(
      'token_endpoint_auth_method must be "none" for public PKCE clients',
    );
  }
  return "none";
}

function normalizeScopesFromOAuthField(value: unknown): McpOAuthScope[] {
  if (value === undefined) {
    return [...DEFAULT_MCP_SCOPES];
  }
  if (typeof value !== "string") {
    throw new ValidationError("scope must be a string");
  }

  const entries = value
    .split(" ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalizeMcpOAuthScopes(entries, {
    defaultScopes: DEFAULT_MCP_SCOPES,
  });
}

export function validateCreateMcpTokenInput(data: unknown): CreateMcpTokenDto {
  const body = ensureObject(data);
  const allowedKeys = ["scopes", "assistantName", "clientId"];
  const unknownKeys = Object.keys(body).filter(
    (key) => !allowedKeys.includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new ValidationError(
      `Request body contains unsupported field(s): ${unknownKeys.join(", ")}`,
    );
  }

  return {
    scopes: normalizeMcpScopes(body.scopes),
    assistantName: normalizeAssistantName(body.assistantName),
    clientId: normalizeClientId(body.clientId, false),
  };
}

export function validateCreateMcpAuthorizationCodeInput(
  data: unknown,
): CreateMcpAuthorizationCodeDto {
  const body = ensureObject(data);
  const allowedKeys = [
    "clientId",
    "redirectUri",
    "scopes",
    "assistantName",
    "state",
    "codeChallenge",
    "codeChallengeMethod",
    "resource",
  ];
  const unknownKeys = Object.keys(body).filter(
    (key) => !allowedKeys.includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new ValidationError(
      `Request body contains unsupported field(s): ${unknownKeys.join(", ")}`,
    );
  }

  const codeChallengeMethod = normalizeStringField({
    value: body.codeChallengeMethod ?? "S256",
    field: "codeChallengeMethod",
    required: true,
  });
  if (codeChallengeMethod !== "S256") {
    throw new ValidationError("codeChallengeMethod must be S256");
  }

  return {
    clientId: normalizeClientId(body.clientId, true)!,
    redirectUri: normalizeRedirectUri(body.redirectUri),
    scopes: normalizeMcpScopes(body.scopes),
    assistantName: normalizeAssistantName(body.assistantName),
    state: normalizeState(body.state),
    codeChallenge: normalizePkceField({
      value: body.codeChallenge,
      field: "codeChallenge",
    }),
    codeChallengeMethod: "S256",
    resource: normalizeOAuthResource(body.resource),
  };
}

export function validateExchangeMcpAuthorizationCodeInput(
  data: unknown,
): ExchangeMcpTokenDto {
  const body = ensureObject(data);
  const allowedKeys = [
    "grantType",
    "code",
    "clientId",
    "redirectUri",
    "codeVerifier",
    "refreshToken",
    "resource",
  ];
  const unknownKeys = Object.keys(body).filter(
    (key) => !allowedKeys.includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new ValidationError(
      `Request body contains unsupported field(s): ${unknownKeys.join(", ")}`,
    );
  }

  const grantType = normalizeStringField({
    value: body.grantType,
    field: "grantType",
    required: true,
  });
  if (
    grantType !== OAUTH_CLIENT_GRANT_AUTHORIZATION_CODE &&
    grantType !== OAUTH_CLIENT_GRANT_REFRESH_TOKEN
  ) {
    throw new ValidationError(
      'grantType must be "authorization_code" or "refresh_token"',
    );
  }

  if (grantType === OAUTH_CLIENT_GRANT_REFRESH_TOKEN) {
    return {
      grantType: "refresh_token",
      refreshToken: normalizeStringField({
        value: body.refreshToken,
        field: "refreshToken",
        required: true,
        maxLength: 500,
      })!,
      clientId: normalizeClientId(body.clientId, true)!,
      resource: normalizeOAuthResource(body.resource),
    };
  }

  return {
    grantType: "authorization_code",
    code: normalizeStringField({
      value: body.code,
      field: "code",
      required: true,
      maxLength: 200,
    })!,
    clientId: normalizeClientId(body.clientId, true)!,
    redirectUri: normalizeRedirectUri(body.redirectUri),
    codeVerifier: normalizePkceField({
      value: body.codeVerifier,
      field: "codeVerifier",
    }),
    resource: normalizeOAuthResource(body.resource),
  };
}

export function validateRegisterMcpClientInput(
  data: unknown,
): RegisterMcpClientDto {
  const body = ensureObject(data);
  // Per RFC 7591 §3.1, servers MUST ignore unrecognized registration fields.
  // Do not reject unknown keys — clients like Claude Code send extra fields
  // (e.g. code_challenge_method, scope, client_uri) that we don't need to store.
  return {
    redirectUris: normalizeRedirectUris(body.redirect_uris),
    clientName: normalizeClientName(body.client_name),
    grantTypes: normalizeGrantTypes(body.grant_types),
    responseTypes: normalizeResponseTypes(body.response_types),
    tokenEndpointAuthMethod: normalizeTokenEndpointAuthMethod(
      body.token_endpoint_auth_method,
    ),
  };
}

export function validateRevokeMcpSessionInput(
  data: unknown,
): RevokeMcpSessionDto {
  const body = ensureObject(data);

  if (body.revokeAll === true) {
    if (body.sessionId !== undefined) {
      throw new ValidationError(
        "sessionId cannot be combined with revokeAll=true",
      );
    }
    return { revokeAll: true };
  }

  const sessionId = normalizeStringField({
    value: body.sessionId,
    field: "sessionId",
    required: true,
    maxLength: 36,
  });
  validateId(sessionId!);
  return { sessionId: sessionId! };
}

export function validateRevokeMcpOAuthTokenInput(
  data: unknown,
): RevokeMcpOAuthTokenDto {
  const body = ensureObject(data);

  const token = normalizeStringField({
    value: body.token,
    field: "token",
    required: true,
    maxLength: 5000,
  });
  const clientId = normalizeClientId(body.clientId ?? body.client_id, false);

  let tokenTypeHint: "refresh_token" | "access_token" | undefined;
  const rawHint = body.tokenTypeHint ?? body.token_type_hint;
  if (rawHint !== undefined && rawHint !== null) {
    if (typeof rawHint !== "string" || !rawHint.trim()) {
      throw new ValidationError("tokenTypeHint must be a string");
    }
    const normalizedHint = rawHint.trim();
    if (
      normalizedHint !== "refresh_token" &&
      normalizedHint !== "access_token"
    ) {
      throw new ValidationError(
        'tokenTypeHint must be "refresh_token" or "access_token"',
      );
    }
    tokenTypeHint = normalizedHint;
  }

  return {
    token: token!,
    ...(clientId ? { clientId } : {}),
    ...(tokenTypeHint ? { tokenTypeHint } : {}),
  };
}

export function validateOAuthAuthorizeRequest(
  data: unknown,
): OAuthAuthorizeRequestDto {
  const input = ensureObject(data);
  const responseType = normalizeStringField({
    value: input.response_type,
    field: "response_type",
    required: true,
  });
  if (responseType !== "code") {
    throw new ValidationError('response_type must be "code"');
  }

  const codeChallengeMethod = normalizeStringField({
    value: input.code_challenge_method ?? "S256",
    field: "code_challenge_method",
    required: true,
  });
  if (codeChallengeMethod !== "S256") {
    throw new ValidationError("code_challenge_method must be S256");
  }

  return {
    responseType: "code",
    clientId: normalizeClientId(input.client_id, true)!,
    redirectUri: normalizeRedirectUri(input.redirect_uri),
    scopes: normalizeScopesFromOAuthField(input.scope),
    state: normalizeState(input.state),
    codeChallenge: normalizePkceField({
      value: input.code_challenge,
      field: "codeChallenge",
    }),
    codeChallengeMethod: "S256",
    resource: normalizeOAuthResource(input.resource),
  };
}

export function hasMcpScope(
  availableScopes: McpOAuthScope[],
  requiredScopes: McpScope | McpScope[],
): boolean {
  return hasAllMcpScopes(
    availableScopes,
    Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes],
  );
}

export function describeMcpScopes(scopes: McpOAuthScope[]): string {
  return formatMcpOAuthScopes(scopes);
}
