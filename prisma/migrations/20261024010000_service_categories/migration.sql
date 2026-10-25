CREATE TYPE "ServiceCategory" AS ENUM (
  'NAILS',
  'HAIR',
  'BROWS_LASHES',
  'WAXING',
  'MAKEUP'
);

ALTER TABLE "SpaService"
ADD COLUMN "category" "ServiceCategory" NOT NULL DEFAULT 'NAILS';

ALTER TABLE "Appointment"
ADD COLUMN "serviceCategory" "ServiceCategory" NOT NULL DEFAULT 'NAILS',
ADD COLUMN "appointmentDate" DATE;

UPDATE "Appointment" AS appointment
SET
  "serviceCategory" = service."category",
  "appointmentDate" = (appointment."startAt" AT TIME ZONE spa."timezone")::date
FROM "SpaService" AS service, "Spa" AS spa
WHERE service."id" = appointment."serviceId"
  AND spa."id" = appointment."spaId";

ALTER TABLE "Appointment"
ALTER COLUMN "appointmentDate" SET NOT NULL;

CREATE INDEX "Appointment_spaId_customerId_appointmentDate_idx"
ON "Appointment"("spaId", "customerId", "appointmentDate");

CREATE OR REPLACE FUNCTION prevent_duplicate_customer_category_appointment()
RETURNS trigger AS $$
BEGIN
  IF NEW."status" <> 'CANCELLED' THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(
        NEW."spaId"::text || ':' || NEW."customerId"::text || ':' ||
        NEW."appointmentDate"::text || ':' || NEW."serviceCategory"::text
      )
    );

    IF EXISTS (
      SELECT 1
      FROM "Appointment" existing
      WHERE existing."spaId" = NEW."spaId"
        AND existing."customerId" = NEW."customerId"
        AND existing."appointmentDate" = NEW."appointmentDate"
        AND existing."serviceCategory" = NEW."serviceCategory"
        AND existing."status" <> 'CANCELLED'
        AND existing."id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        CONSTRAINT = 'Appointment_customer_category_day_key',
        MESSAGE = 'Customer already has an appointment in this category for this date';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Appointment_customer_category_day_trigger"
BEFORE INSERT OR UPDATE OF "customerId", "serviceCategory", "appointmentDate"
ON "Appointment"
FOR EACH ROW
EXECUTE FUNCTION prevent_duplicate_customer_category_appointment();
