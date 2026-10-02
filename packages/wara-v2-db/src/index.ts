/**
 * Cliente Prisma V2 aislado (output generado en src/generated/client).
 * Nunca usar DATABASE_URL de V1/prod — solo WARA_V2_DATABASE_URL.
 */
import { PrismaClient } from "./generated/client/index.js";

export { Prisma, PrismaClient } from "./generated/client/index.js";
export type * from "./generated/client/index.js";

const globalForPrisma = globalThis as unknown as {
  waraV2Prisma?: PrismaClient;
};

export function createWaraV2Prisma(
  databaseUrl = process.env.WARA_V2_DATABASE_URL,
): PrismaClient {
  if (!databaseUrl) {
    throw new Error(
      "WARA_V2_DATABASE_URL is required (never reuse V1 DATABASE_URL)",
    );
  }
  if (
    process.env.DATABASE_URL &&
    databaseUrl === process.env.DATABASE_URL &&
    process.env.WARA_V2_ALLOW_SHARED_DB !== "true"
  ) {
    throw new Error(
      "Refusing to use DATABASE_URL as WARA_V2_DATABASE_URL (V1 isolation)",
    );
  }
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
}

export const waraV2Prisma =
  globalForPrisma.waraV2Prisma ??
  (process.env.WARA_V2_DATABASE_URL
    ? createWaraV2Prisma()
    : undefined);

if (process.env.NODE_ENV !== "production" && waraV2Prisma) {
  globalForPrisma.waraV2Prisma = waraV2Prisma;
}

export const V2_MUTATIONS_DISABLED = true as const;
export const V2_DEFAULT_MODE = "dry_run" as const;
