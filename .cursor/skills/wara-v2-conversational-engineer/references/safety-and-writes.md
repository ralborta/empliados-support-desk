# Seguridad y escrituras

## Regla de oro

Las reglas pueden **bloquear** escrituras dudosas; **nunca autorizarlas** por heurística, ausencia de negación, cortesía o “parece un sí”.

## Confirmación de escritura

Requisitos concurrentes (path unificado):

1. `decision.answer === "confirm"` (u structured confirm equivalente).
2. Binding de pregunta (`lastAgentQuestionMeta` / pending con `expectedAnswerType: confirmation`).
3. Flags de write en **false** en shadow (ver abajo), o gate de producto si algún día se habilitan.
4. Veto: si `mustBlockWriteExecution(mensaje)` y la decisión intenta confirm → **bloquear**, no confirmar.

Prohibido:

- Generar `CONFIRMO` sintético en código.
- Tratar despedida (`gracias chau`) como confirmación.
- Ejecutar write porque el usuario “no negó”.

## Cancelación

Solo por decisión estructurada (`answer=cancel`, `speechAct=cancel`, `currentTramiteDisposition=cancel`, etc.).  
Tras cancelar: limpiar draft/pending; **no** restaurar la operación cancelada si llega un número suelto después.

## Flags shadow (`v2-shadow`) — vigentes

```text
WARA_V2_UNIFIED_SEMANTIC_BRAIN=true
WARA_V2_ODOMETER_WRITE_ENABLED=false
WARA_V2_CERTIFICATE_WRITE_ENABLED=false
WARA_V2_ODOO_WRITE_ENABLED=false
WARA_V2_DELIVERY_ENABLED=false
WARA_V2_ROUTER_ENABLED=false
ALLOW_EXTERNAL_MUTATIONS=false
```

Lab puede responder “Registro simulado OK … Sin escritura real.” Eso **no** es escritura externa.

## Veto vs routing

`mustBlockWriteExecution` / farewell helpers existen para **seguridad de write**. No usarlos para elegir trámite, empresa o unidad.
