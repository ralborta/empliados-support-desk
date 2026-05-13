import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";
import * as XLSX from "xlsx";

/** Lee celda comparando encabezados sin distinguir mayúsculas / espacios laterales. */
function cell(row: Record<string, unknown>, candidates: string[]): string {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const c = cand.trim().toLowerCase();
    const key = keys.find((k) => k.trim().toLowerCase() === c);
    if (key != null && row[key] != null) {
      const s = String(row[key]).trim();
      if (s) return s;
    }
  }
  return "";
}

function normalizePlate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  return t.replace(/\s+/g, " ");
}

export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
      return NextResponse.json({ error: "El archivo debe ser Excel (.xlsx o .xls)" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { raw: false });

    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "El archivo Excel está vacío o no tiene datos válidos" }, { status: 400 });
    }

    const results = {
      created: 0,
      updated: 0,
      errors: [] as string[],
    };

    for (let i = 0; i < data.length; i++) {
      const row = data[i] as Record<string, unknown>;
      const rowNum = i + 2;

      try {
        let personName = cell(row, [
          "nombre de la persona",
          "nombre persona",
          "persona",
          "nombre contacto",
        ]);
        let companyName = cell(row, [
          "nombre de la empresa",
          "empresa",
          "razón social",
          "razon social",
        ]);
        let phoneRaw = cell(row, [
          "numero de telefono",
          "número de telefono",
          "numero de teléfono",
          "número de teléfono",
          "telefono",
          "teléfono",
          "phone",
          "tel",
        ]);
        let licensePlate = cell(row, [
          "matricula/patente",
          "matrícula/patente",
          "matricula",
          "matrícula",
          "patente",
        ]);

        // Compatibilidad: columnas genéricas o orden fijo (col1 tel, col2 nombre)
        if (!phoneRaw) {
          phoneRaw = cell(row, ["telefono", "teléfono", "Teléfono", "Phone"]);
        }
        if (!personName && !companyName) {
          personName =
            cell(row, ["nombre", "name", "Nombre", "Name"]) ||
            (Object.keys(row).length > 1 ? String(row[Object.keys(row)[1]] ?? "").trim() : "");
        }
        if (!phoneRaw && Object.keys(row).length > 0) {
          phoneRaw = String(row[Object.keys(row)[0]] ?? "").trim();
        }

        if (!phoneRaw) {
          results.errors.push(`Fila ${rowNum}: No se encontró teléfono`);
          continue;
        }

        const normalizedPhone = normalizeWhatsAppPhone(phoneRaw) || phoneRaw.replace(/\s|-/g, "").trim();

        if (normalizedPhone.length < 5) {
          results.errors.push(`Fila ${rowNum}: Teléfono inválido: ${phoneRaw}`);
          continue;
        }

        const nameVal = personName.trim() || null;
        const companyVal = companyName.trim() || null;
        const plateVal = licensePlate ? normalizePlate(licensePlate) : null;

        const before = await prisma.customer.findUnique({ where: { phone: normalizedPhone } });

        await prisma.customer.upsert({
          where: { phone: normalizedPhone },
          update: {
            name: nameVal,
            companyName: companyVal,
            licensePlate: plateVal,
          },
          create: {
            phone: normalizedPhone,
            name: nameVal,
            companyName: companyVal,
            licensePlate: plateVal,
          },
        });

        if (before) {
          results.updated++;
        } else {
          results.created++;
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Error desconocido";
        results.errors.push(`Fila ${rowNum}: ${msg}`);
      }
    }

    return NextResponse.json({
      ok: true,
      results,
      message: `Importación completada: ${results.created} creados, ${results.updated} actualizados, ${results.errors.length} errores`,
    });
  } catch (error: unknown) {
    console.error("Error al importar Excel:", error);
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: "Error al procesar el archivo Excel", details: msg }, { status: 500 });
  }
}
