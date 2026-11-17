CREATE TABLE "TrialSignup" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "spaId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "phone" VARCHAR(15) NOT NULL,
  "ipAddress" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrialSignup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrialSignup_spaId_key" ON "TrialSignup"("spaId");
CREATE UNIQUE INDEX "TrialSignup_phone_key" ON "TrialSignup"("phone");
CREATE INDEX "TrialSignup_ipAddress_createdAt_idx" ON "TrialSignup"("ipAddress", "createdAt");

ALTER TABLE "TrialSignup"
  ADD CONSTRAINT "TrialSignup_spaId_fkey"
  FOREIGN KEY ("spaId") REFERENCES "Spa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
