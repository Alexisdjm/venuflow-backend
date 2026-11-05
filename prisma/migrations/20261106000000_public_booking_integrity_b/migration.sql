-- Preflight BEFORE any schema changes. Never fix or delete incompatible data.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "BookingRequest" br LEFT JOIN "Appointment" a ON a.id=br."appointmentId"
    WHERE br."appointmentId" IS NOT NULL AND (a.id IS NULL OR a."spaId"<>br."spaId")
  ) OR EXISTS (
    SELECT 1 FROM "Appointment" a LEFT JOIN "BookingRequest" br ON br.id=a."visitRequestId"
    WHERE a."visitRequestId" IS NOT NULL AND (br.id IS NULL OR br."spaId"<>a."spaId")
  ) OR EXISTS (
    SELECT 1 FROM "BookingRequest" br LEFT JOIN "Professional" p ON p.id=br."professionalId"
    WHERE br."professionalId" IS NOT NULL AND (p.id IS NULL OR p."spaId"<>br."spaId")
  ) OR EXISTS (
    SELECT "spaId" FROM "User" WHERE role='SPA_ADMIN' AND "spaId" IS NOT NULL
    GROUP BY "spaId" HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'Block B preflight failed: review inconsistent booking relations or duplicate spa administrators; no data was changed';
  END IF;
END $$;

BEGIN;
CREATE UNIQUE INDEX "BookingRequest_id_spaId_key" ON "BookingRequest"(id,"spaId");
CREATE UNIQUE INDEX "BookingRequest_appointmentId_spaId_key" ON "BookingRequest"("appointmentId","spaId");
CREATE UNIQUE INDEX "User_one_spa_admin_key" ON "User"("spaId") WHERE role='SPA_ADMIN' AND "spaId" IS NOT NULL;

ALTER TABLE "BookingRequest" DROP CONSTRAINT "BookingRequest_appointmentId_fkey";
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_appointmentId_spaId_fkey"
  FOREIGN KEY ("appointmentId","spaId") REFERENCES "Appointment"(id,"spaId")
  ON DELETE SET NULL ("appointmentId") ON UPDATE CASCADE;
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_visitRequestId_fkey";
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_visitRequestId_spaId_fkey"
  FOREIGN KEY ("visitRequestId","spaId") REFERENCES "BookingRequest"(id,"spaId")
  ON DELETE SET NULL ("visitRequestId") ON UPDATE CASCADE;
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_professionalId_spaId_fkey"
  FOREIGN KEY ("professionalId","spaId") REFERENCES "Professional"(id,"spaId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reactivating a cancelled appointment must check the same category/day rule.
DROP TRIGGER "Appointment_customer_category_day_trigger" ON "Appointment";
CREATE TRIGGER "Appointment_customer_category_day_trigger"
BEFORE INSERT OR UPDATE OF "customerId", "serviceCategoryId", "appointmentDate", "status", "spaId"
ON "Appointment" FOR EACH ROW EXECUTE FUNCTION prevent_duplicate_customer_category_appointment();
COMMIT;
