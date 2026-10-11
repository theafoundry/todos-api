// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { apiCall } from "../../../api/client";
import { IntegrationsTab } from "./IntegrationsTab";

vi.mock("../../../api/client", () => ({ apiCall: vi.fn() }));
const api = vi.mocked(apiCall);
const sessions = [
  {
    id: "synthetic-chatgpt",
    assistantName: "ChatGPT",
    scopes: ["tasks:read", "tasks:write"],
    lastUsedAt: null,
  },
  {
    id: "synthetic-claude",
    assistantName: "Claude",
    scopes: ["tasks:read"],
    lastUsedAt: null,
  },
];
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("IntegrationsTab access recovery", () => {
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue(response({ sessions }));
  });

  it("does not claim there are no connections when the list fails", async () => {
    api.mockRejectedValueOnce(new Error("Synthetic network failure"));
    render(createElement(IntegrationsTab));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Could not load/,
    );
    expect(screen.queryByText("No assistants connected yet.")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh connected assistants" }),
    );
    expect(
      await screen.findByRole("button", { name: "Revoke ChatGPT" }),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("allows only one pending revocation and removes only the confirmed connection", async () => {
    let resolveRevoke!: (value: Response) => void;
    const deferred = new Promise<Response>((resolve) => {
      resolveRevoke = resolve;
    });
    api
      .mockResolvedValueOnce(response({ sessions }))
      .mockReturnValueOnce(deferred);
    render(createElement(IntegrationsTab));
    const chatgpt = await screen.findByRole("button", {
      name: "Revoke ChatGPT",
    });
    fireEvent.click(chatgpt);
    fireEvent.click(chatgpt);
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    expect(api).toHaveBeenCalledTimes(2);
    expect(chatgpt).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Revoke Claude" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Refresh connected assistants" }),
    ).toBeDisabled();
    expect(api.mock.calls[1]).toEqual([
      "/auth/mcp/sessions/revoke",
      {
        method: "POST",
        body: JSON.stringify({ sessionId: "synthetic-chatgpt" }),
      },
    ]);
    resolveRevoke(response({ revoked: true, sessionId: "synthetic-chatgpt" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Revoke ChatGPT" }),
      ).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Revoke Claude" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Assistant access revoked.",
    );
  });

  it("retains the connection on a lost acknowledgment and reconciles with a fresh read", async () => {
    api
      .mockResolvedValueOnce(response({ sessions }))
      .mockRejectedValueOnce(new Error("Synthetic lost response"))
      .mockResolvedValueOnce(response({ sessions: [sessions[1]] }));
    render(createElement(IntegrationsTab));
    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke ChatGPT" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not confirm revocation.",
    );
    expect(
      screen.getByRole("button", { name: "Revoke ChatGPT" }),
    ).toBeEnabled();
    expect(screen.queryByText("Assistant access revoked.")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh connected assistants" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Revoke ChatGPT" }),
      ).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Revoke Claude" })).toBeTruthy();
    expect(
      api.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
  });

  it("retains connections after an HTTP failure, then confirms revoke all", async () => {
    api
      .mockResolvedValueOnce(response({ sessions }))
      .mockResolvedValueOnce(response({ error: "Synthetic rejection" }, 500))
      .mockResolvedValueOnce(response({ revokedAll: true }));
    render(createElement(IntegrationsTab));
    await screen.findByRole("button", { name: "Revoke ChatGPT" });
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not confirm revocation.",
    );
    expect(screen.getByRole("button", { name: "Revoke ChatGPT" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    expect(
      await screen.findByText("No assistants connected yet."),
    ).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent(
      "All assistant access revoked.",
    );
    expect(api.mock.calls[2]).toEqual([
      "/auth/mcp/sessions/revoke",
      { method: "POST", body: JSON.stringify({ revokeAll: true }) },
    ]);
  });
});
