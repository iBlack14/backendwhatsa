/**
 * MESSAGE PROCESSOR
 * ====================================
 * Módulo central para procesar mensajes entrantes y salientes de WhatsApp.
 * Coordina el parseo, descarga de media, guardado en DB y notificaciones.
 */

import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import axios from 'axios';
import {
    detectMessageType,
    extractMessageText,
    getRealMessage,
    isViewOnceMessage
} from '../utils/messageParser';
import { downloadAndUploadMedia } from '../handlers/MediaHandler';
import { messageService } from '../services/message.service';
import { contactService } from '../services/contact.service';
import { wsService } from '../websocket';
import { supabase } from '../lib/supabase';

/**
 * Cache para prevenir procesamiento duplicado de mensajes.
 * Estructura: messageId -> timestamp cuando fue procesado
 */
const processedMessages = new Map<string, number>();

/**
 * Limpia mensajes procesados cada 5 minutos.
 * Solo mantiene mensajes de los últimos 5 minutos para evitar fugas de memoria.
 */
setInterval(() => {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

    for (const [messageId, timestamp] of processedMessages.entries()) {
        if (timestamp < fiveMinutesAgo) {
            processedMessages.delete(messageId);
        }
    }
}, 5 * 60 * 1000);

/**
 * Obtiene la URL del webhook de una instancia desde Supabase.
 * 
 * @param instanceId - ID de la instancia
 * @returns URL del webhook o null si no está configurado
 */
async function getInstanceWebhookUrl(instanceId: string): Promise<string | null> {
    try {
        const { data, error } = await supabase
            .from('instances')
            .select('webhook_url')
            .eq('document_id', instanceId)
            .single();

        if (error || !data) {
            return null;
        }

        return data.webhook_url || null;
    } catch (error) {
        console.error(`[${instanceId}] ❌ Error fetching webhook_url:`, error);
        return null;
    }
}

/**
 * FUNCIÓN PRINCIPAL: Procesa y guarda un mensaje de WhatsApp.
 * 
 * Flujo de procesamiento:
 * 1. Validación y anti-duplicación
 * 2. Extracción de texto y tipo
 * 3. Descarga de multimedia (si aplica)
 * 4. Guardado en base de datos
 * 5. Actualización de contacto
 * 6. Notificación vía WebSocket
 * 7. Envío a webhook externo
 * 
 * @param clientId - ID de la instancia de WhatsApp
 * @param sock - Socket de conexión de Baileys
 * @param msg - Mensaje de WhatsApp a procesar
 */
export async function processAndSaveMessage(
    clientId: string,
    sock: WASocket,
    msg: WAMessage
): Promise<void> {
    try {
        // ──────────────────────────────────────
        // 📋 PASO 1: Extraer información básica
        // ──────────────────────────────────────

        const fromMe = msg.key.fromMe;
        const remoteJid = msg.key.remoteJid;
        const messageId = msg.key.id;

        // Validación básica
        if (!remoteJid || !messageId) {
            console.warn(`[${clientId}] ⚠️ Message without remoteJid or messageId, skipping.`);
            return;
        }

        // ──────────────────────────────────────
        // 🛡️ PASO 2: Anti-duplicación (solo mensajes entrantes)
        // ──────────────────────────────────────

        if (!fromMe && processedMessages.has(messageId)) {
            const lastProcessed = processedMessages.get(messageId)!;
            const twoMinutesAgo = Date.now() - (2 * 60 * 1000);

            // Si ya fue procesado hace menos de 2 minutos, ignorar
            if (lastProcessed > twoMinutesAgo) {
                console.log(`[${clientId}] 🔄 Duplicate message detected: ${messageId}, skipping.`);
                return;
            }
        }

        // Marcar como procesado
        processedMessages.set(messageId, Date.now());

        // ──────────────────────────────────────
        // 📝 PASO 3: Parsear mensaje
        // ──────────────────────────────────────

        const messageText = extractMessageText(msg.message);
        let messageType = detectMessageType(msg.message);

        // Detectar "Ver una vez" usando metadata de la key
        const isViewOnce = isViewOnceMessage(msg.key) || messageType.startsWith('view_once');

        if (isViewOnce && !messageType.startsWith('view_once')) {
            messageType = 'view_once_image';
        }

        // Texto final (con placeholder para medios pendientes)
        const finalMessageText = messageText || (isViewOnce ? '🔐 Foto/Video (Cargando...)' : undefined);

        console.log(`[${clientId}] ${fromMe ? '📤 Outbound' : '📥 Inbound'} message [${messageType}] from ${remoteJid}`);

        // ──────────────────────────────────────
        // 👤 PASO 4: Extraer información del remitente
        // ──────────────────────────────────────

        const senderName = msg.pushName || undefined;
        const senderPhone = remoteJid?.split('@')[0] || undefined;

        // Obtener foto de perfil
        let profilePicUrl: string | undefined = undefined;
        try {
            if (remoteJid && !fromMe) {
                profilePicUrl = await sock.profilePictureUrl(remoteJid, 'image');
            }
        } catch (picError) {
            // Ignorar error si no tiene foto de perfil
        }

        // ──────────────────────────────────────
        // 📎 PASO 5: Descargar y subir multimedia
        // ──────────────────────────────────────

        const content = getRealMessage(msg.message);
        const mediaResult = await downloadAndUploadMedia(
            { ...msg, message: content },
            messageType,
            clientId
        );

        const { url: mediaUrl, fileName, mimeType } = mediaResult;

        // Tipo final de mensaje
        const finalMessageType = (isViewOnce && messageType === 'text' && !finalMessageText)
            ? 'view_once_image'
            : messageType;

        // ──────────────────────────────────────
        // 💾 PASO 6: Guardar en base de datos
        // ──────────────────────────────────────

        const savedMessage = {
            instance_id: clientId,
            chat_id: remoteJid || '',
            message_id: messageId,
            sender_name: senderName,
            sender_phone: senderPhone,
            message_text: finalMessageText,
            message_type: finalMessageType,
            media_url: mediaUrl,
            from_me: fromMe || false,
            timestamp: new Date(msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now()),
            is_read: fromMe || false,
            metadata: { ...msg, fileName },
            profile_pic_url: profilePicUrl,
            is_view_once: isViewOnce,
            view_once_opened_times: [],
        };

        await messageService.saveMessage(savedMessage);
        console.log(`[${clientId}] ✅ Message saved: ${messageId} (${finalMessageType})`);

        // ──────────────────────────────────────
        // 👥 PASO 7: Actualizar contacto (solo si es mensaje entrante)
        // ──────────────────────────────────────

        if (!fromMe && remoteJid && !remoteJid.includes('@g.us')) {
            try {
                await contactService.saveContact({
                    instance_id: clientId,
                    jid: remoteJid,
                    name: senderName,
                    push_name: senderName,
                    profile_pic_url: profilePicUrl,
                    is_blocked: false,
                });
            } catch (contactError) {
                console.warn(`[${clientId}] ⚠️ Could not save contact:`, contactError);
            }
        }

        // ──────────────────────────────────────
        // 🔔 PASO 8: Notificación WebSocket
        // ──────────────────────────────────────

        wsService.emitNewMessage(clientId, {
            ...savedMessage,
            instanceId: clientId,
            chatId: remoteJid,
            sender: senderName || senderPhone,
            text: messageText,
            type: finalMessageType,
            hasMedia: !!mediaUrl,
            mediaUrl: mediaUrl,
        });

        // ──────────────────────────────────────
        // 🪝 PASO 9: Enviar a webhook externo
        // ──────────────────────────────────────

        try {
            let webhookUrl = await getInstanceWebhookUrl(clientId);

            // Fallback al webhook por defecto si no está configurado
            if (!webhookUrl && process.env.FRONTEND_URL) {
                webhookUrl = `${process.env.FRONTEND_URL}/api/webhooks/whatsapp`;
            }

            if (webhookUrl) {
                axios.post(
                    webhookUrl,
                    {
                        event: 'messages.upsert',
                        instanceId: clientId,
                        data: {
                            fromMe,
                            key: msg.key,
                            message: msg.message,
                            messageTimestamp: msg.messageTimestamp,
                        }
                    },
                    { timeout: 5000 }
                ).catch((webhookError) => {
                    console.warn(`[${clientId}] ⚠️ Webhook notification failed:`, webhookError.message);
                });
            }
        } catch (webhookError) {
            console.error(`[${clientId}] ❌ Error sending webhook:`, webhookError);
        }

    } catch (error) {
        console.error(`[${clientId}] ❌ Error in processAndSaveMessage:`, error);
    }
}

/**
 * Limpia manualmente la caché de mensajes procesados.
 * Útil para testing o mantenimiento.
 */
export function clearProcessedMessagesCache(): void {
    processedMessages.clear();
    console.log('🧹 Processed messages cache cleared.');
}

/**
 * Obtiene el tamaño actual de la caché de mensajes procesados.
 * @returns Número de mensajes en caché
 */
export function getProcessedMessagesCacheSize(): number {
    return processedMessages.size;
}
