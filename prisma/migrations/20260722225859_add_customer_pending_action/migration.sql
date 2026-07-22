-- Aditivo, sin riesgo: agrega una columna nullable a una tabla existente.
-- No reescribe filas (Postgres ADD COLUMN sin DEFAULT es solo metadata en PG 11+).
-- No borra ni modifica ninguna columna existente.
ALTER TABLE "Customer" ADD COLUMN "pendingAction" JSONB;
