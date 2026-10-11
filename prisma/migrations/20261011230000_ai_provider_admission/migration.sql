-- Additive admission metadata only. Existing AI suggestions keep their current meaning.
CREATE TYPE "AiProviderReservationStatus" AS ENUM ('reserved', 'completed', 'uncertain', 'reconciled');

CREATE TABLE "ai_provider_reservations" (
    "id" UUID NOT NULL,
    "user_id" TEXT,
    "request_key" VARCHAR(128) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "day_start" DATE NOT NULL,
    "status" "AiProviderReservationStatus" NOT NULL DEFAULT 'reserved',
    "reserved_cost_micros" BIGINT NOT NULL,
    "charged_cost_micros" BIGINT,
    "settled_at" TIMESTAMP(3),
    "reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_provider_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_provider_reservations_cost_nonnegative" CHECK ("reserved_cost_micros" > 0 AND ("charged_cost_micros" IS NULL OR "charged_cost_micros" >= 0))
);

CREATE TABLE "ai_provider_user_days" (
    "user_id" TEXT NOT NULL,
    "day_start" DATE NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ai_provider_user_days_pkey" PRIMARY KEY ("user_id", "day_start"),
    CONSTRAINT "ai_provider_user_days_count_nonnegative" CHECK ("request_count" >= 0)
);

CREATE TABLE "ai_provider_budget_days" (
    "day_start" DATE NOT NULL,
    "reserved_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "spent_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "breached_at" TIMESTAMP(3),
    "breach_reconciled_at" TIMESTAMP(3),
    CONSTRAINT "ai_provider_budget_days_pkey" PRIMARY KEY ("day_start"),
    CONSTRAINT "ai_provider_budget_days_cost_nonnegative" CHECK ("reserved_cost_micros" >= 0 AND "spent_cost_micros" >= 0)
);

CREATE TABLE "ai_suggestion_reservations" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "day_start" DATE NOT NULL,
    "daily_limit" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_suggestion_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_suggestion_reservations_limit_positive" CHECK ("daily_limit" > 0)
);

CREATE UNIQUE INDEX "ai_provider_reservations_user_id_request_key_key" ON "ai_provider_reservations"("user_id", "request_key");
CREATE INDEX "ai_provider_reservations_user_id_day_start_idx" ON "ai_provider_reservations"("user_id", "day_start");
CREATE INDEX "ai_provider_reservations_status_idx" ON "ai_provider_reservations"("status");
CREATE INDEX "ai_suggestion_reservations_user_id_day_start_idx" ON "ai_suggestion_reservations"("user_id", "day_start");

ALTER TABLE "ai_provider_reservations" ADD CONSTRAINT "ai_provider_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_provider_user_days" ADD CONSTRAINT "ai_provider_user_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_suggestion_reservations" ADD CONSTRAINT "ai_suggestion_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
