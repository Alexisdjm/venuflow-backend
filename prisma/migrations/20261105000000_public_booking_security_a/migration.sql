-- Additive transition: existing bearer tokens retain version 0 and remain valid.
-- New requests store purpose-specific hashes (version 1), not bearer tokens.
ALTER TABLE "BookingRequest" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
-- A pending request must not claim a Customer before email verification.
-- Existing customer links, uniqueness, triggers and foreign keys are preserved.
ALTER TABLE "BookingRequest" ALTER COLUMN "customerId" DROP NOT NULL;
