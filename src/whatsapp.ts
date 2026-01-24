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
 * Subir archivo de media a Supabase Storage
 */
async function uploadMediaToSupabase(
  instanceId: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string | undefined> {
  try {
    // const supabase = createClient(supabaseUrl, supabaseKey); // USAR SINGLETON

    // Crear path único: instance_id/YYYY-MM/filename
    const date = new Date();
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const filePath = `${instanceId}/${yearMonth}/${fileName}`;

    // Subir archivo
    const { data, error } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      console.error('Error uploading to Supabase:', error);
      return undefined;
    }

    // Obtener URL pública
    const { data: urlData } = supabase.storage
      .from('whatsapp-media')
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (error) {
    console.error('Error in uploadMediaToSupabase:', error);
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
 * @param instanceId - ID de la instancia
 * @returns webhook_url o null si no existe
 */
async function getInstanceWebhookUrl(instanceId: string): Promise<string | null> {
  try {
    // const supabase = createClient(supabaseUrl, supabaseKey); // USAR SINGLETON

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

export async function createWhatsAppSession(clientId: string): Promise<void> {
  if (sessions.has(clientId)) {
    whatsappLogger.debug({ clientId }, 'Session already active');
    return;
  }

  whatsappLogger.info({ clientId }, 'Initializing session');

  // Usar autenticación basada en Supabase
  const { state, saveCreds } = await useSupabaseAuthState(clientId);

  // Obtener proxy si está configurado
  const proxy = await proxyService.getProxyForInstance(clientId);
  let agent = undefined;

  if (proxy) {
    whatsappLogger.info({ clientId, proxy: proxy.name }, 'Using proxy configuration');
    agent = proxyService.createProxyAgent(proxy);
  } else {
    whatsappLogger.debug({ clientId }, 'No proxy configured');
  }

  const sock = makeWASocket({
    auth: state,
    browser: ['Chrome (Linux)', '', ''],
    logger: whatsappLogger.child({ clientId }, { level: 'fatal' }), // Silenciar logs de Baileys
    // Configuración adicional para mejorar conexión
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    // Agregar proxy si está disponible
    agent,
  });

  const session: WhatsAppSession = {
    clientId,
    sock,
    qr: null,
    state: 'Initializing',
  };

  sessions.set(clientId, session);

  // Evento: QR generado
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      whatsappLogger.info({ clientId }, '📱 QR CODE GENERATED');

      // Generate terminal QR for debugging
      try {
        const qrTerminal = require('qrcode-terminal');
        qrTerminal.generate(qr, { small: true });
      } catch (e) {
        // Silently fail
      }

      // Convert QR to base64 for frontend
      const qrBase64 = await QRCode.toDataURL(qr);
      session.qr = qrBase64;
      session.state = 'Initializing';

      await updateInstanceInN8N(clientId, {
        state: 'Initializing',
        qr: qrBase64,
        qr_loading: false,
      });
      whatsappLogger.info({ clientId }, 'QR code saved to database');
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut;

      whatsappLogger.info({ clientId, shouldReconnect }, '🔴 Connection terminated');

      if (shouldReconnect) {
        session.state = 'Disconnected';
        sessions.delete(clientId);
        whatsappLogger.info({ clientId }, 'Initiating automatic reconnection');
        await new Promise(resolve => setTimeout(resolve, 1000));
        await createWhatsAppSession(clientId);
      } else {
        session.state = 'Disconnected';
        sessions.delete(clientId);
        await updateInstanceInN8N(clientId, {
          state: 'Disconnected',
          qr: null,
          qr_loading: false,
        });
      }
    } else if (connection === 'open') {
      console.log(`[WHATSAPP] Connection established for ${clientId}`);
      session.state = 'Connected';
      session.qr = null;

      // Retrieve user information
      const user = sock.user;
      if (user) {
        session.phoneNumber = user.id.split(':')[0];
        session.profileName = user.name || '';
        console.log(`[WHATSAPP] Account: ${session.phoneNumber}`);
        console.log(`[WHATSAPP] Display name: ${session.profileName}`);

        // Attempt to retrieve profile picture
        try {
          const jid = user.id;
          const profilePicUrl = await sock.profilePictureUrl(jid, 'image');
          session.profilePicUrl = profilePicUrl;
          console.log(`[WHATSAPP] Profile image: ${profilePicUrl ? 'Retrieved' : 'Not available'}`);
        } catch (error) {
          console.log(`[WHATSAPP] Profile image retrieval failed`);
          session.profilePicUrl = undefined;
        }
      }

      await updateInstanceInN8N(clientId, {
        state: 'Connected',
        qr: null,
        qr_loading: false,
        phone_number: session.phoneNumber,
        profile_name: session.profileName,
        profile_pic_url: session.profilePicUrl,
      });

      // 🔌 Emitir evento WebSocket de conexión exitosa
      wsService.emitInstanceStateChange(clientId, 'Connected');
    }
  });

  // Guardar credenciales
  sock.ev.on('creds.update', saveCreds);

  // ✅ Sincronización de Contactos
  sock.ev.on('contacts.upsert', async (contacts) => {
    try {
      await syncContacts(clientId, contacts);
    } catch (error) {
      console.error(`[${clientId}] ❌ Error handling contacts.upsert:`, error);
    }
  });

  sock.ev.on('contacts.update', async (updates) => {
    // Para updates parciales, podríamos necesitar lógica más compleja,
    // pero por ahora intentamos sincronizar lo que llegue si tiene ID
    try {
      const contacts = updates.map(u => ({ ...u, id: u.id }));
      await syncContacts(clientId, contacts as any);
    } catch (error) {
      console.error(`[${clientId}] ❌ Error handling contacts.update:`, error);
    }
  });

  // Message processing and webhook notifications
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log(`[WHATSAPP] Processing ${messages.length} message(s) for ${clientId}`);

    for (const msg of messages) {
      try {
        const fromMe = msg.key.fromMe;
        const remoteJid = msg.key.remoteJid;
        const messageId = msg.key.id;

        // 🛡️ ANTI-DUPLICACIÓN: Verificar si este mensaje ya fue procesado recientemente
        if (messageId && processedMessages.has(messageId)) {
          const lastProcessed = processedMessages.get(messageId)!;
          const twoMinutesAgo = Date.now() - (2 * 60 * 1000);

          if (lastProcessed > twoMinutesAgo) {
            // console.log(`[WHATSAPP] ⏭️ Skipping duplicate message: ${messageId}`);
            continue; // Saltar este mensaje, ya fue procesado
          }
        }

        // Marcar mensaje como procesado
        if (messageId) {
          processedMessages.set(messageId, Date.now());
        }

        console.log(`[WHATSAPP] ${fromMe ? 'Outbound' : 'Inbound'} message from ${remoteJid}`);

        // Persist message to database
        try {
          // Extract complete message text
          const messageText = extractMessageText(msg.message);
          const messageType = detectMessageType(msg.message);

          console.log(`[WHATSAPP] Raw keys: ${JSON.stringify(Object.keys(msg.message || {}))}`);
          console.log(`[WHATSAPP] Detected type: ${messageType}`);
          // 🔐 Log especial para mensajes "Ver una vez"
          if (messageType.startsWith('view_once')) {
            console.log(`[WHATSAPP] 🔐 VIEW ONCE MESSAGE DETECTED - This message can only be viewed once!`);
          }
          if (messageText) {
            console.log(`[WHATSAPP] Content: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`);
          }

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
              console.log(`[WHATSAPP] Processing standard audio message...`);
              fileName = `audio_${Date.now()}.mp3`;
              mimeType = 'audio/mpeg';
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
            } else if (messageType === 'voice' && content?.audioMessage) {
              console.log(`[WHATSAPP] Processing voice note (PTT)...`);
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

            if (mediaUrl) {
              console.log(`[WHATSAPP] Media file uploaded: ${mediaUrl}`);
            }
          } catch (mediaError) {
            console.error(`[WHATSAPP] Media processing failed:`, mediaError);
          }

          // Attempt to retrieve contact profile picture
          let profilePicUrl: string | undefined = undefined;
          try {
            if (remoteJid && !fromMe) {
              // For individual chats, use sender JID
              // For groups, use group JID
              const picJid = remoteJid;
              profilePicUrl = await sock.profilePictureUrl(picJid, 'image');
              console.log(`[WHATSAPP] Contact profile image retrieved for ${picJid}`);
            }
          } catch (picError) {
            // Profile picture not available or retrieval failed
            console.log(`[WHATSAPP] Contact profile image not available for ${remoteJid}`);
          }

          // 🔐 Detectar si es mensaje "Ver una vez"
          const isViewOnce = messageType.startsWith('view_once');

          const savedMessage = {
            instance_id: clientId,
            chat_id: remoteJid || '',
            message_id: messageId || '',
            sender_name: senderName,
            sender_phone: senderPhone,
            message_text: messageText,
            message_caption: undefined, // Ya incluido en messageText
            message_type: messageType,
            media_url: mediaUrl,
            from_me: fromMe || false,
            timestamp: new Date(msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now()),
            is_read: fromMe || false,
            metadata: { ...msg, fileName },
            profile_pic_url: profilePicUrl,
            is_view_once: isViewOnce,  // 🔐 Marcar como "ver una vez"
            view_once_opened_times: [],  // Array vacío - se llenará cuando se abra
          };

          await messageService.saveMessage(savedMessage);

          console.log(`[WHATSAPP] Message persisted to database`);

          // Automatically save/update contact information
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
              console.log(`[WHATSAPP] Contact information updated: ${remoteJid}`);
            } catch (contactError) {
              console.error(`[WHATSAPP] Contact update failed:`, contactError);
            }
          }

          // Emit WebSocket event for real-time updates
          try {
            wsService.emitNewMessage(clientId, {
              ...savedMessage,
              instanceId: clientId,
              chatId: remoteJid,
              sender: senderName || senderPhone,
              text: messageText,
              type: messageType,
              hasMedia: !!mediaUrl,
              mediaUrl: mediaUrl,
            });
            console.log(`[${clientId}] 🔌 WebSocket event emitted`);
          } catch (wsError) {
            console.error(`[${clientId}] ⚠️ Error emitting WebSocket event:`, wsError);
          }
        } catch (dbError) {
          console.error(`[${clientId}] ❌ Error saving message to DB:`, dbError);
        }

        // 🔀 LÓGICA DE WEBHOOK: Priorizar webhook_url personalizado (N8N) o usar FRONTEND_URL (Templates)
        let webhookUrl: string | null = null;
        let webhookMode = 'unknown';

        // 1️⃣ Intentar obtener webhook_url personalizado de la instancia (modo N8N)
        const customWebhook = await getInstanceWebhookUrl(clientId);

        if (customWebhook) {
          webhookUrl = customWebhook;
          webhookMode = 'N8N (custom)';
          console.log(`[${clientId}] 🎯 Using custom webhook (N8N): ${webhookUrl}`);
        } else {
          // 2️⃣ Fallback: usar FRONTEND_URL (modo Templates)
          const frontendUrl = process.env.FRONTEND_URL;

          if (frontendUrl) {
            webhookUrl = `${frontendUrl}/api/webhooks/whatsapp`;
            webhookMode = 'Templates (internal)';
            console.log(`[WHATSAPP] Using internal webhook endpoint: ${webhookUrl}`);
          } else {
            console.warn(`[${clientId}] ⚠️ No webhook configured (neither custom nor FRONTEND_URL), skipping`);
            continue;
          }
        }

        // Enviar webhook
        await axios.post(webhookUrl, {
          event: 'messages.upsert',
          instanceId: clientId,
          data: {
            fromMe: fromMe,
            key: {
              remoteJid: remoteJid,
              fromMe: fromMe,
              id: messageId,
            },
            message: msg.message,
            messageTimestamp: msg.messageTimestamp,
          }
        }, {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
          }
        });

        console.log(`[WHATSAPP] Webhook notification sent (${webhookMode}): ${fromMe ? 'outbound' : 'inbound'}`);
      } catch (webhookError: any) {
        console.error(`[${clientId}] ❌ Error sending webhook:`, webhookError.message);
        // No bloquear el flujo si falla el webhook
      }
    }
  });
}

export async function sendMessage(
  clientId: string,
  to: string,
  message: string
): Promise<void> {
  const session = sessions.get(clientId);

  if (!session) {
    throw new Error(`Session not found for clientId: ${clientId}`);
  }

  if (session.state !== 'Connected') {
    throw new Error(`Session not connected. Current state: ${session.state}`);
  }

  if (!session.sock || typeof session.sock.sendMessage !== 'function') {
    throw new Error('WhatsApp socket is not properly initialized. Please reconnect the session.');
  }

  const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;

  console.log(`📤 Sending message to ${to} from ${clientId}`);

  try {
    await session.sock.sendMessage(jid, { text: message });
    console.log(`✅ Message sent successfully`);
  } catch (error: any) {
    console.error(`❌ Error sending message:`, error);
    throw new Error(`Failed to send message: ${error.message}`);
  }
}

export function getSession(clientId: string): WhatsAppSession | undefined {
  return sessions.get(clientId);
}

export function getAllSessions(): WhatsAppSession[] {
  return Array.from(sessions.values());
}

export async function disconnectSession(clientId: string): Promise<void> {
  const session = sessions.get(clientId);

  if (session) {
    console.log(`🔌 Disconnecting session ${clientId}...`);
    await session.sock.logout();
    sessions.delete(clientId);
    console.log(`✅ Session ${clientId} disconnected`);
  }
}

async function updateInstanceInN8N(clientId: string, data: any): Promise<void> {
  console.log(`\n🔄 Updating instance ${clientId} with data:`, JSON.stringify(data, null, 2));

  try {
    // PRIORIDAD 1: Actualizar directamente en Supabase (más confiable)
    // const supabaseUrl = process.env.SUPABASE_URL;
    // const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;

    // console.log(`📌 Supabase URL: ${supabaseUrl ? 'Configured ✅' : 'Not configured ❌'}`);
    // console.log(`📌 Supabase Key: ${supabaseKey ? 'Configured ✅' : 'Not configured ❌'}`);

    // if (supabaseUrl && supabaseKey) {
    // const updateUrl = `${supabaseUrl}/rest/v1/instances?document_id=eq.${clientId}`;

    const { error } = await supabase
      .from('instances')
      .update(data)
      .eq('document_id', clientId);

    if (error) {
      console.error(`❌ Error updating instance in Supabase:`, error.message);
    } else {
      console.log(`✅ Updated instance ${clientId} in Supabase`);
    }

    // PRIORIDAD 2: Intentar N8N como opcional (no crítico)
    const webhookUrl = process.env.N8N_UPDATE_WEBHOOK;
    if (webhookUrl) {
      try {
        await axios.put(webhookUrl, {
          documentId: clientId,
          ...data,
        }, { timeout: 3000 }); // Timeout de 3s
        console.log(`✅ Also updated via N8N`);
      } catch (n8nError: any) {
        console.log(`ℹ️ N8N update skipped (not critical): ${n8nError.message}`);
      }
    }
    // } else {
    //   console.error('❌ Supabase credentials not configured - QR will NOT be saved to database!');
    //   console.error('❌ Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables');
    // }
  } catch (error: any) {
    console.error('❌ Error updating instance:', error.message);
    if (error.response) {
      console.error('❌ Response status:', error.response.status);
      console.error('❌ Response data:', error.response.data);
    }
  }
}

// Función para restaurar todas las sesiones existentes al iniciar el servidor
export async function restoreAllSessions(): Promise<void> {
  console.log('🔄 Restoring existing sessions from Supabase...');

  // const supabase = createClient(supabaseUrl, supabaseKey); // USAR SINGLETON

  try {
    // Buscar todas las sesiones que tienen credenciales guardadas
    // Asumimos que si existe la key 'creds', la sesión es válida
    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .select('session_id')
      .eq('key', 'creds');

    if (error) {
      console.error('❌ Error fetching sessions from Supabase:', error);
      // Check if it's a connection error (e.g. invalid URL or network issue)
      if (error.message && (error.message.includes('fetch failed') || error.message.includes('ENOTFOUND'))) {
        console.error('⚠️  HINT: Check your SUPABASE_URL and network connectivity.');
        const supabaseUrl = process.env.SUPABASE_URL;
        console.error(`⚠️  Current SUPABASE_URL: ${supabaseUrl ? supabaseUrl.replace(/:[^:]*@/, ':****@') : 'NOT SET'}`);
      }
      return;
    }

    if (!data || data.length === 0) {
      console.log('ℹ️ No existing sessions found in database');
      return;
    }

    // Eliminar duplicados por si acaso (aunque key='creds' debería ser único por session_id)
    const sessionIds = [...new Set(data.map(row => row.session_id))];

    console.log(`[WHATSAPP] Discovered ${sessionIds.length} session(s) in database`);

    // Restore each session
    for (const clientId of sessionIds) {
      try {
        console.log(`[WHATSAPP] Restoring session: ${clientId}`);
        await createWhatsAppSession(clientId);
        // Brief pause between connections
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error: any) {
        console.error(`[WHATSAPP] Session restoration failed for ${clientId}:`, error.message);
      }
    }

    console.log(`[WHATSAPP] Session restoration completed. Active sessions: ${sessions.size}`);
  } catch (error: any) {
    console.error('❌ Error in restoreAllSessions:', error.message);
  }
}

/**
 * Sincronizar contactos con Supabase
 */
async function syncContacts(instanceId: string, contacts: any[]): Promise<void> {
  if (!contacts || contacts.length === 0) return;

  console.log(`[${instanceId}] 👥 Syncing ${contacts.length} contacts...`);

  // const supabase = createClient(supabaseUrl, supabaseKey); // USAR SINGLETON

  // Preparar datos para upsert
  const contactsData = contacts.map(c => ({
    instance_id: instanceId,
    jid: c.id,
    name: c.name || c.notify || c.verifiedName,
    push_name: c.notify,
    profile_pic_url: c.imgUrl, // Baileys a veces trae esto
    updated_at: new Date()
  }));

  // Procesar en lotes de 50 para no saturar
  const batchSize = 50;
  for (let i = 0; i < contactsData.length; i += batchSize) {
    const batch = contactsData.slice(i, i + batchSize);

    const { error } = await supabase
      .from('contacts')
      .upsert(batch, {
        onConflict: 'instance_id,jid',
        ignoreDuplicates: false
      });

    if (error) {
      console.error(`[${instanceId}] ❌ Error syncing contacts batch ${i}:`, error.message);
    }
  }

  console.log(`[${instanceId}] ✅ Contacts synced successfully`);
}
