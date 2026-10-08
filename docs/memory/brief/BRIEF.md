# Brief — Current Project Context

## Current React/mobile context — 2026-10-08 candidate

The current web client is React + Vite in `client-react/`; the previous vanilla client is archived (see `docs/reference/vanilla-client-archive.md`). Earlier brief sections about `client/modules`, `store.js`, EventBus, `switchView` and Railway describe historical work, not current React mobile architecture or deployment verification. Express + Prisma + PostgreSQL remain the backend. Desktop `AppShell` and mobile `MobileShell` are separate rendering paths; the mobile breakpoint is ≤700 CSS pixels.

The mobile reliability candidate starts from verified snapshot `37f59cd1a2154f2461d2f43fe4f66c7f9c4364d6`. The candidate is on `codex/planwren-mobile-reliability`; the draft PR records its exact SHA and checks. It is not a new deployment. User authorization covers implementation and draft PR work; merge/deploy and production task mutation are not implied.

The bounded mobile model is list/card → Details → Edit draft → explicit Save, with one shared frame, local drafts, More details, retained failures and synchronous pending ownership. Complete/Reopen, Undo, reschedule and confirmed Delete use consistent feedback. Uncertain outcomes refresh/reconcile before another write; mobile offline mode retains drafts for explicit retry rather than promising queued synchronization. Service-worker behavior and desktop shared-API changes require separate regression checks.

Plan for is scheduledDate, distinct from Due by. Existing exact values are preserved unless changed; explicitly selected deadlines use the end of the device-local day and display its timezone. Account timezone is not available in the browser user DTO. Legacy midnight deadlines preserve their named day and require an explicit normalization action when needed.

Mobile tabs, selected project and native scroll restore safely; browser history contains markers, not draft contents. Back consults the active dirty/pending owner, and Forward cannot resurrect discarded/saved sheets. Reload resets transient sheets. Background refresh retains data, surfaces errors and updates task/project/Focus reads while continuing to record user scroll.

Keep Fold's Focus cards and compact Today/Everything/project lists. Current work repairs clipped agenda access, named card navigation/flip controls, inactive-face focus isolation, project routing and gesture/count recovery. No card hiding or broad redesign is authorized; a denser or shorter preview remains a later product choice.

The regression setup uses strict isolated synthetic fixtures in Chromium/WebKit touch, plus focused draft/store/navigation/date/worker tests. Final-SHA CI, authenticated UI-to-backend persistence and real-iPhone Safari are pending until results are recorded. Final device checks must include keyboard, native date controls, edge Back, safe areas/rotation, network recovery and VoiceOver on the exact candidate. Emulation is preliminary evidence only.

## Historical context through March 2026

Target: <=2 pages. When this grows beyond 2 pages, compact:
extract new rules -> Canon, archive old sections -> Archive, reset Brief.

## What This Project Is

Full-stack todo application. Express + Prisma + PostgreSQL backend, vanilla JS frontend (single-page app, no framework, no bundler). Deployed on Railway.

## Current State

- Sidebar-first Todos shell is active: the rail owns navigation, search, and utility disclosure on desktop, with a sheet variant on mobile.
- Settings is available from the sidebar bottom (as the only pinned bottom item) and renders inside the Todos shell; profile/account controls live there too.
- Home is now an explicit launch surface with curated modules (`Top Focus`, `Due Soon`, `Stale Risks`, `Quick Wins`, `Projects to Nudge`) and the primary desktop composer entry.
- Search no longer lives as a large persistent control in the main panel; search-adjacent filters/settings are disclosed from the sidebar when search is focused or active.
- Project headings (sections) are supported and project-selected lists group by heading when available.
- Redundant top chrome has been reduced: the top bar mainly serves the projects button when the rail is collapsed/hidden, while the main list header stays compact.
- AI internal category handling is hardened; `AI Plan` is hidden from nav/filter surfaces.

## Active Architecture Patterns

- ES6 modules throughout — all domain logic in named modules under `client/modules/` and `client/utils/`; no globals except window registrations in app.js.
- `store.js` is the shared mutable state hub — all modules import `{ state, hooks }` from store.js; store.js imports nobody. Import DAG: store.js ← domain modules ← app.js.
- EventBus pub-sub: state mutations dispatch events, renderers subscribe — `applyFiltersAndRender()` is never called directly.
- DialogManager singleton: all 12 overlay surfaces wired through `open()`/`close()`/`closeAll()` with focus trap and Escape routing.
- Server-side filtering: project, dateView, search execute in Postgres via Prisma; client `filterTodosList()` is a thin post-processor for heading grouping only.
- Debounce: all input/keyup handlers that trigger `filterTodos()` use DEBOUNCE_MS=250.
- Event delegation on container elements (never on dynamic children).
- `filterTodos()` is the single filter entry point.
- `setSelectedProjectKey()` is the only project selection API.
- `waitForTodosViewIdle()` for deterministic UI readiness in tests.

## Current View Model

- `Home / launchpad`: the only intentional dashboard-like landing surface. It helps the user choose where to enter work rather than acting like analytics.
- `Smart views`: `All tasks`, `Today`, `Upcoming`, `Completed`, and `Unsorted` are list-first views with a compact shared header; search/filter state is driven from the sidebar.
- `Project-selected views`: selecting a project keeps the sidebar as the context source and groups tasks by heading when sections exist. Current `master` still reuses the shared list header and compact focus panel here, so future quiet-workspace changes should treat that as existing behavior to intentionally replace, not as a new invariant.

## Active Constraints

- Keep legacy top tabs as low-prominence compatibility affordances for Todos/Settings switching; do not remove until tests/user flows no longer depend on them.
- UI tests should target the Settings route trigger, not `profileView` activation as a required user path.
- Internal categories are data-visible under `All tasks` but excluded from navigation/selectors.
- Keep search and search-adjacent filter disclosure in the sidebar rail/sheet; do not reintroduce persistent main-panel search chrome.
- Avoid duplicate primary create affordances on desktop; the Home hero/button path is the intended strong create entry.
- Prefer calm, restrained, editorial hierarchy over generic dashboard framing when extending the Todos shell.

## Recent Decisions (2026-02-22 to 2026-03-01)

- PRs `#126` and `#127` reworked quick-entry/tool hierarchy and CTA emphasis so the rail and composer feel lighter and more intentional.
- PRs `#128`, `#130`, `#132`, `#145`, and `#146` converged on a sidebar-first IA: navigation, search, filters, and utility actions should live in the rail/sheet with less repeated main-panel chrome.
- PR `#141` introduced project headings/sections, establishing projects as structured workspaces rather than flat category lists.
- PRs `#142`, `#143`, and `#144` introduced Home as a launchpad/dashboard surface with curated modules and made the composer entry consistent around that surface.
- The emerging product direction is a calmer, more spacious, more editorial workspace model: `Home` decides, smart views scan lists, and projects organize work. The implementation on `master` is partway through that transition, so not every older shared chrome pattern has been removed yet.

## Recent Decisions (2026-03-01 to 2026-03-06)

- PRs `#149` and `#150` hardened the Playwright test infrastructure: redundant specs were pruned and workers now use per-worker auth state files for parallelization.
- PR `#151` and follow-up fixes (`#152`, `#154`) polished and rebalanced the Home launchpad surface after initial introduction — modules were simplified and spacing/composition tightened.
- PRs `#155`, `#156` completed the sidebar chrome cleanup: redundant headings, dead h3 CSS, and leftover decorative sidebar elements removed. The todos view header is now collapsed.
- PR `#157` was a comprehensive redesign of the Home dashboard and sidebar chrome, establishing the current visual hierarchy and editorial workspace direction as the intentional baseline.
- PR `#158` integrated Lucide icons across sidebar nav items and restored the Logout button in the sidebar footer, replacing text-only nav affordances.
- PR `#159` introduced the bottom action dock (fixed-position panel at 64px height, z-index 55) as the home for profile/account quick actions, and cleaned up the sidebar footer to reduce weight.
- PRs `#160` and `#161` were polish and regression passes: active-state highlighting, profile panel presentation, and mobile layout fixes after the dock and Lucide icon changes.
- Current uncommitted work adds an icon-only collapsed sidebar rail state at 64px width, with tooltips on hover — the collapsed ↔ expanded toggle is now a first-class interaction.

## Shell Chrome State (as of 2026-03-06)

- Sidebar rail supports icon-only collapsed state at 64px width; expanded state restores labels and section headings.
- Bottom action dock (`.dock-profile-panel`, z-index 55, fixed) is the home for profile/account quick actions. It does not replace sidebar Settings — Settings remains the primary account surface.
- Lucide icons are used for sidebar nav items; text-only fallbacks are not present.
- Logout is available in the sidebar footer (not only in Settings).
- Mobile layout has a top bar for the Projects button / rail toggle; the dock is visible on mobile.

## Architecture Remediation — COMPLETE (as of 2026-03-09)

All 10 arch review tasks (140–149) merged. Repo restructure (Task 150) also complete.

- app.js: 13,918 lines → 1,975 lines (thin orchestrator)
- 29 focused JS modules in `client/modules/` and `client/utils/`
- `public/` renamed to `client/` with `modules/` and `utils/` subdirs
- `src/` organized into `services/`, `middleware/`, `validation/` subdirs

Key invariants from this sprint (see Canon candidates):

- `store.js` imports from nobody — circular imports structurally impossible
- diff-before-delete discipline when extracting functions to modules
- tsc --noEmit after each module batch, never after all at once

## Shipped Features (M1–M3)

- **M1:** AI Plan Review UX — editable draft rows, select/deselect, apply guards (PR #39)
- **M2:** Task Critic Evolution — feature-flagged structured panel, granular apply, stale-response guard (PRs #41, #89)
- **M3:** Calendar export (.ics) — client-side ICS export for filtered due-dated todos (PR #42)
- **Task 113:** Sidebar density polish — done, merged

## P1 Sprint — COMPLETE (2026-03-09 to 2026-03-10)

Four PRs forming a coherent sequence: decouple render triggers → tighten module boundaries → repo cleanup → overlay coordination + safe patching.

- **PR #199 (Task 156):** EventBus extracted to `client/modules/eventBus.js`. 34 `hooks.renderTodos?.()` calls across 7 modules replaced with `EventBus.dispatch("todos:changed", { reason })`. Business logic no longer commands renders directly.
- **PR #200 (Task 157):** DOM Boundary Layer policy added to `filterLogic.js`. Category C violation in `filterTodosList()` fixed — pure functions are now pure.
- **PR #201 (Task 158):** Repo cleanup — 7 stale `.worktrees/*` submodule refs removed; task docs 151/152 moved to done/.
- **PR #202 (Task 159):** Overlay coordination centralized via expanded `overlayManager.js`. Selector layer (`selectorLayer.js`) and targeted row patching (`todosViewPatches.js`) introduced to reduce avoidable full rerenders. Full rerender fallbacks preserved.

Key invariants added by P1:

- EventBus is the only render trigger — domain modules emit, renderers subscribe
- `filterTodosList()` is a pure function (no DOM reads)
- All overlay open/close goes through OverlayManager

## P2 Sprint — COMPLETE (PR #203, Task 160, merged 2026-03-10)

## P3 Sprint — COMPLETE (PR #207, Task 163, merged 2026-03-10)

Responsive architecture cleanup, targeted DOM patching, and debounce narrowing.

- `responsiveLayout.js` (new) — single owner of viewport mode and rail presentation state
- `stateActions.js` + `store.js` — viewport and rail presentation actions/fields added
- `railUi.js` — targeted project row reconciliation by identity; no more container replacement
- `todosViewPatches.js` + `todosService.js` + `drawerUi.js` — safe patch-by-id paths consolidated
- `app.js` — debouncing narrowed to filter/search inputs only
- `taskDrawerAssist.js` + `filterLogic.js` — viewport inference routed through responsiveLayout.js

Key invariants added by P3:

- Responsive state is owned in one place — consumers never infer viewport independently
- Project row updates are targeted; container replacement eliminated from the rail
- Debounce applies to filter/search only, not all declarative inputs

Three new focused modules reducing structural duplication in high-churn UI flows:

- `stateActions.js` — explicit `applyUiAction(type, payload)` dispatcher replacing ad-hoc boolean writes
- `asyncLifecycle.js` — `runAsyncLifecycle()` helper normalizing load/error/empty patterns
- `uiTemplates.js` — shared string-template helpers replacing duplicated inline HTML construction

All verifications green (tsc, format, test:unit, test:ui:fast 205/33).

## Open Tech Debt

- ~~`state.js` vs `store.js` overlap~~ resolved in Task 151 (renamed to authSession.js)
- ~~API rate limiting~~ resolved in Task 152 (extracted to rateLimitMiddleware.ts)
- ~~localStorage key centralization~~ resolved in Task 153 (storageKeys.js)
- ~~hooks.renderTodos coupling~~ resolved in Task 154/PR #199 (EventBus module)
- ~~DOM boundary violations in filterLogic~~ resolved in Task 155/PR #200
- Component framework migration spike — deferred; requires explicit human ADR before any work begins

---

_Last updated: 2026-03-10_
