/**
 * Precedencia Policy (contratos §4.3 / modelo §5):
 * human → cancel → correct/switch → provide_data → ask_question →
 * new_request → confirm/reject → chitchat/unclear
 */
import type { UserActType } from "@wara-v2/contracts";

const RANK: Record<UserActType, number> = {
  request_human: 100,
  cancel_all: 90,
  cancel_partial: 89,
  correct: 80,
  switch_company: 79,
  switch_unit: 78,
  provide_data: 70,
  ask_question: 60,
  new_request: 50,
  confirm: 40,
  reject: 39,
  chitchat: 20,
  unclear: 10,
};

export function actPrecedence(type: UserActType): number {
  return RANK[type] ?? 0;
}

export function compareActsByPrecedence(
  a: { type: UserActType; order: number; priority: number },
  b: { type: UserActType; order: number; priority: number },
): number {
  const d = actPrecedence(b.type) - actPrecedence(a.type);
  if (d !== 0) return d;
  const p = b.priority - a.priority;
  if (p !== 0) return p;
  return a.order - b.order;
}
