import { describe, expect, it } from "vitest";
import type { Todo, Project } from "../../types";
import type {
  FocusBriefResponse,
  TaskItem,
  RankedPanel,
} from "../../types/focusBrief";
import { reconcileFocusBrief } from "./reconcileFocusBrief";

const now = new Date(2026, 9, 7, 12);
const due = (day: number) =>
  new Date(2026, 9, day, 23, 59, 59, 999).toISOString();
const task = (id: string, patch: Partial<Todo> = {}): Todo =>
  ({
    id,
    title: "Current title",
    completed: false,
    archived: false,
    dueDate: due(7),
    scheduledDate: null,
    doDate: null,
    priority: "high",
    estimateMinutes: 40,
    status: "next",
    projectId: "p1",
    category: null,
    updatedAt: new Date(2026, 8, 1).toISOString(),
    ...patch,
  }) as Todo;
const item = (id: string): TaskItem => ({
  id,
  title: "Cached old title",
  dueDate: "2026-10-06",
  estimateMinutes: 5,
  priority: "low",
  overdue: true,
});
const provenance = { source: "deterministic" as const };
const panel = (data: RankedPanel["data"]): RankedPanel => ({
  type: data.type,
  reason: "Original ranking",
  data,
  provenance,
});
const cached = (): FocusBriefResponse => ({
  pinned: {
    rightNow: {
      narrative: "Generated narrative about the old plan.",
      urgentItems: [
        {
          title: "As-of urgent title",
          dueDate: "2026-10-06",
          reason: "Original interpretation",
        },
      ],
      topRecommendation: {
        taskId: "live",
        title: "Cached old title",
        reasoning: "Original AI reasoning",
      },
    },
    todayAgenda: ["live", "completed", "archived", "deleted"].map((id) => ({
      ...item(id),
      completed: false,
    })),
    rightNowProvenance: { ...provenance, generatedAt: "2026-10-07T09:00:00Z" },
    todayAgendaProvenance: provenance,
  },
  rankedPanels: [
    panel({
      type: "whatNext",
      items: ["live", "completed", "archived", "deleted"].map((id) => ({
        id,
        title: "Cached old title",
        reason: "Generated rationale",
        impact: "high",
        effort: "Small",
      })),
    }),
    panel({
      type: "dueSoon",
      groups: [
        {
          label: "Overdue",
          items: ["live", "completed", "archived", "deleted"].map(item),
        },
      ],
    }),
    panel({
      type: "trackOverview",
      columns: {
        thisWeek: ["live", "completed", "archived", "deleted"].map(item),
        next14Days: [],
        later: [],
      },
    }),
  ],
  generatedAt: "2026-10-07T09:00:00Z",
  expiresAt: "2026-10-07T13:00:00Z",
  cached: true,
  isStale: false,
});

describe("cached Focus task references", () => {
  it("uses current actionable task fields without rewriting generated text or provenance", () => {
    const brief = cached();
    const snapshot = structuredClone(brief);
    const result = reconcileFocusBrief(
      brief,
      [
        task("live"),
        task("completed", { completed: true }),
        task("archived", { archived: true }),
      ],
      [],
      now,
    );
    expect(result.pinned.todayAgenda).toEqual([
      {
        id: "live",
        title: "Current title",
        dueDate: "2026-10-07",
        estimateMinutes: 40,
        priority: "high",
        overdue: false,
        completed: false,
      },
    ]);
    expect(result.pinned.rightNow.topRecommendation).toEqual({
      taskId: "live",
      title: "Current title",
      reasoning: "Original AI reasoning",
    });
    expect(result.pinned.rightNow.narrative).toBe(
      brief.pinned.rightNow.narrative,
    );
    expect(result.pinned.rightNow.urgentItems).toEqual(
      brief.pinned.rightNow.urgentItems,
    );
    expect(result.generatedAt).toBe(brief.generatedAt);
    expect(result.pinned.rightNowProvenance).toBe(
      brief.pinned.rightNowProvenance,
    );
    expect(result.rankedPanels[0].data).toEqual({
      type: "whatNext",
      items: [
        {
          id: "live",
          title: "Current title",
          reason: "Generated rationale",
          impact: "high",
          effort: "Small",
        },
      ],
    });
    expect(result.rankedPanels[1].data).toEqual({
      type: "dueSoon",
      groups: [
        {
          label: "Today",
          items: [
            {
              id: "live",
              title: "Current title",
              dueDate: "2026-10-07",
              estimateMinutes: 40,
              priority: "high",
              overdue: false,
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(result.rankedPanels)).not.toMatch(
      /completed|archived|deleted/,
    );
    expect(brief).toEqual(snapshot);
  });

  it("removes stale today and recommendation actions after completion, deletion or date changes", () => {
    expect(
      reconcileFocusBrief(
        cached(),
        [task("live", { completed: true })],
        [],
        now,
      ).pinned.rightNow.topRecommendation,
    ).toBeNull();
    expect(
      reconcileFocusBrief(cached(), [], [], now).pinned.todayAgenda,
    ).toEqual([]);
    const result = reconcileFocusBrief(
      cached(),
      [task("live", { dueDate: due(25), scheduledDate: due(25) })],
      [],
      now,
    );
    expect(result.pinned.todayAgenda).toEqual([]);
    expect(result.rankedPanels[1].data).toEqual({
      type: "dueSoon",
      groups: [],
    });
    const track = result.rankedPanels[2].data;
    expect(track.type).toBe("trackOverview");
    if (track.type === "trackOverview") {
      expect(track.columns.thisWeek).toEqual([]);
      expect(track.columns.later.map((task) => task.id)).toEqual(["live"]);
    }
  });

  it("includes newly captured and planned-to-today tasks absent from the cached SYS agenda", () => {
    const result = reconcileFocusBrief(
      cached(),
      [
        task("new", { dueDate: due(7) }),
        task("planned", {
          dueDate: null,
          scheduledDate: new Date(2026, 9, 7, 16).toISOString(),
        }),
        task("do-today", {
          dueDate: null,
          doDate: new Date(2026, 9, 7, 8).toISOString(),
        }),
        task("future", { dueDate: due(20) }),
      ],
      [],
      now,
    );
    expect(result.pinned.todayAgenda.map((item) => item.id)).toEqual([
      "new",
      "planned",
      "do-today",
    ]);
  });

  it("refreshes deterministic project counts, stale-task ages and changed inbox membership", () => {
    const brief = cached();
    brief.rankedPanels = [
      panel({
        type: "projectsToNudge",
        items: [
          {
            id: "p1",
            name: "Old project",
            overdueCount: 4,
            waitingCount: 5,
            dueSoonCount: 6,
          },
          {
            id: "deleted-project",
            name: "Deleted",
            overdueCount: 4,
            waitingCount: 0,
            dueSoonCount: 0,
          },
        ],
      }),
      panel({
        type: "backlogHygiene",
        items: [{ id: "live", title: "Old", staleDays: 100 }],
      }),
      panel({ type: "unsorted", items: [{ id: "live", title: "Old" }] }),
      panel({ type: "rescueMode", openCount: 100, overdueCount: 100 }),
    ];
    const projects = [
      { id: "p1", name: "Renamed project", archived: false },
    ] as Project[];
    const result = reconcileFocusBrief(
      brief,
      [
        task("live", {
          dueDate: due(6),
          status: "waiting",
          updatedAt: now.toISOString(),
        }),
      ],
      projects,
      now,
    );
    expect(result.rankedPanels[0].data).toEqual({
      type: "projectsToNudge",
      items: [
        {
          id: "p1",
          name: "Renamed project",
          overdueCount: 1,
          waitingCount: 1,
          dueSoonCount: 0,
        },
      ],
    });
    expect(result.rankedPanels[1].data).toEqual({
      type: "backlogHygiene",
      items: [],
    });
    expect(result.rankedPanels[2].data).toEqual({
      type: "unsorted",
      items: [],
    });
    expect(
      result.rankedPanels.some((panel) => panel.type === "rescueMode"),
    ).toBe(false);
  });
});
