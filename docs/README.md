# docs/

Navigation map for this directory.

## Product Docs

| Path                  | Purpose                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `product-overview.md` | Current product-facing overview of the shipped feature set          |
| `wiki/`               | Wiki-ready pages that can be copied into the GitHub wiki if enabled |

## Agent Workflow

| Path                                              | Purpose                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `WORKFLOW.md`                                     | GitHub-native workflow rules for issues, projects, PRs, and docs (start here) |
| `SAFETY_GUARDRAILS.md`                            | Operational safety rules for all agents                                       |
| `agent-accessibility.md`                          | First-pass server contract and safety model for machine agents                |
| `assistant-mcp.md`                                | Remote MCP adapter for assistant clients                                      |
| `remote-mcp-auth.md`                              | Account linking, auth, scopes, and local testing for the remote MCP surface   |
| `planner-runtime.md`                              | Planner runtime architecture and tool-to-engine mapping                       |
| `engineering-backlog.md`                          | GitHub-ready engineering backlog grounded in verified repo state              |
| `harness/`                                        | Repo harness docs: session flow, evals, and invariant matrix                  |
| `ops/railway-remote-mcp-deploy.md`                | Railway deployment runbook for the public MCP surface                         |
| `ops/production-migration-closeout-2026-09-29.md` | Verified Railway-to-self-hosted-Postgres and credential-rotation closeout     |
| `ops/connector-smoke-checklist.md`                | Manual ChatGPT / Claude connector smoke checklist                             |
| `ops/refresh-token-fallback-removal.md`           | Refresh-token cutover and legacy cleanup step                                 |
| `ops/`                                            | Repo operations runbooks and GitHub project setup notes                       |
| `agent-ops/`                                      | Dual-agent protocol (state machine, review contract)                          |
| `agent-queue/`                                    | Legacy markdown task archive and historical prompts                           |
| `architecture/`                                   | Architecture invariants (structural rules)                                    |
| `adr/`                                            | Architecture Decision Records (numbered, dated, reviewed)                     |
| `memory/`                                         | Canon / Brief / Index / Archive for context compaction                        |

Task state lives in GitHub Issues and GitHub Projects. Docs are for durable guidance only.

## Feature Specs

| Path                   | Purpose                          |
| ---------------------- | -------------------------------- |
| `01-*` through `07-*`  | AI decision assist feature specs |
| `ui-revamp/`           | UI redesign specs (M1, M2, M4)   |
| `next-enhancements.md` | Enhancement backlog              |
| `codex-prompts.md`     | Codex implementation prompts     |

For a full pointer table, see `memory/index/INDEX.md`.
