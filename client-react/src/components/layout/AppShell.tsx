import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from "react";
import { useAuth } from "../../auth/AuthProvider";
import { useTodosStore } from "../../store/useTodosStore";
import { useProjectsStore } from "../../store/useProjectsStore";
import { useDarkMode } from "../../hooks/useDarkMode";
import { useDensity } from "../../hooks/useDensity";
import { useGroupBy } from "../../hooks/useGroupBy";
import { useServiceWorker } from "../../hooks/useServiceWorker";
import { useIsMobile } from "../../hooks/useIsMobile";
import { IconMoon, IconSun, IconMenu } from "../shared/Icons";
import { useIcsExport } from "../../hooks/useIcsExport";
import { captureInboxItem } from "../../api/inbox";
import { apiCall } from "../../api/client";
import { Sidebar, type WorkspaceView } from "../projects/Sidebar";
import { SortableTodoList } from "../todos/SortableTodoList";
import { TodoDrawer } from "../todos/TodoDrawer";
import type { Project, Todo } from "../../types";
import type { SortField, SortOrder, ViewMode } from "../../types/viewTypes";
import { UndoToast, type ToastVariant } from "../shared/UndoToast";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { CommandPalette } from "../shared/CommandPalette";
import { ShortcutsOverlay } from "../shared/ShortcutsOverlay";
import { type ActiveFilters } from "../todos/FilterPanel";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { ComponentGalleryPage } from "./ComponentGalleryPage";
import { SettingsPage } from "./SettingsPage";
import { TuneUpView } from "../tuneup/TuneUpView";
import { HomeDashboard } from "./HomeDashboard";
import { InboxReview } from "../inbox/InboxReview";
import { ViewHeader } from "./ViewHeader";
import { ProjectCrud } from "../projects/ProjectCrud";
import {
  ProjectEditorView,
  type ProjectSavePayload,
} from "../projects/ProjectEditorView";
import { PROJECT_RAIL_BACKLOG_SENTINEL } from "../projects/projectEditorModels";
import { OnboardingFlow } from "../shared/OnboardingFlow";
import { useTaskNavigation } from "../../hooks/useTaskNavigation";
import { useHashRoute } from "../../hooks/useHashRoute";
import { useViewTransition } from "../../hooks/useViewTransition";
import { TaskFullPage } from "../todos/TaskFullPage";
import { ViewRouter, ViewRoute } from "./ViewRouter";
import { ListViewHeader } from "./ListViewHeader";
import {
  focusGlobalSearchInput,
  triggerPrimaryNewTask,
} from "../../utils/focusTargets";
import { useOverlayFocusTrap } from "../shared/useOverlayFocusTrap";
import * as todosApi from "../../api/todos";
import {
  filterVisibleTodos,
  computeHorizonCounts,
  computeViewCounts,
  getQuickEntryPlaceholder,
  type HorizonSegment,
} from "./appShellFilters";
import {
  buildQueryParams,
  getViewTitle,
  shouldShowListViewHeader,
  isBlockingOverlayOpen,
  DRAFT_PROJECT_ID,
} from "./appShellViews";
import {
  computeSnoozePayload,
  getLifecycleUndoMessage,
  buildDocumentTitle,
  getHeaderTitle,
  getActiveViewKey,
  computeNextNavIndex,
  computeSelectAllResult,
  createDraftProject,
  VIEW_LABELS,
  type SnoozeAction,
} from "./appShellLogic";

// Lazy-loaded heavy components (code splitting)
const BoardView = lazy(() =>
  import("../todos/BoardView").then((m) => ({ default: m.BoardView })),
);
const TaskComposer = lazy(() =>
  import("../todos/TaskComposer").then((m) => ({ default: m.TaskComposer })),
);
const AdminPage = lazy(() =>
  import("../admin/AdminPage").then((m) => ({ default: m.AdminPage })),
);
const FeedbackForm = lazy(() =>
  import("../feedback/FeedbackForm").then((m) => ({ default: m.FeedbackForm })),
);
const WeeklyReview = lazy(() =>
  import("./WeeklyReview").then((m) => ({ default: m.WeeklyReview })),
);
import { AgentActivityView } from "../activity/AgentActivityView";

type AppPage =
  | "todos"
  | "settings"
  | "components"
  | "admin"
  | "feedback"
  | "review"
  | "activity";
type UiMode = "normal" | "simple";

interface UndoAction {
  message: string;
  onUndo?: () => void;
  actionLabel?: string;
  variant?: ToastVariant;
}

export function AppShell() {
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const { dark, toggle: toggleDarkMode } = useDarkMode();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("inbox");
  const [inboxRefreshKey, setInboxRefreshKey] = useState(0);
  // Per-view density: list surfaces (today / horizon / all) each remember
  // their own row density. Other views share the global key so they
  // behave as before. Values must stay a subset of WorkspaceView.
  const densityViewKey =
    activeView === "today" || activeView === "horizon" || activeView === "all"
      ? activeView
      : undefined;
  const {
    density,
    setDensity,
    cycle: cycleDensity,
  } = useDensity(densityViewKey);
  const { groupBy, setGroupBy } = useGroupBy();
  const { startTransition } = useViewTransition();
  const [horizonSegment, setHorizonSegment] = useState<HorizonSegment>(() => {
    const stored = localStorage.getItem("todos:horizon-segment");
    return stored === "due" ||
      stored === "planned" ||
      stored === "pending" ||
      stored === "later"
      ? stored
      : "due";
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [draftProject, setDraftProject] = useState<Project | null>(null);
  const taskNav = useTaskNavigation();
  const hashRoute = useHashRoute();
  const activeTodoId = taskNav.activeTaskId;
  const expandedTodoId =
    taskNav.state.mode === "quickEdit" ? taskNav.state.taskId : null;
  const fullPageTaskId =
    taskNav.state.mode === "fullPage" ? taskNav.state.taskId : null;
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const deletePendingRef = useRef(false);
  const deleteAttemptedRef = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({
    dateFilter: "all",
    priority: "",
    status: "",
  });
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [page, setPage] = useState<AppPage>("todos");
  const [showTuneUp, setShowTuneUp] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [projectCrudMode, setProjectCrudMode] = useState<
    "create" | "rename" | null
  >(null);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortField>("order");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [activeTagFilter, setActiveTagFilter] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [composerOpen, setComposerOpen] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [uiMode, setUiMode] = useState<UiMode>(
    () => (localStorage.getItem("todos:ui-mode") as UiMode) || "normal",
  );
  const exportIcs = useIcsExport();
  const mobileSheetRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const appMainRef = useRef<HTMLDivElement>(null);
  const showOnboarding = Boolean(user && !user.onboardingCompletedAt);

  useOverlayFocusTrap({
    isOpen: isMobile && mobileNavOpen,
    containerRef: mobileSheetRef,
    onClose: () => setMobileNavOpen(false),
  });

  // Bulk selection
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const {
    todos,
    getTodo,
    loadState,
    errorMessage,
    loadTodos,
    addTodo,
    toggleTodo,
    editTodo,
    removeTodo,
  } = useTodosStore();

  const { projects, loadProjects } = useProjectsStore();

  // Build query params based on active view + project
  const queryParams = useMemo(
    () =>
      buildQueryParams({
        activeView,
        selectedProjectId,
        sortBy,
        sortOrder,
      }),
    [activeView, selectedProjectId, sortBy, sortOrder],
  );

  // Load data on mount and when filters change
  useEffect(() => {
    loadTodos(queryParams);
  }, [loadTodos, queryParams]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    localStorage.setItem("todos:horizon-segment", horizonSegment);
  }, [horizonSegment]);

  // Hash route ↔ task navigation sync
  // On hash change (e.g. browser back), sync to nav state
  useEffect(() => {
    const taskId = hashRoute.taskId;
    if (taskId && taskNav.state.mode !== "fullPage") {
      taskNav.openFullPage(taskId);
    } else if (!taskId && taskNav.state.mode === "fullPage") {
      taskNav.collapse();
    }
  }, [hashRoute.taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When nav state enters fullPage, push hash
  useEffect(() => {
    if (fullPageTaskId && hashRoute.taskId !== fullPageTaskId) {
      hashRoute.navigateToTask(fullPageTaskId);
    } else if (!fullPageTaskId && hashRoute.taskId) {
      hashRoute.clearRoute();
    }
  }, [fullPageTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Service worker — offline sync
  useServiceWorker(
    useCallback((replayed: number, failed: number) => {
      if (replayed > 0) {
        setUndoAction({
          message: `Synced ${replayed} offline change${replayed > 1 ? "s" : ""}${failed > 0 ? ` (${failed} failed)` : ""}`,
        });
      }
    }, []),
  );

  // Client-side filtering: delegated to extracted pure utility
  const visibleTodos = useMemo(() => {
    return filterVisibleTodos({
      todos,
      activeView,
      horizonSegment,
      selectedProjectId,
      searchQuery,
      activeTagFilter,
      activeHeadingId,
      activeFilters,
    });
  }, [
    todos,
    activeView,
    horizonSegment,
    selectedProjectId,
    searchQuery,
    activeTagFilter,
    activeHeadingId,
    activeFilters,
  ]);

  const drawerTaskId =
    taskNav.state.mode === "drawer" ? taskNav.state.taskId : null;
  const activeTodo = useMemo(
    () =>
      drawerTaskId ? (todos.find((t) => t.id === drawerTaskId) ?? null) : null,
    [todos, drawerTaskId],
  );
  const hasBlockingOverlay =
    mobileNavOpen ||
    paletteOpen ||
    shortcutsOpen ||
    composerOpen ||
    !!projectCrudMode ||
    !!deleteTarget ||
    !!activeTodo ||
    showOnboarding;

  useEffect(() => {
    for (const element of [sidebarRef.current, appMainRef.current]) {
      if (!element) continue;
      if (hasBlockingOverlay) {
        element.setAttribute("aria-hidden", "true");
        element.setAttribute("inert", "");
      } else {
        element.removeAttribute("aria-hidden");
        element.removeAttribute("inert");
      }
    }

    return () => {
      for (const element of [sidebarRef.current, appMainRef.current]) {
        element?.removeAttribute("aria-hidden");
        element?.removeAttribute("inert");
      }
    };
  }, [hasBlockingOverlay]);

  const horizonCounts = useMemo(() => computeHorizonCounts(todos), [todos]);

  // Count badges for workspace views
  const viewCounts = useMemo(() => computeViewCounts(todos), [todos]);

  // Context-aware quick entry placeholder
  const quickEntryPlaceholder = useMemo(() => {
    if (selectedProjectId) {
      const project = projects.find((p) => p.id === selectedProjectId);
      return project ? `Add a task to ${project.name}…` : "Add a task…";
    }
    switch (activeView) {
      case "home":
        return "What needs your focus today?";
      case "today":
        return "Add a task for today…";
      case "horizon":
        switch (horizonSegment) {
          case "pending":
            return "Add something you’re waiting on…";
          case "planned":
            return "Add something planned for later…";
          case "later":
            return "Capture something for later…";
          default:
            return "Add something on the horizon…";
        }
      default:
        return "Add a task…";
    }
  }, [selectedProjectId, projects, activeView, horizonSegment]);

  const focusSearchInput = useCallback(() => {
    startTransition(() => setPage("todos"));
    requestAnimationFrame(() => {
      focusGlobalSearchInput();
    });
  }, [startTransition]);

  const focusQuickEntryOrOpenComposer = useCallback(() => {
    startTransition(() => setPage("todos"));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (triggerPrimaryNewTask()) {
          return;
        }
        setComposerOpen(true);
      });
    });
  }, [startTransition]);

  // --- Handlers ---

  const reportTaskFailure = useCallback((error: unknown) => {
    setUndoAction({
      message:
        error instanceof Error
          ? error.message
          : "The task could not be changed. Try again.",
      variant: "error",
    });
  }, []);

  const handleQuickEdit = useCallback(
    (id: string) => {
      taskNav.openQuickEdit(id);
    },
    [taskNav],
  );

  const handleOpenDrawer = useCallback(
    (id: string) => {
      taskNav.openDrawer(id);
    },
    [taskNav],
  );

  const handleCloseDrawer = useCallback(() => {
    taskNav.deescalate();
  }, [taskNav]);

  const handleCaptureToDesk = useCallback(
    async (text: string) => {
      await captureInboxItem(text);
      setInboxRefreshKey((value) => value + 1);
      setUndoAction({
        message: "Saved to Inbox for review",
        actionLabel: "Open Inbox",
        onUndo: () => {
          setPage("todos");
          setSelectedProjectId(null);
          setActiveView("inbox");
          taskNav.collapse();
        },
      });
    },
    [taskNav],
  );

  const handleInlineEdit = useCallback(
    async (id: string, title: string) => {
      await editTodo(id, { title });
    },
    [editTodo],
  );

  const handleLifecycleAction = useCallback(
    async (id: string, action: string) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);

      const todo = todos.find((t) => t.id === id);
      const payload = computeSnoozePayload(action as SnoozeAction);
      const message = getLifecycleUndoMessage(
        action as SnoozeAction,
        todo?.title ?? "Task",
      );

      if (payload.status) {
        await editTodo(id, { status: payload.status as Todo["status"] });
      }
      if (payload.archived !== undefined) {
        await editTodo(id, { archived: payload.archived });
      }
      if (payload.scheduledDate) {
        await editTodo(id, {
          scheduledDate: payload.scheduledDate,
          status: "scheduled" as "scheduled",
        });
      }

      if (action === "cancel") {
        setUndoAction({
          message,
          onUndo: () => editTodo(id, { status: "inbox" as "inbox" }),
        });
      } else if (action === "archive") {
        setUndoAction({
          message,
          onUndo: () => editTodo(id, { archived: false }),
        });
      } else {
        setUndoAction({ message });
      }
    },
    [editTodo],
  );

  const handleTagClick = useCallback((tag: string) => {
    setActiveTagFilter((prev) => (prev === tag ? "" : tag));
  }, []);

  const handleReorder = useCallback(
    async (activeId: string, overId: string) => {
      const oldIndex = visibleTodos.findIndex((t) => t.id === activeId);
      const newIndex = visibleTodos.findIndex((t) => t.id === overId);
      if (oldIndex === -1 || newIndex === -1) return;

      // Build reorder payload
      const reordered = [...visibleTodos];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);
      const items = reordered.map((t, i) => ({ id: t.id, order: i }));

      try {
        await todosApi.reorderTodos(items);
        loadTodos(queryParams);
      } catch {
        // Refresh to get server state
        loadTodos(queryParams);
      }
    },
    [visibleTodos, loadTodos, queryParams],
  );

  const handleToggle = useCallback(
    async (id: string, completed: boolean) => {
      const todo = todos.find((t) => t.id === id);
      try {
        await toggleTodo(id, completed);
      } catch (error) {
        reportTaskFailure(error);
        return;
      }
      if (todo) {
        setUndoAction({
          message: completed
            ? `"${todo.title}" completed`
            : `"${todo.title}" marked incomplete`,
          onUndo: () => {
            void toggleTodo(id, !completed).catch(reportTaskFailure);
          },
        });
      }
    },
    [todos, toggleTodo, reportTaskFailure],
  );

  const handleDeleteRequest = useCallback((id: string) => {
    if (deletePendingRef.current) return;
    deleteAttemptedRef.current = false;
    setDeleteTarget(id);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget || deleteAttemptedRef.current) return;
    deleteAttemptedRef.current = true;
    deletePendingRef.current = true;
    const todo = todos.find((t) => t.id === deleteTarget);
    try {
      await removeTodo(deleteTarget);
    } catch (error) {
      // The confirmation has already animated out; close it and show the error.
      setDeleteTarget(null);
      reportTaskFailure(error);
      return;
    } finally {
      deletePendingRef.current = false;
    }
    if (activeTodoId === deleteTarget) taskNav.collapse();
    setDeleteTarget(null);
    if (todo) {
      setUndoAction({
        message: `"${todo.title}" deleted`,
        onUndo: () => {
          // Re-create (best effort — server assigns new ID)
          void addTodo({ title: todo.title, projectId: todo.projectId }).catch(
            reportTaskFailure,
          );
        },
      });
    }
  }, [
    deleteTarget,
    activeTodoId,
    todos,
    removeTodo,
    addTodo,
    reportTaskFailure,
  ]);

  // --- Project next step handlers ---

  const handleProjectTaskDefer = useCallback(
    async (todo: Todo) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      await editTodo(todo.id, { dueDate: tomorrow.toISOString() });
      setUndoAction({
        message: `"${todo.title}" deferred to tomorrow`,
        onUndo: () => editTodo(todo.id, { dueDate: todo.dueDate }),
      });
    },
    [editTodo],
  );

  const handleReplaceNextTask = useCallback(() => {
    // This would cycle to the next task
    // For now, just show a toast
    setUndoAction({
      message: "Pick another task feature coming soon",
    });
  }, []);

  const handleSaveProject = useCallback(
    async (id: string, payload: ProjectSavePayload) => {
      const body: Record<string, unknown> = {};
      if (payload.name !== undefined) body.name = payload.name;
      if (payload.description !== undefined)
        body.description = payload.description;
      if (payload.goal !== undefined) body.goal = payload.goal;
      if (payload.area !== undefined) body.area = payload.area;
      if (payload.priority !== undefined) body.priority = payload.priority;
      if (payload.targetDate !== undefined)
        body.targetDate = payload.targetDate;
      if (payload.status !== undefined) body.status = payload.status;
      if (id === DRAFT_PROJECT_ID) {
        const response = await apiCall("/projects", {
          method: "POST",
          body: JSON.stringify(body),
        });
        const created = (await response.json()) as Project;
        setDraftProject(null);
        setSelectedProjectId(created.id);
        await loadProjects();
        return;
      }
      await apiCall(`/projects/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      loadProjects();
    },
    [loadProjects],
  );

  const handleSelectView = useCallback((view: WorkspaceView) => {
    setActiveView(view);
    taskNav.collapse();
    setBulkMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleSelectHorizonSegment = useCallback(
    (segment: HorizonSegment) => {
      setHorizonSegment(segment);
      setActiveView("horizon");
      taskNav.collapse();
      setBulkMode(false);
      setSelectedIds(new Set());
    },
    [taskNav],
  );

  const handleSelectProject = useCallback((id: string | null) => {
    if (id !== DRAFT_PROJECT_ID) {
      setDraftProject(null);
    }
    setSelectedProjectId(id);
    setActiveHeadingId(null);
    taskNav.collapse();
    setBulkMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleCreateProjectDraft = useCallback(() => {
    startTransition(() => setPage("todos"));
    setDraftProject(createDraftProject());
    setSelectedProjectId(DRAFT_PROJECT_ID);
    setActiveHeadingId(null);
    taskNav.collapse();
    setBulkMode(false);
    setSelectedIds(new Set());
    setMobileNavOpen(false);
  }, [startTransition, taskNav]);

  const handleOpenProject = useCallback(
    async (id: string) => {
      await loadProjects();
      handleSelectProject(id);
    },
    [handleSelectProject, loadProjects],
  );

  // --- Bulk actions ---

  const handleBulkSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkMode(true);
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(
      computeSelectAllResult(
        selectedIds,
        visibleTodos.map((t) => t.id),
      ),
    );
  }, [selectedIds, visibleTodos]);

  const handleBulkComplete = useCallback(async () => {
    const ids = [...selectedIds];
    await Promise.all(
      ids.map((id) => todosApi.updateTodo(id, { completed: true })),
    );
    setBulkMode(false);
    setSelectedIds(new Set());
    loadTodos(queryParams);
  }, [selectedIds, loadTodos, queryParams]);

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => todosApi.deleteTodo(id)));
    setBulkMode(false);
    setSelectedIds(new Set());
    loadTodos(queryParams);
  }, [selectedIds, loadTodos, queryParams]);

  const handleCancelBulk = useCallback(() => {
    setBulkMode(false);
    setSelectedIds(new Set());
  }, []);

  // --- Keyboard shortcuts ---

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape: close palette, cancel delete confirm, de-escalate task UI,
      // cancel bulk, close mobile nav
      if (e.key === "Escape") {
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        if (deleteTarget) {
          setDeleteTarget(null);
          return;
        }
        if (activeTodoId) {
          taskNav.deescalate();
        } else if (bulkMode) {
          handleCancelBulk();
        } else if (mobileNavOpen) {
          setMobileNavOpen(false);
        }
        return;
      }

      // Ctrl/Cmd+K: open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }

      const inInput =
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.tagName === "SELECT";

      if (inInput) return;

      // 'n': focus quick entry
      if (e.key === "n" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        focusQuickEntryOrOpenComposer();
        return;
      }

      // 'v': toggle view menu
      if (e.key === "v" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setViewMenuOpen((o) => !o);
        return;
      }

      // '/': focus search
      if (e.key === "/") {
        e.preventDefault();
        focusSearchInput();
        return;
      }

      // '?': toggle shortcuts overlay
      if (e.key === "?") {
        setShortcutsOpen((o) => !o);
        return;
      }

      // j/k: navigate between tasks
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const ids = visibleTodos.map((t) => t.id);
        if (ids.length === 0) return;
        const direction = e.key === "j" ? "down" : "up";
        const nextIdx = computeNextNavIndex(activeTodoId, direction, ids);
        taskNav.openQuickEdit(ids[nextIdx]);
        document
          .querySelector(`[data-todo-id="${ids[nextIdx]}"]`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }

      // x: toggle completion of focused task
      if (e.key === "x" && activeTodoId) {
        e.preventDefault();
        const todo = visibleTodos.find((t) => t.id === activeTodoId);
        if (todo) handleToggle(activeTodoId, !todo.completed);
        return;
      }

      // e: open drawer for focused task
      if (e.key === "e" && activeTodoId) {
        e.preventDefault();
        handleOpenDrawer(activeTodoId);
        return;
      }

      // d: delete focused task
      if (e.key === "d" && activeTodoId) {
        e.preventDefault();
        setDeleteTarget(activeTodoId);
        return;
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    activeTodoId,
    bulkMode,
    mobileNavOpen,
    paletteOpen,
    deleteTarget,
    viewMenuOpen,
    handleCancelBulk,
    focusQuickEntryOrOpenComposer,
    focusSearchInput,
    handleOpenDrawer,
    handleToggle,
    taskNav,
    visibleTodos,
  ]);

  // --- Derived ---

  const selectedProject = selectedProjectId
    ? selectedProjectId === DRAFT_PROJECT_ID
      ? draftProject
      : (projects.find((p) => p.id === selectedProjectId) ?? null)
    : null;

  const headerTitle = getHeaderTitle(
    activeView,
    selectedProjectId,
    selectedProject?.name ?? null,
  );

  // ViewRouter active key: projects get a dynamic composite key
  const activeViewKey = getActiveViewKey(activeView, selectedProjectId);

  // Dynamic page title
  useEffect(() => {
    document.title = buildDocumentTitle(page, headerTitle);
  }, [page, headerTitle]);

  const handlePaletteNavigate = useCallback(
    (view: WorkspaceView) => {
      startTransition(() => setPage("todos"));
      handleSelectView(view);
      handleSelectProject(null);
    },
    [handleSelectView, handleSelectProject],
  );

  const sidebarContent = (
    <Sidebar
      projects={projects}
      activeView={activeView}
      selectedProjectId={selectedProjectId}
      viewCounts={viewCounts}
      onSelectView={(v) => {
        startTransition(() => setPage("todos"));
        handleSelectView(v);
        setMobileNavOpen(false);
      }}
      onSelectProject={(id) => {
        startTransition(() => setPage("todos"));
        handleSelectProject(id);
        setMobileNavOpen(false);
      }}
      onCreateProject={handleCreateProjectDraft}
      onOpenSettings={() => {
        startTransition(() => setPage("settings"));
        setMobileNavOpen(false);
      }}
      onOpenComponents={() => {
        startTransition(() => setPage("components"));
        setMobileNavOpen(false);
      }}
      onOpenFeedback={() => {
        startTransition(() => setPage("feedback"));
        setMobileNavOpen(false);
      }}
      onOpenAdmin={() => {
        startTransition(() => setPage("admin"));
        setMobileNavOpen(false);
      }}
      onOpenActivity={() => {
        startTransition(() => setPage("activity"));
        setMobileNavOpen(false);
      }}
      activePage={page}
      onToggleTheme={toggleDarkMode}
      onOpenShortcuts={() => setShortcutsOpen(true)}
      onOpenProfile={() => {
        startTransition(() => setPage("settings"));
        setMobileNavOpen(false);
      }}
      onLogout={logout}
      user={user}
      dark={dark}
      isAdmin={user?.role === "admin"}
      isCollapsed={sidebarCollapsed}
      onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onNewTask={() => setComposerOpen(true)}
      uiMode={uiMode}
    />
  );

  return (
    <div
      className={`app-shell${bulkMode ? " is-bulk-selecting" : ""}${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
    >
      {/* Desktop sidebar */}
      {!isMobile && (
        <aside
          ref={sidebarRef}
          className={`app-sidebar${sidebarCollapsed ? " app-sidebar--collapsed" : ""}`}
        >
          {sidebarContent}
        </aside>
      )}

      {/* Mobile nav sheet */}
      {isMobile && (
        <>
          <div
            id="projectsRailSheet"
            ref={mobileSheetRef}
            className="mobile-sheet"
            aria-hidden={!mobileNavOpen}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
          >
            {sidebarContent}
          </div>
          <div
            className="mobile-sheet-backdrop"
            aria-hidden={!mobileNavOpen}
            onClick={() => setMobileNavOpen(false)}
          />
        </>
      )}

      <div ref={appMainRef} className="app-main">
        {loadState === "loading" && (
          <div className="loading-bar" aria-label="Loading">
            <div className="loading-bar__fill" />
          </div>
        )}
        <ErrorBoundary>
          {page === "settings" && showTuneUp ? (
            <TuneUpView
              onOpenTask={(taskId) => {
                setShowTuneUp(false);
                startTransition(() => setPage("todos"));
                taskNav.openDrawer(taskId);
              }}
              onUndo={(action) => setUndoAction(action)}
            />
          ) : page === "settings" ? (
            <SettingsPage
              dark={dark}
              onToggleDark={toggleDarkMode}
              uiMode={uiMode}
              onToggleUiMode={() => {
                const next = uiMode === "normal" ? "simple" : "normal";
                setUiMode(next);
                localStorage.setItem("todos:ui-mode", next);
              }}
              density={density}
              onCycleDensity={cycleDensity}
              onBack={() => {
                setShowTuneUp(false);
                startTransition(() => setPage("todos"));
              }}
              onOpenTuneUp={() => setShowTuneUp(true)}
            />
          ) : page === "components" ? (
            <ComponentGalleryPage
              dark={dark}
              onBack={() => startTransition(() => setPage("todos"))}
            />
          ) : page === "admin" ? (
            <Suspense
              fallback={
                <div className="loading-skeleton loading">
                  <div className="loading-skeleton__row" />
                </div>
              }
            >
              <AdminPage
                onBack={() => startTransition(() => setPage("todos"))}
              />
            </Suspense>
          ) : page === "feedback" ? (
            <Suspense
              fallback={
                <div className="loading-skeleton loading">
                  <div className="loading-skeleton__row" />
                </div>
              }
            >
              <FeedbackForm
                onBack={() => startTransition(() => setPage("todos"))}
              />
            </Suspense>
          ) : page === "review" ? (
            <Suspense
              fallback={
                <div className="loading-skeleton loading">
                  <div className="loading-skeleton__row" />
                </div>
              }
            >
              <WeeklyReview
                onBack={() => startTransition(() => setPage("todos"))}
                onApplied={() => {
                  void loadTodos(queryParams);
                  void loadProjects();
                }}
              />
            </Suspense>
          ) : page === "activity" ? (
            <AgentActivityView
              onBack={() => startTransition(() => setPage("todos"))}
            />
          ) : (
            <ViewRouter activeViewKey={activeViewKey} capacity={3}>
              <ViewRoute viewKey="inbox">
                <ViewHeader
                  title="Inbox"
                  subtitle="Capture now. Review when you’re ready."
                />
                <div className="app-content">
                  <InboxReview
                    refreshKey={inboxRefreshKey}
                    onAccepted={async () => {
                      if (!(await loadTodos(queryParams))) {
                        throw new Error("Tasks could not be refreshed");
                      }
                    }}
                    onOpenTask={async (id) => {
                      const refreshed = await loadTodos(
                        buildQueryParams({
                          activeView: "all",
                          selectedProjectId: null,
                          sortBy,
                          sortOrder,
                        }),
                      );
                      if (!refreshed || !getTodo(id)) {
                        setUndoAction({
                          message:
                            "Task was accepted. It could not be loaded; refresh Tasks and try again.",
                          variant: "error",
                        });
                        return;
                      }
                      setSelectedProjectId(null);
                      setActiveView("all");
                      taskNav.openDrawer(id);
                    }}
                  />
                </div>
              </ViewRoute>
              <ViewRoute viewKey="home">
                {!isMobile && (
                  <header className="app-header">
                    <span className="app-header__title">Focus</span>
                    <button
                      className="btn"
                      data-new-task-trigger="true"
                      onClick={() => setComposerOpen(true)}
                      id="topBarNewTaskCta"
                    >
                      + New Task
                    </button>
                    <button
                      className="btn"
                      onClick={toggleDarkMode}
                      aria-label="Toggle dark mode"
                      style={{ fontSize: "var(--fs-label)" }}
                    >
                      {dark ? <IconSun /> : <IconMoon />}
                    </button>
                    {user && (
                      <button
                        className="btn"
                        style={{ fontSize: "var(--fs-label)" }}
                        onClick={logout}
                      >
                        Logout
                      </button>
                    )}
                  </header>
                )}
                {isMobile && (
                  <div className="mobile-header">
                    <button
                      id="projectsRailMobileOpen"
                      className="mobile-header__menu-btn"
                      onClick={() => setMobileNavOpen(true)}
                      aria-label="Open navigation"
                    >
                      <IconMenu />
                    </button>
                    <span className="app-header__title">Focus</span>
                    <button
                      className="btn"
                      data-new-task-trigger="true"
                      onClick={() => setComposerOpen(true)}
                      style={{
                        marginLeft: "auto",
                        fontSize: "var(--fs-label)",
                      }}
                    >
                      + New
                    </button>
                  </div>
                )}
                <div className="app-content">
                  <HomeDashboard
                    todos={todos}
                    projects={projects}
                    onTodoClick={handleOpenDrawer}
                    onToggleTodo={handleToggle}
                    onEditTodo={(id, updates) => {
                      editTodo(id, updates);
                    }}
                    onNavigate={(v) => {
                      handleSelectView(v);
                      handleSelectProject(null);
                    }}
                    onSelectProject={(id) => {
                      handleSelectProject(id);
                      startTransition(() => setPage("todos"));
                    }}
                    onUndo={(action) =>
                      setUndoAction({
                        message: action.message,
                        onUndo: action.onUndo,
                      })
                    }
                  />
                </div>
              </ViewRoute>

              {/* List views with shared header */}
              {(["all", "today", "horizon", "completed"] as const).map(
                (view) => (
                  <ViewRoute key={view} viewKey={view}>
                    <ListViewHeader
                      headerTitle={VIEW_LABELS[view] ?? view}
                      activeView={view}
                      selectedProjectId={null}
                      isMobile={isMobile}
                      horizonSegment={
                        view === "horizon" ? horizonSegment : undefined
                      }
                      onHorizonSegmentChange={
                        view === "horizon"
                          ? handleSelectHorizonSegment
                          : undefined
                      }
                      horizonSegmentCounts={
                        view === "horizon" ? horizonCounts : undefined
                      }
                      visibleTodos={visibleTodos}
                      loadState={loadState}
                      filtersOpen={filtersOpen}
                      onToggleFilters={() => setFiltersOpen((o) => !o)}
                      activeFilters={activeFilters}
                      onFilterChange={setActiveFilters}
                      activeTagFilter={activeTagFilter}
                      onClearTagFilter={() => setActiveTagFilter("")}
                      viewMode={viewMode}
                      onViewModeChange={setViewMode}
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSortChange={(f, o) => {
                        setSortBy(f);
                        setSortOrder(o);
                      }}
                      onOpenNav={() => setMobileNavOpen(true)}
                      onNewTask={() => setComposerOpen(true)}
                      onToggleDark={toggleDarkMode}
                      onLogout={logout}
                      onClearProject={() => handleSelectProject(null)}
                      viewLabels={VIEW_LABELS}
                      bulkMode={bulkMode}
                      selectedIds={selectedIds}
                      onSelectAll={handleSelectAll}
                      onBulkComplete={handleBulkComplete}
                      onBulkDelete={handleBulkDelete}
                      onCancelBulk={handleCancelBulk}
                      uiMode={uiMode}
                      onAddTodo={addTodo}
                      onCaptureToDesk={handleCaptureToDesk}
                      quickEntryPlaceholder={quickEntryPlaceholder}
                      searchQuery={searchQuery}
                      onSearchChange={setSearchQuery}
                      todos={todos}
                      onExportIcs={exportIcs}
                      onExportMessage={(msg) => setUndoAction({ message: msg })}
                      user={user}
                      dark={dark}
                      groupBy={groupBy}
                      onGroupByChange={setGroupBy}
                      density={density}
                      onDensityChange={setDensity}
                      viewMenuOpen={viewMenuOpen}
                      onViewMenuOpenChange={setViewMenuOpen}
                    />
                    <div className="app-content">
                      {viewMode === "board" ? (
                        <Suspense
                          fallback={
                            <div className="loading-skeleton loading">
                              <div className="loading-skeleton__row" />
                            </div>
                          }
                        >
                          <BoardView
                            todos={visibleTodos}
                            loadState={loadState}
                            onToggle={handleToggle}
                            onClick={handleOpenDrawer}
                            onStatusChange={editTodo}
                          />
                        </Suspense>
                      ) : (
                        <SortableTodoList
                          todos={visibleTodos}
                          loadState={loadState}
                          errorMessage={errorMessage}
                          activeTodoId={activeTodoId}
                          expandedTodoId={expandedTodoId}
                          isBulkMode={bulkMode}
                          selectedIds={selectedIds}
                          projects={projects}
                          headings={[]}
                          onToggle={handleToggle}
                          onClick={handleQuickEdit}
                          onKebab={handleOpenDrawer}
                          onRetry={() => loadTodos(queryParams)}
                          onSelect={handleBulkSelect}
                          onInlineEdit={handleInlineEdit}
                          onSave={editTodo}
                          onTagClick={handleTagClick}
                          onLifecycleAction={handleLifecycleAction}
                          onReorder={handleReorder}
                          sortBy={sortBy}
                          sortOrder={sortOrder}
                          onSortChange={(f, o) => {
                            setSortBy(f);
                            setSortOrder(o);
                          }}
                        />
                      )}
                    </div>
                  </ViewRoute>
                ),
              )}

              {/* Dynamic project view */}
              {selectedProjectId && selectedProject && (
                <ViewRoute viewKey={`project:${selectedProjectId}`}>
                  <ProjectEditorView
                    project={selectedProject}
                    projects={projects}
                    projectTodos={todos}
                    visibleTodos={visibleTodos}
                    loadState={loadState}
                    errorMessage={errorMessage}
                    activeTodoId={activeTodoId}
                    expandedTodoId={expandedTodoId}
                    selectedIds={selectedIds}
                    activeHeadingId={activeHeadingId}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onOpenNav={() => setMobileNavOpen(true)}
                    onClearProject={() => handleSelectProject(null)}
                    onOpenProject={(id) => {
                      void handleOpenProject(id);
                    }}
                    viewLabels={VIEW_LABELS}
                    activeView={activeView}
                    onNewTask={() => setComposerOpen(true)}
                    user={user}
                    uiMode={uiMode}
                    quickEntryPlaceholder={quickEntryPlaceholder}
                    onAddTodo={addTodo}
                    onCaptureToDesk={handleCaptureToDesk}
                    filtersOpen={filtersOpen}
                    onToggleFilters={() => setFiltersOpen((o) => !o)}
                    activeFilters={activeFilters}
                    onFilterChange={setActiveFilters}
                    activeTagFilter={activeTagFilter}
                    onClearTagFilter={() => setActiveTagFilter("")}
                    bulkMode={bulkMode}
                    onSelectAll={handleSelectAll}
                    onBulkComplete={handleBulkComplete}
                    onBulkDelete={handleBulkDelete}
                    onCancelBulk={handleCancelBulk}
                    onSelectHeading={setActiveHeadingId}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    onToggle={handleToggle}
                    onTaskClick={handleQuickEdit}
                    onTaskOpen={handleOpenDrawer}
                    onRetry={() => loadTodos(queryParams)}
                    onSelect={handleBulkSelect}
                    onInlineEdit={handleInlineEdit}
                    onSave={editTodo}
                    onTagClick={handleTagClick}
                    onLifecycleAction={handleLifecycleAction}
                    onReorder={handleReorder}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSortChange={(f, o) => {
                      setSortBy(f);
                      setSortOrder(o);
                    }}
                    onDeferTask={handleProjectTaskDefer}
                    onReplaceNext={handleReplaceNextTask}
                    onSaveProject={handleSaveProject}
                    onRequestDeleteTodo={handleDeleteRequest}
                    onArchiveProject={async (id) => {
                      await apiCall(`/projects/${id}`, {
                        method: "PUT",
                        body: JSON.stringify({ archived: true }),
                      });
                      handleSelectProject(null);
                      loadProjects();
                    }}
                    onDeleteProject={async (id) => {
                      await apiCall(
                        `/projects/${id}?taskDisposition=unsorted`,
                        {
                          method: "DELETE",
                        },
                      );
                      handleSelectProject(null);
                      loadProjects();
                    }}
                    isDraft={selectedProject?.id === DRAFT_PROJECT_ID}
                  />
                </ViewRoute>
              )}
            </ViewRouter>
          )}
        </ErrorBoundary>
      </div>

      {fullPageTaskId &&
        (() => {
          const fullPageTodo = todos.find((t) => t.id === fullPageTaskId);
          return fullPageTodo ? (
            <TaskFullPage
              todo={fullPageTodo}
              projects={projects}
              onSave={editTodo}
              onDelete={handleDeleteRequest}
              onBack={() => taskNav.deescalate()}
            />
          ) : null;
        })()}

      <TodoDrawer
        todo={activeTodo}
        projects={projects}
        onClose={handleCloseDrawer}
        onSave={editTodo}
        onDelete={handleDeleteRequest}
        onOpenFullPage={(id) => taskNav.openFullPage(id)}
      />

      {deleteTarget && (
        <ConfirmDialog
          title="Delete task"
          message="Are you sure you want to delete this task? This cannot be undone."
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={handlePaletteNavigate}
        onNavigateHorizonSegment={(segment) => {
          startTransition(() => setPage("todos"));
          handleSelectHorizonSegment(segment);
          handleSelectProject(null);
        }}
        onWeeklyReview={() => startTransition(() => setPage("review"))}
        onToggleDarkMode={toggleDarkMode}
        onOpenSettings={() => startTransition(() => setPage("settings"))}
        onOpenFeedback={() => startTransition(() => setPage("feedback"))}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onNewTask={focusQuickEntryOrOpenComposer}
        onFocusSearch={focusSearchInput}
        onExportCalendar={() => {
          const withDates = todos.filter((t) => t.dueDate);
          if (withDates.length === 0) {
            setUndoAction({ message: "No tasks with due dates to export" });
            return;
          }
          exportIcs(withDates);
          setUndoAction({
            message: `Exported ${withDates.length} tasks to .ics`,
          });
        }}
        onLogout={logout}
        projects={projects}
        todos={todos}
        onTodoClick={(id) => {
          taskNav.openDrawer(id);
          setPaletteOpen(false);
        }}
        onProjectOpen={(id) => {
          startTransition(() => setPage("todos"));
          handleSelectProject(id);
          setPaletteOpen(false);
        }}
      />

      {projectCrudMode && (
        <ProjectCrud
          mode={projectCrudMode}
          currentName={renameTarget?.name}
          projectId={renameTarget?.id}
          onDone={() => {
            setProjectCrudMode(null);
            setRenameTarget(null);
            loadProjects();
          }}
          onCancel={() => {
            setProjectCrudMode(null);
            setRenameTarget(null);
          }}
        />
      )}

      <ShortcutsOverlay
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      <Suspense fallback={null}>
        <TaskComposer
          isOpen={composerOpen}
          projects={projects}
          defaultProjectId={selectedProjectId}
          workspaceView={activeView}
          onSubmitTask={async (dto) => {
            await addTodo(dto);
          }}
          onCaptureToDesk={handleCaptureToDesk}
          onClose={() => setComposerOpen(false)}
        />
      </Suspense>

      <UndoToast action={undoAction} onDismiss={() => setUndoAction(null)} />

      {showOnboarding && (
        <OnboardingFlow onComplete={() => {}} onAddTodo={addTodo} />
      )}
    </div>
  );
}
