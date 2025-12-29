# Guía de Deploy - Empliados Support Desk

## ✅ Estado Actual
- ✅ Base de datos en Railway con migración aplicada
- ✅ Código en GitHub: https://github.com/ralborta/empliados-support-desk
- ✅ Build local exitoso (Next.js 16 + Prisma 6)
- ⏳ Esperando deploy en Vercel

## 📦 Stack Técnico
- **Frontend/Backend**: Next.js 16.1.1 (App Router, TypeScript, Tailwind)
- **Base de Datos**: PostgreSQL en Railway
- **ORM**: Prisma 6.19.1 (downgrade desde v7 por compatibilidad)
- **Auth**: iron-session
- **Deployment**: Vercel

## Variables de Entorno para Vercel

Configura estas variables en **Vercel → Project Settings → Environment Variables**:

```
DATABASE_URL=postgresql://postgres:QaVYMOysPnKLDIthwOrsAcPISAVnRCzj@gondola.proxy.rlwy.net:12745/railway?sslmode=require
APP_PASSWORD=empliados-support-2025-secure
SESSION_PASSWORD=empliados-session-secret-key-32-chars-minimum-required-for-security
BUILDERBOT_BOT_ID=7d4339ee-2a9b-424e-92f6-ad7790c1662f
BUILDERBOT_API_KEY=bb-04c2baf7-5db2-4c43-9cfc-35bbbb660812
BUILDERBOT_BASE_URL=https://app.builderbot.cloud
OPENAI_API_KEY=sk-proj-...tu-api-key...
```

**IMPORTANTE:** 
- Las contraseñas pueden cambiarse por otras más seguras si lo deseas
- El `BUILDERBOT_BOT_ID` y `BUILDERBOT_API_KEY` son los que te proporciona BuilderBot.cloud
- El `OPENAI_API_KEY` es necesario para generar resúmenes automáticos de las conversaciones

## Pasos para Deploy en Vercel

1. Ve a https://vercel.com
2. Click en "Add New Project"
3. Conecta el repo: `ralborta/empliados-support-desk`
4. Framework Preset: Next.js (debería detectarlo automáticamente)
5. Build Command: `pnpm install --frozen-lockfile && pnpm build` (o deja el default)
6. Output Directory: `.next` (default)
7. En "Environment Variables", pega las 5 variables de arriba
8. Click "Deploy"

## Configurar BuilderBot.cloud

Una vez que tengas la URL de Vercel (ej: `https://empliados-support-desk.vercel.app`):

### 1. Configurar Webhook en BuilderBot

Ve a tu proyecto en BuilderBot.cloud → **Desarrollador** → **Webhooks** → **message.incoming**

**URL del Webhook:**
```
https://TU-APP.vercel.app/api/whatsapp/inbound
```

**Método:** POST  
**Content-Type:** application/json

BuilderBot enviará automáticamente este formato:
```json
{
  "eventName": "message.incoming",
  "data": {
    "body": "texto del mensaje",
    "name": "Nombre del Cliente",
    "from": "5491112345678",
    "attachment": [],
    "projectId": "7d4339ee-2a9b-424e-92f6-ad7790c1662f"
  }
}
```

### 2. ¿Cómo funciona?

1. **Cliente envía WhatsApp** → BuilderBot recibe el mensaje
2. **BuilderBot hace POST** → Tu webhook en Vercel
3. **Tu backend crea ticket** → Guarda en base de datos
4. **Tu backend envía respuesta** → Vía API de BuilderBot → Cliente recibe respuesta automática

### 3. Mensajes Automáticos

El sistema enviará automáticamente:
- ✅ Confirmación cuando se crea un ticket nuevo
- ✅ Notificación cuando se escala a un agente humano
- ✅ Incluye el código del ticket (ej: `TKT-20250129-ABC123`)

## Pruebas Locales

```bash
pnpm dev
```

Luego:
- Abre http://localhost:3000/login
- Password: `empliados-support-2025-secure`
- Deberías ver el dashboard de tickets

## Prueba del Webhook

```bash
curl -X POST http://localhost:3000/api/whatsapp/inbound \
  -H "Content-Type: application/json" \
  -d '{
    "eventName": "message.incoming",
    "data": {
      "body": "Hola, no responde Walter",
      "name": "Cliente Test",
      "from": "5491112345678",
      "attachment": [],
      "projectId": "7d4339ee-2a9b-424e-92f6-ad7790c1662f"
    }
  }'
```

Debería:
1. Crear un ticket nuevo
2. Guardar el mensaje en la base de datos
3. Responder con un JSON indicando éxito
4. (Si está bien configurado) Enviar mensaje automático al cliente por WhatsApp

---

## 🤖 Gestión de Mensajes Temporales y Resúmenes con IA

### Ciclo de vida de los mensajes:

**FASE 1: Conversación Activa**
- Los mensajes se almacenan temporalmente en `TicketMessage`
- Permiten tracking en tiempo real de la conversación

**FASE 2: Cierre con Resumen**
- Cuando se cierra o escala un caso, OpenAI resume toda la conversación
- El resumen se guarda en `Ticket.aiSummary` y `Ticket.resolution`
- Los mensajes temporales se **BORRAN** para ahorrar espacio
- Solo queda el resumen en el ticket

### Endpoints para cerrar casos:

#### 1. Escalar a Soporte Humano

```bash
POST /api/tickets/{ticketId}/escalate
```

**¿Cuándo usar?**
- El Agente IA no puede resolver el problema
- Cliente insiste después de 3+ mensajes
- Detecta keywords críticas: "urgente", "no funciona", etc.

**Respuesta:**
```json
{
  "ok": true,
  "ticketCode": "TKT-20241229-ABC123",
  "aiSummary": "Cliente reporta que Walter no responde desde hace 1h...",
  "resolution": "Escalado a soporte humano para atención inmediata.",
  "messagesDeleted": 5
}
```

#### 2. Cerrar Caso Resuelto por IA

```bash
POST /api/tickets/{ticketId}/close-by-ai
```

**¿Cuándo usar?**
- El Agente IA resolvió completamente el problema
- Cliente satisfecho con la respuesta automática
- No requiere intervención humana

**Respuesta:**
```json
{
  "ok": true,
  "ticketCode": "TKT-20241229-ABC123",
  "aiSummary": "Cliente preguntó por horarios de atención.",
  "resolution": "Se informó horario de lunes a viernes 9-18hs. Cliente satisfecho.",
  "messagesDeleted": 3
}
```

### Ventajas del sistema:

✅ **Ahorro de espacio:** Solo guarda resúmenes, no conversaciones completas  
✅ **Contexto claro:** Agentes humanos ven resumen conciso, no mensajes dispersos  
✅ **Métricas precisas:** Distingue casos resueltos por IA vs escalados  
✅ **Auditoría:** Registro de qué pasó sin data innecesaria  

### Ejemplo de flujo completo:

```
1. Cliente envía 5 mensajes → BuilderBot → Webhook
2. Tu backend guarda 5 mensajes temporales en DB
3. Agente IA decide: "Necesita escalar"
4. POST /api/tickets/{id}/escalate
5. OpenAI resume: "Cliente reporta Walter no responde. Urgente."
6. Se guarda el resumen en Ticket
7. Se BORRAN los 5 mensajes temporales
8. Agente humano ve solo el resumen
```
