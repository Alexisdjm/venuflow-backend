ALTER TABLE "Appointment" ADD COLUMN "visitGroupId" UUID;

CREATE INDEX "Appointment_visitGroupId_idx" ON "Appointment"("visitGroupId");
