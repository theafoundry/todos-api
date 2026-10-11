import { useAgentProfiles } from "../../agents/useAgentProfiles";
import { AgentSigil } from "../../components/home/AgentSigil";
import { SectionHeader } from "../../components/layout/SectionHeader";

export function AgentsPanel() {
  const profiles = useAgentProfiles();
  const agents = Object.values(profiles);

  if (agents.length === 0) return null;

  return (
    <section className="settings-section">
      <SectionHeader title="Your Agents" />
      <p className="settings-section__subtitle">
        Assistant styles used when hosted AI is available
      </p>
      <div className="agents-grid">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="agent-card"
            style={{
              background: agent.colors.bg,
              borderColor: agent.colors.stroke,
            }}
          >
            <div className="agent-card__header">
              <AgentSigil
                agentId={agent.id}
                color={agent.colors.stroke}
                bg={agent.colors.bg}
                size={64}
              />
              <div>
                <div
                  className="agent-card__name"
                  style={{ color: agent.colors.textDark }}
                >
                  {agent.name}
                </div>
                <div
                  className="agent-card__role"
                  style={{ color: agent.colors.textDark, opacity: 0.7 }}
                >
                  {agent.role}
                </div>
              </div>
            </div>
            <p
              className="agent-card__quote"
              style={{ color: agent.colors.textDark }}
            >
              &ldquo;{agent.quote}&rdquo;
            </p>
            <div className="agent-card__traits">
              {agent.traits.map((trait) => (
                <span
                  key={trait}
                  className="agent-card__trait"
                  style={{
                    background: agent.colors.traitBg,
                    color: agent.colors.textDark,
                  }}
                >
                  {trait}
                </span>
              ))}
            </div>
            <div
              className="agent-card__details"
              style={{ color: agent.colors.textDark }}
            >
              <div>
                <strong>Superpower:</strong> {agent.superpower}
              </div>
              <div>
                <strong>Quirk:</strong> {agent.quirk}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
