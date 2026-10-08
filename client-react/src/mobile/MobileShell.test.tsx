// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { RefObject } from "react";
import { MobileShell } from "./MobileShell";
import type { Todo } from "../types";

const mocks = vi.hoisted(() => ({
  activeTab: "focus",
  customView: "all",
  loadState: "loaded",
  todos: [] as Todo[],
  loadTodos: vi.fn().mockResolvedValue(true),
  revalidate: vi.fn().mockResolvedValue(true),
  refreshInbox: vi.fn().mockResolvedValue(true),
  refresh: null as (() => Promise<boolean>) | null,
  setActiveTab: vi.fn(),
  setCustomView: vi.fn(),
  inboxProps: null as {
    onAccepted: (task: Todo) => Promise<void>;
    onOpenTask: (id: string) => Promise<void>;
    refreshRef: RefObject<(() => Promise<boolean>) | null>;
  } | null,
  profileNavigate: null as ((destination: string) => void) | null,
}));

// Mock all the complex dependencies
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "1", email: "test@example.com", name: "Test" },
    logout: vi.fn(),
    loading: false,
  }),
}));

vi.mock("../store/useTodosStore", () => ({
  useTodosStore: () => ({
    todos: mocks.todos,
    loadState: mocks.loadState,
    errorMessage: "",
    getTodo: (id: string) => mocks.todos.find((task) => task.id === id),
    getTodos: () => mocks.todos,
    loadTodos: mocks.loadTodos,
    addTodo: vi.fn().mockResolvedValue(undefined),
    toggleTodo: vi.fn().mockResolvedValue(undefined),
    editTodo: vi.fn().mockResolvedValue(undefined),
    removeTodo: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../store/useProjectsStore", () => ({
  useProjectsStore: () => ({
    projects: [],
    getProjects: () => [],
    loadProjects: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("../hooks/useDarkMode", () => ({
  useDarkMode: () => ({ dark: false, toggle: vi.fn() }),
}));

vi.mock("./hooks/useTabBar", () => ({
  useTabBar: () => ({
    activeTab: mocks.activeTab,
    setActiveTab: mocks.setActiveTab,
    customView: mocks.customView,
    setCustomView: mocks.setCustomView,
  }),
}));

vi.mock("./hooks/useScrollPersistence", () => ({
  useScrollPersistence: () => ({ save: vi.fn(), restore: vi.fn() }),
}));

vi.mock("./hooks/useBottomSheet", () => ({
  useBottomSheet: () => ({
    taskId: null,
    snap: "closed",
    openHalf: vi.fn(),
    openFull: vi.fn(),
    expandFull: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock("../hooks/useFocusBrief", () => ({
  useFocusBrief: () => ({
    brief: null,
    loading: false,
    error: null,
    revalidate: mocks.revalidate,
  }),
}));

vi.mock("./hooks/usePalette", () => ({
  usePalette: () => ({ palette: "default", setPalette: vi.fn() }),
}));

vi.mock("./components/TabBar", () => ({
  TabBar: () => createElement("nav", { "data-testid": "tab-bar" }),
}));

vi.mock("./components/BottomSheet", () => ({
  BottomSheet: ({ snap }: { snap: string }) =>
    createElement("div", { "data-testid": "bottom-sheet", "data-snap": snap }),
}));

vi.mock("./components/QuickCapture", () => ({
  QuickCapture: () => createElement("div", { "data-testid": "quick-capture" }),
}));

vi.mock("./components/ProfileSheet", () => ({
  ProfileSheet: ({
    onNavigate,
  }: {
    onNavigate: (destination: string) => void;
  }) => {
    mocks.profileNavigate = onNavigate;
    return createElement("div", { "data-testid": "profile-sheet" });
  },
}));

vi.mock("./components/FieldPicker", () => ({
  FieldPicker: ({ label }: any) =>
    createElement("div", { "data-testid": `field-${label}` }),
}));

vi.mock("./components/PullToSearch", () => ({
  PullToSearch: () => createElement("div", { "data-testid": "pull-to-search" }),
}));

vi.mock("./components/PullToRefresh", () => ({
  PullToRefresh: ({ children, onRefresh }: any) => {
    mocks.refresh = onRefresh;
    return createElement(
      "div",
      { "data-testid": "pull-to-refresh" },
      createElement("button", { onClick: onRefresh }, "Refresh"),
      children,
    );
  },
}));

vi.mock("./components/OfflineBanner", () => ({
  OfflineBanner: () =>
    createElement("div", { "data-testid": "offline-banner" }),
}));

vi.mock("./components/InstallBanner", () => ({
  InstallBanner: () =>
    createElement("div", { "data-testid": "install-banner" }),
}));

vi.mock("./components/Onboarding", () => ({
  Onboarding: () => createElement("div", { "data-testid": "onboarding" }),
}));

vi.mock("./components/SnoozePicker", () => ({
  SnoozePicker: () => createElement("div", { "data-testid": "snooze-picker" }),
}));

vi.mock("./components/Illustrations", () => ({
  IllustrationConstruction: () =>
    createElement("div", { "data-testid": "illustration-construction" }),
}));

vi.mock("./screens/FocusScreen", () => ({
  FocusScreen: () => createElement("div", { "data-testid": "focus-screen" }),
}));

vi.mock("./screens/InboxScreen", () => ({
  InboxScreen: (props: NonNullable<typeof mocks.inboxProps>) => {
    mocks.inboxProps = props;
    props.refreshRef.current = mocks.refreshInbox;
    return createElement("div", { "data-testid": "inbox-screen" });
  },
}));

vi.mock("./screens/TodayScreen", () => ({
  TodayScreen: () => createElement("div", { "data-testid": "today-screen" }),
}));

vi.mock("./screens/ProjectsScreen", () => ({
  ProjectsScreen: () =>
    createElement("div", { "data-testid": "projects-screen" }),
}));

vi.mock("./screens/CustomScreen", () => ({
  CustomScreen: () => createElement("div", { "data-testid": "custom-screen" }),
}));

vi.mock("../api/client", () => ({
  apiCall: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
}));

describe("MobileShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeTab = "focus";
    mocks.customView = "all";
    mocks.loadState = "loaded";
    mocks.todos = [];
    mocks.loadTodos.mockResolvedValue(true);
    mocks.revalidate.mockResolvedValue(true);
    mocks.refreshInbox.mockResolvedValue(true);
    mocks.refresh = null;
    mocks.inboxProps = null;
    mocks.profileNavigate = null;
  });

  it("renders the shell container", () => {
    render(createElement(MobileShell));
    expect(screen.getByTestId("tab-bar")).toBeTruthy();
    expect(screen.getByTestId("bottom-sheet")).toBeTruthy();
  });

  it("renders the OfflineBanner", () => {
    render(createElement(MobileShell));
    expect(screen.getByTestId("offline-banner")).toBeTruthy();
  });

  it("renders the InstallBanner", () => {
    render(createElement(MobileShell));
    expect(screen.getByTestId("install-banner")).toBeTruthy();
  });

  it("renders the Onboarding component", () => {
    render(createElement(MobileShell));
    expect(screen.getByTestId("onboarding")).toBeTruthy();
  });

  it("shows the Focus screen when activeTab is 'focus'", () => {
    render(createElement(MobileShell));
    expect(screen.getByTestId("focus-screen")).toBeTruthy();
    expect(screen.queryByTestId("today-screen")).toBeNull();
  });

  it("renders the QuickCapture component", () => {
    render(createElement(MobileShell));
    expect(screen.getByTestId("quick-capture")).toBeTruthy();
  });

  it("renders the ProfileSheet component", () => {
    render(createElement(MobileShell));
    expect(screen.getByTestId("profile-sheet")).toBeTruthy();
  });

  it("renders the PullToRefresh wrapper", () => {
    render(createElement(MobileShell));
    expect(screen.getByTestId("pull-to-refresh")).toBeTruthy();
  });

  it("renders with correct density and palette data attributes", () => {
    const { container } = render(createElement(MobileShell));
    const shell = container.querySelector(".m-shell");
    expect(shell).toHaveAttribute("data-density", "normal");
    expect(shell).toHaveAttribute("data-palette", "default");
  });

  it("renders the PullToSearch component", () => {
    render(createElement(MobileShell));
    expect(screen.getByTestId("pull-to-search")).toBeTruthy();
  });

  it("renders the SnoozePicker component", () => {
    render(createElement(MobileShell));
    expect(screen.getByTestId("snooze-picker")).toBeTruthy();
  });

  it("keeps Inbox review reachable when Tasks cannot load", () => {
    mocks.activeTab = "inbox";
    mocks.loadState = "error";
    render(createElement(MobileShell));
    expect(screen.getByTestId("inbox-screen")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Retry loading tasks" }),
    ).toBeTruthy();
  });

  it("refreshes accepted Tasks before opening the existing details sheet", async () => {
    mocks.activeTab = "inbox";
    const task = { id: "accepted-1", title: "Call dentist" } as Todo;
    mocks.todos = [task];
    render(createElement(MobileShell));
    await act(async () => {
      await mocks.inboxProps!.onAccepted(task);
    });
    expect(mocks.loadTodos).toHaveBeenCalledWith({});
    expect(mocks.revalidate).toHaveBeenCalled();
    await act(async () => {
      await mocks.inboxProps!.onOpenTask(task.id);
    });
    expect(screen.getByTestId("bottom-sheet")).toHaveAttribute(
      "data-snap",
      "half",
    );
    expect(screen.getByTestId("inbox-screen")).toBeTruthy();
  });

  it("reports accepted Tasks that could not be refreshed without repeating the save", async () => {
    mocks.activeTab = "inbox";
    mocks.loadTodos.mockResolvedValue(false);
    render(createElement(MobileShell));
    await expect(
      mocks.inboxProps!.onAccepted({ id: "accepted-1" } as Todo),
    ).rejects.toThrow("The task was added, but Tasks could not be refreshed");
  });

  it("keeps the Inbox visible and reports an accepted task that cannot be opened", async () => {
    mocks.activeTab = "inbox";
    mocks.loadTodos.mockResolvedValue(false);
    render(createElement(MobileShell));
    await act(async () => {
      await mocks.inboxProps!.onOpenTask("accepted-1");
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The task is saved, but could not be loaded",
    );
    expect(screen.getByTestId("bottom-sheet")).toHaveAttribute(
      "data-snap",
      "closed",
    );
    expect(screen.getByTestId("inbox-screen")).toBeTruthy();
  });

  it("waits for the Inbox request before completing pull-to-refresh", async () => {
    mocks.activeTab = "inbox";
    let finishInbox!: (value: boolean) => void;
    mocks.refreshInbox.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishInbox = resolve;
        }),
    );
    render(createElement(MobileShell));
    let completed = false;
    const refresh = mocks.refresh!().then((result) => {
      completed = true;
      return result;
    });
    await act(async () => {});
    expect(mocks.refreshInbox).toHaveBeenCalledOnce();
    expect(completed).toBe(false);
    finishInbox(true);
    await expect(refresh).resolves.toBe(true);
  });

  it("reports pull-to-refresh failure when Inbox cannot refresh", async () => {
    mocks.activeTab = "inbox";
    mocks.refreshInbox.mockResolvedValue(false);
    render(createElement(MobileShell));
    await expect(mocks.refresh!()).resolves.toBe(false);
  });

  it("retains the hidden Inbox when navigating to Tasks", () => {
    const { rerender } = render(createElement(MobileShell));
    const inbox = screen.getByTestId("inbox-screen");
    expect(inbox).not.toBeVisible();
    mocks.activeTab = "inbox";
    rerender(createElement(MobileShell));
    expect(screen.getByTestId("inbox-screen")).toBe(inbox);
    expect(inbox).toBeVisible();
    mocks.activeTab = "tasks";
    rerender(createElement(MobileShell));
    expect(screen.getByTestId("inbox-screen")).toBe(inbox);
    expect(inbox).not.toBeVisible();
  });

  it("keeps Focus available as an optional fourth-tab view", () => {
    mocks.activeTab = "custom";
    mocks.customView = "home";
    render(createElement(MobileShell));
    expect(screen.getByTestId("focus-screen")).toBeTruthy();
    expect(screen.queryByTestId("custom-screen")).toBeNull();
  });

  it("opens Tasks and Focus from More without changing saved custom preferences", () => {
    mocks.customView = "completed";
    render(createElement(MobileShell));
    act(() => mocks.profileNavigate!("tasks"));
    expect(mocks.setActiveTab).toHaveBeenCalledWith("tasks");
    act(() => mocks.profileNavigate!("focus"));
    expect(mocks.setActiveTab).toHaveBeenCalledWith("focus");
    expect(mocks.setCustomView).not.toHaveBeenCalled();
  });
});
