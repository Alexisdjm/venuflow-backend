ALTER TYPE "BookingRequestStatus" ADD VALUE 'AWAITING_PAYMENT';
ALTER TYPE "BookingRequestStatus" ADD VALUE 'REJECTED';

ALTER TABLE "BookingRequest"
  ADD COLUMN "paymentMethodId" UUID,
  ADD COLUMN "paymentMethodLabel" VARCHAR(80),
  ADD COLUMN "depositAmount" DECIMAL(10,2),
  ADD COLUMN "depositCurrency" VARCHAR(4),
  ADD COLUMN "paymentReference" VARCHAR(80),
  ADD COLUMN "paymentProofPath" VARCHAR(240),
  ADD COLUMN "paymentProofMime" VARCHAR(40),
  ADD COLUMN "paymentProofBytes" INTEGER,
  ADD COLUMN "paymentSubmittedAt" TIMESTAMP(3);

CREATE INDEX "BookingRequest_spaId_status_expiresAt_idx" ON "BookingRequest"("spaId", "status", "expiresAt");
CREATE INDEX "BookingRequest_paymentMethodId_idx" ON "BookingRequest"("paymentMethodId");

ALTER TABLE "BookingRequest"
  ADD CONSTRAINT "BookingRequest_paymentMethodId_fkey"
  FOREIGN KEY ("paymentMethodId") REFERENCES "SpaPaymentMethod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
