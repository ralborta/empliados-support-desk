/**
 * Cliente HTTP hacia simulador local — redirects OFF, allowlist obligatoria.
 */
import {
  assertLocalSimulatorUrl,
  isRedirectForbidden,
} from "../allowlist.js";
import type { SimScenario } from "./local-server.js";
import type { SimulatorHttpPhase } from "../classification.js";

export type SimulatorClientResult = {
  ok: boolean;
  httpStatus: number | null;
  body: unknown;
  bodyOk: boolean;
  errorCode: string | null;
  requestLikelySent: boolean;
  phase: SimulatorHttpPhase;
  externalId?: string;
};

export async function postToLocalSimulator(input: {
  url: string;
  allowedPorts: ReadonlySet<number>;
  idempotencyKey: string;
  body: Record<string, unknown>;
  scenario?: SimScenario;
  timeoutMs?: number;
}): Promise<SimulatorClientResult> {
  void isRedirectForbidden();
  const allow = assertLocalSimulatorUrl(input.url, input.allowedPorts);
  if (!allow.ok) {
    return {
      ok: false,
      httpStatus: null,
      body: null,
      bodyOk: false,
      errorCode: `ALLOWLIST:${allow.reason}`,
      requestLikelySent: false,
      phase: "before_connect",
    };
  }

  const timeoutMs = input.timeoutMs ?? 800;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let requestLikelySent = false;
  let phase: SimulatorHttpPhase = "before_connect";

  try {
    phase = "connected_before_write";
    const res = await fetch(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
        ...(input.scenario ? { "x-sim-scenario": input.scenario } : {}),
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
      redirect: "error", // never follow redirects
    });
    requestLikelySent = true;
    phase = "response_received";

    const text = await res.text();
    let body: unknown = null;
    let bodyOk = false;
    try {
      body = JSON.parse(text);
      bodyOk = true;
    } catch {
      return {
        ok: false,
        httpStatus: res.status,
        body: text.slice(0, 200),
        bodyOk: false,
        errorCode: "MALFORMED_RESPONSE",
        requestLikelySent: true,
        phase,
      };
    }

    const externalId =
      body && typeof body === "object" && "externalId" in body
        ? String((body as { externalId: unknown }).externalId)
        : undefined;

    return {
      ok: res.ok,
      httpStatus: res.status,
      body,
      bodyOk,
      errorCode: null,
      requestLikelySent: true,
      phase,
      externalId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (controller.signal.aborted || /abort/i.test(msg)) {
      return {
        ok: false,
        httpStatus: null,
        body: null,
        bodyOk: false,
        errorCode: "TIMEOUT",
        requestLikelySent,
        phase: requestLikelySent ? "after_request_written" : phase,
      };
    }
    if (/ECONNRESET|socket|fetch failed/i.test(msg)) {
      return {
        ok: false,
        httpStatus: null,
        body: null,
        bodyOk: false,
        errorCode: requestLikelySent
          ? "CONNECTION_RESET_AFTER_WRITE"
          : "RETRYABLE",
        requestLikelySent,
        phase: requestLikelySent ? "after_request_written" : phase,
      };
    }
    return {
      ok: false,
      httpStatus: null,
      body: null,
      bodyOk: false,
      errorCode: "RETRYABLE",
      requestLikelySent,
      phase,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function reconcileLocalSimulator(input: {
  origin: string;
  allowedPorts: ReadonlySet<number>;
  idempotencyKey: string;
  timeoutMs?: number;
}): Promise<"applied" | "absent" | "ambiguous"> {
  const url = `${input.origin}/reconcile?idempotencyKey=${encodeURIComponent(input.idempotencyKey)}`;
  const allow = assertLocalSimulatorUrl(url, input.allowedPorts);
  if (!allow.ok) return "ambiguous";

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(input.timeoutMs ?? 800),
    });
    if (res.status === 404) return "absent";
    if (res.status === 200) {
      const body = (await res.json()) as { status?: string };
      if (body.status === "applied") return "applied";
      if (body.status === "absent") return "absent";
    }
    return "ambiguous";
  } catch {
    return "ambiguous";
  }
}
