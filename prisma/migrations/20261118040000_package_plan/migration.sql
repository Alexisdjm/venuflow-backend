ALTER TABLE "SpaService" ADD COLUMN "defaultSessionsPerWeek" INTEGER;

ALTER TABLE "CustomerPackage" ADD COLUMN "sessionsPerWeek" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CustomerPackage" ADD COLUMN "preferredWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "CustomerPackage" ADD COLUMN "preferredProfessionalId" UUID;
