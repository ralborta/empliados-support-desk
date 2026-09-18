-- Persistir última alerta BBC (transiciones, no spam en refresh del monitor).
ALTER TABLE "OpsServiceHeartbeat" ADD COLUMN "lastAlertAt" TIMESTAMP(3);
