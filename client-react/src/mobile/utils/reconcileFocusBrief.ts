import type { Todo, Project } from "../../types";
import type {
  FocusBriefResponse,
  RankedPanel,
  TaskItem,
} from "../../types/focusBrief";
import { calendarDayOffset, deadlineDateValue } from "./taskDates";

export function isTodayFocusTask(todo: Todo, now = new Date()): boolean {
  const dueDays = todo.dueDate
    ? calendarDayOffset(deadlineDateValue(todo.dueDate), now)
    : null;
  return (
    (dueDays !== null && dueDays <= 0) ||
    Boolean(
      todo.scheduledDate && calendarDayOffset(todo.scheduledDate, now) === 0,
    ) ||
    Boolean(todo.doDate && calendarDayOffset(todo.doDate, now) === 0)
  );
}

/** Keep generated prose/provenance as-of, while task references use the current task snapshot. */
export function reconcileFocusBrief(
  brief: FocusBriefResponse,
  todos: Todo[],
  projects: Project[],
  now = new Date(),
): FocusBriefResponse {
  const active = todos.filter((todo) => !todo.completed && !todo.archived);
  const byId = new Map(active.map((todo) => [todo.id, todo]));
  const dueDays = (todo: Todo) =>
    todo.dueDate
      ? calendarDayOffset(deadlineDateValue(todo.dueDate), now)
      : null;
  const taskItem = (todo: Todo): TaskItem => ({
    id: todo.id,
    title: todo.title,
    dueDate: deadlineDateValue(todo.dueDate) || null,
    estimateMinutes: todo.estimateMinutes ?? null,
    priority: todo.priority ?? "medium",
    overdue: (dueDays(todo) ?? 0) < 0,
  });
  const liveRefs = <T extends { id: string; title: string }>(items: T[]): T[] =>
    items.flatMap((item) => {
      const todo = byId.get(item.id);
      return todo ? [{ ...item, title: todo.title }] : [];
    });
  const refs = (items: { id: string }[]): Todo[] => {
    const seen = new Set<string>();
    return items.flatMap((item) => {
      const todo = byId.get(item.id);
      if (!todo || seen.has(item.id)) return [];
      seen.add(item.id);
      return [todo];
    });
  };
  const reconcilePanel = (panel: RankedPanel): RankedPanel => {
    const data = panel.data;
    switch (data.type) {
      case "unsorted":
        return {
          ...panel,
          data: {
            ...data,
            items: liveRefs(data.items).filter((item) => {
              const todo = byId.get(item.id)!;
              return (
                todo.status === "inbox" || (!todo.projectId && !todo.category)
              );
            }),
          },
        };
      case "whatNext":
        return { ...panel, data: { ...data, items: liveRefs(data.items) } };
      case "dueSoon": {
        const tasks = refs(data.groups.flatMap((group) => group.items));
        const buckets = [
          { label: "Overdue", accepts: (days: number) => days < 0 },
          { label: "Today", accepts: (days: number) => days === 0 },
          { label: "Tomorrow", accepts: (days: number) => days === 1 },
          {
            label: "Next 3 days",
            accepts: (days: number) => days >= 2 && days <= 3,
          },
        ];
        return {
          ...panel,
          data: {
            ...data,
            groups: buckets.flatMap((bucket) => {
              const items = tasks
                .filter((todo) => {
                  const days = dueDays(todo);
                  return days !== null && bucket.accepts(days);
                })
                .map(taskItem);
              return items.length ? [{ label: bucket.label, items }] : [];
            }),
          },
        };
      }
      case "backlogHygiene":
        return {
          ...panel,
          data: {
            ...data,
            items: liveRefs(data.items).flatMap((item) => {
              const todo = byId.get(item.id)!;
              const staleDays = todo.updatedAt
                ? -(calendarDayOffset(todo.updatedAt, now) ?? 0)
                : 0;
              const threshold =
                todo.priority === "high" ||
                todo.priority === "urgent" ||
                todo.status === "inbox"
                  ? 7
                  : 14;
              return staleDays >= threshold ? [{ ...item, staleDays }] : [];
            }),
          },
        };
      case "projectsToNudge": {
        const projectById = new Map(
          projects
            .filter((project) => !project.archived)
            .map((project) => [project.id, project]),
        );
        return {
          ...panel,
          data: {
            ...data,
            items: data.items.flatMap((item) => {
              const project = projectById.get(item.id);
              if (!project) return [];
              const tasks = active.filter((todo) => todo.projectId === item.id);
              const current = {
                ...item,
                name: project.name,
                overdueCount: tasks.filter((todo) => (dueDays(todo) ?? 0) < 0)
                  .length,
                waitingCount: tasks.filter((todo) => todo.status === "waiting")
                  .length,
                dueSoonCount: tasks.filter((todo) => {
                  const days = dueDays(todo);
                  return days !== null && days >= 0 && days <= 3;
                }).length,
              };
              return current.overdueCount ||
                current.waitingCount ||
                current.dueSoonCount
                ? [current]
                : [];
            }),
          },
        };
      }
      case "trackOverview": {
        const tasks = refs([
          ...data.columns.thisWeek,
          ...data.columns.next14Days,
          ...data.columns.later,
        ]);
        const columns: typeof data.columns = {
          thisWeek: [],
          next14Days: [],
          later: [],
        };
        for (const todo of tasks) {
          const days = dueDays(todo);
          const column =
            days === null
              ? todo.priority === "high" || todo.priority === "urgent"
                ? "thisWeek"
                : "later"
              : days <= 7
                ? "thisWeek"
                : days <= 14
                  ? "next14Days"
                  : "later";
          columns[column].push(taskItem(todo));
        }
        return { ...panel, data: { ...data, columns } };
      }
      case "rescueMode":
        return {
          ...panel,
          data: {
            ...data,
            openCount: active.length,
            overdueCount: active.filter((todo) => (dueDays(todo) ?? 0) < 0)
              .length,
          },
        };
    }
  };
  const recommendation = brief.pinned.rightNow.topRecommendation;
  const recommendedTask = recommendation
    ? byId.get(recommendation.taskId)
    : undefined;
  return {
    ...brief,
    pinned: {
      ...brief.pinned,
      rightNow: {
        ...brief.pinned.rightNow,
        topRecommendation:
          recommendation && recommendedTask
            ? { ...recommendation, title: recommendedTask.title }
            : null,
      },
      // Dawn is a deterministic task list, including new tasks absent from the cached brief.
      todayAgenda: active
        .filter((todo) => isTodayFocusTask(todo, now))
        .map((todo) => ({ ...taskItem(todo), completed: false })),
    },
    rankedPanels: brief.rankedPanels
      .map(reconcilePanel)
      .filter(
        (panel) =>
          panel.data.type !== "rescueMode" ||
          (panel.data.openCount > 10 && panel.data.overdueCount > 3),
      ),
  };
}
