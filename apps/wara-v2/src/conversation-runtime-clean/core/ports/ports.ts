import type { TurnDecision, ResolutionRequest } from "../types/decision.js";
import type { TurnInterpretation } from "../types/interpretation.js";
import type { AuthorizationResult, AuthorizedOperation, OperationExecutionResult } from "../types/operation.js";
import type { PolicyInput, PolicyResult } from "../types/policy.js";
import type { ResolutionResult } from "../types/resolution.js";
import type { ComposerInput, ResponsePlan } from "../types/response.js";
import type { ConversationStateClean } from "../types/state.js";
export interface ContextLoader { load(input: { tenantId: string; conversationId: string }): Promise<ConversationStateClean>; }
export interface Interpreter { interpret(input: { message: string; state: ConversationStateClean }): Promise<TurnInterpretation | null>; }
export interface Controller { decide(input: { interpretation: TurnInterpretation; state: ConversationStateClean }): TurnDecision; }
export interface DecisionPolicy { evaluate(input: PolicyInput): PolicyResult; }
export interface EntityResolver { resolve(requests: readonly ResolutionRequest[], state: ConversationStateClean): Promise<readonly ResolutionResult[]>; }
export interface CapabilityAuthorizer { authorize(input: { decision: TurnDecision; state: ConversationStateClean; resolutions: readonly ResolutionResult[] }): AuthorizationResult; }
export interface CapabilityExecutor { execute(operations: readonly AuthorizedOperation[], state: ConversationStateClean): Promise<readonly OperationExecutionResult[]>; }
export interface StateReducer { reduce(input: { previousState: ConversationStateClean; decision: TurnDecision; policy: PolicyResult; resolutions: readonly ResolutionResult[]; executions: readonly OperationExecutionResult[]; messageId?: string }): ConversationStateClean; }
export interface ResponsePlanner { plan(input: { decision: TurnDecision; policy: PolicyResult; previousState: ConversationStateClean; nextState: ConversationStateClean; resolutions: readonly ResolutionResult[]; executions: readonly OperationExecutionResult[] }): ResponsePlan; }
export interface Composer { compose(input: ComposerInput): Promise<string>; }
export type ConversationSaveContext = Readonly<{ messageId?: string; reply?: string; traceId?: string | null }>;
export interface ConversationStore { save(state: ConversationStateClean, context?: ConversationSaveContext): Promise<void>; }
