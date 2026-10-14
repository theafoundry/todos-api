import type { Request } from "express";
import {
  AGENT_ID_MAX_LENGTH,
  AUDIT_ACTOR_MAX_LENGTH,
  assertValidTraceIds,
  boundDisplayLabel,
  deriveAgentId,
} from "./auditAttribution";
import { buildMcpActor, buildMcpAgentId } from "../mcp/mcpAuth";

function fakeReq(headers: Record<string, string>): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

describe("boundDisplayLabel", () => {
  it("keeps short labels verbatim and falls back when missing", () => {
    expect(boundDisplayLabel("codex-test", "unknown-agent")).toBe("codex-test");
    expect(boundDisplayLabel(undefined, "unknown-agent")).toBe("unknown-agent");
    expect(boundDisplayLabel("   ", "unknown-agent")).toBe("unknown-agent");
  });

  it("bounds long default user agents to the actor column limit", () => {
    const userAgent = `Mozilla/5.0 ${"x".repeat(400)}`;
    const bounded = boundDisplayLabel(userAgent, "unknown-agent");
    expect(bounded).toHaveLength(AUDIT_ACTOR_MAX_LENGTH);
    expect(bounded.startsWith("Mozilla/5.0")).toBe(true);
  });

  it("preserves a label exactly at the boundary length", () => {
    const exact = "a".repeat(AUDIT_ACTOR_MAX_LENGTH);
    expect(boundDisplayLabel(exact, "unknown-agent")).toBe(exact);
  });

  it("never splits a surrogate pair at the display boundary", () => {
    const label = `${"a".repeat(254)}🚀${"b".repeat(50)}`;
    const bounded = boundDisplayLabel(label, "unknown-agent");
    // 255 Unicode code points: 254 letters plus the intact emoji.
    expect([...bounded]).toHaveLength(255);
    expect(bounded.endsWith("🚀")).toBe(true);
    expect(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
        bounded,
      ),
    ).toBe(false);
  });
});

describe("deriveAgentId (stable identity, separate from display label)", () => {
  it("keeps short identities verbatim from their full text", () => {
    expect(deriveAgentId("orla")).toBe("orla");
    expect(deriveAgentId("a".repeat(AGENT_ID_MAX_LENGTH))).toBe(
      "a".repeat(AGENT_ID_MAX_LENGTH),
    );
  });

  it("keeps a 20-code-point identity with emoji verbatim", () => {
    const identity = `${"a".repeat(19)}🚀`;
    expect([...identity]).toHaveLength(20);
    expect(deriveAgentId(identity)).toBe(identity);
  });

  it("derives a stable 80-bit digest identity for long sources", () => {
    const label = `Mozilla/5.0 ${"y".repeat(300)}`;
    const first = deriveAgentId(label);
    expect(first).toMatch(/^[0-9a-f]{20}$/);
    expect(deriveAgentId(label)).toBe(first);
  });

  it("does not merge labels differing only after the 255-char display bound", () => {
    const shared = `agent-${"s".repeat(294)}`;
    const first = deriveAgentId(`${shared}-alpha`);
    const second = deriveAgentId(`${shared}-omega`);
    expect(first).not.toBe(second);
  });

  it("does not merge distinct long labels sharing a long prefix", () => {
    const sharedPrefix = "shared-agent-prefix-".repeat(4);
    expect(deriveAgentId(`${sharedPrefix}alpha`)).not.toBe(
      deriveAgentId(`${sharedPrefix}omega`),
    );
  });
});

describe("buildMcpAgentId (authenticated client identity preferred)", () => {
  it("prefers the verified client id over the assistant display name", () => {
    const id = buildMcpAgentId(fakeReq({}), {
      assistantName: "Display Name",
      clientId: "client-123",
    });
    expect(id).toBe("client-123");
  });

  it("derives identity from the full verified claim, not truncated text", () => {
    const shared = `client-${"c".repeat(294)}`;
    const first = buildMcpAgentId(fakeReq({}), {
      clientId: `${shared}-alpha`,
    });
    const second = buildMcpAgentId(fakeReq({}), {
      clientId: `${shared}-omega`,
    });
    expect(first).toHaveLength(AGENT_ID_MAX_LENGTH);
    expect(first).not.toBe(second);
  });

  it("falls back to caller headers only when no verified claim exists", () => {
    const shared = `agent-${"s".repeat(294)}`;
    const first = buildMcpAgentId(
      fakeReq({ "x-assistant-name": `${shared}-alpha` }),
      {},
    );
    const second = buildMcpAgentId(
      fakeReq({ "x-assistant-name": `${shared}-omega` }),
      {},
    );
    expect(first).not.toBe(second);
  });
});

describe("assertValidTraceIds", () => {
  it("accepts ids at the boundary length", () => {
    expect(() =>
      assertValidTraceIds({
        requestId: "r".repeat(255),
        idempotencyKey: "k".repeat(255),
      }),
    ).not.toThrow();
  });

  it("rejects oversized request ids and idempotency keys before mutation", () => {
    expect(() => assertValidTraceIds({ requestId: "r".repeat(256) })).toThrow(
      expect.objectContaining({ status: 400, code: "INVALID_INPUT" }),
    );
    expect(() =>
      assertValidTraceIds({
        requestId: "ok",
        idempotencyKey: "k".repeat(256),
      }),
    ).toThrow(expect.objectContaining({ status: 400, code: "INVALID_INPUT" }));
  });

  it("never truncates: distinct oversized keys are both rejected, not merged", () => {
    const prefix = "k".repeat(300);
    for (const key of [`${prefix}-a`, `${prefix}-b`]) {
      expect(() =>
        assertValidTraceIds({ requestId: "ok", idempotencyKey: key }),
      ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    }
  });
});

describe("buildMcpActor verified attribution", () => {
  it("prefers the verified session label over a spoofed header", () => {
    const actor = buildMcpActor(
      fakeReq({ "x-assistant-name": "spoofed-assistant" }),
      { assistantName: "VerifiedAssistant", clientId: "verified-client" },
    );
    expect(actor).toBe("VerifiedAssistant");
  });

  it("falls back to the verified client id before caller headers", () => {
    const actor = buildMcpActor(
      fakeReq({ "x-assistant-name": "spoofed-assistant" }),
      { clientId: "verified-client" },
    );
    expect(actor).toBe("verified-client");
  });

  it("uses the caller header only as an untrusted fallback and bounds it", () => {
    const actor = buildMcpActor(
      fakeReq({ "x-assistant-name": `caller-${"z".repeat(400)}` }),
      {},
    );
    expect(actor).toHaveLength(AUDIT_ACTOR_MAX_LENGTH);
    expect(actor.startsWith("caller-")).toBe(true);
  });

  it("falls back to a bounded user agent, then the default label", () => {
    expect(
      buildMcpActor(fakeReq({ "user-agent": "SyntheticAgent/1.0" }), {}),
    ).toBe("SyntheticAgent/1.0");
    expect(buildMcpActor(fakeReq({}), {})).toBe("unknown-assistant");
  });
});
