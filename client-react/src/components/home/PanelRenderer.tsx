// client-react/src/components/home/PanelRenderer.tsx
import { FlipCard } from "./FlipCard";
import { TarotCardFront, TarotCardBack } from "./TarotCard";
import { CardBackContent } from "./CardBack";
import { PANEL_ART } from "./pixel-art";
import type { RankedPanel, PanelProvenance } from "../../types/focusBrief";
import {
  useAgentProfiles,
  getAgentProfile,
} from "../../agents/useAgentProfiles";
import type { AgentProfile } from "../../agents/types";

interface Props {
  panel: RankedPanel;
  onTaskClick: (id: string) => void;
  onSelectProject: (id: string) => void;
  onEditTodo?: (id: string, updates: Record<string, unknown>) => void;
}

// ─── Unsorted Panel (The Inbox, V, SYS) ──────────────────────────────────

function UnsortedPanel({
  data,
  provenance,
  reason,
  onTaskClick,
  onEditTodo,
}: {
  data: any;
  provenance?: PanelProvenance;
  reason: string;
  onTaskClick: (id: string) => void;
  onEditTodo?: (id: string, updates: Record<string, unknown>) => void;
}) {
  const Art = PANEL_ART["unsorted"];
  const topItem = data.items[0];

  const front = (
    <TarotCardFront
      name="The Inbox"
      subtitle="Unsorted items"
      numeral="V"
      source="sys"
      illustration={<Art size={48} />}
      accentPattern={{ mode: "flowField", seed: 105 }}
      illustrationCaption={data.items.length + " unsorted"}
    >
      <div className="inbox-stack">
        <div className="inbox-stack__shadow inbox-stack__shadow--far" />
        <div className="inbox-stack__shadow inbox-stack__shadow--near" />
        <div className="inbox-stack__front">
          {topItem ? (
            <>
              <button
                className="focus-list__item-title"
                data-card-swipe-target=""
                onClick={() => onTaskClick(topItem.id)}
              >
                {topItem.title}
              </button>
              {onEditTodo && (
                <div className="focus-list__item-actions">
                  <button
                    className="focus-action-chip"
                    onClick={() => onEditTodo(topItem.id, { status: "next" })}
                    title="Move to Next"
                  >
                    Next
                  </button>
                  <button
                    className="focus-action-chip focus-action-chip--muted"
                    onClick={() =>
                      onEditTodo(topItem.id, { status: "someday" })
                    }
                    title="Move to Someday"
                  >
                    Later
                  </button>
                </div>
              )}
            </>
          ) : (
            <span className="focus-panel__empty">All clear!</span>
          )}
        </div>
      </div>
      {data.items.length > 1 && (
        <div className="focus-list">
          {data.items.slice(1).map((item: any) => (
            <div
              key={item.id}
              className="focus-list__item focus-list__item--triage"
            >
              <button
                className="focus-list__item-title"
                data-card-swipe-target=""
                onClick={() => onTaskClick(item.id)}
              >
                {item.title}
              </button>
              {onEditTodo && (
                <div className="focus-list__item-actions">
                  <button
                    className="focus-action-chip"
                    onClick={() => onEditTodo(item.id, { status: "next" })}
                    title="Move to Next"
                  >
                    Next
                  </button>
                  <button
                    className="focus-action-chip focus-action-chip--muted"
                    onClick={() => onEditTodo(item.id, { status: "someday" })}
                    title="Move to Someday"
                  >
                    Later
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </TarotCardFront>
  );

  const back = (
    <TarotCardBack
      name="The Inbox"
      numeral="V"
      source="sys"
      illustration={<Art size={80} />}
    >
      <CardBackContent provenance={provenance} reason={reason} />
    </TarotCardBack>
  );

  return <FlipCard front={front} back={back} />;
}

// ─── Due Soon Panel (The Hourglass, III, SYS) ────────────────────────────

function DueSoonPanel({
  data,
  provenance,
  reason,
  onTaskClick,
}: {
  data: any;
  provenance?: PanelProvenance;
  reason: string;
  onTaskClick: (id: string) => void;
}) {
  const Art = PANEL_ART["dueSoon"];
  const totalItems = data.groups.reduce(
    (s: number, g: any) => s + g.items.length,
    0,
  );
  const maxCount = Math.max(...data.groups.map((g: any) => g.items.length), 1);

  const front = (
    <TarotCardFront
      name="The Hourglass"
      subtitle="Due soon"
      numeral="III"
      source="sys"
      illustration={<Art size={48} />}
      accentPattern={{ mode: "scatteredOrbits", seed: 103 }}
      illustrationCaption={totalItems + " tasks due"}
    >
      <div className="urgency-bars">
        {data.groups.map((group: any) => (
          <div key={group.label} className="urgency-bar">
            <div className="urgency-bar__label">
              <span>{group.label}</span>
              <span>{group.items.length}</span>
            </div>
            <div
              style={{
                height: 4,
                background: "var(--tarot-frame)",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.round((group.items.length / maxCount) * 100)}%`,
                  height: "100%",
                  background: group.items.some((i: any) => i.overdue)
                    ? "var(--viz-4)"
                    : "var(--viz-2)",
                  borderRadius: 2,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="focus-list" style={{ marginTop: "var(--s-2)" }}>
        {data.groups
          .flatMap((g: any) => g.items)
          .slice(0, 3)
          .map((item: any) => (
            <button
              key={item.id}
              className="focus-list__item"
              data-card-swipe-target=""
              onClick={() => onTaskClick(item.id)}
            >
              <span>{item.title}</span>
              {item.dueDate && (
                <span
                  className={`focus-list__badge${item.overdue ? " focus-list__badge--overdue" : ""}`}
                >
                  {item.dueDate}
                </span>
              )}
            </button>
          ))}
      </div>
    </TarotCardFront>
  );

  const back = (
    <TarotCardBack
      name="The Hourglass"
      numeral="III"
      source="sys"
      illustration={<Art size={80} />}
    >
      <CardBackContent provenance={provenance} reason={reason} />
    </TarotCardBack>
  );

  return <FlipCard front={front} back={back} />;
}

// ─── What Next Panel (The Compass, IV, AI) ───────────────────────────────

function WhatNextPanel({
  data,
  provenance,
  reason,
  onTaskClick,
  agent,
}: {
  data: any;
  provenance?: PanelProvenance;
  reason: string;
  onTaskClick: (id: string) => void;
  agent?: {
    id: string;
    name: string;
    role: string;
    colors: AgentProfile["colors"];
    traits: AgentProfile["traits"];
    quote: AgentProfile["quote"];
  };
}) {
  const Art = PANEL_ART["whatNext"];

  const front = (
    <TarotCardFront
      name="The Compass"
      subtitle="What to do next"
      numeral="IV"
      source="ai"
      illustration={<Art size={48} />}
      accentPattern={{ mode: "arcRivers", seed: 104 }}
      illustrationCaption={data.items.length + " paths forward"}
      agent={agent}
    >
      {data.items.map((item: any, i: number) => (
        <div
          key={item.id}
          className="tarot-ranked-entry"
          style={{
            opacity: i === 0 ? 1 : i === 1 ? 0.85 : 0.65,
            cursor: "pointer",
          }}
          onClick={() => onTaskClick(item.id)}
          role="button"
          data-card-swipe-target=""
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onTaskClick(item.id)}
        >
          <div className="tarot-ranked-entry__header">
            <span
              className="tarot-ranked-numeral"
              style={{ fontSize: `${18 - i * 2}px` }}
            >
              {i + 1}
            </span>
            <span
              style={{
                fontSize: `${14 - i}px`,
                fontWeight: 500,
                color: "var(--tarot-text)",
              }}
            >
              {item.title}
            </span>
          </div>
          <div className="tarot-ranked-entry__reason">{item.reason}</div>
          <div className="tarot-ranked-entry__meta">
            <span
              className={`tarot-micro-label tarot-micro-label--${item.impact}`}
            >
              {item.impact}
            </span>
            <span className="tarot-micro-sep">{"\u00b7"}</span>
            <span
              className="tarot-micro-label"
              style={{ color: "var(--tarot-muted)" }}
            >
              {item.effort}
            </span>
          </div>
        </div>
      ))}
    </TarotCardFront>
  );

  const back = (
    <TarotCardBack
      name="The Compass"
      numeral="IV"
      source="ai"
      illustration={<Art size={80} />}
      agent={agent}
    >
      <CardBackContent provenance={provenance} reason={reason} agent={agent} />
    </TarotCardBack>
  );

  return <FlipCard front={front} back={back} />;
}

// ─── Backlog Hygiene Panel (The Web, VI, SYS) ────────────────────────────

function BacklogHygienePanel({
  data,
  provenance,
  reason,
  onTaskClick,
}: {
  data: any;
  provenance?: PanelProvenance;
  reason: string;
  onTaskClick: (id: string) => void;
}) {
  const Art = PANEL_ART["backlogHygiene"];

  const front = (
    <TarotCardFront
      name="The Web"
      subtitle="Stale tasks"
      numeral="VI"
      source="sys"
      illustration={<Art size={48} />}
      accentPattern={{ mode: "spiralField", seed: 106 }}
      illustrationCaption={data.items.length + " stale"}
    >
      <div className="focus-list">
        {data.items.map((item: any, i: number) => (
          <button
            key={item.id}
            className="focus-list__item decay-item"
            data-card-swipe-target=""
            onClick={() => onTaskClick(item.id)}
          >
            <div className="decay-item__row">
              <span
                style={{
                  fontFamily: "var(--tarot-serif, Georgia, serif)",
                  marginRight: "var(--s-2)",
                  color: "var(--tarot-muted)",
                }}
              >
                {i + 1}.
              </span>
              <span>{item.title}</span>
              <span className="focus-list__meta">
                {item.staleDays}d untouched
              </span>
            </div>
            <div
              style={{
                height: 3,
                background: "var(--tarot-frame)",
                borderRadius: 2,
                overflow: "hidden",
                marginTop: 4,
              }}
            >
              <div
                style={{
                  width: `${Math.min(Math.round((item.staleDays / 30) * 100), 100)}%`,
                  height: "100%",
                  background: `linear-gradient(90deg, var(--tarot-amber), var(--tarot-red))`,
                  borderRadius: 2,
                }}
              />
            </div>
          </button>
        ))}
      </div>
    </TarotCardFront>
  );

  const back = (
    <TarotCardBack
      name="The Web"
      numeral="VI"
      source="sys"
      illustration={<Art size={80} />}
    >
      <CardBackContent provenance={provenance} reason={reason} />
    </TarotCardBack>
  );

  return <FlipCard front={front} back={back} />;
}

// ─── Projects To Nudge Panel (The Guardian, VII, SYS) ────────────────────

function ProjectsToNudgePanel({
  data,
  provenance,
  reason,
  onSelectProject,
}: {
  data: any;
  provenance?: PanelProvenance;
  reason: string;
  onSelectProject: (id: string) => void;
}) {
  const Art = PANEL_ART["projectsToNudge"];

  const front = (
    <TarotCardFront
      name="The Guardian"
      subtitle="Projects needing attention"
      numeral="VII"
      source="sys"
      illustration={<Art size={48} />}
      accentPattern={{ mode: "scatteredOrbits", seed: 107 }}
    >
      <div className="focus-list">
        {data.items.map((item: any) => {
          const isCritical = item.overdueCount > 0;
          return (
            <button
              key={item.id}
              className="focus-list__item health-item"
              onClick={() => onSelectProject(item.id)}
            >
              <div
                className={`health-dot health-dot--${isCritical ? "critical" : "warning"}`}
              >
                {isCritical ? "!" : "~"}
              </div>
              <div style={{ flex: 1, textAlign: "left" }}>
                <div>{item.name}</div>
                <div className="focus-list__meta">
                  {[
                    item.overdueCount > 0 && `${item.overdueCount} overdue`,
                    item.waitingCount > 0 && `${item.waitingCount} waiting`,
                    item.dueSoonCount > 0 && `${item.dueSoonCount} due soon`,
                  ]
                    .filter(Boolean)
                    .join(" \u00b7 ")}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </TarotCardFront>
  );

  const back = (
    <TarotCardBack
      name="The Guardian"
      numeral="VII"
      source="sys"
      illustration={<Art size={80} />}
    >
      <CardBackContent provenance={provenance} reason={reason} />
    </TarotCardBack>
  );

  return <FlipCard front={front} back={back} />;
}

// ─── Track Overview Panel (The Road, VIII, SYS) ──────────────────────────

function TrackOverviewPanel({
  data,
  provenance,
  reason,
}: {
  data: any;
  provenance?: PanelProvenance;
  reason: string;
}) {
  const Art = PANEL_ART["trackOverview"];

  const columnColors: Record<string, string> = {
    thisWeek: "var(--tarot-warm, var(--tarot-amber))",
    next14Days: "var(--tarot-sage, var(--tarot-text))",
    later: "var(--tarot-muted)",
  };

  const front = (
    <TarotCardFront
      name="The Road"
      subtitle="Task timeline"
      numeral="VIII"
      source="sys"
      illustration={<Art size={48} />}
      accentPattern={{ mode: "arcRivers", seed: 108 }}
    >
      <div className="focus-track">
        {(["thisWeek", "next14Days", "later"] as const).map((col) => (
          <div key={col} className="focus-track__column">
            <div
              className="focus-track__header"
              style={{ color: columnColors[col] }}
            >
              {col === "thisWeek"
                ? "This week"
                : col === "next14Days"
                  ? "Next 14 days"
                  : "Later"}
            </div>
            {data.columns[col].map((item: any) => (
              <div key={item.id} className="focus-track__item">
                {item.title}
              </div>
            ))}
          </div>
        ))}
      </div>
    </TarotCardFront>
  );

  const back = (
    <TarotCardBack
      name="The Road"
      numeral="VIII"
      source="sys"
      illustration={<Art size={80} />}
    >
      <CardBackContent provenance={provenance} reason={reason} />
    </TarotCardBack>
  );

  return <FlipCard front={front} back={back} />;
}

// ─── Rescue Mode Panel (Rescue, SYS) ─────────────────────────────────────

function RescueModePanel({
  data,
  provenance,
  reason,
}: {
  data: any;
  provenance?: PanelProvenance;
  reason: string;
}) {
  if (data.openCount <= 10 || data.overdueCount <= 3) return null;

  const Art = PANEL_ART["rescueMode"];

  const front = (
    <TarotCardFront
      name="Rescue"
      subtitle="System overloaded"
      numeral=""
      source="sys"
      illustration={<Art size={48} />}
      accentPattern={{ mode: "flowField", seed: 109 }}
    >
      <p className="focus-rescue__text">
        You have <strong>{data.openCount}</strong> open tasks and{" "}
        <strong>{data.overdueCount}</strong> are overdue. Consider triaging or
        deferring some tasks.
      </p>
    </TarotCardFront>
  );

  const back = (
    <TarotCardBack
      name="Rescue"
      numeral=""
      source="sys"
      illustration={<Art size={80} />}
    >
      <CardBackContent provenance={provenance} reason={reason} />
    </TarotCardBack>
  );

  return <FlipCard front={front} back={back} />;
}

// ─── Panel Map ─────────────────────────────────────────────────────────────

const PANEL_MAP: Record<string, React.ComponentType<any>> = {
  unsorted: UnsortedPanel,
  dueSoon: DueSoonPanel,
  whatNext: WhatNextPanel,
  backlogHygiene: BacklogHygienePanel,
  projectsToNudge: ProjectsToNudgePanel,
  trackOverview: TrackOverviewPanel,
  rescueMode: RescueModePanel,
};

// ─── PanelRenderer ─────────────────────────────────────────────────────────

export function PanelRenderer({
  panel,
  onTaskClick,
  onSelectProject,
  onEditTodo,
}: Props) {
  const profiles = useAgentProfiles();
  const agentProfile = getAgentProfile(profiles, panel.agentId);
  const agent = agentProfile
    ? {
        id: agentProfile.id,
        name: agentProfile.name,
        role: agentProfile.role,
        colors: agentProfile.colors,
        traits: agentProfile.traits,
        quote: agentProfile.quote,
      }
    : undefined;

  const Component = PANEL_MAP[panel.type];
  if (!Component) return null;
  return (
    <Component
      data={panel.data}
      provenance={panel.provenance}
      reason={panel.reason}
      onTaskClick={onTaskClick}
      onSelectProject={onSelectProject}
      onEditTodo={onEditTodo}
      agent={agent}
    />
  );
}
