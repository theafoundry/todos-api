import { useState, useCallback, useEffect, useRef } from "react";
import { apiCall } from "../../../api/client";
import type { McpSessionSummary } from "../../../types";

export function IntegrationsTab() {
  const [sessions, setSessions] = useState<McpSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<{ sessionId: string | null } | null>(
    null,
  );
  const revoking = useRef(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await apiCall("/auth/mcp/sessions");
      if (!res.ok) {
        throw new Error("Could not load sessions");
      }
      const data = (await res.json()) as { sessions?: McpSessionSummary[] };
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {
      setError("Could not load connected assistants. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const revoke = useCallback(async (sessionId: string | null) => {
    if (revoking.current) return;
    revoking.current = true;
    setPending({ sessionId });
    setError("");
    setNotice("");
    try {
      const res = await apiCall("/auth/mcp/sessions/revoke", {
        method: "POST",
        body: JSON.stringify(sessionId ? { sessionId } : { revokeAll: true }),
      });
      if (!res.ok) throw new Error("Revocation not confirmed");
      setSessions((prev) =>
        sessionId ? prev.filter((session) => session.id !== sessionId) : [],
      );
      setNotice(
        sessionId
          ? "Assistant access revoked."
          : "All assistant access revoked.",
      );
    } catch {
      setError(
        "Could not confirm revocation. Refresh connected assistants to check access before trying again.",
      );
    } finally {
      revoking.current = false;
      setPending(null);
    }
  }, []);

  return (
    <section className="settings-section">
      <p className="settings-meta">
        Review connected assistants and revoke access when you no longer need
        it.
      </p>
      {error && (
        <p className="settings-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="settings-message" role="status">
          {notice}
        </p>
      )}
      <button
        type="button"
        className="btn"
        disabled={loading || pending !== null}
        onClick={() => void loadSessions()}
      >
        Refresh connected assistants
      </button>
      {loading ? (
        <p className="settings-meta" role="status">
          Loading…
        </p>
      ) : sessions.length === 0 && !error ? (
        <p id="mcpSessionsList" className="settings-meta">
          No assistants connected yet.
        </p>
      ) : sessions.length > 0 ? (
        <>
          <div id="mcpSessionsList" className="mcp-sessions">
            {sessions.map((session) => (
              <div key={session.id} className="mcp-session">
                <div className="mcp-session__body">
                  <span className="mcp-session__name">
                    {session.assistantName ||
                      session.clientId ||
                      "Unknown assistant"}
                  </span>
                  <span className="mcp-session__meta">
                    {session.scopes.length > 0
                      ? session.scopes.join(", ")
                      : "No scopes recorded"}
                  </span>
                  <span className="mcp-session__date">
                    Last used{" "}
                    {session.lastUsedAt
                      ? new Date(session.lastUsedAt).toLocaleDateString()
                      : "never"}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={pending !== null}
                  onClick={() => void revoke(session.id)}
                  aria-label={`Revoke ${session.assistantName || session.clientId || "assistant"}`}
                >
                  {pending?.sessionId === session.id ? "Revoking…" : "Revoke"}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--danger"
            disabled={pending !== null}
            onClick={() => void revoke(null)}
          >
            {pending?.sessionId === null ? "Revoking all…" : "Revoke all"}
          </button>
        </>
      ) : null}
    </section>
  );
}
