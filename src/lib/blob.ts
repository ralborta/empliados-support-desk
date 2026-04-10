import { put } from "@vercel/blob";

/**
 * Descarga una imagen temporal de BuilderBot y la sube a Vercel Blob Storage
 * @param tempUrl URL temporal de BuilderBot
 * @param filename Nombre del archivo (opcional)
 * @returns URL permanente en Vercel Blob
 */
export async function uploadToBlob(tempUrl: string, filename?: string): Promise<string> {
  try {
    console.log(`📥 Descargando imagen temporal: ${tempUrl}`);

    // Verificar que el token esté disponible
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      console.warn(`⚠️ BLOB_READ_WRITE_TOKEN no está configurado. Usando URL temporal.`);
      return tempUrl;
    }

    // Descargar la imagen de BuilderBot
    const response = await fetch(tempUrl);
    if (!response.ok) {
      throw new Error(`Error al descargar imagen: ${response.status}`);
    }

    const blob = await response.blob();
    const contentType = response.headers.get("content-type") || "image/jpeg";

    // Generar nombre único si no se proporciona
    const finalFilename = filename || `attachment-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    console.log(`📤 Subiendo a Vercel Blob: ${finalFilename} (${contentType})`);

    // Subir a Vercel Blob
    const { url } = await put(finalFilename, blob, {
      access: "public",
      contentType,
    });

    console.log(`✅ Imagen subida a Blob: ${url}`);
    
    // Validar que la URL sea absoluta
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      console.error(`❌ URL de Blob no es absoluta: ${url}`);
      throw new Error("URL de Blob no es absoluta");
    }
    
    return url;
  } catch (error: any) {
    console.error(`❌ Error al subir a Blob:`, error.message);
    console.error(`❌ Stack:`, error.stack);
    
    // Si la URL temporal es absoluta, usarla como fallback
    if (tempUrl && (tempUrl.startsWith("http://") || tempUrl.startsWith("https://"))) {
      console.warn(`⚠️ Usando URL temporal como fallback: ${tempUrl}`);
      return tempUrl;
    }
    
    // Si no es absoluta, lanzar error para que no se guarde una ruta relativa
    throw new Error(`URL temporal no es absoluta y Blob falló: ${tempUrl}`);
  }
}

/**
 * Extrae la extensión del archivo desde la URL
 */
export function getFileExtension(url: string): string {
  const match = url.match(/\.([a-z0-9]+)(\?|$)/i);
  return match ? match[1] : "jpg";
}

/**
 * Sube un File (FormData) a Vercel Blob y devuelve URL pública.
 */
export async function uploadFileToBlob(file: File): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN no configurado. No se pueden subir adjuntos.");
  }

  const safeName = (file.name || "archivo").replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `ticket-${Date.now()}-${safeName}`;
  const contentType = file.type || "application/octet-stream";
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { url } = await put(filename, buffer, {
    access: "public",
    contentType,
  });

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("URL de Blob no es absoluta");
  }
  return url;
}
