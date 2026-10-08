# Canon — Promoted Rules

Rules added here were learned through violations or near-misses.
They are permanent and override any conflicting guidance.

## How Rules Get Promoted

A rule enters Canon when:

1. An agent violates an invariant and the violation is caught in review.
2. A pattern causes repeated friction across multiple tasks.
3. A session learning proves universally applicable.

## Rules

### React mobile scope and reliable interactions

- The sidebar/top-tab/`switchView` historical navigation rules below describe the historical vanilla Todos shell and its desktop IA. The archived vanilla client is not the current React mobile composition root; reason: treating old implementation APIs as mobile requirements obscures the actual touch flow.
- Current React desktop navigation remains in `AppShell`; at ≤700 CSS pixels the application mounts `MobileShell`, with Focus/Today/Projects/custom tabs, visible Search and account access. Apply rules to the shell that actually renders; reason: a desktop editor fix does not repair a separate mobile editor.
- Mobile task surfaces have one active owner and a shared named modal frame. Only handle-originated drag may dismiss; body touches, scroll and keyboard input cannot. All dismissal paths consult dirty/pending ownership; reason: bubbled touchend previously dismissed Edit/disclosure before their actions.
- Mobile edits/capture use local drafts, explicit submission and retained error recovery. Never equate a worker `202` receipt or ambiguous mutation response with persisted data; refresh/reconcile uncertainty before another write. Reason: autosave lost characters and repeated creation could duplicate tasks.
- Preserve exact existing dates unless explicitly edited. Plan for changes scheduledDate; Due by explicitly selected in mobile ends at the device-local day, with timezone disclosure and deadline-order validation. Reason: rescheduling formerly moved deadlines and discarded promised times.
- Persist safe tab/project/scroll preferences, not unsaved drafts or transient editor routes. One scroll owner restores on view entry after data is ready and continues tracking user scroll during refresh. Reason: reload and refresh must not imply a draft was saved or jump to an old offset.
- Preserve Fold cards/branding and compact task lists while fixing accessibility, overflow and navigation correctness. Card removal or broad presentation changes require a separate product decision; reason: functional defects do not establish user preference against cards.
- Qualify the exact candidate in Chromium/WebKit touch plus final real-iPhone Safari; label emulation, synthetic fixtures, worker tests and backend persistence evidence separately. Reason: browser emulation does not reproduce native keyboard/date UI, VoiceOver or a physical phone.

### Testing

- Local `chromium-mobile` test failures are expected when baselines are Linux-generated. Do not "fix" these by updating macOS snapshots.
- Port 4173 conflicts occur after interrupted test runs. Kill with `lsof -ti:4173 | xargs kill -9` before retrying.

### Git

- Untracked spec files from other branches leak into Playwright test discovery. Use worktree isolation.
- Git pathspec exclude syntax: use `:(exclude)docs/` not `:!docs/` to avoid bash history expansion.

### Process

- Never weaken a test to make CI pass. Fix the code.
- Do not commit untracked `docs/` content unless the task explicitly allows it.
- When a UI/task PR changes navigation IA or persistent UX behavior, update `docs/memory/canon/CANON.md` + `docs/memory/brief/BRIEF.md` in the same PR (or immediate docs-only follow-up PR).

### UI Navigation & IA

- Sidebar is the single primary navigation surface in Todos mode; top tabs remain compatibility affordances only while tests still depend on them.
- Search belongs to the sidebar rail/sheet in Todos mode; do not reintroduce a persistent main-panel search bar.
- Search-adjacent controls are contextual disclosure UI: reveal filters/settings from the rail when search is focused or active instead of keeping them permanently visible.
- Sidebar bottom contains the stable account entry point: `Settings`.
- `Profile` is presented as Settings content, not as a standalone sidebar nav item.
- Entering Settings must not collapse or remove the sidebar shell.
- Any `Profile` CTA must route through `switchView('settings')`; do not route to a standalone `profileView` as the primary account surface.
- In mobile layouts where the sidebar is hidden, keep a visible top-tab route to Settings to avoid trapping account/verification flows.

### Internal Categories

- `AI Plan` is an internal category and must never appear in user navigation surfaces (projects rail, category dropdown, create/edit project pickers).
- If persisted selection resolves to an internal category, client selection must fall back to `All tasks` (`setSelectedProjectKey("")` path).

---

_To add a rule: append it under the appropriate heading with a one-line rationale._
