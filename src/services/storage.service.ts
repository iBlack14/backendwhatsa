import { supabase } from '../lib/supabase';
import { v4 as uuidv4 } from 'uuid';

export class StorageService {
    private readonly BUCKET_NAME = 'whatsapp-media';

    /**
     * Subir archivo a Supabase Storage
     * @param buffer Buffer del archivo
     * @param instanceId ID de la instancia
     * @param mimeType Tipo MIME
     * @param fileName Nombre del archivo (opcional)
     * @returns URL pública del archivo
     */
    async uploadFile(buffer: Buffer, instanceId: string, mimeType: string, fileName?: string): Promise<string | undefined> {
        try {
            const ext = this.getExtensionFromMimeType(mimeType);
            const name = fileName || `${uuidv4()}.${ext}`;

            // Organizar por año/mes para evitar carpetas gigantes
            const date = new Date();
            const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const filePath = `${instanceId}/${yearMonth}/${name}`;

            // 1. Intentar subir
            const { error: uploadError } = await supabase.storage
                .from(this.BUCKET_NAME)
                .upload(filePath, buffer, {
                    contentType: mimeType,
                    upsert: false
                });

            if (uploadError) {
                // Si el bucket no existe, intentar crearlo (solo funciona con permisos de admin/service_role)
                if (uploadError.message.includes('bucket not found')) {
                    console.log(`[STORAGE] Bucket '${this.BUCKET_NAME}' not found. Attempting to create...`);
                    const { error: createError } = await supabase.storage.createBucket(this.BUCKET_NAME, {
                        public: true
                    });

                    if (createError) {
                        console.error('[STORAGE] Failed to create bucket:', createError);
                        return undefined;
                    }

                    // Reintentar subida
                    const { error: retryError } = await supabase.storage
                        .from(this.BUCKET_NAME)
                        .upload(filePath, buffer, { contentType: mimeType });

                    if (retryError) {
                        console.error('[STORAGE] Error reloading:', retryError);
                        return undefined;
                    }
                } else {
                    console.error('[STORAGE] Error uploading:', uploadError);
                    return undefined;
                }
            }

            // 2. Obtener URL pública
            const { data } = supabase.storage
                .from(this.BUCKET_NAME)
                .getPublicUrl(filePath);

            return data.publicUrl;
        } catch (error) {
            console.error('[STORAGE] Unexpected error:', error);
            return undefined;
        }
    }

    /**
     * Helper para subir Base64 directamente
     */
    async uploadBase64(base64String: string, instanceId: string, mimeType?: string): Promise<string | undefined> {
        try {
            // Remover header si existe (data:image/png;base64,...)
            const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            let validBase64 = base64String;
            let finalMimeType = mimeType || 'application/octet-stream';

            if (matches && matches.length === 3) {
                finalMimeType = matches[1];
                validBase64 = matches[2];
            }

            const buffer = Buffer.from(validBase64, 'base64');
            return await this.uploadFile(buffer, instanceId, finalMimeType);
        } catch (error) {
            console.error('[STORAGE] Error processing Base64:', error);
            return undefined;
        }
    }

    private getExtensionFromMimeType(mimeType: string): string {
        const map: Record<string, string> = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'video/mp4': 'mp4',
            'audio/mpeg': 'mp3',
            'audio/mp4': 'mp4',
            'audio/ogg': 'ogg',
            'audio/webm': 'webm',
            'application/pdf': 'pdf',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
            'application/vnd.ms-excel': 'xls',
            'application/msword': 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
            'text/plain': 'txt'
        };
        return map[mimeType] || 'bin';
    }
}

export const storageService = new StorageService();
