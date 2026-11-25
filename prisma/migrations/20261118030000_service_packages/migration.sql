CREATE TYPE "ServiceOffering" AS ENUM ('SINGLE', 'PACKAGE');

ALTER TABLE "SpaService" ADD COLUMN "offering" "ServiceOffering" NOT NULL DEFAULT 'SINGLE';
ALTER TABLE "SpaService" ADD COLUMN "sessionCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SpaService" ADD COLUMN "validityDays" INTEGER;

CREATE TABLE "CustomerPackage" (
    "id" UUID NOT NULL,
    "spaId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sessionCount" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "sessionValue" DECIMAL(12,2) NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "CustomerPackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerPackage_id_spaId_key" ON "CustomerPackage"("id", "spaId");
CREATE INDEX "CustomerPackage_spaId_customerId_idx" ON "CustomerPackage"("spaId", "customerId");

ALTER TABLE "CustomerPackage" ADD CONSTRAINT "CustomerPackage_spaId_fkey" FOREIGN KEY ("spaId") REFERENCES "Spa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerPackage" ADD CONSTRAINT "CustomerPackage_customerId_spaId_fkey" FOREIGN KEY ("customerId", "spaId") REFERENCES "Customer"("id", "spaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerPackage" ADD CONSTRAINT "CustomerPackage_serviceId_spaId_fkey" FOREIGN KEY ("serviceId", "spaId") REFERENCES "SpaService"("id", "spaId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PackagePayment" (
    "id" UUID NOT NULL,
    "spaId" UUID NOT NULL,
    "customerPackageId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackagePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PackagePayment_customerPackageId_idx" ON "PackagePayment"("customerPackageId");

ALTER TABLE "PackagePayment" ADD CONSTRAINT "PackagePayment_spaId_fkey" FOREIGN KEY ("spaId") REFERENCES "Spa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackagePayment" ADD CONSTRAINT "PackagePayment_customerPackageId_spaId_fkey" FOREIGN KEY ("customerPackageId", "spaId") REFERENCES "CustomerPackage"("id", "spaId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment" ADD COLUMN "customerPackageId" UUID;
CREATE INDEX "Appointment_customerPackageId_idx" ON "Appointment"("customerPackageId");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_customerPackageId_spaId_fkey" FOREIGN KEY ("customerPackageId", "spaId") REFERENCES "CustomerPackage"("id", "spaId") ON DELETE RESTRICT ON UPDATE CASCADE;
