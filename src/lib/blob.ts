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

    // Descargar la imagen de BuilderBot
    const response = await fetch(tempUrl);
    if (!response.ok) {
      throw new Error(`Error al descargar imagen: ${response.status}`);
    }

    const blob = await response.blob();
    const contentType = response.headers.get("content-type") || "image/jpeg";

    // Generar nombre único si no se proporciona
    const finalFilename = filename || `attachment-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Subir a Vercel Blob
    const { url } = await put(finalFilename, blob, {
      access: "public",
      contentType,
    });

    console.log(`✅ Imagen subida a Blob: ${url}`);
    return url;
  } catch (error: any) {
    console.error(`❌ Error al subir a Blob:`, error.message);
    // Si falla, devolver la URL original como fallback
    return tempUrl;
  }
}

/**
 * Extrae la extensión del archivo desde la URL
 */
export function getFileExtension(url: string): string {
  const match = url.match(/\.([a-z0-9]+)(\?|$)/i);
  return match ? match[1] : "jpg";
}
