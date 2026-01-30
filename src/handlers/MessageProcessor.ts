import { WASocket } from '@whiskeysockets/baileys';
import {
    extractMessageText,
    detectMessageType,
    getRealMessage,
    isViewOnceMessage
} from '../utils/messageParser';
import { downloadAndUploadMedia } from './MediaHandler';
import { messageService, Message } from '../services/message.service';
import { wsService } from '../websocket';

/**
 * Procesa y guarda un mensaje entrante de WhatsApp.
 * 
 * @param instanceId - ID de la instancia
 * @param sock - Socket de Baileys
 * @param msg - Mensaje recibido (upsert)
 */
export async function processAndSaveMessage(
    instanceId: string,
    sock: WASocket,
    msg: any
): Promise<void> {
    try {
        if (!msg.message) return;

        // Ignorar mensajes de estado/broadcast
        if (msg.key.remoteJid === 'status@broadcast') return;

        // Ignorar mensajes de protocolo (cifrado, etc) triviales
        if (msg.message.protocolMessage) return;

        const messageType = detectMessageType(msg.message);
        const messageText = extractMessageText(msg.message);
        const realMessage = getRealMessage(msg.message);
        const isFromMe = msg.key.fromMe || false;

        // Obtener ID del chat y remitente
        const chatId = msg.key.remoteJid!;
        const sender = isFromMe
            ? sock.user?.id?.split(':')[0] + '@s.whatsapp.net' // Yo
            : (msg.key.participant || msg.key.remoteJid!); // En grupos, participant es quien envía

        // Extraer nombre del pushName
        const pushName = msg.pushName || '';

        let mediaUrl: string | undefined;

        // Manejar multimedia
        const mediaTypes = ['image', 'video', 'audio', 'voice', 'sticker', 'document', 'view_once_image', 'view_once_video'];

        if (mediaTypes.includes(messageType)) {
            // Intentar descargar media. Si falla (por ejemplo, mensajes antiguos sin media disponible), no bloquear el flujo.
            try {
                const mediaResult = await downloadAndUploadMedia(msg, messageType, instanceId);
                if (mediaResult.success) {
                    mediaUrl = mediaResult.url;
                }
            } catch (mediaError) {
                console.warn(`[${instanceId}] ⚠️ Failed to download media for message ${msg.key.id}`, mediaError);
            }
        }

        // Construir objeto de mensaje para el servicio
        const messageData: Message = {
            instance_id: instanceId,
            chat_id: chatId,
            message_id: msg.key.id!,
            sender_name: pushName,
            sender_phone: sender?.split('@')[0],
            message_text: messageText,
            message_type: messageType,
            media_url: mediaUrl,
            from_me: isFromMe,
            timestamp: new Date((typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : parseFloat(msg.messageTimestamp)) * 1000), // Baileys usa segundos
            is_read: isFromMe, // Si lo envié yo, está leído. 
            is_view_once: isViewOnceMessage(msg.message) || (realMessage && isViewOnceMessage(realMessage)),
        };

        // Guardar mensaje en DB
        const saved = await messageService.saveMessage(messageData);

        if (saved) {
            // Notificar via WebSocket solo si se guardó correctamente
            wsService.emitNewMessage(instanceId, messageData);
            console.log(`[${instanceId}] 📩 Processed message: ${msg.key.id} (${messageType})`);
        } else {
            console.warn(`[${instanceId}] ⚠️ Message ${msg.key.id} could not be saved to DB.`);
        }

    } catch (error) {
        console.error(`[${instanceId}] ❌ Error processing message:`, error);
    }
}
