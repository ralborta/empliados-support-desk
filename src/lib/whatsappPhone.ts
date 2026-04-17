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
 * Busca Customer por teléfono canónico; si en DB hay un formato viejo (JID, +, espacios),
 * lo encuentra por comparación numérica y opcionalmente actualiza `phone` al valor normalizado.
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
