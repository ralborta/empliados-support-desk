-- Cache de SessionToken Wara por contacto elegido (evita CreateChatBotToken en cada consulta).
ALTER TABLE "Customer" ADD COLUMN "waraSessionToken" TEXT;
ALTER TABLE "Customer" ADD COLUMN "waraSessionAt" TIMESTAMP(3);
