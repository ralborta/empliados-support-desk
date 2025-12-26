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
BUILDERBOT_WEBHOOK_SECRET=builderbot-webhook-secret-key-2025
APP_BASE_URL=https://TU-APP.vercel.app
```

**IMPORTANTE:** 
- Reemplaza `APP_BASE_URL` con la URL real que te dé Vercel después del primer deploy
- Las contraseñas pueden cambiarse por otras más seguras si lo deseas

## Pasos para Deploy en Vercel

1. Ve a https://vercel.com
2. Click en "Add New Project"
3. Conecta el repo: `ralborta/empliados-support-desk`
4. Framework Preset: Next.js (debería detectarlo automáticamente)
5. Build Command: `pnpm install --frozen-lockfile && pnpm build` (o deja el default)
6. Output Directory: `.next` (default)
7. En "Environment Variables", pega las 5 variables de arriba
8. Click "Deploy"

## Configurar Builderbot

Una vez que tengas la URL de Vercel (ej: `https://empliados-support-desk.vercel.app`):

1. Configura el webhook de Builderbot a: `https://TU-APP.vercel.app/api/whatsapp/inbound`
2. Header requerido: `x-bb-secret: builderbot-webhook-secret-key-2025`
3. Payload esperado:
```json
{
  "phone": "54911...",
  "text": "mensaje del cliente",
  "messageId": "id-unico-opcional",
  "name": "nombre-opcional",
  "timestamp": 1234567890,
  "metadata": {}
}
```

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
  -H "x-bb-secret: builderbot-webhook-secret-key-2025" \
  -d '{
    "phone": "5491112345678",
    "text": "No responde Walter",
    "messageId": "test-123"
  }'
```

Debería crear un ticket y devolver un Action Plan.
