/**
 * MEDIA HANDLER
 * ====================================
 * Módulo especializado en la descarga y subida de archivos multimedia
 * de mensajes de WhatsApp a Supabase Storage (con fallback local).
 */

import {
  WAMessage,
  WASocket,
  downloadMediaMessage,
  proto
} from 'baileys';
import path from 'path';
import fs from 'fs';
import { supabase } from '../lib/supabase';

/**
 * Interface para definir el resultado de una operación de media
 */
export interface MediaUploadResult {
    url?: string;
    fileName?: string;
    mimeType?: string;
    success: boolean;
    error?: string;
}

/**
 * Interface para los datos del mensaje que contiene media
 */
export interface MessageMediaData {
    fileName?: string;
    mimeType?: string;
    buffer?: Buffer;
}

/**
 * Guarda un archivo localmente como fallback cuando Supabase falla.
 * Crea la carpeta /media si no existe.
 * 
 * @param buffer - Buffer del archivo a guardar
 * @param fileName - Nombre del archivo
 * @returns URL pública local del archivo guardado
 * 
 * @example
 * const url = await saveMediaLocally(buffer, "photo_123.jpg");
 * // Retorna: "http://localhost:4000/media/photo_123.jpg"
 */
async function saveMediaLocally(
    buffer: Buffer,
    fileName: string
): Promise<string> {
    // Crear directorio de media si no existe
    const mediaDir = path.join(process.cwd(), 'media');
    if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
    }

    // Guardar archivo
    const filePath = path.join(mediaDir, fileName);
    await fs.promises.writeFile(filePath, buffer);

    // Construir URL pública
    const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;
    const cleanBaseUrl = baseUrl.replace(/\/$/, ''); // Eliminar slash final si existe

    return `${cleanBaseUrl}/media/${fileName}`;
}

/**
 * Sube un archivo de media a Supabase Storage.
 * Si falla, automáticamente usa el fallback local.
 * 
 * @param instanceId - ID de la instancia de WhatsApp
 * @param buffer - Buffer del archivo
 * @param fileName - Nombre del archivo
 * @param mimeType - Tipo MIME del archivo (ej: "image/jpeg")
 * @returns URL pública del archivo (Supabase o local)
 * 
 * @example
 * const url = await uploadMediaToSupabase("instance-123", buffer, "img.jpg", "image/jpeg");
 */
export async function uploadMediaToSupabase(
    instanceId: string,
    buffer: Buffer,
    fileName: string,
    mimeType: string
): Promise<string | undefined> {
    try {
        // ──────────────────────────────────────
        // 📤 PASO 1: Intentar subir a Supabase
        // ──────────────────────────────────────

        const date = new Date();
        const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        // Estructura de carpetas: instanceId/año-mes/archivo.ext
        const filePath = `${instanceId}/${yearMonth}/${fileName}`;

        const { data, error } = await supabase.storage
            .from('whatsapp-media')
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: false, // No sobrescribir si ya existe
            });

        // Si la subida fue exitosa, obtener URL pública
        if (!error && data) {
            const { data: urlData } = supabase.storage
                .from('whatsapp-media')
                .getPublicUrl(filePath);

            if (urlData.publicUrl) {
                console.log(`✅ Media uploaded to Supabase: ${filePath}`);
                return urlData.publicUrl;
            }
        }

        // Si llegamos aquí, Supabase falló
        console.warn(`⚠️ Supabase upload failed for ${fileName}, using local fallback.`, error);

    } catch (error) {
        console.error('❌ Error in uploadMediaToSupabase:', error);
    }

    // ──────────────────────────────────────
    // 💾 PASO 2: Fallback - Guardar localmente
    // ──────────────────────────────────────

    try {
        const localUrl = await saveMediaLocally(buffer, fileName);
        console.log(`✅ Media saved locally: ${fileName}`);
        return localUrl;
    } catch (localError) {
        console.error('❌ Error saving media locally:', localError);
        return undefined;
    }
}

/**
 * Descarga y procesa archivos multimedia de un mensaje de WhatsApp.
 * Detecta automáticamente el tipo de media y extrae metadata.
 * 
 * @param msg - Mensaje de Baileys
 * @param messageType - Tipo de mensaje detectado ("image", "video", etc.)
 * @param instanceId - ID de la instancia
 * @returns Objeto con URL de la media y metadata
 * 
 * @example
 * const media = await downloadAndUploadMedia(msg, "image", "instance-123");
 * console.log(media.url); // URL pública de la imagen
 */
export async function downloadAndUploadMedia(
    msg: any,
    messageType: string,
    instanceId: string
): Promise<MediaUploadResult> {
    try {
        const content = msg.message;
        let fileName: string | undefined;
        let mimeType: string | undefined;
        let mediaUrl: string | undefined;

        // ──────────────────────────────────────
        // 🖼️ IMÁGENES (incluyendo "ver una vez")
        // ──────────────────────────────────────

        if ((messageType === 'image' || messageType === 'view_once_image') && content?.imageMessage) {
            fileName = (content.imageMessage as any).fileName || `image_${Date.now()}.jpg`;
            mimeType = content.imageMessage.mimetype || 'image/jpeg';

            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            // Type guard: fileName y mimeType siempre tienen valores por defecto
            if (fileName && mimeType) {
                mediaUrl = await uploadMediaToSupabase(instanceId, buffer as Buffer, fileName, mimeType);
            }
        }

        // ──────────────────────────────────────
        // 🎥 VIDEOS (incluyendo "ver una vez")
        // ──────────────────────────────────────

        else if ((messageType === 'video' || messageType === 'view_once_video') && content?.videoMessage) {
            fileName = (content.videoMessage as any).fileName || `video_${Date.now()}.mp4`;
            mimeType = content.videoMessage.mimetype || 'video/mp4';

            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            // Type guard: fileName y mimeType siempre tienen valores por defecto
            if (fileName && mimeType) {
                mediaUrl = await uploadMediaToSupabase(instanceId, buffer as Buffer, fileName, mimeType);
            }
        }

        // ──────────────────────────────────────
        // 🎵 AUDIO
        // ──────────────────────────────────────

        else if (messageType === 'audio' && content?.audioMessage) {
            fileName = `audio_${Date.now()}.mp3`;
            mimeType = 'audio/mpeg';

            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            // Type guard: fileName y mimeType son literales, siempre definidos
            if (fileName && mimeType) {
                mediaUrl = await uploadMediaToSupabase(instanceId, buffer as Buffer, fileName, mimeType);
            }
        }

        // ──────────────────────────────────────
        // 🎤 NOTAS DE VOZ
        // ──────────────────────────────────────

        else if (messageType === 'voice' && content?.audioMessage) {
            fileName = `voice_${Date.now()}.ogg`;
            mimeType = 'audio/ogg';

            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            // Type guard: fileName y mimeType son literales, siempre definidos
            if (fileName && mimeType) {
                mediaUrl = await uploadMediaToSupabase(instanceId, buffer as Buffer, fileName, mimeType);
            }
        }

        // ──────────────────────────────────────
        // 📄 DOCUMENTOS
        // ──────────────────────────────────────

        else if (messageType === 'document' && content?.documentMessage) {
            fileName = content.documentMessage.fileName || `document_${Date.now()}`;
            mimeType = content.documentMessage.mimetype || 'application/octet-stream';

            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            // Type guard: fileName y mimeType siempre tienen valores por defecto
            if (fileName && mimeType) {
                mediaUrl = await uploadMediaToSupabase(instanceId, buffer as Buffer, fileName, mimeType);
            }
        }

        // ──────────────────────────────────────
        // 🎨 STICKERS
        // ──────────────────────────────────────

        else if (messageType === 'sticker' && content?.stickerMessage) {
            fileName = `sticker_${Date.now()}.webp`;
            mimeType = content.stickerMessage.mimetype || 'image/webp';

            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            // Type guard: fileName y mimeType siempre tienen valores por defecto
            if (fileName && mimeType) {
                mediaUrl = await uploadMediaToSupabase(instanceId, buffer as Buffer, fileName, mimeType);
            }
        }

        // Retornar resultado
        return {
            url: mediaUrl,
            fileName,
            mimeType,
            success: !!mediaUrl,
        };

    } catch (error: any) {
        // Si el mensaje aún está siendo descifrado, no es un error crítico
        if (!msg.messageStubType) {
            console.error(`⏳ Media download pending for message ${msg.key.id}`, error?.message);
        }

        return {
            success: false,
            error: error?.message || 'Unknown error',
        };
    }
}
