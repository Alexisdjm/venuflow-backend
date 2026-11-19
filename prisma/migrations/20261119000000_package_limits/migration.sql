ALTER TABLE "Appointment" ADD COLUMN "rescheduleCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CustomerPackage" ADD COLUMN "inactivityDays" INTEGER;
ALTER TABLE "CustomerPackage" ADD COLUMN "maxReschedules" INTEGER NOT NULL DEFAULT 2;
