ALTER TABLE "Appointment" ALTER COLUMN "createdById" DROP NOT NULL;

CREATE TYPE "BookingRequestStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "BookingRequest" (
  "id" UUID NOT NULL,
  "spaId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "serviceId" UUID NOT NULL,
  "professionalId" UUID,
  "appointmentId" UUID,
  "token" VARCHAR(64) NOT NULL,
  "receiptToken" VARCHAR(64),
  "status" "BookingRequestStatus" NOT NULL DEFAULT 'PENDING',
  "email" TEXT NOT NULL,
  "submittedName" TEXT NOT NULL,
  "submittedPhone" TEXT NOT NULL,
  "nationalId" TEXT NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "resendAvailableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookingRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingRequest_token_key" ON "BookingRequest"("token");
CREATE UNIQUE INDEX "BookingRequest_receiptToken_key" ON "BookingRequest"("receiptToken");
CREATE UNIQUE INDEX "BookingRequest_appointmentId_key" ON "BookingRequest"("appointmentId");
CREATE INDEX "BookingRequest_spaId_status_idx" ON "BookingRequest"("spaId", "status");
CREATE INDEX "BookingRequest_customerId_idx" ON "BookingRequest"("customerId");

ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_spaId_fkey" FOREIGN KEY ("spaId") REFERENCES "Spa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_customerId_spaId_fkey" FOREIGN KEY ("customerId", "spaId") REFERENCES "Customer"("id", "spaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_serviceId_spaId_fkey" FOREIGN KEY ("serviceId", "spaId") REFERENCES "SpaService"("id", "spaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
