# Today Plan conversation panel

Planwren is the working product name for this extension proposal. This slice
keeps the existing Todos package, identifiers, OAuth audience, domains, and
standalone application compatible.

## Surface and contract

The smallest extension is a Today Plan panel beside a conversation. The MCP
tool catalog adds `open_today_plan` with title `Today Plan` and metadata:

```json
{
  "ui": {
    "resourceUri": "ui://todos/today-plan/v1.html",
    "visibility": ["app"]
  },
  "openai/ui": {
    "entrypoints": [{ "type": "thread" }]
  }
}
```

This metadata belongs on the MCP tool, not the plugin manifest. The existing
registered-app package requires no new manifest fields or runtime dependencies.
The opener accepts exactly `{}`. Existing authentication and
`tasks.read`/`projects.read` checks apply before returning a narrow setup result:
`state`, server-local `date`, and `timezone`. It does not read task or project
lists, plan, or write tasks. App-only visibility is a host discovery hint;
server authorization remains the access boundary.

The component consumes that initial result and shows a date, available-minutes
input, and energy selector. Time and energy have no defaults. Only an explicit
submission calls `plan_today` with all three inputs. A successful plan uses the
same rendering, complete/undo, rescheduling, and refresh paths as the inline
widget. Refresh keeps the last successful planning inputs; draft edits require
Update plan. Each iframe holds its own state, with no shared browser storage.

Direct `plan_today` results can contain more than twelve tasks. The component
preserves and displays their complete returned order, so the visible tasks match
the authoritative totals. This supersedes the historical Phase 0 compact-card
presentation cap. The original `render_today_plan` input still allows at most
twelve selected IDs and returns totals for that selected subset; its contract
is unchanged. Panel planning and inline refresh keep the full direct plan.

The original six model tools and their metadata/input contracts stay unchanged.
Text-only clients continue to use them. No additional task operations or scopes
are introduced. The widget still has no direct network access; CSP origin lists
remain empty. The standalone app and its routes are unchanged.

All entrypoints use the `fullscreen` display mode under the current extension
contract. Both resource metadata and the MCP Apps handshake advertise
`inline` and `fullscreen`. Preferred mode is omitted, preserving ordinary inline
renders. This uses the existing JSON-RPC MCP Apps bridge, without an additional
SDK. The new metadata snapshot is
`test/fixtures/mcp-app-metadata.extensions.json`; historical Phase 1/2 snapshots
are retained for compatibility assertions. `npm run review:metadata` and
`npm run review:portal-scan` target the current snapshot.

## Sources and availability

Verified against the current official docs on October 2, 2026:

- [Plugin Extensions overview](https://developers.openai.com/plugins/build/extensions)
- [Thread entrypoint and display-mode specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#thread-entrypoint)
- [Platform support](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#platform-support)
- [MCP Apps UI bridge](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt)

The formal support table describes expected launch support. Its Web column
means the Work browser and excludes classic ChatGPT; the overview says web
extensions for Free/Go are coming soon. These sources establish the contract,
not availability for a particular account or client version.

## Acceptance boundary

Local tests use synthetic plans, mock host notifications, and isolated
authentication/service doubles. They can verify metadata, empty arguments,
scope denial, setup rendering, explicit planning, errors, mutations, responsive
layout, and instance isolation. They cannot prove ChatGPT discovers or mounts
the entrypoint. No host registration, credentials, deployment, production task
changes, or app submission are part of this implementation.

After separately authorized host setup, check on a supported ChatGPT surface:

1. Refresh server metadata and open a new conversation. Verify a single
   `Today Plan` panel entry and its fallback icon.
2. Open it with `{}`. Confirm server-local date/timezone, blank time/energy,
   no automatic planning, and successful fullscreen placement.
3. With isolated review data, submit explicit inputs. Verify the plan, keyboard
   access, complete/undo, rescheduling, and refresh after changing the inputs.
4. Expire or revoke the test connection. Verify reconnect guidance and no
   writes while unauthorized; reopen after reconnecting.
5. Open another conversation. Verify independent panel state and usable narrow
   layout. Also verify the six tools and ordinary inline render in a client
   without extensions.

Real host acceptance remains pending until those checks are completed.
