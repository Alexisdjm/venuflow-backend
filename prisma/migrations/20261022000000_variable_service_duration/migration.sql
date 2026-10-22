CREATE TYPE "ServiceDurationType" AS ENUM ('FIXED', 'VARIABLE');

ALTER TABLE "SpaService"
ADD COLUMN "durationType" "ServiceDurationType" NOT NULL DEFAULT 'FIXED',
ALTER COLUMN "durationMinutes" DROP NOT NULL;
