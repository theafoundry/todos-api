import { randomUUID } from "crypto";
import type { Request } from "express";

import { getAgentRequestContext } from "./agentContext";

jest.mock("crypto", () => ({
  ...jest.requireActual("crypto"),
  randomUUID: jest.fn(),
}));

function createRequest(headers: Record<string, string> = {}): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    requestId: headers["request-id"],
  } as unknown as Request;
}

describe("getAgentRequestContext", () => {
  it("prefers the canonical request id on the express request", () => {
    const req = createRequest({
      "request-id": "req-shared-123",
      "x-agent-request-id": "legacy-agent-id",
      "x-agent-name": "agent-runner",
    });

    expect(getAgentRequestContext(req)).toEqual({
      actor: "agent-runner",
      agentId: "agent-runner",
      requestId: "req-shared-123",
    });
  });

  it("falls back to the legacy agent header when no request id exists", () => {
    const req = createRequest({
      "x-agent-request-id": "legacy-agent-id",
    });

    expect(getAgentRequestContext(req)).toEqual({
      actor: "unknown-agent",
      agentId: "unknown-agent",
      requestId: "legacy-agent-id",
    });
  });

  it("bounds a caller-supplied display label to the audit column limit", () => {
    const req = createRequest({ "x-agent-name": `agent-${"a".repeat(400)}` });

    const context = getAgentRequestContext(req);

    expect(context.actor).toHaveLength(255);
    expect(context.actor.startsWith("agent-")).toBe(true);
  });

  it("separates identity from the bounded display label", () => {
    const shared = `agent-${"s".repeat(294)}`;
    const first = getAgentRequestContext(
      createRequest({ "x-agent-name": `${shared}-alpha` }),
    );
    const second = getAgentRequestContext(
      createRequest({ "x-agent-name": `${shared}-omega` }),
    );

    expect(first.actor).toBe(second.actor);
    expect(first.agentId).toHaveLength(20);
    expect(first.agentId).not.toBe(second.agentId);
  });

  it("bounds a long default user agent instead of storing it verbatim", () => {
    const req = createRequest({
      "user-agent": `Mozilla/5.0 ${"b".repeat(400)}`,
    });

    expect(getAgentRequestContext(req).actor).toHaveLength(255);
  });

  it("keeps a label exactly at the boundary length and defaults when missing", () => {
    const exact = "c".repeat(255);
    expect(
      getAgentRequestContext(createRequest({ "x-agent-name": exact })).actor,
    ).toBe(exact);
    expect(getAgentRequestContext(createRequest()).actor).toBe("unknown-agent");
  });

  it("generates a request id when neither header is present", () => {
    const mockedRandomUuid = jest.mocked(randomUUID);
    mockedRandomUuid.mockReturnValue(
      "generated-request-id" as ReturnType<typeof randomUUID>,
    );

    const req = createRequest();

    expect(getAgentRequestContext(req)).toEqual({
      actor: "unknown-agent",
      agentId: "unknown-agent",
      requestId: "generated-request-id",
    });
  });
});
