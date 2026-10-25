CREATE TABLE "service_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "spaId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_categories_id_spaId_key" ON "service_categories"("id", "spaId");
CREATE UNIQUE INDEX "service_categories_spaId_normalizedName_key" ON "service_categories"("spaId", "normalizedName");
CREATE INDEX "service_categories_spaId_sortOrder_idx" ON "service_categories"("spaId", "sortOrder");

ALTER TABLE "service_categories"
ADD CONSTRAINT "service_categories_spaId_fkey"
FOREIGN KEY ("spaId") REFERENCES "Spa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "service_categories" ("id", "spaId", "name", "normalizedName", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid(), spa."id", names.name, names.normalized_name, names.sort_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Spa" AS spa
CROSS JOIN (
  VALUES
    ('Uñas', 'uñas', 0),
    ('Cabello', 'cabello', 1),
    ('Cejas y pestañas', 'cejas y pestañas', 2),
    ('Depilación', 'depilación', 3),
    ('Maquillaje', 'maquillaje', 4)
) AS names(name, normalized_name, sort_order);

ALTER TABLE "SpaService" ADD COLUMN "categoryId" UUID;

UPDATE "SpaService" AS service
SET "categoryId" = category."id"
FROM "service_categories" AS category
WHERE category."spaId" = service."spaId"
  AND category."normalizedName" = CASE service."category"::text
    WHEN 'NAILS' THEN 'uñas'
    WHEN 'HAIR' THEN 'cabello'
    WHEN 'BROWS_LASHES' THEN 'cejas y pestañas'
    WHEN 'WAXING' THEN 'depilación'
    WHEN 'MAKEUP' THEN 'maquillaje'
  END;

ALTER TABLE "SpaService" ALTER COLUMN "categoryId" SET NOT NULL;
ALTER TABLE "SpaService"
ADD CONSTRAINT "SpaService_categoryId_spaId_fkey"
FOREIGN KEY ("categoryId", "spaId") REFERENCES "service_categories"("id", "spaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpaService" DROP COLUMN "category";

DROP TRIGGER "Appointment_customer_category_day_trigger" ON "Appointment";

ALTER TABLE "Appointment" ADD COLUMN "serviceCategoryId" UUID;

UPDATE "Appointment" AS appointment
SET "serviceCategoryId" = category."id"
FROM "service_categories" AS category
WHERE category."spaId" = appointment."spaId"
  AND category."normalizedName" = CASE appointment."serviceCategory"::text
    WHEN 'NAILS' THEN 'uñas'
    WHEN 'HAIR' THEN 'cabello'
    WHEN 'BROWS_LASHES' THEN 'cejas y pestañas'
    WHEN 'WAXING' THEN 'depilación'
    WHEN 'MAKEUP' THEN 'maquillaje'
  END;

ALTER TABLE "Appointment" ALTER COLUMN "serviceCategoryId" SET NOT NULL;
ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_serviceCategoryId_spaId_fkey"
FOREIGN KEY ("serviceCategoryId", "spaId") REFERENCES "service_categories"("id", "spaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" DROP COLUMN "serviceCategory";

CREATE OR REPLACE FUNCTION prevent_duplicate_customer_category_appointment()
RETURNS trigger AS $$
BEGIN
  IF NEW."status" <> 'CANCELLED' THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(
        NEW."spaId"::text || ':' || NEW."customerId"::text || ':' ||
        NEW."appointmentDate"::text || ':' || NEW."serviceCategoryId"::text
      )
    );

    IF EXISTS (
      SELECT 1
      FROM "Appointment" existing
      WHERE existing."spaId" = NEW."spaId"
        AND existing."customerId" = NEW."customerId"
        AND existing."appointmentDate" = NEW."appointmentDate"
        AND existing."serviceCategoryId" = NEW."serviceCategoryId"
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
BEFORE INSERT OR UPDATE OF "customerId", "serviceCategoryId", "appointmentDate"
ON "Appointment"
FOR EACH ROW
EXECUTE FUNCTION prevent_duplicate_customer_category_appointment();

DROP TYPE "ServiceCategory";
