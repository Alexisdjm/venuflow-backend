CREATE TABLE "Customer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "spaId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Customer_id_spaId_key" ON "Customer"("id", "spaId");
CREATE UNIQUE INDEX "Customer_spaId_phone_key" ON "Customer"("spaId", "phone");
CREATE INDEX "Customer_spaId_name_idx" ON "Customer"("spaId", "name");

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_spaId_fkey"
FOREIGN KEY ("spaId") REFERENCES "Spa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Customer" ("id", "spaId", "name", "phone", "email", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  "spaId",
  (array_agg("customerName" ORDER BY "createdAt" DESC))[1],
  "customerPhone",
  (array_agg("customerEmail" ORDER BY "createdAt" DESC) FILTER (WHERE "customerEmail" IS NOT NULL))[1],
  MIN("createdAt"),
  CURRENT_TIMESTAMP
FROM "Appointment"
GROUP BY "spaId", "customerPhone";

ALTER TABLE "Appointment" ADD COLUMN "customerId" UUID;

UPDATE "Appointment" AS appointment
SET "customerId" = customer."id"
FROM "Customer" AS customer
WHERE customer."spaId" = appointment."spaId"
  AND customer."phone" = appointment."customerPhone";

ALTER TABLE "Appointment" ALTER COLUMN "customerId" SET NOT NULL;
CREATE INDEX "Appointment_customerId_startAt_idx" ON "Appointment"("customerId", "startAt");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_customerId_spaId_fkey"
FOREIGN KEY ("customerId", "spaId") REFERENCES "Customer"("id", "spaId") ON DELETE RESTRICT ON UPDATE CASCADE;
