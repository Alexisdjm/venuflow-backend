-- PostgreSQL exclusion constraints make the availability check atomic across
-- every API instance. Half-open ranges allow adjacent appointments.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_no_confirmed_overlap"
EXCLUDE USING gist (
  "professionalId" WITH =,
  tsrange("startAt", "endAt", '[)') WITH &&
)
WHERE ("status" = 'CONFIRMED');
