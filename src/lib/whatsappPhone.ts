import type { Customer, PrismaClient } from "@prisma/client";

/**
 * Unifica el identificador de WhatsApp a solo dígitos (sin @s.whatsapp.net, espacios, +).
 * Mismo contacto físico → mismo valor; evita filas duplicadas de Customer por formato distinto.
 */
export function normalizeWhatsAppPhone(raw: string): string {
  let s = String(raw ?? "").trim();
  if (s.includes("@")) {
    s = s.split("@")[0] ?? s;
  }
  return s.replace(/\D/g, "");
}

/**
 * True si el remitente NO es una persona/cliente real: canales (newsletter),
 * listas de difusión, grupos, estados, o IDs imposibles para un número telefónico.
 *
 * Estos remitentes (p. ej. `120363169271016023@newsletter`, `status@broadcast`,
 * `...@g.us`) deben IGNORARSE por completo: el bot no debe responderlos ni derivarlos.
 * Un número E.164 válido tiene como máximo 15 dígitos; los IDs de canal/grupo
 * son mucho más largos.
 */
export function isNonHumanWhatsAppSender(raw: string): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return false;
  if (
    s.includes("@newsletter") ||
    s.includes("@broadcast") ||
    s.includes("@g.us") ||
    s.includes("status@") ||
    s.includes("@lid")
  ) {
    return true;
  }
  // ID puramente numérico pero demasiado largo para ser un teléfono real.
  const digits = s.replace(/\D/g, "");
  if (digits.length > 15) return true;
  return false;
}

/**
 * Busca Customer por teléfono canónico; si en DB hay un formato viejo (JID, +, espacios),
 * lo encuentra por comparación numérica y opcionalmente actualiza `phone` al valor normalizado.
 *
 * **Puede crear** una fila `Customer` si no existe. El producto de soporte (WhatsApp / tickets)
 * no debe usar esta función para altas: solo `findCustomerByWhatsAppNumber` + alta en panel/import.
 */
export async function resolveCustomerByWhatsAppNumber(
  prisma: PrismaClient,
  rawFrom: string,
  opts?: { name?: string }
): Promise<Customer> {
  const normalized = normalizeWhatsAppPhone(rawFrom);
  if (normalized.length < 8) {
    throw new Error(`Teléfono WhatsApp inválido: ${rawFrom}`);
  }

  const byCanonical = await prisma.customer.findUnique({
    where: { phone: normalized },
  });
  if (byCanonical) {
    if (opts?.name != null) {
      return prisma.customer.update({
        where: { id: byCanonical.id },
        data: { name: opts.name },
      });
    }
    return byCanonical;
  }

  const legacy = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Customer"
    WHERE regexp_replace(split_part(phone, '@', 1), '[^0-9]', '', 'g') = ${normalized}
    ORDER BY "createdAt" ASC
    LIMIT 2
  `;

  if (legacy.length === 1) {
    return prisma.customer.update({
      where: { id: legacy[0].id },
      data: {
        phone: normalized,
        ...(opts?.name != null ? { name: opts.name } : {}),
      },
    });
  }

  if (legacy.length > 1) {
    console.warn(
      `[whatsappPhone] Varias filas Customer para el mismo número (${normalized}); usando la más antigua. Convendría fusionar en DB.`
    );
    return prisma.customer.update({
      where: { id: legacy[0].id },
      data: {
        phone: normalized,
        ...(opts?.name != null ? { name: opts.name } : {}),
      },
    });
  }

  return prisma.customer.create({
    data: {
      phone: normalized,
      name: opts?.name ?? null,
    },
  });
}

/** Solo lectura + canónico: no crea fila. Usado en webhooks salientes. */
export async function findCustomerByWhatsAppNumber(
  prisma: PrismaClient,
  rawFrom: string
): Promise<Customer | null> {
  const normalized = normalizeWhatsAppPhone(rawFrom);
  if (normalized.length < 8) return null;

  const byCanonical = await prisma.customer.findUnique({
    where: { phone: normalized },
  });
  if (byCanonical) return byCanonical;

  const legacy = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Customer"
    WHERE regexp_replace(split_part(phone, '@', 1), '[^0-9]', '', 'g') = ${normalized}
    ORDER BY "createdAt" ASC
    LIMIT 1
  `;
  if (!legacy[0]) return null;

  return prisma.customer.update({
    where: { id: legacy[0].id },
    data: { phone: normalized },
  });
}
