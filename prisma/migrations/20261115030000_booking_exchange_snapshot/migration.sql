ALTER TABLE "BookingRequest"
  ADD COLUMN "depositVesAmount" DECIMAL(14,2),
  ADD COLUMN "exchangeRate" DECIMAL(18,8),
  ADD COLUMN "exchangeSource" VARCHAR(16),
  ADD COLUMN "exchangeQuotedAt" TIMESTAMP(3);
