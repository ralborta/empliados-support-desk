import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import * as XLSX from "xlsx";

export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 });
    }

    // Validar que sea un archivo Excel
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
      return NextResponse.json({ error: "El archivo debe ser Excel (.xlsx o .xls)" }, { status: 400 });
    }

    // Leer el archivo Excel
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { raw: false });

    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "El archivo Excel está vacío o no tiene datos válidos" }, { status: 400 });
    }

    // Procesar cada fila
    const results = {
      created: 0,
      updated: 0,
      errors: [] as string[],
    };

    for (let i = 0; i < data.length; i++) {
      const row = data[i] as any;
      const rowNum = i + 2; // +2 porque Excel empieza en 1 y tiene header

      try {
        // Buscar teléfono y nombre (case insensitive)
        let phone = row.telefono || row.phone || row.tel || row["Teléfono"] || row["Phone"] || "";
        let name = row.nombre || row.name || row.empresa || row["Nombre"] || row["Name"] || row["Empresa"] || "";

        // Si no encuentra, intentar con la primera columna como teléfono y segunda como nombre
        if (!phone && Object.keys(row).length > 0) {
          const keys = Object.keys(row);
          phone = row[keys[0]] || "";
          name = row[keys[1]] || "";
        }

        if (!phone || phone.toString().trim() === "") {
          results.errors.push(`Fila ${rowNum}: No se encontró teléfono`);
          continue;
        }

        // Normalizar teléfono
        const normalizedPhone = phone.toString().replace(/\s|-/g, "").trim();
        const normalizedName = name ? name.toString().trim() : null;

        if (normalizedPhone.length < 5) {
          results.errors.push(`Fila ${rowNum}: Teléfono inválido: ${phone}`);
          continue;
        }

        // Upsert cliente
        await prisma.customer.upsert({
          where: { phone: normalizedPhone },
          update: {
            name: normalizedName || undefined,
          },
          create: {
            phone: normalizedPhone,
            name: normalizedName,
          },
        });

        // Verificar si fue creación o actualización
        const existing = await prisma.customer.findUnique({
          where: { phone: normalizedPhone },
        });

        if (existing && existing.createdAt.getTime() > Date.now() - 1000) {
          // Creado hace menos de 1 segundo = nuevo
          results.created++;
        } else {
          results.updated++;
        }
      } catch (error: any) {
        results.errors.push(`Fila ${rowNum}: ${error.message || "Error desconocido"}`);
      }
    }

    return NextResponse.json({
      ok: true,
      results,
      message: `Importación completada: ${results.created} creados, ${results.updated} actualizados, ${results.errors.length} errores`,
    });
  } catch (error: any) {
    console.error("Error al importar Excel:", error);
    return NextResponse.json(
      { error: "Error al procesar el archivo Excel", details: error.message },
      { status: 500 }
    );
  }
}
