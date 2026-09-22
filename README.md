# Todos — AI Planning Workspace

A calm workspace for turning scattered tasks into focused days, reviewed weeks, and clear next actions.

## What Todos Does

**Plan your days** — AI generates time-boxed daily plans based on your priorities, energy level, and deadlines. Review, adjust, and start working.

**Capture anything** — Dump tasks, ideas, and notes into your inbox. Type naturally ("Call dentist tomorrow 2pm") or let AI triage batches into projects.

**Review your weeks** — A structured weekly review surfaces stale tasks, missing next actions, and forgotten commitments. One click to clean up.

**Connect your AI assistant** — Claude, ChatGPT, or any MCP-compatible client can manage your tasks conversationally. The legacy `/mcp` connector exposes the broad 92-tool catalog; the ChatGPT-native profile at `/mcp/app` exposes six focused, schema-stable tools, including an optional interactive Today Plan component.

**Automate the routine** — Daily plans, weekly reviews, inbox triage, and stale task cleanup run on schedule in the background.

## Quick Links

- [Product Overview](docs/product-overview.md)
- [UX Principles](UX.md)
- [Docs Index](docs/README.md)
- [Assistant MCP](docs/assistant-mcp.md)
- [Installable Todos Plugin](docs/assistant-mcp.md#local-plugin-installation)
- [Planner Runtime](docs/planner-runtime.md)
- [Product Review Specs](docs/specs/)

## Product Surfaces

- **Home Dashboard** — AI-curated top focus, due-soon groups, daily plan, priorities brief, and stale alerts
- **Inbox** — Quick capture with AI-powered triage and promotion to tasks/projects
- **Today / Upcoming / Scheduled** — Time-scoped views with energy-aware planning
- **Weekly Review** — Structured review with findings and one-click apply
- **AI Assistant** — On-create critique, drawer suggestions, brain-dump-to-plan, goal decomposition
- **MCP Connectivity** — Remote tool surface for Claude, ChatGPT, and automation agents
- **Projects & Organization** — Projects, areas, goals, headings, tags, dependencies, recurrence
- **Command Palette** — Keyboard-first navigation and task search (Cmd+K)

## Technical Stack

- Express + Prisma + PostgreSQL backend in `src/` (TypeScript, input validation, structured errors)
- Vite + React + TypeScript web client in `client-react/`
- SwiftUI iOS app (iOS 17+) in `ios/TodosApp/` — zero third-party dependencies
- `td` CLI (Commander.js) in `cli/` + `src/cli/`
- Python agent runner in `agent-runner/` (scheduled jobs on Railway cron)
- JWT auth with refresh-token rotation, email verification, Google/Apple/phone login
- Remote MCP surface and internal `/agent` surface for assistant connectors
- Docker Compose for local PostgreSQL development
- Legacy vanilla JS web client in `client/` has been removed; see [`docs/reference/vanilla-client-archive.md`](docs/reference/vanilla-client-archive.md) for context

## Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose
- PostgreSQL (via Docker or local installation)

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd todos-api
npm install
```

### 2. Set Up Environment

Copy the example environment file:

```bash
cp .env.example .env
```

The `.env` file contains:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/todos_dev"
DATABASE_URL_TEST="postgresql://postgres:postgres@localhost:5432/todos_test"
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key-change-in-production
JWT_ACCESS_SECRET=your-access-jwt-secret-change-in-production
JWT_REFRESH_SECRET=your-refresh-jwt-secret-change-in-production
ADMIN_BOOTSTRAP_SECRET=
EMAIL_FEATURES_ENABLED=true
CORS_ORIGINS=
```

Production notes:

- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be set to strong, different values.
- `JWT_SECRET` is supported as a backward-compatibility fallback only.
- `CORS_ORIGINS` must be set (comma-separated allowlist).
- `ADMIN_BOOTSTRAP_SECRET` is optional, and enables first-admin provisioning from the Profile UI.
- `DATABASE_URL` must be set in production.
- If `EMAIL_FEATURES_ENABLED=true`, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and `BASE_URL`.
- AI model integration is optional: set `AI_PROVIDER_ENABLED=true` and configure `AI_PROVIDER_API_KEY` to call a live provider.
- Configure `AI_DAILY_SUGGESTION_LIMIT` to cap daily AI generations per user (default: `50`).
- Optional per-plan caps: `AI_DAILY_SUGGESTION_LIMIT_FREE`, `AI_DAILY_SUGGESTION_LIMIT_PRO`, `AI_DAILY_SUGGESTION_LIMIT_TEAM`.

### 3. Start Database

```bash
npm run docker:up
```

This starts a PostgreSQL 16 container with both development and test databases.

### 4. Run Migrations

```bash
npm run prisma:migrate
```

This creates the database schema and generates the Prisma client.

### 5. Start the Server

```bash
npm run dev
```

The app shell, API, and MCP endpoints will be available at http://localhost:3000

## Product Surfaces

The repo currently ships more than a CRUD API. The main user-facing and machine-facing surfaces are:

- `client/`
  Static frontend app with Home, Inbox, All tasks, Today, Upcoming, Completed, project rail, task drawer, onboarding, feedback, and admin views.
- `/todos`, `/projects`, `/users`, `/preferences`
  Core authenticated task, project, profile, and planning-preference APIs.
- `/ai`
  AI decision-assist, plan-drafting, priorities brief, suggestion history, and feedback-summary APIs.
- `/capture`
  Capture inbox API for recording and triaging unstructured items.
- `/feedback` and `/admin`
  Feedback submission plus admin review, automation, and promotion workflows.
- `/agent`
  Internal machine-usable action surface used by the frontend and automation flows.
- `/mcp`, `/oauth`, `/.well-known/*`
  Public assistant-connector surface with OAuth, scoped tools, and MCP transport endpoints.

## Current Capability Snapshot

Today the repo supports:

- personal task management with richer metadata than a basic todo app
- project organization with nested project paths and project headings
- daily planning and weekly review workflows
- AI-assisted suggestions across multiple UI surfaces
- authenticated remote assistant access through MCP
- agent/automation control-plane capabilities such as job runs, metrics, recommendation feedback, day context, and learning recommendations

Important current limitations:

- the product is stronger on prioritization and planning than on full calendar scheduling/timeboxing
- the remote MCP layer is capable, but assistant-session management is still more operational than polished in the in-app UI
- some advanced backend capabilities are exposed more clearly through `/agent` and MCP than through the end-user UI today

## Available Scripts

### Development

- `npm run dev` - Start server with auto-reload (nodemon)
- `npm start` - Start server in production mode

### Database Management

- `npm run db:setup` - One-command setup: start Docker + run migrations
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Create and apply new migration
- `npm run prisma:migrate:deploy` - Deploy migrations (production)
- `npm run prisma:studio` - Open Prisma Studio (database GUI)
- `npm run prisma:reset` - Reset database (WARNING: deletes all data)

### Docker

- `npm run docker:up` - Start PostgreSQL container
- `npm run docker:down` - Stop PostgreSQL container
- `npm run docker:reset` - Reset Docker volumes (deletes all data)
- `npm run docker:logs` - View PostgreSQL logs

### Local Domain Routing

To use a stable local host alias on this laptop without touching production or staging:

1. Add an `/etc/hosts` entry:

```bash
echo '127.0.0.1 dev.todos.karthikg.in' | sudo tee -a /etc/hosts
```

2. Start the API on port `3000`:

```bash
npm run dev
```

3. Start the React dev server on port `5173`:

```bash
npm run dev:react
```

4. Open the app at:

```text
http://dev.todos.karthikg.in:5173/app/
```

The Vite config explicitly allows `dev.todos.karthikg.in`, and API requests continue to proxy to the backend on `http://localhost:3000`.

If you need the backend to generate links for the local host alias, set:

```bash
BASE_URL=http://dev.todos.karthikg.in:3000
GOOGLE_REDIRECT_URI=http://dev.todos.karthikg.in:3000/auth/google/callback
```

### Local HTTPS Routing

For a trusted local HTTPS endpoint on this laptop, use `mkcert` plus the repo-local Caddy proxy:

1. Install local tools once:

```bash
brew install mkcert caddy
mkcert -install
```

2. Add the host alias once:

```bash
echo '127.0.0.1 dev.todos.karthikg.in' | sudo tee -a /etc/hosts
```

3. Generate the local cert:

```bash
npm run https:certs
```

4. Start the backend and React dev server:

```bash
BASE_URL=https://dev.todos.karthikg.in \
GOOGLE_REDIRECT_URI=https://dev.todos.karthikg.in/auth/google/callback \
npm run dev

npm run dev:react
```

5. Start the HTTPS reverse proxy:

```bash
npm run https:proxy
```

6. Open:

```text
https://dev.todos.karthikg.in/app/
```

The local proxy routes `/app` and Vite dev assets to `http://127.0.0.1:5173`, and routes `/auth`, `/todos`, `/users`, and the rest of the backend surface to `http://127.0.0.1:3000`.

If you want one command after the one-time setup steps above, use:

```bash
npm run dev:https
```

That helper starts the local DB, backend, React dev server, and Caddy proxy together with:

- `BASE_URL=https://dev.todos.karthikg.in`
- `GOOGLE_REDIRECT_URI=https://dev.todos.karthikg.in/auth/google/callback`
- `EMAIL_FEATURES_ENABLED=false` unless you explicitly override it

### Testing

- `npm test` - Run all tests
- `npm run test:integration` - Run integration tests with deterministic local test DB setup
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

Integration test DB behavior:

- If `TEST_DATABASE_URL` or `DATABASE_URL_TEST` is set, integration tests use that URL.
- If neither is set, integration tests default to:
  - `postgresql://postgres:postgres@localhost:5432/todos_test?schema=public`
- The test bootstrap runs `prisma migrate reset --force --skip-seed --skip-generate` for a deterministic schema.
- Safety guardrails:
  - Refuses URLs that do not look like a test database.
  - Refuses non-local DB hosts by default (`localhost`, `127.0.0.1`, `::1` only).
  - Set `ALLOW_REMOTE_TEST_DB=true` only when you intentionally need a remote test DB.

### Build

- `npm run build` - Build TypeScript + generate Prisma client

## Selected Core API Endpoints

The list below is intentionally partial and highlights the classic todo CRUD
surface. The current repo also exposes project, auth, AI, capture, feedback,
agent, and MCP endpoints described above.

### Create a Todo

```http
POST /todos
Content-Type: application/json

{
  "title": "Buy groceries",
  "description": "Milk, eggs, bread"
}

# Response: 201 Created
{
  "id": "uuid",
  "title": "Buy groceries",
  "description": "Milk, eggs, bread",
  "completed": false,
  "createdAt": "2026-02-07T...",
  "updatedAt": "2026-02-07T..."
}
```

### Get All Todos

```http
GET /todos

# Optional query parameters
# completed=true|false
# priority=low|medium|high
# category=<exact-category-name>
# sortBy=order|createdAt|updatedAt|dueDate|priority|title
# sortOrder=asc|desc
# page=<positive-integer>        # requires limit
# limit=<1-100>

# Response: 200 OK
[
  {
    "id": "uuid",
    "title": "Buy groceries",
    "description": "Milk, eggs, bread",
    "completed": false,
    "createdAt": "2026-02-07T...",
    "updatedAt": "2026-02-07T..."
  }
]
```

### Get a Single Todo

```http
GET /todos/:id

# Response: 200 OK
{
  "id": "uuid",
  "title": "Buy groceries",
  ...
}

# Response: 404 Not Found
{
  "error": "Todo not found"
}
```

### Update a Todo

```http
PUT /todos/:id
Content-Type: application/json

{
  "title": "Buy groceries and cook dinner",
  "description": "Updated description",
  "completed": true
}

# Response: 200 OK
{
  "id": "uuid",
  "title": "Buy groceries and cook dinner",
  "description": "Updated description",
  "completed": true,
  "createdAt": "2026-02-07T...",
  "updatedAt": "2026-02-07T..."
}

# Response: 404 Not Found
{
  "error": "Todo not found"
}
```

### Delete a Todo

```http
DELETE /todos/:id

# Response: 204 No Content

# Response: 404 Not Found
{
  "error": "Todo not found"
}
```

## Validation Rules

### Title

- ✅ Required
- ✅ Must be a string
- ✅ Cannot be empty (after trimming whitespace)
- ✅ Maximum 200 characters

### Description

- ✅ Optional
- ✅ Must be a string if provided
- ✅ Maximum 1000 characters

### Completed

- ✅ Must be a boolean if provided

## Testing

The project has three testing layers:

- Unit tests for core validation/business logic (`npm run test:unit`)
- Integration API tests against PostgreSQL (`npm run test:integration`)
- Playwright UI coverage for end-to-end browser behavior (`npm run test:ui:fast` / `npm run test:ui`)

Test totals change over time. Use command output as the source of truth rather than fixed counts in docs.

### Run Tests

```bash
# Unit tests (default test command)
npm run test:unit

# Watch mode
npm run test:watch

# Unit coverage
npm run test:coverage

# API integration tests (requires test DB)
npm run test:integration
```

### UI Testing (Playwright)

```bash
# Run full UI suite (includes visual snapshot tests)
npm run test:ui

# Run fast deterministic UI suite (excludes @visual snapshot tests)
npm run test:ui:fast

# Update baseline screenshots
npm run test:ui:update

# Run in headed mode locally
npm run test:ui:headed
```

#### Fast vs Full UI suites

- `npm run test:ui:fast`
  - Runs the PR-gating tier.
  - Excludes tests tagged `@visual`.
  - Intended for fast, deterministic DOM/state validation.
- `npm run test:ui`
  - Runs the full suite, including `@visual` snapshot assertions.
  - Intended for local visual verification and dedicated visual CI runs.

#### Linux-consistent visual runs

For screenshot consistency with CI, run visual tests in a Linux environment (container/CI) before updating snapshots:

```bash
# Full suite in CI-like mode
CI=1 npm run test:ui
```

### UI Quality Checks

```bash
# CSS lint (inline <style> blocks in HTML)
npm run lint:css

# HTML validation
npm run lint:html

# Local link crawl
npm run test:links
```

### Test Database

Tests automatically use a separate test database (`todos_test`) to avoid affecting development data. The test setup:

1. Runs migrations on test database before all tests
2. Cleans test data before each test
3. Disconnects Prisma client after all tests

## Project Structure

```
todos-api/
├── src/                     # Express + Prisma backend (TypeScript)
│   ├── routes/              # Express routers
│   ├── services/            # Domain services (todos, projects, auth, AI)
│   ├── domains/             # Domain-oriented backend modules
│   ├── middleware/          # Express middleware
│   ├── validation/          # Request validation
│   ├── interfaces/          # Service contracts
│   ├── cli/                 # `td` CLI implementation
│   ├── app.ts               # App composition
│   └── server.ts            # Entrypoint
├── client-react/            # Vite + React + TypeScript web client
├── ios/TodosApp/            # SwiftUI iOS app (iOS 17+), zero third-party deps
├── cli/                     # `td` CLI package wrapper
├── agent-runner/            # Python worker (Railway cron) — scheduled jobs
├── prisma/                  # Prisma schema + migrations
├── test/                    # Jest setup/teardown helpers
├── tests/ui/                # Playwright UI specs
├── evals/ + eval-lab/       # AI evaluator suites
├── scripts/                 # Build, deploy, workflow-guard scripts
├── docs/                    # Architecture, runbooks, ADRs, agent protocol
└── .github/workflows/       # CI, release-train, secret-scan, eval-lab
```

The legacy vanilla JS web client previously in `client/` has been removed; its historical structure is preserved in [`docs/reference/vanilla-client-archive.md`](docs/reference/vanilla-client-archive.md).

## Architecture

The app is route-modular and service-oriented:

- `src/app.ts` wires middleware and route modules.
- `src/routes/*.ts` own HTTP contracts and validation boundaries.
- Service modules handle domain behavior (todos, projects, auth, AI flows).
- Prisma-backed services provide persistent behavior for runtime/integration tests.
- A deterministic in-memory todo service is retained for focused unit scenarios.

## Database Schema

The canonical schema is in `prisma/schema.prisma` and includes auth/user tables, projects, todos, subtasks, and AI suggestion tracking tables.

## Environment Variables

| Variable                    | Description                                               | Default                                                    |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`              | PostgreSQL connection for dev/prod                        | `postgresql://postgres:postgres@localhost:5432/todos_dev`  |
| `DATABASE_URL_TEST`         | PostgreSQL connection for tests                           | `postgresql://postgres:postgres@localhost:5432/todos_test` |
| `PORT`                      | Server port                                               | `3000`                                                     |
| `NODE_ENV`                  | Environment (development/test/production)                 | `development`                                              |
| `EMAIL_FEATURES_ENABLED`    | Enable verification/reset email delivery                  | `true`                                                     |
| `BASE_URL`                  | Public app/API base URL                                   | `http://localhost:3000`                                    |
| `DOMAIN_VERIFICATION_TOKEN` | Hosted app-review domain challenge token; unset elsewhere | —                                                          |
| `REQUEST_BODY_LIMIT`        | JSON body size limit                                      | `256kb`                                                    |
| `FORM_BODY_LIMIT`           | Form body size limit                                      | `64kb`                                                     |
| `REQUEST_TIMEOUT_MS`        | Node request timeout                                      | `30000`                                                    |
| `HEADERS_TIMEOUT_MS`        | Node headers timeout                                      | `35000`                                                    |
| `KEEP_ALIVE_TIMEOUT_MS`     | Node keep-alive timeout                                   | `5000`                                                     |

## Deployment

### Build for Production

```bash
npm run build
```

This compiles TypeScript and generates the Prisma client.

### Run in Production

1. Set environment variables:

   ```bash
   export DATABASE_URL="postgresql://user:password@host:5432/todos_prod"
   export NODE_ENV="production"
   export PORT="3000"
   export BASE_URL="https://your-public-api.example.com"
   ```

2. Run migrations:

   ```bash
   npm run prisma:migrate:deploy
   ```

3. Start server:
   ```bash
   npm start
   ```

### Docker Deployment

The PostgreSQL container is configured for local development. For production, use a managed database service (AWS RDS, Google Cloud SQL, etc.) and update the `DATABASE_URL` accordingly.

### Remote MCP Deployment

The public assistant connector surface is exposed from the same service under:

- `GET /mcp`
- `POST /mcp`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `POST /oauth/register`
- `GET /oauth/authorize`
- `POST /oauth/token`

Supporting docs:

- `docs/assistant-mcp.md`
- `docs/remote-mcp-auth.md`
- `docs/ops/railway-remote-mcp-deploy.md`
- `docs/ops/connector-smoke-checklist.md`

## Troubleshooting

### Port 5432 Already in Use

If you have a local PostgreSQL instance running:

```bash
# Stop local PostgreSQL (macOS with Homebrew)
brew services stop postgresql@18

# Or change the port in docker-compose.yml
ports:
  - '5433:5432'
```

### Docker Not Running

```bash
# macOS
open -a Docker

# Wait for Docker to start, then:
npm run docker:up
```

### Prisma Client Not Found

```bash
npm run prisma:generate
```

### Migration Issues

```bash
# Reset database (WARNING: deletes all data)
npm run prisma:reset

# Or manually:
npm run docker:reset
npm run prisma:migrate
```

## Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express 5
- **Language**: TypeScript 5
- **Database**: PostgreSQL 16
- **ORM**: Prisma 6
- **Testing**: Jest + Supertest
- **Containerization**: Docker + Docker Compose
- **Dev Tools**: Nodemon, ts-node

## License

ISC

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. From your linked task worktree, open a pull request: `scripts/open-task-pr.sh` (for example `scripts/open-task-pr.sh --fill`)

## Support

For issues and questions, please open a GitHub issue.
