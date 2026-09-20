-- OAuth clients may use state for signed relay context. Keep the persisted
-- authorization-code contract aligned with the bounded 4096-character HTTP
-- validation limit.
ALTER TABLE "mcp_authorization_codes"
ALTER COLUMN "state" TYPE VARCHAR(4096);
