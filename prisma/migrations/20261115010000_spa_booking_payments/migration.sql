CREATE TYPE "RemoteDepositMode" AS ENUM ('NONE', 'PERCENT', 'FIXED');
CREATE TYPE "RemotePaymentMethod" AS ENUM ('PAGO_MOVIL', 'ZELLE', 'BINANCE', 'PAYPAL', 'TRANSFER');

ALTER TABLE "Spa"
  ADD COLUMN "remoteDepositMode" "RemoteDepositMode" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "remoteDepositValue" DECIMAL(10, 2),
  ADD COLUMN "remoteDepositCurrency" VARCHAR(4),
  ADD COLUMN "paymentReviewHoldMinutes" INTEGER NOT NULL DEFAULT 240;

ALTER TABLE "Spa" ADD CONSTRAINT "Spa_remote_deposit_check" CHECK (
  (
    "remoteDepositMode" = 'NONE'
    AND "remoteDepositValue" IS NULL
    AND "remoteDepositCurrency" IS NULL
  )
  OR (
    "remoteDepositMode" = 'PERCENT'
    AND "remoteDepositValue" >= 1
    AND "remoteDepositValue" <= 100
    AND "remoteDepositCurrency" IS NULL
  )
  OR (
    "remoteDepositMode" = 'FIXED'
    AND "remoteDepositValue" > 0
    AND "remoteDepositValue" <= 100000
    AND "remoteDepositCurrency" IS NOT NULL
  )
);

ALTER TABLE "Spa" ADD CONSTRAINT "Spa_payment_review_hold_check" CHECK (
  "paymentReviewHoldMinutes" >= 60
  AND "paymentReviewHoldMinutes" <= 1440
);

CREATE TABLE "SpaPaymentMethod" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "spaId" UUID NOT NULL,
  "type" "RemotePaymentMethod" NOT NULL,
  "label" VARCHAR(80) NOT NULL,
  "details" JSONB NOT NULL,
  "requiresProof" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpaPaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpaPaymentMethod_spaId_label_key" ON "SpaPaymentMethod"("spaId", "label");
CREATE INDEX "SpaPaymentMethod_spaId_sortOrder_idx" ON "SpaPaymentMethod"("spaId", "sortOrder");

ALTER TABLE "SpaPaymentMethod" ADD CONSTRAINT "SpaPaymentMethod_spaId_fkey"
  FOREIGN KEY ("spaId") REFERENCES "Spa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
