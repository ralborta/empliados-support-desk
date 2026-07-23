-- Aditivo, sin riesgo: agrega dos columnas nullable a una tabla existente.
-- No reescribe filas (Postgres ADD COLUMN sin DEFAULT es solo metadata en PG 11+).
-- No borra ni modifica ninguna columna existente.
ALTER TABLE "AgentUser" ADD COLUMN "presenceStartedAt" TIMESTAMP(3);
ALTER TABLE "AgentUser" ADD COLUMN "currentPage" TEXT;
