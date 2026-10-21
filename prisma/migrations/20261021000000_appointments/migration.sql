CREATE TYPE "AppointmentStatus" AS ENUM ('CONFIRMED', 'COMPLETED', 'CANCELLED');
CREATE TABLE "Appointment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "spaId" UUID NOT NULL,
  "professionalId" UUID NOT NULL, "serviceId" UUID NOT NULL,
  "customerName" TEXT NOT NULL, "customerPhone" TEXT NOT NULL,
  "customerEmail" TEXT, "notes" TEXT, "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL, "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
  "createdById" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Appointment_id_spaId_key" ON "Appointment"("id", "spaId");
CREATE INDEX "Appointment_spaId_startAt_idx" ON "Appointment"("spaId", "startAt");
CREATE INDEX "Appointment_professionalId_startAt_idx" ON "Appointment"("professionalId", "startAt");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_spaId_fkey" FOREIGN KEY ("spaId") REFERENCES "Spa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_professionalId_spaId_fkey" FOREIGN KEY ("professionalId", "spaId") REFERENCES "Professional"("id", "spaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_serviceId_spaId_fkey" FOREIGN KEY ("serviceId", "spaId") REFERENCES "SpaService"("id", "spaId") ON DELETE RESTRICT ON UPDATE CASCADE;
