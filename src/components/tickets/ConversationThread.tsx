"use client";

import { User, Lock } from "lucide-react";
import { fromLabels } from "@/lib/tickets";
import { formatDateTimeAR } from "@/lib/formatDateTimeAR";
import { formatDateSeparator } from "@/lib/formatRelativeTime";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { AtilioAvatar } from "@/components/ui/AtilioAvatar";
import { MessageAttachments } from "@/components/tickets/MessageAttachments";

type Attachment = { url: string; type: string; name: string };

export type ThreadMessage = {
  id: string;
  from: string;
  text: string;
  createdAt: string;
  direction?: string;
  attachments: unknown;
};

type ThreadItem =
  | { kind: "date"; key: string; label: string }
  | { kind: "group"; key: string; from: string; isInternal: boolean; messages: ThreadMessage[] };

function buildThreadItems(messages: ThreadMessage[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  let lastDateKey = "";

  for (const msg of messages) {
    const d = new Date(msg.createdAt);
    const dateKey = d.toLocaleDateString("es-AR");
    if (dateKey !== lastDateKey) {
      items.push({ kind: "date", key: `d-${dateKey}`, label: formatDateSeparator(msg.createdAt) });
      lastDateKey = dateKey;
    }

    const isInternal = msg.direction === "INTERNAL_NOTE";
    const groupFrom = isInternal ? "__INTERNAL__" : msg.from;
    const last = items[items.length - 1];
    if (last?.kind === "group" && last.from === groupFrom) {
      last.messages.push(msg);
    } else {
      items.push({
        kind: "group",
        key: `g-${msg.id}`,
        from: groupFrom,
        isInternal,
        messages: [msg],
      });
    }
  }
  return items;
}

function bubbleClass(from: string, isInternal: boolean): string {
  if (isInternal) {
    return "bg-amber-50 text-amber-950 ring-1 ring-amber-200/80 border-l-2 border-amber-400";
  }
  if (from === "CUSTOMER") return "bg-white text-slate-800 ring-1 ring-slate-200/90";
  if (from === "BOT") return "bg-emerald-50/90 text-emerald-950 ring-1 ring-emerald-200/70";
  return "bg-[#4a0e1c]/[0.06] text-slate-900 ring-1 ring-[#4a0e1c]/10";
}

function senderLabel(from: string, isInternal: boolean): string {
  if (isInternal) return "Nota interna";
  return fromLabels[from as "CUSTOMER" | "BOT" | "HUMAN"] || from;
}

export function ConversationThread({ messages }: { messages: ThreadMessage[] }) {
  if (messages.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin mensajes aún.</p>;
  }

  const items = buildThreadItems(messages);

  return (
    <div className="space-y-3">
      {items.map((item) => {
        if (item.kind === "date") {
          return (
            <div key={item.key} className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200/80" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  {item.label}
                </span>
              </div>
            </div>
          );
        }

        const { from, isInternal, messages: groupMsgs } = item;
        const label = senderLabel(from === "__INTERNAL__" ? "HUMAN" : from, isInternal);
        const first = groupMsgs[0]!;

        return (
          <div key={item.key} className="flex gap-2.5">
            <div className="mt-0.5 shrink-0">
              {isInternal ? (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-800">
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                </span>
              ) : from === "BOT" ? (
                <AtilioAvatar size="sm" />
              ) : from === "CUSTOMER" ? (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600">
                  <User className="h-3.5 w-3.5" aria-hidden />
                </span>
              ) : (
                <AgentAvatar name={label} size="sm" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-baseline gap-2 text-[11px] text-slate-500">
                <span className="font-semibold text-slate-700">{label}</span>
                <time dateTime={first.createdAt}>{formatDateTimeAR(first.createdAt)}</time>
              </div>
              <div className="space-y-1">
                {groupMsgs.map((msg) => (
                  <div key={msg.id}>
                    <div
                      className={`inline-block max-w-[min(100%,42rem)] rounded-2xl px-3 py-2 text-sm leading-relaxed ${bubbleClass(from === "__INTERNAL__" ? "HUMAN" : from, isInternal)}`}
                    >
                      {msg.text || "[Sin texto]"}
                    </div>
                    {msg.attachments ? (
                      <MessageAttachments attachments={msg.attachments as Attachment[]} />
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
