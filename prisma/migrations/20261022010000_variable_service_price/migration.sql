CREATE TYPE "ServicePriceType" AS ENUM ('FIXED', 'VARIABLE');

ALTER TABLE "SpaService"
ADD COLUMN "priceType" "ServicePriceType" NOT NULL DEFAULT 'FIXED';
