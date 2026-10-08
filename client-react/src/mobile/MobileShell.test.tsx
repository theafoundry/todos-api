// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MobileShell } from "./MobileShell";

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
    todos: [],
    loadState: "loaded",
    errorMessage: "",
    getTodo: vi.fn(),
    getTodos: () => [],
    loadTodos: vi.fn().mockResolvedValue(undefined),
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
    loadProjects: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../hooks/useDarkMode", () => ({
  useDarkMode: () => ({ dark: false, toggle: vi.fn() }),
}));

vi.mock("./hooks/useTabBar", () => ({
  useTabBar: () => ({
    activeTab: "focus",
    setActiveTab: vi.fn(),
    customView: null,
    setCustomView: vi.fn(),
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
  useFocusBrief: () => ({ brief: null, loading: false, error: null }),
}));

vi.mock("./hooks/usePalette", () => ({
  usePalette: () => ({ palette: "default", setPalette: vi.fn() }),
}));

vi.mock("./components/TabBar", () => ({
  TabBar: () => createElement("nav", { "data-testid": "tab-bar" }),
}));

vi.mock("./components/BottomSheet", () => ({
  BottomSheet: () => createElement("div", { "data-testid": "bottom-sheet" }),
}));

vi.mock("./components/QuickCapture", () => ({
  QuickCapture: () => createElement("div", { "data-testid": "quick-capture" }),
}));

vi.mock("./components/ProfileSheet", () => ({
  ProfileSheet: () => createElement("div", { "data-testid": "profile-sheet" }),
}));

vi.mock("./components/FieldPicker", () => ({
  FieldPicker: ({ label }: any) =>
    createElement("div", { "data-testid": `field-${label}` }),
}));

vi.mock("./components/PullToSearch", () => ({
  PullToSearch: () => createElement("div", { "data-testid": "pull-to-search" }),
}));

vi.mock("./components/PullToRefresh", () => ({
  PullToRefresh: ({ children }: any) =>
    createElement("div", { "data-testid": "pull-to-refresh" }, children),
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
});
