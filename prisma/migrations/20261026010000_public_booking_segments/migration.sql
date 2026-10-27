ALTER TABLE "BookingRequest" ADD COLUMN "segments" JSONB;

ALTER TABLE "Appointment" ADD COLUMN "visitRequestId" UUID;

CREATE INDEX "Appointment_visitRequestId_idx" ON "Appointment"("visitRequestId");

ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_visitRequestId_fkey"
FOREIGN KEY ("visitRequestId") REFERENCES "BookingRequest"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
