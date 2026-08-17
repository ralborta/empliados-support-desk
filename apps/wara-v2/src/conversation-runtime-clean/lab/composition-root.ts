import { loadCleanLabApplicationConfig, type CleanLabApplicationConfig } from "../config/lab-config.js";
import { sanitizedCleanHealthConfig } from "../config/clean-config.js";
import { PgPoolSqlClient } from "../adapters/persistence/pg-pool-sql-client.js";
import { PostgresCleanPersistence } from "../adapters/persistence/postgres-clean-persistence.js";
import { AtomicCleanConversationStore } from "../adapters/persistence/atomic-conversation-store.js";
import { SystemClock } from "../core/persistence/contracts.js";
import { createEmptyCleanState } from "../core/types/state.js";
import { CleanOpenAiInterpreterTransport } from "../adapters/interpreter/clean-openai-interpreter-transport.js";
import { StableInterpreterAdapter } from "../adapters/interpreter/stable-interpreter-adapter.js";
import { GatedCleanInterpreter } from "../adapters/interpreter/gated-interpreter.js";
import { CleanController } from "../core/controller/controller.js";
import { CleanDecisionPolicy } from "../core/policy/decision-policy.js";
import { CleanStateReducer } from "../core/state/reducer.js";
import { CleanResponsePlanner } from "../core/response/response-planner.js";
import { CleanCapabilityAuthorizer } from "../core/authorization/capability-authorizer.js";
import { CLEAN_CAPABILITY_CATALOG } from "../core/authorization/capability-catalog.js";
import { operationCancel, operationConfirm, operationCorrect, operationPrepare } from "../core/kernel/operational-kernel.js";
import { GuardedHttpTransport } from "../adapters/services/guarded-http-transport.js";
import { GuardedWaraAdapter } from "../adapters/services/guarded-wara-adapter.js";
import { GuardedOdooHandoffAdapter } from "../adapters/services/guarded-odoo-handoff-adapter.js";
import { WaraEntityResolver } from "../adapters/services/wara-entity-resolver.js";
import { CleanOperationalCapabilityExecutor } from "../adapters/services/clean-capability-executor.js";
import { createJsonServiceTransport, OpenAiFactsOnlyComposerTransport, unavailableServiceTransport } from "../adapters/http/json-http-transports.js";
import { FactsOnlyLlmComposer } from "../adapters/composer/facts-only-composer.js";
import { VersionedKnowledgeRepository } from "../adapters/knowledge/versioned-knowledge-repository.js";
import { CLEAN_KNOWLEDGE_FIXTURES } from "../adapters/knowledge/validated-fixtures.js";
import { InMemoryCleanObservability } from "../adapters/observability/in-memory-observability.js";
import { PostgresTransactionalOutbox } from "../adapters/outbox/postgres-outbox.js";
import { GuardedOutboxWorker } from "../adapters/outbox/guarded-outbox-worker.js";
import { HttpAttachmentScanner, HttpAttachmentStorage, HttpOutboxDeliveryDispatcher } from "../adapters/http/storage-delivery-transports.js";
import { GuardedAttachmentStorageAdapter } from "../adapters/attachments/guarded-storage-adapter.js";
import { processCleanTurn } from "../core/orchestration/process-turn.js";
import { startCleanLabServer, type CleanLabServer } from "../adapters/lab/clean-lab-server.js";

export type CleanLabApplication = Readonly<{
  config: CleanLabApplicationConfig; server: CleanLabServer; outboxWorker: GuardedOutboxWorker | null;
  components: Readonly<{ capabilityCatalog: typeof CLEAN_CAPABILITY_CATALOG; kernel: Readonly<{ operationPrepare: typeof operationPrepare; operationConfirm: typeof operationConfirm; operationCorrect: typeof operationCorrect; operationCancel: typeof operationCancel }>; storage: GuardedAttachmentStorageAdapter | null }>;
  close(): Promise<void>;
}>;
function serviceTransport(baseUrl: string | null, headers: Readonly<Record<string, string>>) { return baseUrl ? createJsonServiceTransport({ baseUrl, headers }) : unavailableServiceTransport(); }

export async function startCleanLabApplication(env: NodeJS.ProcessEnv = process.env): Promise<CleanLabApplication> {
  const config = loadCleanLabApplicationConfig(env); const clock = new SystemClock(); const health = sanitizedCleanHealthConfig(config.runtime);
  if (!config.runtime.runtimeEnabled) {
    const server = await startCleanLabServer({ host: config.host, port: config.port, apiKey: config.apiKey, allowedTenants: config.allowedTenants, requestsPerMinute: config.requestsPerMinute, commit: config.commit, health, persistence: "unavailable", kb: config.runtime.kbEnabled ? "unavailable" : "disabled" }, { turn: async () => { throw new Error("CLEAN_RUNTIME_DISABLED"); } }, { get: async () => null });
    return { config, server, outboxWorker: null, components: { capabilityCatalog: CLEAN_CAPABILITY_CATALOG, kernel: { operationPrepare, operationConfirm, operationCorrect, operationCancel }, storage: null }, close: () => server.close() };
  }
  const sql = new PgPoolSqlClient({ connectionString: config.databaseUrl!, statementTimeoutMs: config.statementTimeoutMs, connectionTimeoutMs: config.connectionTimeoutMs });
  if (!await sql.healthCheck()) { await sql.close(); throw new Error("CLEAN_STARTUP_DATABASE_UNAVAILABLE"); }
  const installed = await sql.query<{ fn: string | null }>("select to_regprocedure($1) as fn", [`${config.runtime.persistenceNamespace}.load_snapshot(text,text)`]);
  if (!installed.rows[0]?.fn) { await sql.close(); throw new Error("CLEAN_STARTUP_MIGRATION_REQUIRED"); }
  const repository = new PostgresCleanPersistence(sql, config.runtime.persistenceNamespace);
  const waraTransport = serviceTransport(config.waraBaseUrl, config.waraToken ? { authorization: `Bearer ${config.waraToken}` } : {});
  const wara = new GuardedWaraAdapter(new GuardedHttpTransport(config.runtime, waraTransport));
  const odooHeaders: Readonly<Record<string, string>> = config.odooApiKey ? { authorization: `Bearer ${config.odooApiKey}`, "x-odoo-db": config.odooDb!, "x-odoo-email": config.odooEmail! } : {};
  const odoo = new GuardedOdooHandoffAdapter(config.runtime, serviceTransport(config.odooUrl, odooHeaders));
  const knowledge = new VersionedKnowledgeRepository(config.runtime, CLEAN_KNOWLEDGE_FIXTURES);
  const observer = new InMemoryCleanObservability(clock);
  const interpreter = new GatedCleanInterpreter(config.runtime, new StableInterpreterAdapter(new CleanOpenAiInterpreterTransport(env)));
  const composer = new FactsOnlyLlmComposer(config.runtime, new OpenAiFactsOnlyComposerTransport(config.openAiKey ?? "", config.openAiModel ?? ""));
  const resolver = new WaraEntityResolver(wara, config.allowedTenants);
  const executor = new CleanOperationalCapabilityExecutor(wara, odoo, knowledge, config.allowedTenants);
  const outbox = new PostgresTransactionalOutbox(sql, config.runtime.persistenceNamespace);
  const outboxWorker = new GuardedOutboxWorker(config.runtime, outbox, new HttpOutboxDeliveryDispatcher(config.deliveryUrl, config.deliveryToken), clock);
  const storage = new GuardedAttachmentStorageAdapter(config.runtime, { allowedMimeTypes: new Set(["image/jpeg", "image/png", "application/pdf"]), maxSizeBytes: 10 * 1024 * 1024 }, new HttpAttachmentScanner(config.scannerUrl), new HttpAttachmentStorage(config.storageUrl));
  const runtime = { turn: async (input: { tenantId: string; sessionId: string; messageId: string; message: string; customerName?: string | null }) => {
    const snapshot = await repository.load({ tenantId: input.tenantId, conversationId: input.sessionId }); const state = snapshot?.state.state ?? createEmptyCleanState({ tenantId: input.tenantId, conversationId: input.sessionId });
    const store = new AtomicCleanConversationStore(repository, clock, snapshot?.state.version ?? 0, input.messageId, config.runtime.deliveryEnabled);
    const result = await processCleanTurn({ tenantId: input.tenantId, conversationId: input.sessionId, message: input.message, messageId: input.messageId, customerName: input.customerName }, { contextLoader: { load: async () => state }, interpreter, controller: new CleanController(), policy: new CleanDecisionPolicy(), resolver, authorizer: new CleanCapabilityAuthorizer(), executor, reducer: new CleanStateReducer(), responsePlanner: new CleanResponsePlanner(), composer, store, observer });
    return { ...result, traceId: result.trace.traceId ?? "trace-unavailable" };
  } };
  const server = await startCleanLabServer({ host: config.host, port: config.port, apiKey: config.apiKey, allowedTenants: config.allowedTenants, requestsPerMinute: config.requestsPerMinute, commit: config.commit, health, persistence: "configured", kb: config.runtime.kbEnabled ? "configured" : "disabled" }, runtime, observer);
  return { config, server, outboxWorker, components: { capabilityCatalog: CLEAN_CAPABILITY_CATALOG, kernel: { operationPrepare, operationConfirm, operationCorrect, operationCancel }, storage }, close: async () => { await server.close(); await repository.close(); } };
}
