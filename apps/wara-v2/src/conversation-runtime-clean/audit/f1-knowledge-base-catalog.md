# F1.C — Knowledge Base Catalog

| KB ID | Fuente | Tenant/alcance | Tipo | Contenido/tema | Destino Clean | Estado |
|---|---|---|---|---|---|---|
| KB-OPCIONES-MANUAL | `docs/Modulo_Opciones_Wara.pdf` | producto | knowledge | uso del módulo Opciones | fuente versionada + `domain.answer` | requiere extracción aprobada |
| KB-UNIDADES-MANUAL | `docs/Modulo_Unidades_Wara.pdf` | producto | knowledge | módulo Unidades | fuente versionada + `domain.answer` | requiere extracción aprobada |
| KB-V1-OPCIONES | `pilot/semantic/v1-info-guides.ts` | producto | operational_template | fallback de guía Opciones | hechos, no texto literal | parcialmente reusable |
| KB-V1-UNIDADES | mismo archivo | producto | operational_template | fallback de guía Unidades | hechos, no texto literal | parcialmente reusable |
| KB-V1-MANTENIMIENTO | mismo archivo | producto | operational_template | pasos del módulo mantenimiento | facts de KB | parcialmente reusable |
| KB-V1-ODO-HORO | mismo archivo | producto | knowledge | conceptos odómetro/horómetro | facts de KB | reusable con validación |
| KB-V1-TICKET | mismo archivo | producto | business_rule | cuándo crear ticket | Policy/Capability, no KB textual | reclasificado |
| KB-DOMAIN | `pilot/semantic/domain-knowledge.ts` | producto | knowledge | WARA, GPS, odómetro, horómetro, certificados | knowledge port | reusable por concepto |
| KB-PLATFORM | `pilot/semantic/platform-knowledge-base.ts` | producto | knowledge | topics `platform_*` | knowledge port | reusable por topic |
| KB-PLATFORM-AI | `platform-knowledge-ai.ts` | producto | presentation | redacción/selección asistida | Composer/KB adapter futuro | no conectar todavía |
| KB-INFO-REPLIES | `src/lib/infoGuideReplies.ts` | producto | operational_template | respuestas informativas V1 | facts + Composer | revisar texto |
| KB-KNOWLEDGE-DB | `src/lib/knowledgeBase.ts` | multi-tenant | knowledge | archivos/entradas persistidas | KnowledgeRepository port | integración ausente |
| KB-KNOWLEDGE-AI | `src/lib/knowledgeBaseAI.ts` | multi-tenant | presentation | respuesta sobre contexto recuperado | Composer/RAG futuro | integración ausente |
| KB-PROMPT-MODULES | `src/lib/botPromptModules.ts`, `botPromptStore.ts` | configurable | presentation | prompts por módulo | no es KB canónica | separar |
| KB-BUILDERBOT-PROMPTS | `scripts/*_prompt.txt`, sync scripts | deployment | operational_template | plantillas BBC históricas | referencia histórica | no copiar |
| KB-MAESTRO-INSTRUCTIONS | `scripts/current_instructions.txt`, `instructions_updated.txt` | deployment | historical_patch | instrucciones acumuladas | no migrar como conocimiento | obsoleta |
| KB-CONVERSATION-PROMPT | `promptTemplate.ts`, `pilot/prompt.ts` | runtime | presentation | personalidad/flujo legacy | Composer style, no facts | revisar |
| KB-ATILIO-STYLE | `pilot/semantic/atilio-reply-style.ts` | producto | presentation | tono y formato | Composer contract | reusable |
| KB-ODOO-LABELS | `tickets.ts`, Odoo maps | producto | business_rule | status/priority/category/ref | typed domain catalog | parcialmente implementado |
| KB-TENANT-FILES | UI `KnowledgeFilesList`, API prompt/KB | tenant | knowledge | documentos cargados | RAG/knowledge adapter | integración ausente |
| KB-RIOPLATENSE-DATASET | `rioplatense-dataset.ts` | evaluación | historical_patch | variantes lingüísticas | Golden Corpus/LLM eval | no KB |
| KB-TEST-TEMPLATES | tests/smokes/traces | evaluación | historical_patch | respuestas/casos esperados | case catalog | no KB |
| KB-DOCS-ARCH | `docs/v2/**` arquitectura/auditorías | ingeniería | business_rule | contratos y decisiones | policy inventory | no exposición cliente |

## Reglas de migración

- `knowledge` aporta hechos o procedimientos con fuente.
- `business_rule` se implementa en Policy/Strategy, nunca como texto recuperado.
- `operational_template` se descompone en facts + propósito; no se copia literalmente si contiene routing.
- `presentation` pertenece al Composer.
- `historical_patch` alimenta tests o se descarta; nunca se convierte en KB.

No se copió contenido textual de patches. La extracción completa de PDFs y repositorios tenant requiere un checkpoint de contenido aprobado y, para tenant data, acceso a persistencia real; ambos quedan pendientes en G.
