export type KnowledgeScope = Readonly<{ tenantId: string; companyId?: string | null; domain: string }>;
export type KnowledgePassage = Readonly<{ id: string; source: string; version: string; text: string }>;
export type KnowledgeResult = Readonly<{
  status: "found" | "not_found" | "backend_error";
  passages: readonly KnowledgePassage[];
}>;
export type KnowledgeDocument = KnowledgePassage & Readonly<{
  scope: "global" | "tenant" | "company" | "domain"; tenantId?: string; companyId?: string; domain?: string;
  humanValidated: boolean;
}>;
export interface KnowledgeRepository { retrieve(input: Readonly<{ scope: KnowledgeScope; topicId: string; limit?: number }>): Promise<KnowledgeResult>; }
export interface KnowledgeExtractor { extract(input: Readonly<{ sourceId: string; version: string; content: Uint8Array }>): Promise<readonly KnowledgePassage[]>; }
