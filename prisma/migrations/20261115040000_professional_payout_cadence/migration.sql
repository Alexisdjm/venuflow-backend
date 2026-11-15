CREATE TYPE "ProfessionalPayoutCadence" AS ENUM ('NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

ALTER TABLE "Spa"
  ADD COLUMN "professionalPayoutCadence" "ProfessionalPayoutCadence" NOT NULL DEFAULT 'NONE';
