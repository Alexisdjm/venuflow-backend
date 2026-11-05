CREATE TYPE "PaymentMethod" AS ENUM ('PAGO_MOVIL', 'PUNTO_DE_VENTA', 'ZELLE', 'BINANCE');

ALTER TABLE "Appointment" ADD COLUMN "paymentMethod" "PaymentMethod";
