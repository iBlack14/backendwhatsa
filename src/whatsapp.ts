import makeWASocket, {
  DisconnectReason,
  WASocket,
  WAMessage,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { WhatsAppSession } from './types';
import { proxyService } from './services/proxy.service';
import { messageService } from './services/message.service';
import { contactService } from './services/contact.service';
import { createClient } from '@supabase/supabase-js';
import { useSupabaseAuthState } from './auth/SupabaseAuthState';
import { wsService } from './websocket';
import { supabase } from './lib/supabase';
import { whatsappLogger } from './utils/logger';

const sessions = new Map<string, WhatsAppSession>();

// 🛡️ Cache para evitar duplicación de mensajes
// Estructura: messageId -> timestamp cuando fue procesado
const processedMessages = new Map<string, number>();

// Limpiar mensajes procesados cada 5 minutos (mantener solo los últimos 5 minutos)
setInterval(() => {
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  for (const [messageId, timestamp] of processedMessages.entries()) {
    if (timestamp < fiveMinutesAgo) {
      processedMessages.delete(messageId);
    }
  }
}, 5 * 60 * 1000); // Cada 5 minutos

/**
 * Guardar archivo localmente (Fallback)
 */
async function saveMediaLocally(
  buffer: Buffer,
  fileName: string
): Promise<string> {
  const mediaDir = path.join(process.cwd(), 'media');
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  const filePath = path.join(mediaDir, fileName);
  await fs.promises.writeFile(filePath, buffer);

  const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;
  // Asegurar que no haya doble slash
  const url = `${baseUrl.replace(/\/$/, '')}/media/${fileName}`;
  return url;
}

/**
 * Subir archivo de media a Supabase Storage con Fallback Local
 */
async function uploadMediaToSupabase(
  instanceId: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string | undefined> {
  try {
    // 1. Intentar subir a Supabase
    const date = new Date();
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const filePath = `${instanceId}/${yearMonth}/${fileName}`;

    const { data, error } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (!error && data) {
      const { data: urlData } = supabase.storage
        .from('whatsapp-media')
        .getPublicUrl(filePath);

      if (urlData.publicUrl) return urlData.publicUrl;
    }

    console.warn('Supabase upload failed or returned no URL, falling back to local storage.');
  } catch (error) {
    console.error('Error in uploadMediaToSupabase:', error);
  }

  // 2. Fallback: Guardar localmente
  try {
    return await saveMediaLocally(buffer, fileName);
  } catch (localError) {
    console.error('Error saving media locally:', localError);
    return undefined;
  }
}

/**
 * Desempaqueta mensajes de wrappers como ephemeralMessage, viewOnceMessage, etc.
 * @param message - Objeto de mensaje de Baileys
 * @returns Mensaje real desempaquetado
 */
function getRealMessage(message: any): any {
  if (!message) return undefined;
  if (message.ephemeralMessage) return getRealMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage) return getRealMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2) return getRealMessage(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension) return getRealMessage(message.viewOnceMessageV2Extension.message);
  if (message.deviceSentMessage) return getRealMessage(message.deviceSentMessage.message);
  return message;
}

/**
 * Extraer texto completo del mensaje
 * @param message - Objeto de mensaje de Baileys
 * @returns Texto del mensaje o undefined
 */
function extractMessageText(message: any): string | undefined {
  const realMessage = getRealMessage(message);
  if (!realMessage) return undefined;

  // Texto simple
  if (realMessage.conversation) return realMessage.conversation;

  // Texto extendido (con formato, links, menciones, etc)
  if (realMessage.extendedTextMessage?.text) return realMessage.extendedTextMessage.text;

  // Caption de imagen
  if (realMessage.imageMessage?.caption) return realMessage.imageMessage.caption;

  // Caption de video
  if (realMessage.videoMessage?.caption) return realMessage.videoMessage.caption;

  // Caption de documento
  if (realMessage.documentMessage?.caption) return realMessage.documentMessage.caption;

  // Respuestas de botones y listas...
  if (realMessage.buttonsResponseMessage?.selectedButtonId) {
    return `Botón: ${realMessage.buttonsResponseMessage.selectedDisplayText || realMessage.buttonsResponseMessage.selectedButtonId}`;
  }

  if (realMessage.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return `Lista: ${realMessage.listResponseMessage.title || realMessage.listResponseMessage.singleSelectReply.selectedRowId}`;
  }

  if (realMessage.templateButtonReplyMessage?.selectedId) {
    return `Botón: ${realMessage.templateButtonReplyMessage.selectedDisplayText || realMessage.templateButtonReplyMessage.selectedId}`;
  }

  // Ubicación, Contactos, etc.
  if (realMessage.locationMessage) {
    return `📍 Ubicación: ${realMessage.locationMessage.degreesLatitude}, ${realMessage.locationMessage.degreesLongitude}`;
  }

  if (realMessage.contactMessage) {
    return `👤 Contacto: ${realMessage.contactMessage.displayName || 'Sin nombre'}`;
  }

  if (realMessage.contactsArrayMessage) {
    const count = realMessage.contactsArrayMessage.contacts?.length || 0;
    return `👥 ${count} contacto(s)`;
  }

  if (realMessage.reactionMessage) {
    return `${realMessage.reactionMessage.text} (reacción)`;
  }

  if (realMessage.pollCreationMessage) {
    return `📊 Encuesta: ${realMessage.pollCreationMessage.name}`;
  }

  if (realMessage.stickerMessage) {
    return '🎨 Sticker';
  }

  return undefined;
}

/**
 * Detectar el tipo de mensaje de forma precisa
 * @param message - Objeto de mensaje de Baileys
 * @returns Tipo de mensaje legible
 */
function detectMessageType(message: any): string {
  if (!message) return 'text';

  // Primero detectamos si es "Ver una vez" inspeccionando los wrappers
  const isViewOnce = message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension ||
    (message.ephemeralMessage?.message?.viewOnceMessage || message.ephemeralMessage?.message?.viewOnceMessageV2);

  const realMessage = getRealMessage(message);
  if (!realMessage) return 'text';

  if (isViewOnce) {
    if (realMessage.imageMessage) return 'view_once_image';
    if (realMessage.videoMessage) return 'view_once_video';
  }

  // Detectar tipos específicos del mensaje desempaquetado
  if (realMessage.conversation || realMessage.extendedTextMessage) return 'text';
  if (realMessage.imageMessage) return 'image';
  if (realMessage.videoMessage) return 'video';
  if (realMessage.audioMessage) {
    return realMessage.audioMessage.ptt ? 'voice' : 'audio';
  }
  if (realMessage.documentMessage) return 'document';
  if (realMessage.stickerMessage) return 'sticker';
  if (realMessage.locationMessage || realMessage.liveLocationMessage) return 'location';
  if (realMessage.contactMessage) return 'contact';
  if (realMessage.contactsArrayMessage) return 'contacts';
  if (realMessage.buttonsResponseMessage || realMessage.templateButtonReplyMessage) return 'button_reply';
  if (realMessage.listResponseMessage) return 'list_reply';
  if (realMessage.reactionMessage) return 'reaction';
  if (realMessage.pollCreationMessage) return 'poll';
  if (realMessage.pollUpdateMessage) return 'poll_update';

  const keys = Object.keys(realMessage);
  if (keys.length > 0) {
    const key = keys[0];
    if (key.includes('ViewOnce') || key.includes('viewOnce')) {
      // Intento de fallback inteligente para view once (asumimos imagen por defecto si falla todo)
      return 'view_once_image';
    }
    return key.replace('Message', '').toLowerCase();
  }
  return 'unknown';
}

/**
 * Helper para obtener el webhook_url de una instancia desde Supabase
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
 * Función central para procesar y guardar un mensaje
 */
async function processAndSaveMessage(clientId: string, sock: WASocket, msg: WAMessage): Promise<void> {
  try {
    const fromMe = msg.key.fromMe;
    const remoteJid = msg.key.remoteJid;
    const messageId = msg.key.id;

    if (!remoteJid || !messageId) return;

    // 🛡️ ANTI-DUPLICACIÓN (Solo para mensajes entrantes)
    if (!fromMe && processedMessages.has(messageId)) {
      const lastProcessed = processedMessages.get(messageId)!;
      const twoMinutesAgo = Date.now() - (2 * 60 * 1000);
      if (lastProcessed > twoMinutesAgo) return;
    }

    // Marcar como procesado (hacemos upsert en DB luego, así que está bien)
    processedMessages.set(messageId, Date.now());

    // Extraer texto y tipo
    const messageText = extractMessageText(msg.message);
    let messageType = detectMessageType(msg.message);

    // 🔐 Detectar View Once (Priorizar metadata de la KEY)
    const isViewOnce = (msg.key as any).isViewOnce || messageType.startsWith('view_once');
    if (isViewOnce && !messageType.startsWith('view_once')) {
      messageType = 'view_once_image';
    }

    // Si no hay contenido aún, poner un texto temporal
    const finalMessageText = messageText || (isViewOnce ? '🔐 Foto/Video (Cargando...)' : undefined);

    console.log(`[WHATSAPP] ${fromMe ? 'Outbound' : 'Inbound'} message [${messageType}] from ${remoteJid}`);

    // Extraer nombre del contacto
    const senderName = msg.pushName || undefined;
    const senderPhone = remoteJid?.split('@')[0] || undefined;

    // Extraer información adicional según el tipo
    let mediaUrl = undefined;
    let fileName = undefined;
    let mimeType = undefined;

    // Obtener el contenido real desempaquetado de forma recursiva
    const content = getRealMessage(msg.message);

    // Descargar media si existe
    try {
      if ((messageType === 'image' || messageType === 'view_once_image') && content?.imageMessage) {
        fileName = (content.imageMessage as any).fileName || `image_${Date.now()}.jpg`;
        mimeType = content.imageMessage.mimetype || 'image/jpeg';
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
      } else if ((messageType === 'video' || messageType === 'view_once_video') && content?.videoMessage) {
        fileName = (content.videoMessage as any).fileName || `video_${Date.now()}.mp4`;
        mimeType = content.videoMessage.mimetype || 'video/mp4';
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
      } else if (messageType === 'audio' && content?.audioMessage) {
        fileName = `audio_${Date.now()}.mp3`;
        mimeType = 'audio/mpeg';
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
      } else if (messageType === 'voice' && content?.audioMessage) {
        fileName = `voice_${Date.now()}.ogg`;
        mimeType = 'audio/ogg';
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
      } else if (messageType === 'document' && content?.documentMessage) {
        fileName = content.documentMessage.fileName || `document_${Date.now()}`;
        mimeType = content.documentMessage.mimetype || 'application/octet-stream';
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
      } else if (messageType === 'sticker' && content?.stickerMessage) {
        fileName = `sticker_${Date.now()}.webp`;
        mimeType = content.stickerMessage.mimetype || 'image/webp';
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
      }
    } catch (mediaError) {
      // Ignorar error de descarga si el mensaje aún está cifrado (ausente)
      if (!msg.messageStubType) {
        console.error(`[WHATSAPP] Media download pending for ${messageId}`);
      }
    }

    // Attempt to retrieve contact profile picture
    let profilePicUrl: string | undefined = undefined;
    try {
      if (remoteJid && !fromMe) {
        profilePicUrl = await sock.profilePictureUrl(remoteJid, 'image');
      }
    } catch (picError) { /* ignore */ }

    // FINAL MESSAGE TYPE LOGIC
    const finalMessageType = (isViewOnce && messageType === 'text' && !finalMessageText) ? 'view_once_image' : messageType;

    const savedMessage = {
      instance_id: clientId,
      chat_id: remoteJid || '',
      message_id: messageId,
      sender_name: senderName,
      sender_phone: senderPhone,
      message_text: finalMessageText, // Usamos el texto procesado
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
    console.log(`[WHATSAPP] Message processed: ${messageId} (${finalMessageType})`);

    // Update contact
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
      } catch (e) { }
    }

    // WebSocket notify
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

    // Webhook notify
    try {
      let webhookUrl = await getInstanceWebhookUrl(clientId);
      if (!webhookUrl && process.env.FRONTEND_URL) {
        webhookUrl = `${process.env.FRONTEND_URL}/api/webhooks/whatsapp`;
      }

      if (webhookUrl) {
        axios.post(webhookUrl, {
          event: 'messages.upsert',
          instanceId: clientId,
          data: {
            fromMe,
            key: msg.key,
            message: msg.message,
            messageTimestamp: msg.messageTimestamp,
          }
        }, { timeout: 5000 }).catch(() => { });
      }
    } catch (e) { }

  } catch (error) {
    console.error(`[${clientId}] ❌ Error in processAndSaveMessage:`, error);
  }
}

export async function createWhatsAppSession(clientId: string): Promise<void> {
  if (sessions.has(clientId)) return;

  const { state, saveCreds } = await useSupabaseAuthState(clientId);
  const proxy = await proxyService.getProxyForInstance(clientId);
  let agent = proxy ? proxyService.createProxyAgent(proxy) : undefined;

  const retryMap = new Map<string, any>();
  const msgRetryCounterCache: any = {
    get: (key: string) => retryMap.get(key),
    set: (key: string, value: any) => { retryMap.set(key, value) },
    del: (key: string) => retryMap.delete(key),
    flushAll: () => retryMap.clear()
  };

  const sock = makeWASocket({
    auth: state,
    browser: ['Chrome (Linux)', '', ''],
    logger: whatsappLogger.child({ clientId }, { level: 'fatal' }),
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    agent,
    msgRetryCounterCache,
    retryRequestDelayMs: 250,
  });

  const session: WhatsAppSession = { clientId, sock, qr: null, state: 'Initializing' };
  sessions.set(clientId, session);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      const qrBase64 = await QRCode.toDataURL(qr);
      session.qr = qrBase64;
      await updateInstanceInN8N(clientId, { state: 'Initializing', qr: qrBase64, qr_loading: false });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        sessions.delete(clientId);
        setTimeout(() => createWhatsAppSession(clientId), 2000);
      } else {
        sessions.delete(clientId);
        await updateInstanceInN8N(clientId, { state: 'Disconnected', qr: null, qr_loading: false });
      }
    } else if (connection === 'open') {
      session.state = 'Connected';
      session.qr = null;
      const user = sock.user;
      if (user) {
        session.phoneNumber = user.id.split(':')[0];
        session.profileName = user.name || '';
        try {
          session.profilePicUrl = await sock.profilePictureUrl(user.id, 'image');
        } catch (e) { }
      }
      await updateInstanceInN8N(clientId, {
        state: 'Connected',
        qr: null,
        qr_loading: false,
        phone_number: session.phoneNumber,
        profile_name: session.profileName,
        profile_pic_url: session.profilePicUrl,
      });
      wsService.emitInstanceStateChange(clientId, 'Connected');
    }
  });

  sock.ev.on('contacts.upsert', async (contacts) => syncContacts(clientId, contacts));

  // 📥 Manejar nuevos mensajes
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      await processAndSaveMessage(clientId, sock, msg);
    }
  });

  // 🔄 Manejar actualizaciones de mensajes (IMPORTANTE para desencriptación diferida)
  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      if (update.update.message) {
        // Reconstruir un objeto WAMessage completo para procesarlo
        const msgToProcess: any = {
          key: update.key,
          message: update.update.message,
          messageTimestamp: (update as any).messageTimestamp || Math.floor(Date.now() / 1000),
          pushName: (update as any).pushName
        };

        await processAndSaveMessage(clientId, sock, msgToProcess);
      }
    }
  });
}

export async function sendMessage(clientId: string, to: string, message: string): Promise<void> {
  const session = sessions.get(clientId);
  if (!session || session.state !== 'Connected') throw new Error('Session not connected');
  const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
  await session.sock.sendMessage(jid, { text: message });
}

export function getSession(clientId: string) { return sessions.get(clientId); }
export function getAllSessions() { return Array.from(sessions.values()); }

export async function disconnectSession(clientId: string): Promise<void> {
  const session = sessions.get(clientId);
  if (session) {
    await session.sock.logout();
    sessions.delete(clientId);
  }
}

async function updateInstanceInN8N(clientId: string, data: any): Promise<void> {
  try {
    await supabase.from('instances').update(data).eq('document_id', clientId);
  } catch (e) { }
}

export async function restoreAllSessions(): Promise<void> {
  try {
    const { data } = await supabase.from('whatsapp_sessions').select('session_id').eq('key', 'creds');
    if (!data) return;
    const sessionIds = [...new Set(data.map(row => row.session_id))];
    for (const clientId of sessionIds) {
      createWhatsAppSession(clientId);
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (e) { }
}

async function syncContacts(instanceId: string, contacts: any[]): Promise<void> {
  if (!contacts?.length) return;
  const contactsData = contacts.map(c => ({
    instance_id: instanceId,
    jid: c.id,
    name: c.name || c.notify || c.verifiedName,
    push_name: c.notify,
    profile_pic_url: c.imgUrl,
    updated_at: new Date()
  }));
  for (let i = 0; i < contactsData.length; i += 50) {
    await supabase.from('contacts').upsert(contactsData.slice(i, i + 50), { onConflict: 'instance_id,jid' });
  }
}
