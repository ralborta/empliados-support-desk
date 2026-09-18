/**
 * Fase 10A — shadow canary controlado (evaluation-only).
 */
export {
  loadShadowCanaryConfig,
  applyShadowCanaryTestFlags,
  clearShadowCanaryTestFlags,
  SHADOW_FLAG,
  SHADOW_CANARY_FLAG,
  SHADOW_KILL_FLAG,
  SHADOW_ALLOWLIST_FLAG,
  SHADOW_TENANT_FLAG,
  type ShadowCanaryConfig,
  type ShadowCanaryFlags,
} from "./flags.js";
export {
  parseExactPhoneAllowlist,
  isPhoneAllowlisted,
  assertTenantAllowed,
  maskPhone,
} from "./allowlist.js";
export { prepareShadowSegment } from "./privacy.js";
export {
  processShadowCanaryCopy,
  enqueueShadowCanaryCopy,
  enqueueAndReturnImmediately,
  type ShadowCopyInput,
  type ShadowProcessResult,
} from "./enqueue.js";
export {
  hasProcessedMessage,
  loadShadowRecord,
  resetShadowStoreForTests,
  purgeExpiredRecords,
  storeStats,
  SHADOW_STORE_ROOT,
} from "./store.js";
export { evaluateShadowSegment } from "./evaluate.js";
