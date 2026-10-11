-- Complete fields and index already present in the Prisma audit model.
-- Some installations added these nullable columns manually before this migration.
ALTER TABLE "agent_action_audits"
  ADD COLUMN IF NOT EXISTS "agent_id" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "narration" VARCHAR(500);

CREATE INDEX IF NOT EXISTS "agent_action_audits_user_id_agent_id_created_at_idx"
  ON "agent_action_audits"("user_id", "agent_id", "created_at");
