import { useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useTodosStore } from "../store/useTodosStore";
import { useProjectsStore } from "../store/useProjectsStore";
import { useDarkMode } from "../hooks/useDarkMode";
import { useTabBar } from "./hooks/useTabBar";
import { useMobileNavigation } from "./hooks/useMobileNavigation";
import { useScrollPersistence } from "./hooks/useScrollPersistence";
import { useFocusBrief } from "../hooks/useFocusBrief";
import { useServiceWorker } from "../hooks/useServiceWorker";
import { usePalette } from "./hooks/usePalette";
import { useTaskActions } from "./hooks/useTaskActions";
import { ViewActivityProvider } from "../components/layout/ViewActivityContext";
import { TabBar } from "./components/TabBar";
import { BottomSheet } from "./components/BottomSheet";
import { TaskDetails } from "./components/TaskDetails";
import { TaskEditor } from "./components/TaskEditor";
import { TaskFeedback } from "./components/TaskFeedback";
import { QuickCapture } from "./components/QuickCapture";
import { ProfileSheet } from "./components/ProfileSheet";
import { PullToSearch } from "./components/PullToSearch";
import { PullToRefresh } from "./components/PullToRefresh";
import { OfflineBanner } from "./components/OfflineBanner";
import { SnoozePicker } from "./components/SnoozePicker";
import { InstallBanner } from "./components/InstallBanner";
import { Onboarding } from "./components/Onboarding";
import { IllustrationConstruction } from "./components/Illustrations";
import { FocusScreen } from "./screens/FocusScreen";
import { InboxScreen } from "./screens/InboxScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { CustomScreen } from "./screens/CustomScreen";
import { manualMutationRequest, MutationApiError } from "../api/mutations";
import type { Todo } from "../types";
import { validateTaskDates } from "./utils/taskDates";
import "./mobile.css";
import "./task-actions.css";

export function MobileShell() {
  const { user, logout } = useAuth();
  const { dark, toggle: toggleDarkMode } = useDarkMode();
  const {
    todos,
    getTodo,
    getTodos,
    loadState,
    errorMessage,
    loadTodos,
    addTodo,
    toggleTodo,
    editTodo,
    removeTodo,
  } = useTodosStore({ offlineMode: "manual" });
  const {
    projects,
    getProjects,
    loading: projectsLoading,
    error: projectsError,
    loadProjects,
  } = useProjectsStore();
  const { activeTab, setActiveTab, customView, setCustomView } = useTabBar();
  const inboxRefreshRef = useRef<(() => Promise<boolean>) | null>(null);
  const openingAcceptedTask = useRef(false);
  const { palette, setPalette } = usePalette();
  const focusBrief = useFocusBrief();
  const reconcileTasks = useCallback(async () => {
    const applied = await loadTodos({});
    await focusBrief.revalidate();
    return applied;
  }, [loadTodos, focusBrief.revalidate]);
  const actions = useTaskActions(reconcileTasks);
  const closeRequestRef = useRef<(() => void) | null>(null);
  const activeSurfaceId = useRef<string | null>(null);
  const navigation = useMobileNavigation({
    closeRequestRef,
    isDismissBlocked: () =>
      Boolean(
        activeSurfaceId.current &&
        actions.pendingIds.has(activeSurfaceId.current),
      ),
  });
  const {
    surface,
    page,
    openSurface,
    closeSurface,
    openPage,
    closePage,
    selectedProjectId,
    openProject,
    closeProject,
  } = navigation;
  activeSurfaceId.current = "taskId" in surface ? surface.taskId : null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewKey = `${activeTab}:${activeTab === "projects" ? (selectedProjectId ?? "all") : activeTab === "custom" ? customView : ""}`;
  const dataReady =
    loadState === "loaded" &&
    (activeTab !== "projects" || (!projectsLoading && !projectsError));
  useScrollPersistence(viewKey, scrollRef, dataReady);
  const onWorkerSync = useCallback(() => {
    void loadTodos({});
    void focusBrief.revalidate();
  }, [loadTodos, focusBrief.revalidate]);
  useServiceWorker(onWorkerSync);

  useEffect(() => {
    void loadTodos({});
    void loadProjects();
  }, [loadTodos, loadProjects]);
  const handleTodoClick = useCallback(
    (id: string) => {
      if (actions.pendingIds.has(id)) return;
      actions.setFeedback(null);
      openSurface({ mode: "details", taskId: id });
    },
    [actions.pendingIds, actions.setFeedback, openSurface],
  );
  const handleToggleTodo = useCallback(
    async (id: string, completed: boolean) => {
      const undo = {
        label: "Undo",
        run: () => {
          void actions.run(
            id,
            async () => {
              await toggleTodo(id, !completed);
              void focusBrief.revalidate();
            },
            completed ? "Reopened task" : "Completed task",
          );
        },
      };
      const saved = await actions.run(
        id,
        () => toggleTodo(id, completed),
        completed ? "Completed task" : "Reopened task",
        undo,
      );
      if (saved) {
        if ("taskId" in surface && surface.taskId === id)
          closeSurface({ all: true });
        void focusBrief.revalidate();
      }
      return saved;
    },
    [actions.run, toggleTodo, surface, closeSurface, focusBrief.revalidate],
  );
  const handleCreateTask = useCallback(
    async (dto: Parameters<typeof addTodo>[0]) => {
      await addTodo(dto);
      actions.setFeedback({ kind: "success", message: "Added task" });
      void focusBrief.revalidate();
    },
    [addTodo, actions.setFeedback, focusBrief.revalidate],
  );
  const handleCreateProject = useCallback(
    async (name: string) => {
      const response = await manualMutationRequest(
        "/projects",
        { method: "POST", body: JSON.stringify({ name }) },
        "add the project",
      );
      const project: unknown = await response.json().catch(() => null);
      if (
        !project ||
        typeof project !== "object" ||
        !("id" in project) ||
        typeof project.id !== "string" ||
        !project.id ||
        !("name" in project) ||
        project.name !== name
      )
        throw new MutationApiError(
          "Project save could not be confirmed. Refresh before adding it again.",
          "uncertain",
        );
      await loadProjects();
      actions.setFeedback({ kind: "success", message: "Added project" });
    },
    [loadProjects, actions.setFeedback],
  );
  const handleAvatarClick = useCallback(
    () => openSurface({ mode: "profile" }),
    [openSurface],
  );
  const handleRefresh = useCallback(async () => {
    const results = await Promise.all([
      loadTodos({}),
      loadProjects(),
      focusBrief.revalidate(),
      activeTab === "inbox" ? (inboxRefreshRef.current?.() ?? true) : true,
    ]);
    return results.every(Boolean);
  }, [loadTodos, loadProjects, focusBrief.revalidate, activeTab]);
  const handleSnoozeTodo = useCallback(
    (id: string) => {
      if (actions.pendingIds.has(id)) return;
      openSurface({ mode: "reschedule", taskId: id, returnToDetails: false });
    },
    [actions.pendingIds, openSurface],
  );
  const handleSnoozeClose = useCallback(() => closeSurface(), [closeSurface]);
  const handleSnoozeConfirm = useCallback(
    async (date: string) => {
      if (surface.mode !== "reschedule") return;
      const todo = todos.find((task) => task.id === surface.taskId);
      const error = validateTaskDates(date, todo?.dueDate ?? null);
      if (error) throw new Error(error);
      await editTodo(surface.taskId, { scheduledDate: date });
      actions.setFeedback({ kind: "success", message: "Rescheduled task" });
      void focusBrief.revalidate();
    },
    [surface, todos, editTodo, actions.setFeedback, focusBrief.revalidate],
  );
  const handleToggleSubtask = useCallback(
    async (todoId: string, subtaskId: string, completed: boolean) => {
      await actions.run(
        todoId,
        async () => {
          const response = await manualMutationRequest(
            `/todos/${encodeURIComponent(todoId)}/subtasks/${encodeURIComponent(subtaskId)}`,
            {
              method: "PUT",
              body: JSON.stringify({ completed }),
            },
            "save the subtask",
          );
          const subtask: unknown = await response.json().catch(() => null);
          if (
            !subtask ||
            typeof subtask !== "object" ||
            !("id" in subtask) ||
            subtask.id !== subtaskId ||
            !("completed" in subtask) ||
            subtask.completed !== completed
          )
            throw new MutationApiError(
              "The subtask change could not be confirmed. Refresh to check it.",
              "uncertain",
            );
          if (!(await loadTodos({})))
            throw new MutationApiError(
              "The subtask was saved, but the list could not be refreshed. Refresh to check it.",
              "uncertain",
            );
        },
        "Saved subtask",
      );
    },
    [actions.run, loadTodos],
  );
  const handleDelete = useCallback(
    async (id: string) => {
      if (await actions.run(id, () => removeTodo(id), "Deleted task")) {
        if ("taskId" in surface && surface.taskId === id)
          closeSurface({ all: true });
        void focusBrief.revalidate();
      }
    },
    [actions.run, removeTodo, surface, closeSurface, focusBrief.revalidate],
  );

  const selectedTaskRef = useRef<Todo | null>(null);
  const liveTask =
    "taskId" in surface
      ? (todos.find((todo) => todo.id === surface.taskId) ?? null)
      : null;
  if (liveTask) selectedTaskRef.current = liveTask;
  const taskPending =
    "taskId" in surface && actions.pendingIds.has(surface.taskId);
  const sheetTodo =
    liveTask ??
    ("taskId" in surface && selectedTaskRef.current?.id === surface.taskId
      ? selectedTaskRef.current
      : null);
  const sheetProject = useMemo(
    () =>
      sheetTodo?.projectId
        ? projects.find((project) => project.id === sheetTodo.projectId)
        : undefined,
    [sheetTodo, projects],
  );
  const details = sheetTodo ? (
    <TaskDetails
      key={sheetTodo.id}
      todo={sheetTodo}
      project={sheetProject}
      pending={taskPending}
      feedback={actions.feedback}
      onEdit={() => openSurface({ mode: "edit", taskId: sheetTodo.id })}
      onComplete={() => {
        void handleToggleTodo(sheetTodo.id, !sheetTodo.completed);
      }}
      onReschedule={() =>
        openSurface({
          mode: "reschedule",
          taskId: sheetTodo.id,
          returnToDetails: true,
        })
      }
      onDelete={() => {
        void handleDelete(sheetTodo.id);
      }}
      onToggleSubtask={(id, completed) => {
        void handleToggleSubtask(sheetTodo.id, id, completed);
      }}
    />
  ) : null;
  const screenProps = {
    todos,
    projects,
    user,
    pendingIds: actions.pendingIds,
    onTodoClick: handleTodoClick,
    onToggleTodo: handleToggleTodo,
    onAvatarClick: handleAvatarClick,
    onSearch: () => openSurface({ mode: "search" }),
  };
  const handleProjectClick = (id: string) => {
    setActiveTab("projects");
    openProject(id);
  };
  const handleTabChange = (tab: typeof activeTab) => {
    if (selectedProjectId) closeProject();
    setActiveTab(tab);
  };
  const handleAcceptedCapture = useCallback(
    async (task: Todo) => {
      const refreshed = await reconcileTasks();
      if (!refreshed || !getTodo(task.id))
        throw new Error(
          "The task was added, but Tasks could not be refreshed. Refresh to see it.",
        );
    },
    [reconcileTasks, getTodo],
  );
  const handleOpenAcceptedTask = useCallback(
    async (id: string) => {
      if (openingAcceptedTask.current) return;
      openingAcceptedTask.current = true;
      try {
        if (!getTodo(id)) {
          actions.setFeedback({ kind: "pending", message: "Loading task…" });
          if (!(await loadTodos({})) || !getTodo(id)) {
            actions.setFeedback({
              kind: "error",
              message:
                "The task is saved, but could not be loaded. Refresh Tasks and try opening it again.",
            });
            return;
          }
        }
        // Keep Inbox as the return destination after closing task details.
        handleTodoClick(id);
      } finally {
        openingAcceptedTask.current = false;
      }
    },
    [getTodo, loadTodos, actions.setFeedback, handleTodoClick],
  );
  const showingFocus =
    activeTab === "focus" || (activeTab === "custom" && customView === "home");
  useEffect(() => {
    if (
      surface.mode === "details" &&
      loadState === "loaded" &&
      !taskPending &&
      !liveTask
    )
      closeSurface({ all: true });
  }, [surface, loadState, taskPending, liveTask, closeSurface]);

  return (
    <div className="m-shell" data-density="normal" data-palette={palette}>
      <OfflineBanner />
      <InstallBanner />
      {surface.mode === "closed" && (
        <TaskFeedback
          feedback={actions.feedback}
          onDismiss={() => actions.setFeedback(null)}
        />
      )}
      <div
        className={`m-shell__content${showingFocus ? " m-shell__content--focus" : ""}`}
        ref={scrollRef}
      >
        <PullToRefresh
          onRefresh={handleRefresh}
          disabled={surface.mode !== "closed" || page !== "todos"}
        >
          {loadState === "loading" && !todos.length && (
            <p role="status" className="m-mobile-load">
              Loading tasks…
            </p>
          )}
          {loadState === "error" && (
            <div role="alert" className="m-mobile-load">
              <p>{errorMessage || "Could not load tasks."}</p>
              <button
                type="button"
                onClick={() => {
                  void handleRefresh();
                }}
              >
                Retry loading tasks
              </button>
            </div>
          )}
          {projectsError && (
            <div role="alert" className="m-mobile-load">
              <p>{projectsError}</p>
              <button
                type="button"
                onClick={() => {
                  void loadProjects();
                }}
              >
                Retry loading projects
              </button>
            </div>
          )}
          {showingFocus && focusBrief.error && (
            <div role="alert" className="m-mobile-load">
              <p>Focus could not be updated. {focusBrief.error}</p>
              <button
                type="button"
                onClick={() => {
                  void focusBrief.revalidate();
                }}
              >
                Retry focus
              </button>
            </div>
          )}
          <div hidden={activeTab !== "inbox"}>
            <ViewActivityProvider isActive={activeTab === "inbox"}>
              <InboxScreen
                user={user}
                refreshRef={inboxRefreshRef}
                onAvatarClick={handleAvatarClick}
                onSearch={() => openSurface({ mode: "search" })}
                onAccepted={handleAcceptedCapture}
                onOpenTask={handleOpenAcceptedTask}
              />
            </ViewActivityProvider>
          </div>
          {(loadState === "loaded" || todos.length > 0) && (
            <>
              {showingFocus && (
                <FocusScreen
                  {...screenProps}
                  onSelectProject={handleProjectClick}
                  brief={focusBrief.brief}
                  briefLoading={focusBrief.loading}
                  briefError={focusBrief.error}
                />
              )}
              {activeTab === "today" && (
                <TodayScreen {...screenProps} onSnoozeTodo={handleSnoozeTodo} />
              )}
              {activeTab === "projects" && (
                <ProjectsScreen
                  {...screenProps}
                  selectedProjectId={selectedProjectId}
                  onSelectProject={handleProjectClick}
                  onBack={closeProject}
                  onSnoozeTodo={handleSnoozeTodo}
                />
              )}
              {(activeTab === "tasks" ||
                (activeTab === "custom" && customView !== "home")) && (
                <CustomScreen
                  view={activeTab === "tasks" ? "all" : customView}
                  {...screenProps}
                  onSnoozeTodo={handleSnoozeTodo}
                />
              )}
            </>
          )}
        </PullToRefresh>
      </div>
      <PullToSearch
        open={surface.mode === "search"}
        onClose={() => closeSurface()}
        todos={todos}
        projects={projects}
        onSelectResult={(id) =>
          openSurface({ mode: "details", taskId: id }, { replace: true })
        }
      />
      <BottomSheet
        snap={surface.mode === "details" ? "half" : "closed"}
        onClose={() => closeSurface()}
        dismissDisabled={taskPending}
        onExpandFull={() =>
          sheetTodo && openSurface({ mode: "edit", taskId: sheetTodo.id })
        }
        halfContent={details}
        fullContent={null}
      />
      {surface.mode === "edit" && sheetTodo && (
        <TaskEditor
          key={sheetTodo.id}
          open
          todo={sheetTodo}
          projects={projects}
          onSave={editTodo}
          onReconcile={async () => {
            const applied = await reconcileTasks();
            return applied && Boolean(getTodo(sheetTodo.id));
          }}
          closeRequestRef={closeRequestRef}
          onCancel={() => closeSurface()}
          onSaved={() => {
            actions.setFeedback({ kind: "success", message: "Saved task" });
            closeSurface();
            void focusBrief.revalidate();
          }}
        />
      )}
      <QuickCapture
        open={surface.mode === "capture"}
        projects={projects}
        onClose={() => closeSurface()}
        closeRequestRef={closeRequestRef}
        onCreateTask={handleCreateTask}
        onCreateProject={handleCreateProject}
        onReconcile={async ({ type, label }) => {
          const wanted = label.trim().toLocaleLowerCase();
          if (type === "project") {
            if (!(await loadProjects())) return null;
            return {
              matches: getProjects()
                .filter(
                  (project) =>
                    project.name.trim().toLocaleLowerCase() === wanted,
                )
                .map((project) => ({
                  id: project.id,
                  label: project.name,
                  type,
                })),
            };
          }
          if (!(await reconcileTasks())) return null;
          return {
            matches: getTodos()
              .filter(
                (task) => task.title.trim().toLocaleLowerCase() === wanted,
              )
              .map((task) => ({ id: task.id, label: task.title, type })),
          };
        }}
      />
      <ProfileSheet
        open={surface.mode === "profile"}
        onClose={() => closeSurface()}
        user={user}
        dark={dark}
        onToggleDark={toggleDarkMode}
        customView={customView}
        onChangeCustomView={setCustomView}
        onLogout={logout}
        onNavigate={(destination) => {
          if (destination === "focus") {
            handleTabChange("focus");
          } else if (destination === "tasks") {
            handleTabChange("tasks");
          } else {
            openPage(destination as typeof page);
          }
        }}
        palette={palette}
        onChangePalette={setPalette}
      />
      <SnoozePicker
        open={surface.mode === "reschedule"}
        closeRequestRef={closeRequestRef}
        onClose={handleSnoozeClose}
        onSnooze={handleSnoozeConfirm}
        onReconcile={async () => {
          if (surface.mode !== "reschedule") return false;
          const applied = await reconcileTasks();
          return applied && Boolean(getTodo(surface.taskId));
        }}
      />
      <TabBar
        activeTab={activeTab}
        customView={customView}
        onTabChange={handleTabChange}
        onFabPress={() => openSurface({ mode: "capture" })}
      />
      {page !== "todos" && (
        <div className="m-shell__page-overlay">
          <header className="m-header">
            <button className="m-header__back" onClick={closePage}>
              ← Back
            </button>
            <div className="m-header__text">
              <h1 className="m-header__title">
                {page === "ai"
                  ? "AI Workspace"
                  : page === "review"
                    ? "Weekly Review"
                    : "Admin"}
              </h1>
            </div>
          </header>
          <div className="m-shell__page-content">
            <div className="m-empty">
              <IllustrationConstruction />
              <div className="m-empty__title">Coming soon on mobile</div>
              <div className="m-empty__hint">
                Use the desktop app for full access
              </div>
            </div>
          </div>
        </div>
      )}
      <Onboarding />
    </div>
  );
}
