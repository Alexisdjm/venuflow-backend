ALTER TABLE "Spa"
ADD COLUMN "openingMinute" INTEGER NOT NULL DEFAULT 540,
ADD COLUMN "closingMinute" INTEGER NOT NULL DEFAULT 1080;

ALTER TABLE "Spa"
ADD CONSTRAINT "Spa_operating_hours_check"
CHECK ("openingMinute" >= 0 AND "closingMinute" <= 1440 AND "openingMinute" < "closingMinute");
