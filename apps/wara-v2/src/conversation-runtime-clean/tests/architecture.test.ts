import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "../core");
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []);
}
const sources = files(root).map((file) => ({ file, source: ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) }));

test("core has no imports from legacy or delivery layers", () => {
  const forbidden = ["commander-v3", "conversation-runtime-next", "/pilot/", "whatsapp", "proxy"];
  for (const { file, source } of sources) {
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        assert.equal(forbidden.some((part) => statement.moduleSpecifier.text.includes(part)), false, `${file}: ${statement.moduleSpecifier.text}`);
      }
    }
  }
});

test("post-interpreter component signatures do not accept message", () => {
  const excluded = new Set(["Interpreter", "processCleanTurn"]);
  for (const { file, source } of sources) {
    const visit = (node: ts.Node): void => {
      if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && !excluded.has(node.name?.getText(source) ?? "")) {
        for (const parameter of node.parameters) assert.notEqual(parameter.name.getText(source), "message", `${file}: ${node.name?.getText(source)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});

test("core does not reference V3 contracts or conversion helpers", () => {
  const forbiddenIdentifiers = new Set(["ConversationStateV3", "TurnPlan", "vnextToV3", "migrateV3ToVNext"]);
  for (const { file, source } of sources) {
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) assert.equal(forbiddenIdentifiers.has(node.text), false, `${file}: ${node.text}`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});

test("PolicyResult cannot carry a TurnDecision", () => {
  const policy = sources.find(({ file }) => file.endsWith("types/policy.ts"))!;
  const alias = policy.source.statements.find((statement): statement is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === "PolicyResult");
  assert.ok(alias);
  const visit = (node: ts.Node): void => {
    if (ts.isPropertySignature(node)) assert.notEqual(node.name.getText(policy.source), "decision");
    if (ts.isTypeReferenceNode(node)) assert.notEqual(node.typeName.getText(policy.source), "TurnDecision");
    ts.forEachChild(node, visit);
  };
  visit(alias.type);
});

test("lab composition and live corpus use the native Clean Interpreter, never Runtime Next", () => {
  const cleanRoot = join(root, "..");
  for (const relative of ["lab/composition-root.ts", "live/run-live-corpus.ts"]) {
    const source = readFileSync(join(cleanRoot, relative), "utf8");
    assert.equal(source.includes("conversation-runtime-next"), false, relative);
    assert.equal(source.includes("RuntimeNextStableTransport"), false, relative);
    assert.equal(source.includes("CleanOpenAiInterpreterTransport"), true, relative);
  }
});
