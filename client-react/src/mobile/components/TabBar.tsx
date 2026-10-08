import { Inbox, Calendar, FolderOpen, AlignJustify, Plus } from "lucide-react";
import type { MobileTab } from "../hooks/useTabBar";
import { CUSTOM_TAB_OPTIONS } from "../hooks/useTabBar";

interface Props {
  activeTab: MobileTab;
  customView: string;
  onTabChange: (tab: MobileTab) => void;
  onFabPress: () => void;
}

function getCustomLabel(view: string): string {
  return CUSTOM_TAB_OPTIONS.find((o) => o.key === view)?.label ?? "More";
}

const ICON_SIZE = 22;
const ICON_STROKE = 1.5;

export function TabBar({
  activeTab,
  customView,
  onTabChange,
  onFabPress,
}: Props) {
  return (
    <nav className="m-tab-bar" role="tablist" aria-label="Main navigation">
      <button
        className={`m-tab-bar__tab${activeTab === "inbox" ? " m-tab-bar__tab--active" : ""}`}
        role="tab"
        aria-selected={activeTab === "inbox"}
        onClick={() => onTabChange("inbox")}
      >
        <Inbox size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        <span className="m-tab-bar__label">Inbox</span>
      </button>
      <button
        className={`m-tab-bar__tab${activeTab === "today" ? " m-tab-bar__tab--active" : ""}`}
        role="tab"
        aria-selected={activeTab === "today"}
        onClick={() => onTabChange("today")}
      >
        <Calendar
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          fill={activeTab === "today" ? "currentColor" : "none"}
        />
        <span className="m-tab-bar__label">Today</span>
      </button>
      <button
        className="m-tab-bar__fab"
        aria-label="Quick capture"
        onClick={() => {
          if (navigator.vibrate) navigator.vibrate(5);
          onFabPress();
        }}
      >
        <Plus size={22} strokeWidth={2.5} color="white" />
      </button>
      <button
        className={`m-tab-bar__tab${activeTab === "projects" ? " m-tab-bar__tab--active" : ""}`}
        role="tab"
        aria-selected={activeTab === "projects"}
        onClick={() => onTabChange("projects")}
      >
        <FolderOpen
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          fill={activeTab === "projects" ? "currentColor" : "none"}
        />
        <span className="m-tab-bar__label">Projects</span>
      </button>
      <button
        className={`m-tab-bar__tab${activeTab === "custom" ? " m-tab-bar__tab--active" : ""}`}
        role="tab"
        aria-selected={activeTab === "custom"}
        onClick={() => onTabChange("custom")}
      >
        <AlignJustify
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          fill={activeTab === "custom" ? "currentColor" : "none"}
        />
        <span className="m-tab-bar__label">{getCustomLabel(customView)}</span>
      </button>
    </nav>
  );
}
