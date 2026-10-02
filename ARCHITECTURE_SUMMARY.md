# Architecture Summary for Agents (Updated)

**Repository:** `todos-api`  
**Version:** 1.6.0  
**Last Updated:** 2026-03-25  
**Stack:** Express 5 + TypeScript + Prisma + PostgreSQL backend; React + Vite web client in `client-react/`; SwiftUI iOS app in `ios/TodosApp/`; Python agent-runner on Railway cron

---

## Quick Reference

| Aspect       | Value                                                                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend** | `client-react/` — Vite + React + TypeScript (primary). iOS app in `ios/TodosApp/` consumes the same API. The legacy vanilla JS client at `client/` has been removed; see `docs/reference/vanilla-client-archive.md` for history. |
| **Backend**  | `src/` — TypeScript, Express 5, Prisma ORM                                                                                                                                                                                       |
| **Database** | PostgreSQL 16 (26 models, 15+ enums)                                                                                                                                                                                             |
| **Testing**  | Jest (unit/integration/MCP), Playwright (UI), Custom (AI evals)                                                                                                                                                                  |
| **Auth**     | JWT + refresh rotation, Google OAuth, Apple Sign-In, Phone SMS OTP                                                                                                                                                               |
| **AI**       | OpenAI-compatible API (planning, critique, suggestions, decision assist)                                                                                                                                                         |
| **MCP**      | Remote Model Context Protocol for AI assistant connectors                                                                                                                                                                        |
| **Worker**   | Python (`agent-runner/`) — scheduled automation jobs on Railway cron                                                                                                                                                             |
| **API Docs** | Swagger/OpenAPI at `/api-docs`                                                                                                                                                                                                   |

---

## Load-Bearing Patterns (DO NOT BREAK)

### Frontend (Historical — vanilla JS client)

> **Historical.** The patterns in this subsection describe the removed vanilla JS web client (previously in `client/`). They are preserved here for context on legacy code and prior ADRs (001–004). For the current web client, see `client-react/` and `.claude/skills/react-client/SKILL.md`. Full archive: [`docs/reference/vanilla-client-archive.md`](docs/reference/vanilla-client-archive.md).

1. **Event Delegation** — `app.js` uses delegated listeners via `data-onclick` attributes. Never attach listeners directly to dynamic child elements.

2. **Filter Pipeline** — `#categoryFilter` + `filterTodos()` is the canonical filter path. All project/category/status filtering routes through it.

3. **Project Selection** — Use `setSelectedProjectKey(...)` for all project selection entry points. Do not bypass it.

4. **DOM-Ready Signal** — After auth/navigation, wait for `#todosView.active` + `#todosContent` visible + no `.loading` children. Use `waitForTodosViewIdle()` from `tests/ui/helpers/todos-view.ts`.

5. **Hooks Registry** — `hooks.*` object breaks circular dependencies. Modules call `hooks.X()` instead of importing directly.

6. **State Actions** — `stateActions.js` implements named state transitions (`applyUiAction`, `applyAsyncAction`, `applyDomainAction`).

7. **Page Bootstrap Shims** — `app-page.js` and `auth-page.js` run BEFORE `app.js`, inject DOM stubs, and handle auth gating. Do not bypass these shims.

### Backend

1. **Service Interfaces** — All services implement interfaces (`ITodoService`, `IProjectService`) for testability.

2. **Dual Implementation** — `TodoService` (in-memory for tests) vs `PrismaTodoService` (database-backed for runtime).

3. **Idempotency** — Agent actions use `AgentIdempotencyRecord` for retry safety (SHA-256 input hashing, 7-day TTL).

4. **Rate Limiting** — Per-route limits: auth (5/15min), email, API (100/15min), MCP (60/min).

5. **Structured Errors** — `HttpError` class with MCP-compatible error format.

6. **Standalone Page Routes** — `/auth` and `/app` routes serve standalone HTML pages before API routers. Do not reorder route registration.

---

## Directory Structure

> The tree below summarizes top-level directories; it is not exhaustive. The legacy `client/` vanilla JS tree has been removed; for its historical layout see [`docs/reference/vanilla-client-archive.md`](docs/reference/vanilla-client-archive.md).

```
todos-api/
├── client-react/                    # Primary web client — Vite + React + TypeScript
│   ├── src/                         # Components, features, hooks, mobile, views
│   ├── public/                      # Static assets
│   └── vite*.config.ts              # Separate build targets (main, landing, auth)
│
├── ios/TodosApp/                    # SwiftUI iOS app (iOS 17+), zero third-party deps
│   ├── TodosApp/                    # App/Core/Features/Components
│   └── TodosAppTests/               # XCTest suites
│
├── cli/                             # `td` CLI package wrapper
│
├── src/                             # Backend TypeScript source (175 files)
│   ├── server.ts                    # Entry point
│   ├── app.ts                       # Express app composition (417 lines)
│   ├── config.ts                    # Environment configuration
│   ├── swagger.ts                   # OpenAPI/Swagger spec
│   ├── routes/                      # Express routers (14 files, 138+ routes)
│   ├── services/                    # Domain services (62 files, 15K+ lines)
│   ├── middleware/                  # Express middleware (6 files)
│   ├── interfaces/                  # Service contracts (4 files)
│   ├── validation/                  # Validation schemas
│   ├── types/                       # TypeScript type definitions
│   ├── agent/                       # Agent executor (3.3K lines) + context
│   ├── ai/                          # AI decision logic
│   ├── mcp/                         # MCP protocol (5 files)
│   ├── domains/                     # Domain-oriented structure
│   └── infra/                       # Infrastructure (logging, metrics)
│
├── prisma/
│   ├── schema.prisma                # Database schema (26 models, 15+ enums)
│   └── migrations/                  # Database migrations
│
├── agent-runner/                    # Python worker (scheduled jobs, Railway cron)
│   ├── main.py                      # Command router
│   ├── jobs/                        # Job modules: daily, weekly, inbox, decomposer,
│   │                                # watchdog, evaluators, project_health, retention, etc.
│   ├── storage/                     # Enrollment, state, audit
│   └── mcp_client.py                # Backend API client
│
├── tests/
│   └── ui/                          # Playwright specs (40+ files)
│       └── helpers/                 # UI test helpers (auth, DOM waits)
│
├── test/                            # Jest setup/teardown
│   ├── setup.ts                     # Global test DB setup with safety guards
│   ├── teardown.ts                  # Prisma disconnect
│   └── jest.setup.ts                # Test utilities
│
├── evals/                           # AI evaluation suites
│   ├── agent/                       # Agent evals
│   ├── decision-assist/             # AI decision evals
│   ├── mcp/                         # MCP connector evals
│   └── planner/                     # Planner evals
│
├── docs/                            # Documentation (30+ files)
│   ├── adr/                         # Architecture Decision Records (5 ADRs)
│   ├── agent-ops/                   # Agent operations
│   ├── agent-queue/                 # Legacy markdown task protocol
│   ├── architecture/                # Current/target state
│   ├── harness/                     # Test harness docs
│   ├── memory/                      # Context compaction
│   ├── ops/                         # Deployment runbooks
│   └── ui-revamp/                   # UI redesign specs
│
├── .github/workflows/
│   ├── ci.yml                       # Unit + integration CI
│   ├── mcp.yml                      # MCP protocol tests
│   ├── ui-tests.yml                 # Playwright fast suite
│   └── ui-visual.yml                # Visual snapshot tests
│
└── public/                          # Static public assets (logos, icons)
```

---

## Frontend Architecture

### Multi-Page Architecture (Mar 2026 Refactor)

The app transitioned from a single-page app to a **multi-page architecture** with standalone pages for auth and app views.

```
┌─────────────────────────────────────────────────────────────┐
│ Landing Page (client/index.html @ /)                        │
│ - Marketing/hero section                                    │
│ - Feature highlights                                        │
│ - Login/register CTA buttons                                │
│ - Embedded auth forms (login, register, phone)              │
│ - Inline scripts call app.js functions                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Auth Page (client/public/auth.html @ /auth)                 │
│ - Standalone auth page (392 lines)                          │
│ - auth-page.js (779 lines) handles form submissions         │
│ - auth-page.css (89 lines) for page-specific styles         │
│ - Redirects to /app on successful login                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ App Page (client/public/app.html @ /app)                    │
│ - Standalone app workspace (3,241 lines)                    │
│ - app-page.js (139 lines) bootstrap shim:                   │
│   1. Auth gate: redirect to /auth if no token               │
│   2. Inject DOM stubs (#authView, #profileView, etc.)       │
│   3. Patch window.logout to redirect instead of toggle      │
│ - Loads app.js (1,733 lines) as ES module                   │
│ - Full todo/project/AI functionality                        │
└─────────────────────────────────────────────────────────────┘
```

### Page Bootstrap Flow

```
App Page Load:
1. <script src="/utils/authSession.js"> — Load AppState
2. <script src="/public/app-page.js"> — Run bootstrap shim:
   - Check for valid token → redirect to /auth if missing
   - Inject stub user if social OAuth (no user object)
   - Inject DOM stubs (#authView, #profileView, etc.)
   - Patch window.logout to redirect to /auth
3. <script type="module" src="/app.js"> — Load main app:
   - Import 420+ exports from 22+ modules
   - Wire 137 hooks entries
   - Bind delegated DOM events
   - Call showAppView() if authenticated

Auth Page Load:
1. <script src="/utils/authSession.js"> — Load AppState
2. <script src="/public/auth-page.js"> — Run auth handlers:
   - Login form submission
   - Register form submission
   - Phone OTP flow
   - Password reset
   - Social OAuth initiation
3. On success → redirect to /app with tokens
```

### Composition Model (app.js)

```
┌─────────────────────────────────────────────────────────────┐
│ app.js (1,733 lines, 57KB)                                  │
│ - Imports 420+ named exports from 22+ modules               │
│ - Wires 137 hooks entries                                   │
│ - Binds delegated DOM events via data-onclick               │
│ - Exposes ~120 functions to window.*                        │
│ - Calls initGlobalListeners() from bootstrap/               │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐  ┌─────────────────┐  ┌───────────────┐
│ store.js      │  │ todosService.js │  │ projectsState │
│ - state       │  │ - API calls     │  │ - Project CRUD│
│ - hooks       │  │ - Todo ops      │  │ - Headings    │
└───────────────┘  └─────────────────┘  └───────────────┘
        │                   │                   │
        ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│ Feature Modules (38 total, 1.5MB)                           │
│ - filterLogic.js (1,300 lines) — canonical filter pipeline  │
│ - authUi.js — social/phone auth handlers                    │
│ - aiWorkspace.js — AI plan/critique/brain-dump              │
│ - drawerUi.js (2.1K lines) — todo edit drawer               │
│ - railUi.js — projects sidebar navigation                   │
│ - homeDashboard.js — AI-powered focus dashboard             │
│ - commandPalette.js — Ctrl+K navigation                     │
│ - quickEntry.js — natural date parsing                      │
│ - stateActions.js (688 lines) — named state transitions     │
│ - uiTemplates.js — row/drawer templates                     │
│ - soulConfig.js — workspace configuration                   │
└─────────────────────────────────────────────────────────────┘
```

### State Management

**Single shared state object** (`store.js`, 342 lines, ~100 properties):

```javascript
state = {
  // Auth
  currentUser: null,
  accessToken: null,
  refreshToken: null,

  // Todos
  todos: [],
  filteredTodos: [],
  selectedTodoIds: new Set(),

  // Projects
  projects: [],
  selectedProjectKey: null,
  expandedHeadings: new Set(),

  // Workspace
  currentWorkspaceView: "home", // 'home' | 'unsorted' | 'home'
  currentDateView: "all", // 'all' | 'today' | 'upcoming' | ...

  // Drawer
  drawerOpen: false,
  drawerMode: null, // 'create' | 'edit' | 'view'
  draftTodo: null,

  // AI
  aiWorkspaceOpen: false,
  aiCriticResponse: null,
  aiPlanDraft: null,

  // UI
  darkMode: false,
  commandPaletteOpen: false,
  quickEntryOpen: false,
  // ... 80+ more properties
};
```

**Mutation pattern:** Direct mutation within named actions:

```javascript
// stateActions.js
function applyDomainAction(actionType, payload) {
  switch (actionType) {
    case "TODO_CREATED":
      state.todos.push(payload.todo);
      state.filteredTodos = filterTodos();
      break;
    case "DRAWER_OPEN":
      state.drawerOpen = true;
      state.drawerMode = payload.mode;
      state.draftTodo = payload.todo;
      break;
    case "WORKSPACE/VIEW:SET":
      state.currentWorkspaceView = payload.view;
      break;
    // ... 50+ action types
  }
  EventBus.dispatch("state:changed", { action: actionType, payload });
}
```

### Event System

**EventBus** (17 lines, pub-sub):

```javascript
// platform/events/eventBus.js
const listeners = new Map();

export function subscribe(event, callback) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(callback);
  return () => listeners.get(event).delete(callback);
}

export function dispatch(event, payload) {
  if (listeners.has(event)) {
    listeners.get(event).forEach((cb) => cb(payload));
  }
}

// In use:
EventBus.dispatch("todos:changed"); // Triggers filter + render
EventBus.dispatch("todos:render"); // Render only
EventBus.dispatch("state:changed"); // State changed (logging, persistence)
```

### DOM Rendering

**Full list replacement** (common pattern):

```javascript
// filterLogic.js
export function renderTodos() {
  const container = document.getElementById("todosContent");
  const html = state.filteredTodos.map((todo) => renderTodoRow(todo)).join("");
  container.innerHTML = html; // Full replacement
}

// Micro-patches for single-todo updates:
// todosViewPatches.js (378 lines)
export function patchTodoRowCompletion(todoId, completed) {
  const row = document.querySelector(`[data-todo-id="${todoId}"]`);
  const checkbox = row.querySelector(".todo-checkbox");
  checkbox.checked = completed;
  row.classList.toggle("completed", completed);
}
```

---

## Backend Architecture

### Request Flow

```
┌─────────────────────────────────────────────────────────────┐
│ server.ts (entry point)                                     │
│ - Creates services (Prisma-backed)                          │
│ - Boots Express app                                         │
│ - Graceful shutdown handling                                │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ app.ts (composition root, 417 lines)                        │
│ - Middleware stack (CORS, helmet, rate limiting, logging)   │
│ - Swagger/OpenAPI docs at /api-docs                         │
│ - Standalone page routes (/auth, /app)                      │
│ - Route registration                                        │
│ - Service injection                                         │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐  ┌─────────────────┐  ┌───────────────┐
│ /auth         │  │ /todos          │  │ /projects     │
│ /ai           │  │ /users          │  │ /agent        │
│ /mcp          │  │ /capture        │  │ /feedback     │
│ /preferences  │  │ /admin          │  │               │
└───────────────┘  └─────────────────┘  └───────────────┘
        │                   │                   │
        ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│ Services Layer (62 files, 15K+ lines)                       │
│ - AuthService, SocialAuthService, PhoneAuthService          │
│ - PrismaTodoService, TodoService (in-memory for tests)      │
│ - ProjectService, HeadingService                            │
│ - AiPlannerService, AiSuggestionStore                       │
│ - AgentExecutor, McpOAuthService                            │
│ - FeedbackService (triage, duplicate, promotion, automation)│
│ - CaptureService, PreferencesService                        │
│ - AgentEnrollmentService, FailedAutomationActionService     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Prisma ORM Layer                                            │
│ - schema.prisma (26 models, 15+ enums)                      │
│ - Auto-generated client                                     │
└─────────────────────────────────────────────────────────────┘
```

### Middleware Stack (in order)

```typescript
// app.ts
app.use(requestIdMiddleware); // Adds X-Request-ID
app.use(routeLatencyMetrics); // Prometheus metrics
app.use(cors({ origin: CORS_ORIGINS }));
app.use(
  helmet({
    // Security headers
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'nonce-<random>'"],
        // ...
      },
    },
  }),
);
app.use(rateLimiters.authLimiter); // 5 req / 15 min
app.use(rateLimiters.apiLimiter); // 100 req / 15 min
app.use(rateLimiters.mcpLimiter); // 60 req / min
app.use(cookieParser());
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

// Swagger/OpenAPI docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api-docs.json", (req, res) => res.send(swaggerSpec));

// Static files
app.use(express.static(path.join(__dirname, "../client")));
app.use(express.static(path.join(__dirname, "../public")));
app.use(
  express.static(path.join(__dirname, "../node_modules/chrono-node/dist/esm")),
);

// Standalone page routes — MUST be before /auth API router
const authPage = path.join(__dirname, "../client/public/auth.html");
const appPage = path.join(__dirname, "../client/public/app.html");
app.get("/auth", (_req, res) => res.sendFile(authPage));
app.get("/app", (_req, res) => res.sendFile(appPage));
app.get("/app/{*path}", (_req, res) => res.sendFile(appPage));

// API rate limit zone
app.use("/api", apiLimiter);

// Routes
app.use("/auth", authRouter); // POST /auth/login, /auth/register, etc.
app.use("/todos", todosRouter);
app.use("/projects", projectsRouter);
// ...
```

### Standalone Page Routes

**Critical:** Page routes must be registered BEFORE the `/auth` API router to intercept GET requests:

```typescript
// Correct order (DO NOT CHANGE):
// 1. Static middleware
app.use(express.static(path.join(__dirname, "../client")));

// 2. Standalone page routes
app.get("/auth", (_req, res) => res.sendFile(authPage));
app.get("/app", (_req, res) => res.sendFile(appPage));
app.get("/app/{*path}", (_req, res) => res.sendFile(appPage));

// 3. API routes (POST /auth/login, etc.)
app.use("/auth", authRouter);
```

If reordered, `GET /auth` would hit the API router and return 404.

### Agent Architecture

**Dual-mode execution:**

```
┌─────────────────────────────────────────────────────────────┐
│ Scheduled Jobs (Python worker - agent-runner/)              │
│ - Deployed on Railway cron                                  │
│ - 7 job types: daily, weekly, inbox, watchdog, etc.         │
│ - Enrollment-based auth (refresh token → short-lived JWT)   │
│ - Calls Node API via HTTP                                   │
│ - Persists results to AgentJobRun table                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ On-Demand Jobs (sync - agentExecutor.ts)                    │
│ - User-triggered via API (POST /agent/write/*)              │
│ - 98 actions dispatched synchronously                       │
│ - Long-running LLM calls block Express event loop ⚠️        │
│ - Idempotency via AgentIdempotencyRecord                    │
└─────────────────────────────────────────────────────────────┘
```

**Agent executor** (`agentExecutor.ts`, 3,362 lines):

```typescript
// Simplified structure
export async function executeAgentAction(
  action: AgentAction,
  userId: string,
  input: unknown,
) {
  // 1. Validate input with Zod
  const validated = actionValidators[action].parse(input);

  // 2. Check idempotency (SHA-256 hash of action + input)
  const idempotencyKey = hashActionInput(action, validated);
  const existing = await checkIdempotency(idempotencyKey);
  if (existing) return existing.result;

  // 3. Dispatch to handler (98 actions)
  let result: unknown;
  switch (action) {
    case "plan_today":
      result = await handlePlanToday(userId, validated);
      break;
    case "break_down_project":
      result = await handleBreakDownProject(userId, validated);
      break;
    // ... 96 more cases
  }

  // 4. Persist audit log
  await persistAuditLog(userId, action, result);

  // 5. Cache result for idempotency
  await cacheIdempotencyResult(idempotencyKey, result);

  return result;
}
```

### Database Schema (Key Models)

```prisma
// Core models
model User {
  id            String    @id @default(uuid())
  email         String?   @unique
  password      String?   // nullable for social/phone users
  phoneE164     String?   @unique
  role          UserRole  @default(USER)
  plan          UserPlan  @default(FREE)
  socialAccounts SocialAccount[]
  refreshTokens RefreshToken[]
  todos         Todo[]
  projects      Project[]
  // ...
}

model SocialAccount {
  id                      String   @id @default(uuid())
  userId                  String
  provider                String   // "google" | "apple"
  providerSubject         String   // Provider's stable user ID
  emailAtProvider         String?
  emailVerifiedAtProvider Boolean  @default(false)
  user                    User     @relation(fields: [userId], references: [id])

  @@unique([provider, providerSubject])
}

model Todo {
  id              String         @id @default(uuid())
  userId          String
  title           String
  description     String?
  status          TodoStatus     @default(INBOX)
  priority        TodoPriority   @default(MEDIUM)
  dueDate         DateTime?
  projectId       String?
  headingId       String?
  dependsOnTaskIds String[]
  recurrenceType  TodoRecurrenceType?
  recurrenceRule  String?
  tags            String[]
  energy          TodoEnergy?
  source          TodoSource     @default(MANUAL)
  user            User           @relation(fields: [userId], references: [id])
  project         Project?       @relation(fields: [projectId], references: [id])
  heading         Heading?       @relation(fields: [headingId], references: [id])
  subtasks        Subtask[]
  aiSuggestions   AiSuggestion[]
  // ...
}

// AI/Agent models
model AiSuggestion {
  id          String             @id @default(uuid())
  userId      String
  type        AiSuggestionType   // "critique" | "plan" | "brain_dump"
  status      AiSuggestionStatus // "pending" | "applied" | "dismissed"
  input       Json
  output      Json
  appliedTodoIds String[]
  createdAt   DateTime           @default(now())
  user        User               @relation(fields: [userId], references: [id])
}

model AgentJobRun {
  id          String   @id @default(uuid())
  userId      String
  jobType     String   // "daily" | "weekly" | "inbox" | etc.
  status      String   // "pending" | "running" | "completed" | "failed"
  input       Json
  output      Json?
  startedAt   DateTime?
  completedAt DateTime?
  // ...
}

// MCP models
model McpAssistantSession { /* ... */ }
model McpAuthorizationCode { /* ... */ }
model McpRefreshToken { /* ... */ }

// Feedback models
model FeedbackRequest {
  id          String         @id @default(uuid())
  userId      String
  type        FeedbackType   // "bug" | "feature" | "improvement"
  status      FeedbackStatus // "new" | "triaged" | "promoted" | "closed"
  description String
  classification FeedbackClassification?
  // ...
}
```

---

## Testing Strategy

### Test Pyramid

```
                    ┌─────────────────┐
                    │   UI (40+ specs)│  Playwright (fast + visual)
                   ─├─────────────────┤─
                  │  Integration (6)  │  Jest + supertest + PostgreSQL
                 ──├─────────────────┤──
                │    Unit (17)        │  Jest (in-memory services)
               ───┴─────────────────┴───
                      ┌───────────────┐
                      │  MCP (separate)│  Jest (MCP protocol)
                     ──┴───────────────┴──
```

### Required CI Checks

```bash
# All must pass for PR merge
npx tsc --noEmit                    # Type checking
npm run format:check                # Prettier
npm run lint:html                   # HTML validation
npm run lint:css                    # CSS linting
npm run test:unit                   # Unit tests (300+ tests)
npm run test:mcp                    # MCP protocol tests
CI=1 npm run test:ui:fast           # Fast UI suite (excludes @visual)
```

### UI Test Rules

1. **Fast suite** (`test:ui:fast`) — PR-gating tier, excludes `@visual` tests
2. **Full suite** (`test:ui`) — Includes visual snapshots
3. **Snapshot rules:**
   - Tests with `toHaveScreenshot()` MUST include `@visual` tag
   - CI runs on `ubuntu-latest` (macOS screenshots won't match)
   - Update snapshots in Docker for consistency
4. **Auth setup:** Use `openTodosViewWithStorageState()` or `bootstrapTodosContext()` from `tests/ui/helpers/todos-view.ts`
5. **DOM waits:** Use `waitForTodosViewIdle()` — never `page.waitForTimeout()`
6. **Multi-page awareness:** Tests must handle `/auth` and `/app` as separate pages

### Test Database Strategy

- **Isolation:** Separate `todos_test` database
- **Setup:** `prisma migrate reset --force` before integration tests; Prisma 7 does not run seeding or client generation during reset
- **Safety guards:**
  - Refuses URLs without "test" in name
  - Refuses non-local hosts (unless `ALLOW_REMOTE_TEST_DB=true`)
  - Validates PostgreSQL URL format

---

## Known Issues & Technical Debt

### Critical Hotspots

| File                         | Lines  | Issue                                                               |
| ---------------------------- | ------ | ------------------------------------------------------------------- |
| `client/app.js`              | 1,733  | Imports 420+ exports, wires 137 hooks, assigns 120 window functions |
| `client/index.html`          | 4,010  | Landing page with embedded auth forms, inline scripts               |
| `client/styles.css`          | 10,778 | Monolithic stylesheet (216KB), not split by page                    |
| `client/drawerUi.js`         | 2,146  | Mixes rendering, draft management, AI assist, kebab menu            |
| `client/projectsState.js`    | 1,391  | Handles CRUD, headings, dialogs, rail updates                       |
| `client/aiWorkspace.js`      | 1,517  | Owns critique, plan, brain-dump in one module                       |
| `src/agent/agentExecutor.ts` | 3,362  | Dispatches 98 actions synchronously, blocking event loop            |
| `client/stateActions.js`     | 688    | 50+ action types, large switch statements                           |
| `client/public/auth-page.js` | 779    | Auth form handlers — could be modularized                           |

### Open Issues

1. **Pre-existing UI test failures** — Error-state tests failing on master (varies by branch)
2. **Stale git branches** — 30+ branches including worktrees
3. **Dual runtime** — Python worker + Node.js backend
4. **No async agent queue** — ADR-005 accepted but not implemented
5. **Frontend state coupling** — Direct mutation of shared `state` object
6. **CSS not split** — styles.css remains monolithic despite multi-page architecture
7. **No landing-page.js** — Landing page logic embedded in index.html inline scripts

---

## Accepted ADRs

| ADR | Title                             | Status                                           |
| --- | --------------------------------- | ------------------------------------------------ |
| 001 | Frontend composition roots        | Accepted (not implemented)                       |
| 002 | Event bus contract                | Accepted                                         |
| 003 | Agent worker queue                | Accepted                                         |
| 004 | Domain-oriented backend structure | Accepted                                         |
| 005 | Agent execution architecture      | Accepted (BullMQ for on-demand, not implemented) |

---

## Environment Variables (Key)

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/todos_dev
DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5432/todos_test

# Auth
JWT_ACCESS_SECRET=<secret>
JWT_REFRESH_SECRET=<secret>
ADMIN_BOOTSTRAP_SECRET=<optional>

# CORS
CORS_ORIGINS=https://app.example.com

# AI
AI_PROVIDER_ENABLED=true
AI_PROVIDER_API_KEY=<key>
AI_PROVIDER_MODEL=gpt-4o-mini
AI_DAILY_SUGGESTION_LIMIT=50

# Social Auth
GOOGLE_CLIENT_ID=<id>
GOOGLE_CLIENT_SECRET=<secret>
APPLE_CLIENT_ID=<id>
APPLE_TEAM_ID=<team>
TWILIO_ACCOUNT_SID=<sid>

# Feature Flags
GOOGLE_LOGIN_ENABLED=true
APPLE_LOGIN_ENABLED=true
PHONE_LOGIN_ENABLED=true
AI_DECISION_ASSIST=true
```

---

## Common Operations

### Local Development

```bash
# Start PostgreSQL
npm run docker:up

# Run migrations
npm run prisma:migrate

# Start dev server
npm run dev

# Run all checks
npm run check:all
```

### Testing

```bash
# Unit tests
npm run test:unit

# MCP tests
npm run test:mcp

# Integration tests
npm run test:integration

# UI fast suite
CI=1 npm run test:ui:fast

# UI full suite (includes visual)
npm run test:ui

# Update snapshots (in Docker for consistency)
docker run --rm -v "$(pwd)":/work -w /work \
  mcr.microsoft.com/playwright:v1.58.2 \
  /bin/bash -c "npm ci && npx playwright test --update-snapshots"
```

### Database

```bash
# Generate Prisma client
npm run prisma:generate

# Create migration
npm run prisma:migrate

# Deploy migrations (production)
npm run prisma:migrate:deploy

# Open Prisma Studio
npm run prisma:studio

# Reset database (WARNING: deletes all data)
npm run prisma:reset
```

### API Documentation

```bash
# View Swagger UI
open http://localhost:3000/api-docs

# Download OpenAPI spec
curl http://localhost:3000/api-docs.json
```

---

## Security Checklist

- [x] JWT rotation on refresh
- [x] OAuth state parameter (CSRF prevention)
- [x] Apple nonce validation
- [x] Rate limiting per route
- [x] Helmet CSP headers
- [x] Input validation with Zod
- [x] Anti-enumeration (generic auth errors)
- [x] Idempotency for agent actions
- [x] Request ID tracking (X-Request-ID)
- [ ] Dependency updates (manual)
- [ ] Security headers audit (periodic)

---

## Deployment

### Production Build

```bash
# Compile TypeScript
npm run build

# Deploy migrations
npm run prisma:migrate:deploy

# Start server
npm start
```

### Railway Deployment

- PostgreSQL via Railway managed database
- Python worker deployed as separate cron service
- Remote MCP surface enabled at `/mcp`
- Static files served from `/client` and `/public`

---

## File Size Summary

| Category      | Files | Total Lines | Notes                                                 |
| ------------- | ----- | ----------- | ----------------------------------------------------- |
| Frontend HTML | 4     | 7,643       | index.html (4,010), app.html (3,241), auth.html (392) |
| Frontend JS   | 40+   | 1.5MB+      | app.js (1,733), modules (38 files)                    |
| Frontend CSS  | 2     | 10,867      | styles.css (10,778), auth-page.css (89)               |
| Backend TS    | 175   | 20K+        | services (62), routes (14), middleware (6)            |
| Tests         | 60+   | —           | Unit (17), Integration (6), UI (40+)                  |
| Docs          | 30+   | —           | ADRs (5), architecture, ops, harness                  |

---

## Contact & Support

- **Issues:** https://github.com/karthikg80/todos-api/issues
- **Documentation:** `docs/` directory
- **ADRs:** `docs/adr/` directory
- **Architecture:** `docs/architecture/` directory
- **API Docs:** `/api-docs` (Swagger UI)

---

**Last reviewed:** 2026-03-25  
**Next review:** After ADR-001 implementation or CSS split

**Changes since previous summary:**

- Multi-page architecture (landing, auth, app) — Mar 2026 refactor
- Standalone page bootstrap shims (app-page.js, auth-page.js)
- Swagger/OpenAPI documentation at `/api-docs`
- Updated file counts and line counts
- Added file size summary table
