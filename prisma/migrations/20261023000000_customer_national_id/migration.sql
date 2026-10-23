DROP INDEX "Customer_spaId_phone_key";

ALTER TABLE "Customer" ADD COLUMN "nationalId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "customerNationalId" TEXT;

CREATE UNIQUE INDEX "Customer_spaId_nationalId_key"
ON "Customer"("spaId", "nationalId");
