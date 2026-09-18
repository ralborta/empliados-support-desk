# Diagnóstico — contacto WARA `486546` vs `CreateChatBotToken`

**Fecha:** 2026-08-12  
**Entorno:** producción WARA (`apps.visionblo.com`)  
**Teléfono lab:** `+5491133788190`

## Síntoma

Al elegir empresa **WARA** en el menú multiempresa, V2 responde que no pudo abrir sesión.

## Evidencia

### `ObtenerContactosPorNumero`

```json
{
  "ok": true,
  "contactos": [
    { "contacto_id": 486546, "nombre": "Raul Alborta", "empresa": "WARA" },
    { "contacto_id": 131776, "nombre": "Administrador Wara", "empresa": "El Cacique S.A." }
  ]
}
```

### `CreateChatBotToken`

| `contacto_id` enviado | Resultado |
|----------------------|-----------|
| **486546** (devuelto por lookup) | `{"error":"Contacto inexistente"}` |
| **131776** (El Cacique) | OK — SessionToken |
| **64866** (id canónico histórico WARA en aliases V1) | OK — CustomerID 26872 |
| **26872** (CustomerID de 64866) | `{"error":"Contacto inexistente"}` |

## Conclusión

1. V2 usa `contacto_id` igual que V1; no es un bug de parser.
2. **Inconsistencia del API WARA:** el id de asociación teléfono↔empresa (`486546`) no abre sesión con `CreateChatBotToken`.
3. El id operativo WARA en prod es **64866** (solo documentado en aliases de staging V1; no aplican en prod).
4. **El Cacique (131776)** es coherente entre lookup y token.

## Acción V2 lab

- Mensaje claro al fallar: empresa, contacto_id, error WARA, otras opciones.
- Empresa de laboratorio recomendada: **El Cacique S.A.**
- Sin escrituras en WARA/Odoo.

## Pendiente externo (WARA)

Confirmar si `contacto_id` de lookup debe usarse en `CreateChatBotToken` o si falta otro identificador.
