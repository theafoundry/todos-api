// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthProvider";
import { useFocusBrief } from "../hooks/useFocusBrief";
import { apiCall } from "../api/client";

vi.mock("../api/client", () => ({ apiCall: vi.fn() }));
vi.mock("../utils/pageTransitions", () => ({ navigateWithFade: vi.fn() }));

const accountA = { id: "synthetic-account-a", email: "account-a@example.test" };
const accountB = { id: "synthetic-account-b", email: "account-b@example.test" };
const accountABrief = {
  pinned: {
    rightNow: {
      narrative: "Private action belonging to account A",
      urgentItems: [],
      topRecommendation: null,
    },
    todayAgenda: [],
    rightNowProvenance: { source: "deterministic" },
    todayAgendaProvenance: { source: "deterministic" },
  },
  rankedPanels: [],
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function FocusProbe() {
  const { brief, error } = useFocusBrief();
  return (
    <div>
      <p>{brief?.pinned.rightNow.narrative ?? "No Focus brief"}</p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function AccountHarness() {
  const { user, loading, logout, setTokens } = useAuth();
  return (
    <div>
      <p>Account: {user?.id ?? "none"}</p>
      <button type="button" onClick={logout}>
        Log out
      </button>
      <button
        type="button"
        onClick={() =>
          setTokens("synthetic-b-access", "synthetic-b-refresh", accountB)
        }
      >
        Switch to account B
      </button>
      {!loading && user && <FocusProbe key={user.id} />}
      {!user && <p>Signed out</p>}
    </div>
  );
}

describe("Focus brief account and logout isolation", () => {
  const postMessage = vi.fn();
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    postMessage.mockClear();
    vi.stubGlobal("navigator", {
      serviceWorker: { controller: { postMessage } },
    });
    vi.mocked(apiCall).mockReset();
    localStorage.setItem("authToken", "synthetic-a-access");
    localStorage.setItem("refreshToken", "synthetic-a-refresh");
    localStorage.setItem("user", JSON.stringify(accountA));
    localStorage.setItem(
      "todos:focus-brief-cache",
      JSON.stringify(accountABrief),
    );
  });

  it("discards the brief at logout and never shows it for another account with AI off", async () => {
    let switched = false;
    vi.mocked(apiCall).mockImplementation(async (path) => {
      if (path === "/users/me") return response(accountA);
      if (path === "/ai/focus-brief")
        return switched
          ? response({ error: "AI disabled" }, 503)
          : response(accountABrief);
      throw new Error(`Unmapped synthetic request: ${path}`);
    });
    render(
      <AuthProvider>
        <AccountHarness />
      </AuthProvider>,
    );
    expect(
      await screen.findByText("Private action belonging to account A"),
    ).toBeTruthy();
    localStorage.setItem(
      "todos:focus-brief-cache",
      JSON.stringify(accountABrief),
    );
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(screen.getByText("Signed out")).toBeTruthy();
    expect(
      screen.queryByText("Private action belonging to account A"),
    ).toBeNull();
    expect(localStorage.getItem("todos:focus-brief-cache")).toBeNull();
    expect(localStorage.getItem("authToken")).toBeNull();
    expect(localStorage.getItem("refreshToken")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
    expect(postMessage).toHaveBeenCalledWith("clear-private-data");

    switched = true;
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to account B" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    expect(screen.getByText("No Focus brief")).toBeTruthy();
    expect(
      screen.queryByText("Private action belonging to account A"),
    ).toBeNull();
    expect(localStorage.getItem("todos:focus-brief-cache")).toBeNull();
  });

  it.each(["logout", "account-change"])(
    "ignores a late profile response after %s",
    async (transition) => {
      let finishProfile!: (value: Response) => void;
      vi.mocked(apiCall).mockImplementation(async (path) => {
        if (path === "/users/me")
          return new Promise<Response>((resolve) => {
            finishProfile = resolve;
          });
        if (path === "/ai/focus-brief")
          return response({ error: "AI disabled" }, 503);
        throw new Error(`Unmapped synthetic request: ${path}`);
      });
      render(
        <AuthProvider>
          <AccountHarness />
        </AuthProvider>,
      );
      await waitFor(() => expect(finishProfile).toBeDefined());
      fireEvent.click(
        screen.getByRole("button", {
          name: transition === "logout" ? "Log out" : "Switch to account B",
        }),
      );
      await act(async () => {
        finishProfile(response(accountA));
      });
      if (transition === "logout") {
        expect(localStorage.getItem("user")).toBeNull();
        expect(localStorage.getItem("authToken")).toBeNull();
        expect(screen.getByText("Signed out")).toBeTruthy();
      } else {
        expect(localStorage.getItem("user")).toBe(JSON.stringify(accountB));
        expect(localStorage.getItem("authToken")).toBe("synthetic-b-access");
        expect(screen.getByText("Account: synthetic-account-b")).toBeTruthy();
      }
      expect(
        screen.queryByText("Private action belonging to account A"),
      ).toBeNull();
      expect(postMessage).toHaveBeenCalledWith("clear-private-data");
    },
  );

  it("ignores a late old-account response across an account change", async () => {
    let finishAccountA!: (value: Response) => void;
    let reads = 0;
    vi.mocked(apiCall).mockImplementation(async (path) => {
      if (path === "/users/me") return response(accountA);
      if (path === "/ai/focus-brief") {
        reads += 1;
        if (reads === 1)
          return new Promise<Response>((resolve) => {
            finishAccountA = resolve;
          });
        return response({ error: "AI disabled" }, 503);
      }
      throw new Error(`Unmapped synthetic request: ${path}`);
    });
    render(
      <AuthProvider>
        <AccountHarness />
      </AuthProvider>,
    );
    await waitFor(() => expect(reads).toBe(1));
    expect(
      screen.queryByText("Private action belonging to account A"),
    ).toBeNull();
    localStorage.setItem(
      "todos:focus-brief-cache",
      JSON.stringify(accountABrief),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to account B" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    await act(async () => {
      finishAccountA(response(accountABrief));
    });
    expect(screen.getByText("No Focus brief")).toBeTruthy();
    expect(
      screen.queryByText("Private action belonging to account A"),
    ).toBeNull();
    expect(localStorage.getItem("todos:focus-brief-cache")).toBeNull();
    expect(reads).toBe(2);
  });
});
