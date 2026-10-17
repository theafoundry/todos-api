const { createHash } = require("crypto");

const { createApp } = require("../../dist/app");
const { AuthService } = require("../../dist/services/authService");
const { TodoService } = require("../../dist/services/todoService");

const REAL_AUTH_METHODS = new Set(
  Object.getOwnPropertyNames(AuthService.prototype).filter(
    (name) => name !== "constructor",
  ),
);
const authFixtures = [];

function buildProject(id, name, userId, overrides = {}) {
  return {
    id,
    name,
    status: "active",
    archived: false,
    userId,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    taskCount: 0,
    openTaskCount: 0,
    completedTaskCount: 0,
    todoCount: 0,
    openTodoCount: 0,
    ...overrides,
  };
}

function createProjectServiceMock(seedProjects = []) {
  const projects = [...seedProjects];

  return {
    projects,
    service: {
      findAll: async (userId) =>
        projects.filter((project) => project.userId === userId),
      findById: async (userId, id) =>
        projects.find(
          (project) => project.userId === userId && project.id === id,
        ) ?? null,
      create: async (userId, dto) => {
        const project = buildProject(
          `project-${projects.length + 1}`,
          dto.name,
          userId,
          {
            status: dto.status ?? "active",
            archived: dto.archived ?? false,
          },
        );
        projects.push(project);
        return project;
      },
      update: async (userId, id, dto) => {
        const project = projects.find(
          (item) => item.userId === userId && item.id === id,
        );
        if (!project) {
          return null;
        }
        Object.assign(project, dto, { updatedAt: new Date() });
        return project;
      },
      setArchived: async (userId, id, archived) => {
        const project = projects.find(
          (item) => item.userId === userId && item.id === id,
        );
        if (!project) {
          return null;
        }
        project.archived = archived;
        project.updatedAt = new Date();
        return project;
      },
      delete: async (userId, id) => {
        const index = projects.findIndex(
          (project) => project.userId === userId && project.id === id,
        );
        if (index === -1) {
          return false;
        }
        projects.splice(index, 1);
        return true;
      },
    },
  };
}

function buildMcpSession(userId, scopes, assistantName = "ChatGPT") {
  return {
    userId,
    email: `${userId}@example.com`,
    tokenType: "mcp",
    scopes,
    assistantName,
    clientId: `${assistantName.toLowerCase()}-client`,
  };
}

function createPkcePair(verifier) {
  const challenge = createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return { verifier, challenge };
}

// Records reads of real AuthService methods the mock does not implement. The
// app often swallows auth errors (e.g. OAuth link sessions resolve to null), so
// a missing fixture method would otherwise surface as an unrelated 400.
function trackMissingAuthMethods(target, missingMethods) {
  return new Proxy(target, {
    get(object, property, receiver) {
      if (
        typeof property === "string" &&
        !(property in object) &&
        REAL_AUTH_METHODS.has(property)
      ) {
        missingMethods.add(property);
      }
      return Reflect.get(object, property, receiver);
    },
  });
}

function createMockAuthService(initialSession) {
  let currentSession = initialSession;
  const deletedUserIds = new Set();
  const missingMethods = new Set();

  const authService = {
    verifyToken: () => ({
      userId: currentSession?.userId ?? "user-1",
      email: `${currentSession?.userId ?? "user-1"}@example.com`,
    }),
    // Mirrors AuthService.verifyActiveToken: a validly signed token is
    // rejected once its account no longer exists.
    verifyActiveToken: async (token) => {
      const payload = authService.verifyToken(token);
      if (deletedUserIds.has(payload.userId)) {
        throw new Error("Invalid token");
      }
      return payload;
    },
    createMcpToken: (input) => ({
      token: `mcp-token-${input.userId}`,
      tokenType: "Bearer",
      scope: [...input.scopes].sort().join(" "),
      scopes: [...input.scopes].sort(),
      expiresAt: "2026-04-10T00:00:00.000Z",
      expiresIn: 2592000,
      assistantName: input.assistantName,
      clientId: input.clientId,
      refreshToken: input.refreshToken ?? "refresh-token-1",
      refreshTokenExpiresAt: "2026-04-10T00:00:00.000Z",
      refreshTokenExpiresIn: 2592000,
    }),
    verifyMcpToken: () => currentSession,
    decodeMcpToken: () => ({
      ...currentSession,
      issuedAt: Math.floor(Date.now() / 1000),
    }),
    revokeAllMcpTokensForUser: async () => "2026-03-12T00:00:00.000Z",
    getUserById: async (userId) => {
      if (deletedUserIds.has(userId)) {
        return null;
      }
      return {
        id: userId,
        email: `${userId}@example.com`,
        name: userId,
        isVerified: true,
        role: "user",
        plan: "free",
        createdAt: new Date("2026-03-11T00:00:00.000Z"),
        updatedAt: new Date("2026-03-11T00:00:00.000Z"),
      };
    },
    login: async () => ({
      user: {
        id: currentSession?.userId ?? "user-1",
        email: `${currentSession?.userId ?? "user-1"}@example.com`,
        name: currentSession?.userId ?? "user-1",
      },
      token: "app-session-token",
    }),
  };

  const fixture = {
    authService: trackMissingAuthMethods(authService, missingMethods),
    missingMethods,
    setSession: (session) => {
      currentSession = session;
    },
    deleteUser: (userId) => {
      deletedUserIds.add(userId);
    },
  };
  authFixtures.push(fixture);
  return fixture;
}

// Wraps a trial so any auth fixture it created must have implemented every
// real AuthService method the app called. Drift is reported ahead of the
// trial's own assertion failure, which is usually just its downstream symptom.
function withAuthFixtureParity(run) {
  return async (context) => {
    const firstFixture = authFixtures.length;
    // Discriminate on `ok`, not on the error's truthiness: a trial may throw
    // or reject with any value (undefined, null, 0, ...) and must still fail.
    let outcome;
    try {
      outcome = { ok: true, value: await run(context) };
    } catch (error) {
      outcome = { ok: false, error };
    }

    const missing = new Set(
      authFixtures
        .slice(firstFixture)
        .flatMap((fixture) => [...fixture.missingMethods]),
    );
    if (missing.size > 0) {
      throw new Error(
        `Eval auth fixture is missing AuthService methods the app called: ${[
          ...missing,
        ]
          .sort()
          .join(
            ", ",
          )}. Update createMockAuthService in evals/shared/app-harness.js.`,
        outcome.ok ? undefined : { cause: outcome.error },
      );
    }
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  };
}

function createAgentEvalApp({ projects = [] } = {}) {
  const todoService = new TodoService();
  const projectService = createProjectServiceMock(projects);
  const app = createApp({
    todoService,
    projectService: projectService.service,
  });

  return {
    app,
    todoService,
    projectService,
  };
}

function createMcpEvalApp({ projects = [], session } = {}) {
  const todoService = new TodoService();
  const projectService = createProjectServiceMock(projects);
  const auth = createMockAuthService(session);
  const app = createApp({
    todoService,
    authService: auth.authService,
    projectService: projectService.service,
  });

  return {
    app,
    todoService,
    projectService,
    auth,
  };
}

module.exports = {
  buildProject,
  buildMcpSession,
  createAgentEvalApp,
  createMcpEvalApp,
  createPkcePair,
  withAuthFixtureParity,
};
