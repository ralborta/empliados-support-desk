# Flows eliminados de BuilderBot Cloud — 2026-07-22

Contexto: auditoría (Fase 0) confirmó que el único cerebro de routing activo hoy es
`POST /api/whatsapp/turn` (backend Next.js). BBC solo tiene 4 flows con un camino de
entrada real: `Inicio` (EVENTS.WELCOME), `Mensaje de Voz` (EVENTS.VOICE_NOTE, corregido
hoy para llamar a `/turn` igual que Inicio), `Derivar` e `Ignorar No Cliente`.

Los 17 flows listados abajo no tenían ningún camino de entrada alcanzable (ni por
keyword de usuario, ni por `gotoFlow`/`conditionFlowId` desde un flow vivo) y se
eliminaron de BuilderBot Cloud (proyecto `7d4339ee-2a9b-424e-92f6-ad7790c1662f`).

## Hallazgo relevante antes del borrado

`Mensaje de Voz` (audio) llamaba a un endpoint viejo
(`/api/builderbot/customer-registered/{from}/context`) y, si el cliente estaba
registrado, redirigía a `Router Wara` (el GPT router viejo) — bypaseando todos los
arreglos hechos en `/turn` durante 2026 (anti-loop, resolución de marca/Nissan,
estado de confirmación en DB, etc.). Se corrigió para que llame a `/turn` igual que
`Inicio`. Además, `Elegir Empresa` (uno de los destinos de esa rama) estaba
completamente vacío (sin mensajes) — un cliente de audio que necesitara elegir
empresa se quedaba sin respuesta.

## Flows eliminados

- **Router Wara** (`5895dde2-c0df-41c2-8a35-0895331aefbf`) — GPT router viejo con 24 reglas de intención por IA. Reglas completas abajo.
- **Elegir Empresa** (`c4b5127a-76fd-4cb2-8b43-d99685b5c50a`) — sin mensajes (dead-end).
- **Cambio Odómetro** (`ae2a5ae9-c289-448c-a068-3cb8c65a2e7f`) — duplicado viejo de "Ejecutar Odómetro".
- **Certificados** (`fd2e658c-f547-4ec6-b64f-00815620bd6b`) — duplicado viejo de "Ejecutar Certificados".
- **Gestión Mantenimiento** (`42b29014-7560-4a67-bc09-0201eb1efdd5`) — duplicado viejo de "Ejecutar Gestión Mantenimiento".
- **Información Mantenimiento** (`069bcb65-7503-433c-a4ae-1dd89cd26471`)
- **Información Unidades** (`52f8a36b-819b-4edb-aeb7-677041797a31`)
- **Información Opciones** (`312ea5a6-0493-43e6-b026-05d14bcb6436`)
- **Ejecutar Consulta Unidad** (`29a8afe6-2414-42bd-8a17-4baaa93d9b44`)
- **Ejecutar Certificados** (`8f4c81a0-e3ca-4c79-b1c5-d94ce6d661e2`)
- **Ejecutar Gestión Mantenimiento** (`e893d57f-faca-490f-85a1-d833aa926b9a`)
- **Ejecutar Odómetro** (`b1062a92-0d72-4f90-bcd9-2fa90d76b95f`)
- **Consultar Unidad** (`5939a04e-5a5a-4c59-83b6-31172eba4828`)
- **Reclamo / Asesor (Odoo)** (`f75f176c-d0b0-4aa4-a579-6af9c53cb4e0`)
- **Cambiar Empresa** (`3693a7a9-b5f2-4a66-97f3-acef85dab201`)
- **Flow: Inicio de conversación** (`e3e7ad1c-27a9-40a8-8556-a24b758a29c6`) — no confundir con el flow "Inicio" real (EVENTS.WELCOME), que se mantuvo.
- **BackUp** (`ccc87872-9392-48a9-9b51-5f33e5cc9eeb`)

## Reglas completas del Router Wara (para referencia histórica)

1. Corrección de patente en odómetro (no cambiar empresa) → Cambio Odómetro
2. Cambiar de empresa (prioridad máxima) → Cambiar Empresa
3. Confirmación de odómetro → Cambio Odómetro
4. Confirmación de mantenimiento → Gestión Mantenimiento
5. Confirmación de certificado (prioridad absoluta) → Certificados
6. Cambio de tema — guía Opciones/Agenda → Información Opciones
7. Certificado/cobertura (prioridad sobre odómetro pendiente) → Certificados
8. Mantenimiento con Atilio tras guía → Gestión Mantenimiento
9. Reproceso tras guía informativa → Ignorar No Cliente
10. Turno/agenda (Opciones Wara) → Información Opciones
11. Patente/prefijo para certificado (prioridad sobre consulta) → Certificados
12. Patente para mantenimiento → Gestión Mantenimiento
13. Saludo solo (prioridad sobre consulta con historial) → Flow Inicio de conversación
14. Cerrar caso/conversación (prioridad sobre asesor) → Reclamo/Asesor (Odoo)
15. Consulta caso abierto (prioridad sobre asesor) → Reclamo/Asesor (Odoo)
16. Atilio puede ayudar (prioridad sobre asesor) → Flow Inicio de conversación
17. Asesor/persona humana (prioridad alta) → Reclamo/Asesor (Odoo)
18. Guía Unidades Wara (prioridad sobre consulta en vivo) → Información Unidades
19. Empresas en Wara → Cambiar Empresa
20. Listado/mis unidades/último reporte (prioridad sobre certificado) → Ejecutar Consulta Unidad
21. Ajustar/corregir odómetro/horómetro → Cambio Odómetro
22. Consultar estado/reporte de unidad (directo) → Ejecutar Consulta Unidad
23. Visto bueno tras propuesta de consulta de estado → Consultar Unidad
24. Obtener/solicitar certificado de cobertura → Certificados
25. Guía Opciones Wara (prioridad sobre mantenimiento y consulta) → Información Opciones
26. Registrar/programar gestión operativa de mantenimiento → Gestión Mantenimiento
27. Entender módulo de mantenimiento (guía informativa) → Información Mantenimiento
28. Atilio/default (saludos, ambigüedad) → Flow Inicio de conversación
