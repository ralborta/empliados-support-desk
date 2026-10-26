# F2 — cobertura capability → escenarios

La fuente ejecutable es `golden/corpus.ts`. Cada capability del catálogo genera un escenario individual `capability:<name>` y además los siguientes recorridos verifican composición multi-turno:

| Grupo | Capabilities | Escenario multi-turno |
|---|---|---|
| Empresa | company.list/select/get_active | `flow:company-select` |
| Unidad | unit.search/select/get_active/get_previous | `flow:unit-context` |
| GPS | gps.get_status | `flow:gps` |
| Medidores | odometer/hourmeter prepare+update | `flow:odometer`, `flow:hourmeter` |
| Mantenimiento | maintenance.prepare/create | `flow:maintenance` |
| Certificados | certificate.prepare/issue | `flow:certificate` |
| Handoff legacy | handoff.prepare/create | escenarios individuales + autorización |
| Conversación | handoff/assign/release prepare+commit | `flow:handoff-assignment-release` |
| Tickets | create/status/update/close/reopen | `flow:ticket-lifecycle` |
| Adjuntos | prepare/commit/get/link ticket/maintenance | `flow:attachments`, `flow:maintenance` |
| Knowledge | domain.answer | `flow:kb-lateral-resume` |

Test de cierre: `golden-corpus.test.ts` compara el set cubierto contra `CLEAN_CAPABILITY_CATALOG`; una capability nueva rompe la suite hasta recibir escenario.
