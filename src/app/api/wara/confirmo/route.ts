import { NextRequest, NextResponse } from "next/server";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";

type ConfirmBody = {
  confirm?: string;
  body?: string;
  api_key?: string;
  apiKey?: string;
  key?: string;
  token?: string;
};

function pickSecret(req: NextRequest, body: ConfirmBody): string | undefined {
  return (
    req.headers.get("x-api-key")?.trim() ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    body.api_key?.trim() ||
    body.apiKey?.trim() ||
    body.key?.trim() ||
    body.token?.trim()
  );
}

function isConfirmo(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  return /^confirmo$/i.test(value.trim());
}

const BB_STATUS = 200;

export async function POST(req: NextRequest) {
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        confirmed: false,
        confirmed_s: "false",
        error: "BUILDERBOT_CONTEXT_API_KEY/PULZE_API_KEY no configurado",
      },
      { status: BB_STATUS }
    );
  }

  const body = (await req.json().catch(() => ({}))) as ConfirmBody;
  if (!validateContextSecret(pickSecret(req, body))) {
    return NextResponse.json(
      {
        ok: false,
        confirmed: false,
        confirmed_s: "false",
        error: "API key inválida o faltante",
      },
      { status: BB_STATUS }
    );
  }

  const raw = (body.confirm ?? body.body ?? "").trim();
  const confirmed = isConfirmo(raw);
  return NextResponse.json(
    {
      ok: true,
      confirmed,
      confirmed_s: confirmed ? "true" : "false",
      input: raw,
    },
    { status: BB_STATUS }
  );
}
