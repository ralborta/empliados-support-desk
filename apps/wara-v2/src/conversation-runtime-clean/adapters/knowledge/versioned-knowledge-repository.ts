import type { CleanRuntimeConfig } from "../../config/clean-config.js";
import type { KnowledgeDocument, KnowledgeRepository, KnowledgeResult } from "../../core/knowledge/contracts.js";

function visible(document: KnowledgeDocument, tenantId: string, companyId: string | null | undefined, domain: string): boolean {
  if (!document.humanValidated) return false;
  if (document.scope === "global") return true;
  if (document.scope === "tenant") return document.tenantId === tenantId;
  if (document.scope === "company") return document.tenantId === tenantId && document.companyId === companyId;
  return document.domain === domain && (!document.tenantId || document.tenantId === tenantId);
}

export class VersionedKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly config: CleanRuntimeConfig, private readonly documents: readonly KnowledgeDocument[]) {}
  async retrieve(input: Parameters<KnowledgeRepository["retrieve"]>[0]): Promise<KnowledgeResult> {
    if (!this.config.runtimeEnabled || !this.config.kbEnabled) return { status: "not_found", passages: [] };
    const passages = this.documents
      .filter((document) => document.id === input.topicId && visible(document, input.scope.tenantId, input.scope.companyId, input.scope.domain))
      .sort((a, b) => a.scope.localeCompare(b.scope) || b.version.localeCompare(a.version) || a.source.localeCompare(b.source))
      .slice(0, Math.max(1, Math.min(input.limit ?? 5, 10)))
      .map(({ id, source, version, text }) => ({ id, source, version, text }));
    return passages.length ? { status: "found", passages } : { status: "not_found", passages: [] };
  }
}
