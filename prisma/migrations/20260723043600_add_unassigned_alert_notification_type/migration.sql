-- Aditivo, sin riesgo: agrega un valor nuevo a un enum existente. No modifica ni borra
-- ningún valor previo, no reescribe filas.
ALTER TYPE "AgentNotificationType" ADD VALUE 'UNASSIGNED_ALERT';
