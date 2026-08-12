/**
 * Composición del runtime V2 local (Fase 6).
 * PostgreSQL = autoridad; FakeModel; simulador HTTP local.
 */
import { randomUUID, createHash } from "node:crypto";
import {
  createWaraV2Prisma,
  type PrismaClient,
  V2_MUTATIONS_DISABLED,
} from "@wara-v2/db";
import {
  OperationDomainService,
  PrismaUnitOfWork,
} from "@wara-v2/domain";
import {
  TurnPipeline,
  FakeModelAdapter,
  PrismaLockPort,
  PrismaIngressPort,
  PrismaTurnStore,
  PrismaOutboxPort,
  PrismaOperationPort,
  type TurnPipelineInput,
  type TurnPipelineResult,
  type ModelAdapter,
} from "@wara-v2/orchestrator";
import {
  OutboxDispatcher,
  EffectReconciler,
  startLocalSimulator,
  type LocalSimulator,
  ALLOW_EXTERNAL_MUTATIONS,
  GUARANTEES,
} from "@wara-v2/executors";

export type V2Runtime = {
  prisma: PrismaClient;
  simulator: LocalSimulator;
  pipeline: TurnPipeline;
  locks: PrismaLockPort;
  ownerId: string;
  close: () => Promise<void>;
  ensureConversation: (input: {
    phoneE164: string;
    companyId: string;
    unitId?: string;
    conversationId?: string;
    customerId?: string;
  }) => Promise<{
    customerId: string;
    conversationId: string;
  }>;
  handleInbound: (input: {
    conversationId: string;
    customerId: string;
    companyId: string;
    unitId?: string | null;
    text: string;
    messageId?: string;
    commandId?: string;
    ownerId?: string;
  }) => Promise<TurnPipelineResult>;
  dispatchOutboxOnce: (outboxId?: string, scenario?: string) => Promise<unknown>;
  reconcileOnce: (operationId: string) => Promise<unknown>;
};

export async function createV2Runtime(opts?: {
  databaseUrl?: string;
  model?: ModelAdapter;
  ownerId?: string;
}): Promise<V2Runtime> {
  if (V2_MUTATIONS_DISABLED !== true) {
    throw new Error("V2_MUTATIONS_DISABLED must be true");
  }
  if (ALLOW_EXTERNAL_MUTATIONS !== false) {
    throw new Error("ALLOW_EXTERNAL_MUTATIONS must be false");
  }
  if (GUARANTEES.allowExternalEffectReal !== false) {
    throw new Error("real external effects forbidden");
  }

  const url = opts?.databaseUrl ?? process.env.WARA_V2_DATABASE_URL;
  if (!url) throw new Error("WARA_V2_DATABASE_URL required");

  const prisma = createWaraV2Prisma(url);
  const simulator = await startLocalSimulator();
  const ports = new Set([simulator.port]);
  const ownerId = opts?.ownerId ?? `rt_${randomUUID().slice(0, 8)}`;

  const domain = new OperationDomainService(new PrismaUnitOfWork(prisma));
  const locks = new PrismaLockPort(prisma);
  const ingress = new PrismaIngressPort(prisma);
  const turns = new PrismaTurnStore(prisma);
  const outbox = new PrismaOutboxPort(prisma);
  const operations = new PrismaOperationPort(prisma);
  const model = opts?.model ?? new FakeModelAdapter();

  const pipeline = new TurnPipeline({
    model,
    turns,
    locks,
    ingress,
    outbox,
    operations,
    domain,
    mutationsDisabled: true,
    effectRuntime: {
      prisma,
      simulatorUrl: simulator.baseUrl,
      allowedPorts: ports,
    },
  });

  return {
    prisma,
    simulator,
    pipeline,
    locks,
    ownerId,
    async close() {
      await simulator.close();
      await prisma.$disconnect();
    },
    async ensureConversation(input) {
      const phoneE164 = input.phoneE164;
      let customer = await prisma.customer.findUnique({ where: { phoneE164 } });
      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            id: input.customerId ?? randomUUID(),
            phoneE164,
          },
        });
      }
      const simTenantId = input.companyId ?? "tenant_simulator";
      let conversation = await prisma.conversation.findUnique({
        where: {
          customerId_channel_channelAccountId_tenantId: {
            customerId: customer.id,
            channel: "simulator",
            channelAccountId: "sim_local",
            tenantId: simTenantId,
          },
        },
      });
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            id: input.conversationId ?? randomUUID(),
            customerId: customer.id,
            tenantId: simTenantId,
            channel: "simulator",
            channelAccountId: "sim_local",
            activeCompanyId: input.companyId,
          },
        });
      } else if (input.companyId) {
        conversation = await prisma.conversation.update({
          where: { id: conversation.id },
          data: { activeCompanyId: input.companyId },
        });
      }
      await prisma.conversationState.upsert({
        where: { conversationId: conversation.id },
        create: { conversationId: conversation.id },
        update: {},
      });
      return { customerId: customer.id, conversationId: conversation.id };
    },
    async handleInbound(input) {
      const messageId = input.messageId ?? randomUUID();
      const commandId = input.commandId ?? randomUUID();
      const text = input.text;
      const payloadHash = createHash("sha256")
        .update(JSON.stringify({ text }))
        .digest("hex");

      try {
        await prisma.message.create({
          data: {
            id: messageId,
            conversationId: input.conversationId,
            direction: "inbound",
            provider: "simulator",
            channelAccountId: "sim_local",
            externalMessageId: messageId,
            payloadHash,
            bodyText: text,
            receivedAt: new Date(),
          },
        });
      } catch {
        /* concurrent create same id — ok */
      }

      const turnInput: TurnPipelineInput = {
        commandId,
        ownerId: input.ownerId ?? ownerId,
        executionMode: "dry_run",
        conversation: {
          conversationId: input.conversationId,
          customerId: input.customerId,
          activeCompanyId: input.companyId,
          activeUnitId: input.unitId ?? "unit_1",
          channel: "simulator",
          channelAccountId: "sim_local",
          membershipCompanyIds: [input.companyId],
        },
        inbound: {
          messageId,
          provider: "simulator",
          channelAccountId: "sim_local",
          conversationKey: input.conversationId,
          channel: "simulator",
          customerPhoneE164: "+5491100000000",
          text,
          receivedAt: new Date().toISOString(),
          payloadHash,
        },
      };
      return pipeline.handle(turnInput);
    },
    async dispatchOutboxOnce(outboxId, scenario = "success") {
      const d = new OutboxDispatcher(prisma, {
        ownerId,
        simulatorUrl: simulator.baseUrl,
        allowedPorts: ports,
        scenario: scenario as "success",
      });
      return d.dispatchOnce(outboxId);
    },
    async reconcileOnce(operationId) {
      const r = new EffectReconciler(prisma, {
        origin: simulator.origin,
        allowedPorts: ports,
        ownerId,
      });
      return r.reconcileOperation(operationId);
    },
  };
}

export type WorkerHandle = {
  stop: () => Promise<void>;
  ticks: () => number;
};

/** Worker de turnos: procesa callbacks inyectados (cola local en memoria durable-backed). */
export function startTurnWorker(
  runtime: V2Runtime,
  poll: () => Promise<null | Parameters<V2Runtime["handleInbound"]>[0]>,
  opts?: { intervalMs?: number },
): WorkerHandle {
  let stopped = false;
  let ticks = 0;
  const intervalMs = opts?.intervalMs ?? 50;
  const loop = (async () => {
    while (!stopped) {
      const job = await poll();
      if (job) {
        ticks += 1;
        await runtime.handleInbound(job);
      } else {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  })();
  return {
    ticks: () => ticks,
    async stop() {
      stopped = true;
      await loop;
    },
  };
}

export function startOutboxWorker(
  runtime: V2Runtime,
  opts?: { intervalMs?: number; scenario?: string },
): WorkerHandle {
  let stopped = false;
  let ticks = 0;
  const intervalMs = opts?.intervalMs ?? 50;
  const loop = (async () => {
    while (!stopped) {
      ticks += 1;
      await runtime.dispatchOutboxOnce(undefined, opts?.scenario ?? "success");
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return {
    ticks: () => ticks,
    async stop() {
      stopped = true;
      await loop;
    },
  };
}

export function startReconcileWorker(
  runtime: V2Runtime,
  opts?: { intervalMs?: number },
): WorkerHandle {
  let stopped = false;
  let ticks = 0;
  const intervalMs = opts?.intervalMs ?? 100;
  const loop = (async () => {
    while (!stopped) {
      ticks += 1;
      const pending = await runtime.prisma.operation.findMany({
        where: { status: "unknown_outcome" },
        take: 5,
      });
      for (const op of pending) {
        try {
          await runtime.reconcileOnce(op.id);
        } catch {
          /* still ambiguous */
        }
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return {
    ticks: () => ticks,
    async stop() {
      stopped = true;
      await loop;
    },
  };
}
