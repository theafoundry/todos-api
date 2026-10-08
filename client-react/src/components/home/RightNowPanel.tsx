// client-react/src/components/home/RightNowPanel.tsx
import { FlipCard } from "./FlipCard";
import { TarotCardFront, TarotCardBack } from "./TarotCard";
import { CardBackContent } from "./CardBack";
import { FlameArt } from "./pixel-art";
import type { RightNow, PanelProvenance } from "../../types/focusBrief";
import {
  useAgentProfiles,
  getAgentProfile,
} from "../../agents/useAgentProfiles";

interface Props {
  data: RightNow;
  provenance?: PanelProvenance;
  onTaskClick: (id: string) => void;
}

export function RightNowPanel({ data, provenance, onTaskClick }: Props) {
  const profiles = useAgentProfiles();
  const agentProfile = getAgentProfile(profiles, data.agentId);
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
  if (
    !data.narrative &&
    data.urgentItems.length === 0 &&
    !data.topRecommendation
  ) {
    return null;
  }

  const front = (
    <TarotCardFront
      name="The Flame"
      subtitle="Your priorities right now"
      numeral="I"
      source="ai"
      illustration={<FlameArt size={64} />}
      accentPattern={{ mode: "spiralField", seed: 101 }}
      hero
      agent={agent}
    >
      {data.narrative && <p className="tarot-narrative">{data.narrative}</p>}
      {data.topRecommendation && (
        <button
          className="tarot-action-band"
          data-card-swipe-target=""
          onClick={() => onTaskClick(data.topRecommendation!.taskId)}
          style={{
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            width: "100%",
            fontFamily: "inherit",
          }}
        >
          <div className="tarot-action-band__label">Strongest action</div>
          <div className="tarot-action-band__title">
            {data.topRecommendation.title}
          </div>
          <div className="tarot-action-band__reason">
            {data.topRecommendation.reasoning}
          </div>
        </button>
      )}
    </TarotCardFront>
  );

  const back = (
    <TarotCardBack
      name="The Flame"
      numeral="I"
      source="ai"
      illustration={<FlameArt size={80} />}
      agent={agent}
    >
      <CardBackContent
        provenance={provenance}
        reason="Pinned — always visible. Urgent items and your strongest next action."
        agent={agent}
      />
    </TarotCardBack>
  );

  return <FlipCard front={front} back={back} />;
}
