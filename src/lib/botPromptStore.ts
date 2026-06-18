import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import {
  BOT_PROMPT_MODULES,
  buildModulePlaceholder,
  getBotPromptModuleDef,
  type BotPromptModuleDef,
} from "@/lib/botPromptModules";

const SCRIPTS_DIR = path.join(process.cwd(), "scripts");

function readDefaultFromFile(def: BotPromptModuleDef): string | null {
  if (!def.defaultFile) return null;
  const filePath = path.join(SCRIPTS_DIR, def.defaultFile);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function resolveSeedContent(def: BotPromptModuleDef): string {
  return readDefaultFromFile(def) ?? buildModulePlaceholder(def);
}

function writeDefaultFile(def: BotPromptModuleDef, content: string) {
  if (!def.defaultFile) return;
  const filePath = path.join(SCRIPTS_DIR, def.defaultFile);
  writeFileSync(filePath, content, "utf8");
}

export type BotPromptModuleView = {
  key: string;
  name: string;
  description: string;
  flowLabel: string;
  content: string;
  sortOrder: number;
  builderbotFlowId: string | null;
  builderbotAnswerId: string | null;
  syncScriptKey: string | null;
  hasDefaultFile: boolean;
  updatedAt: string;
  seededFrom: "database" | "file" | "placeholder";
};

function toView(
  def: BotPromptModuleDef,
  row: { content: string; updatedAt: Date },
  seededFrom: BotPromptModuleView["seededFrom"]
): BotPromptModuleView {
  return {
    key: def.key,
    name: def.name,
    description: def.description,
    flowLabel: def.flowLabel,
    content: row.content,
    sortOrder: def.sortOrder,
    builderbotFlowId: def.builderbotFlowId ?? null,
    builderbotAnswerId: def.builderbotAnswerId ?? null,
    syncScriptKey: def.syncScriptKey ?? null,
    hasDefaultFile: !!def.defaultFile,
    updatedAt: row.updatedAt.toISOString(),
    seededFrom,
  };
}

async function ensureModule(def: BotPromptModuleDef): Promise<BotPromptModuleView> {
  const existing = await prisma.botPromptModule.findUnique({ where: { key: def.key } });
  if (existing) {
    return toView(def, existing, "database");
  }

  const content = resolveSeedContent(def);
  const created = await prisma.botPromptModule.create({
    data: {
      key: def.key,
      name: def.name,
      description: def.description,
      flowLabel: def.flowLabel,
      content,
      sortOrder: def.sortOrder,
      builderbotFlowId: def.builderbotFlowId,
      builderbotAnswerId: def.builderbotAnswerId,
    },
  });

  const seededFrom: BotPromptModuleView["seededFrom"] = readDefaultFromFile(def)
    ? "file"
    : "placeholder";
  return toView(def, created, seededFrom);
}

export async function listBotPromptModules(): Promise<BotPromptModuleView[]> {
  const views: BotPromptModuleView[] = [];
  for (const def of BOT_PROMPT_MODULES) {
    views.push(await ensureModule(def));
  }
  return views.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getBotPromptModule(key: string): Promise<BotPromptModuleView | null> {
  const def = getBotPromptModuleDef(key);
  if (!def) return null;
  return ensureModule(def);
}

export async function saveBotPromptModule(
  key: string,
  content: string
): Promise<BotPromptModuleView | null> {
  const def = getBotPromptModuleDef(key);
  if (!def) return null;

  await ensureModule(def);

  const updated = await prisma.botPromptModule.update({
    where: { key },
    data: { content },
  });

  writeDefaultFile(def, content);

  return toView(def, updated, "database");
}
