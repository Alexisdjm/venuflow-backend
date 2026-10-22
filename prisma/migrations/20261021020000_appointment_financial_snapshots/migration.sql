ALTER TABLE "Appointment"
ADD COLUMN "servicePrice" DECIMAL(10,2),
ADD COLUMN "commissionRate" DECIMAL(5,2);

UPDATE "Appointment" AS appointment
SET "servicePrice" = service.price,
    "commissionRate" = professional."commissionRate"
FROM "SpaService" AS service, "Professional" AS professional
WHERE service.id = appointment."serviceId"
  AND professional.id = appointment."professionalId";

ALTER TABLE "Appointment"
ALTER COLUMN "servicePrice" SET NOT NULL,
ALTER COLUMN "commissionRate" SET NOT NULL;
