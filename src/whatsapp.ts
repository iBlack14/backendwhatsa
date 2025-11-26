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
import { createClient } from '@supabase/supabase-js';
import { useSupabaseAuthState } from './auth/SupabaseAuthState';

const sessions = new Map<string, WhatsAppSession>();

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
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase credentials not configured');
      return undefined;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

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
 * Extraer texto completo del mensaje
 * @param message - Objeto de mensaje de Baileys
 * @returns Texto del mensaje o undefined
 */
function extractMessageText(message: any): string | undefined {
  if (!message) return undefined;

  // Texto simple
  if (message.conversation) return message.conversation;

  // Texto extendido (con formato, links, menciones, etc)
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;

  // Caption de imagen
  if (message.imageMessage?.caption) return message.imageMessage.caption;

  // Caption de video
  if (message.videoMessage?.caption) return message.videoMessage.caption;

  // Caption de documento
  if (message.documentMessage?.caption) return message.documentMessage.caption;

  // Respuesta de botón
  if (message.buttonsResponseMessage?.selectedButtonId) {
    return `Botón: ${message.buttonsResponseMessage.selectedDisplayText || message.buttonsResponseMessage.selectedButtonId}`;
  }

  // Respuesta de lista
  if (message.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return `Lista: ${message.listResponseMessage.title || message.listResponseMessage.singleSelectReply.selectedRowId}`;
  }

  // Template button reply
  if (message.templateButtonReplyMessage?.selectedId) {
    return `Botón: ${message.templateButtonReplyMessage.selectedDisplayText || message.templateButtonReplyMessage.selectedId}`;
  }

  // Ubicación
  if (message.locationMessage) {
    const lat = message.locationMessage.degreesLatitude;
    const lng = message.locationMessage.degreesLongitude;
    return `📍 Ubicación: ${lat}, ${lng}`;
  }

  // Contacto
  if (message.contactMessage) {
    return `👤 Contacto: ${message.contactMessage.displayName || 'Sin nombre'}`;
  }

  // Contactos múltiples
  if (message.contactsArrayMessage) {
    const count = message.contactsArrayMessage.contacts?.length || 0;
    return `👥 ${count} contacto(s)`;
  }

  // Reacción
  if (message.reactionMessage) {
    return `${message.reactionMessage.text} (reacción)`;
  }

  // Poll/Encuesta
  if (message.pollCreationMessage) {
    return `📊 Encuesta: ${message.pollCreationMessage.name}`;
  }

  // Sticker (emoji o descripción)
  if (message.stickerMessage) {
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

  // Detectar tipos específicos de Baileys
  if (message.conversation) return 'text';
  if (message.extendedTextMessage) return 'text';
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.audioMessage) {
    // Diferenciar entre audio y nota de voz
    return message.audioMessage.ptt ? 'voice' : 'audio';
  }
  if (message.documentMessage) return 'document';
  if (message.stickerMessage) return 'sticker';
  if (message.locationMessage) return 'location';
  if (message.liveLocationMessage) return 'location';
  if (message.contactMessage) return 'contact';
  if (message.contactsArrayMessage) return 'contacts';
  if (message.buttonsResponseMessage) return 'button_reply';
  if (message.templateButtonReplyMessage) return 'button_reply';
  if (message.listResponseMessage) return 'list_reply';
  if (message.reactionMessage) return 'reaction';
  if (message.pollCreationMessage) return 'poll';
  if (message.pollUpdateMessage) return 'poll_update';

  // Si no se detecta, retornar el primer key como fallback
  const keys = Object.keys(message);
  return keys.length > 0 ? keys[0].replace('Message', '') : 'unknown';
}

/**
 * Helper para obtener el webhook_url de una instancia desde Supabase
 * @param instanceId - ID de la instancia
 * @returns webhook_url o null si no existe
 */
async function getInstanceWebhookUrl(instanceId: string): Promise<string | null> {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return null;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

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
    console.log(`✅ Session ${clientId} already exists`);
    return;
  }

  console.log(`🔄 Creating session for ${clientId}...`);

  // Usar autenticación basada en Supabase
  const { state, saveCreds } = await useSupabaseAuthState(clientId);

  // Obtener proxy si está configurado
  const proxy = await proxyService.getProxyForInstance(clientId);
  let agent = undefined;

  if (proxy) {
    console.log(`🌐 Using proxy: ${proxy.name} (${proxy.type}://${proxy.host}:${proxy.port})`);
    agent = proxyService.createProxyAgent(proxy);
  } else {
    console.log(`📡 No proxy configured for instance ${clientId}`);
  }

  const sock = makeWASocket({
    auth: state,
    browser: ['Chrome (Linux)', '', ''],
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
      console.log('\n' + '='.repeat(60));
      console.log(`📱 QR CODE GENERATED FOR: ${clientId}`);
      console.log('='.repeat(60));
      console.log('👉 Scan this QR code with WhatsApp to connect');
      console.log('='.repeat(60) + '\n');

      // Imprimir QR en la terminal para debugging
      try {
        const qrTerminal = require('qrcode-terminal');
        qrTerminal.generate(qr, { small: true });
      } catch (e) {
        console.log('⚠️ qrcode-terminal not installed, skipping terminal QR');
      }

      // Convertir QR a base64 para el frontend
      console.log(`🔄 Converting QR to base64...`);
      const qrBase64 = await QRCode.toDataURL(qr);
      session.qr = qrBase64;
      session.state = 'Initializing';

      console.log(`💾 Saving QR to database (length: ${qrBase64.length} chars)...`);
      await updateInstanceInN8N(clientId, {
        state: 'Initializing',
        qr: qrBase64,
        qr_loading: false, // Cambiar a false porque el QR ya está listo
      });
      console.log(`✅ QR saved! Frontend should receive it within 1-2 seconds.`);
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut;

      console.log(
        `❌ Connection closed for ${clientId}. Reconnect:`,
        shouldReconnect
      );

      if (shouldReconnect) {
        // Marcar sesión como desconectada antes de eliminar
        session.state = 'Disconnected';
        // Eliminar sesión existente antes de reconectar
        sessions.delete(clientId);
        console.log(`🔄 Reconnecting session ${clientId}...`);
        // Pequeño delay para evitar race conditions
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
      console.log(`✅ Connection opened for ${clientId}`);
      session.state = 'Connected';
      session.qr = null;

      // Obtener info del usuario
      const user = sock.user;
      if (user) {
        session.phoneNumber = user.id.split(':')[0];
        session.profileName = user.name || '';
        console.log(`📞 Phone: ${session.phoneNumber}`);
        console.log(`👤 Name: ${session.profileName}`);

        // Intentar obtener foto de perfil
        try {
          const jid = user.id;
          const profilePicUrl = await sock.profilePictureUrl(jid, 'image');
          session.profilePicUrl = profilePicUrl;
          console.log(`📸 Profile pic: ${profilePicUrl ? 'Found' : 'Not found'}`);
        } catch (error) {
          console.log(`⚠️ Could not get profile picture`);
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

  // ✅✅ WEBHOOK: Notificar al frontend cuando se envían/reciben mensajes
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log(`[${clientId}] 📨 messages.upsert event - ${messages.length} message(s)`);

    for (const msg of messages) {
      try {
        const fromMe = msg.key.fromMe;
        const remoteJid = msg.key.remoteJid;
        const messageId = msg.key.id;

        console.log(`[${clientId}] ${fromMe ? '📤 Sent' : '📥 Received'} message - ${remoteJid}`);

        // 💾 Guardar mensaje en la base de datos
        try {
          // Usar la nueva función para extraer texto completo
          const messageText = extractMessageText(msg.message);
          const messageType = detectMessageType(msg.message);

          console.log(`[${clientId}] 📋 Message type: ${messageType}`);
          if (messageText) {
            console.log(`[${clientId}] 💬 Content: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`);
          }

          // Extraer nombre del contacto
          const senderName = msg.pushName || undefined;
          const senderPhone = remoteJid?.split('@')[0] || undefined;

          // Extraer información adicional según el tipo
          let mediaUrl = undefined;
          let fileName = undefined;
          let mimeType = undefined;

          // Descargar media si existe
          try {
            if (messageType === 'image' && msg.message?.imageMessage) {
              fileName = (msg.message.imageMessage as any).fileName || `image_${Date.now()}.jpg`;
              mimeType = msg.message.imageMessage.mimetype || 'image/jpeg';
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
            } else if (messageType === 'video' && msg.message?.videoMessage) {
              fileName = (msg.message.videoMessage as any).fileName || `video_${Date.now()}.mp4`;
              mimeType = msg.message.videoMessage.mimetype || 'video/mp4';
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
            } else if (messageType === 'audio' && msg.message?.audioMessage) {
              fileName = `audio_${Date.now()}.mp3`;
              mimeType = msg.message.audioMessage.mimetype || 'audio/mpeg';
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
            } else if (messageType === 'voice' && msg.message?.audioMessage) {
              fileName = `voice_${Date.now()}.ogg`;
              mimeType = msg.message.audioMessage.mimetype || 'audio/ogg';
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
            } else if (messageType === 'document' && msg.message?.documentMessage) {
              fileName = (msg.message.documentMessage as any).fileName || `document_${Date.now()}`;
              mimeType = msg.message.documentMessage.mimetype || 'application/octet-stream';
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
            } else if (messageType === 'sticker' && msg.message?.stickerMessage) {
              fileName = `sticker_${Date.now()}.webp`;
              mimeType = msg.message.stickerMessage.mimetype || 'image/webp';
              const buffer = await downloadMediaMessage(msg, 'buffer', {});
              mediaUrl = await uploadMediaToSupabase(clientId, buffer as Buffer, fileName, mimeType);
            }

            if (mediaUrl) {
              console.log(`[${clientId}] 📎 Media uploaded: ${mediaUrl}`);
            }
          } catch (mediaError) {
            console.error(`[${clientId}] ❌ Error downloading/uploading media:`, mediaError);
          }

          // Intentar obtener foto de perfil del contacto
          let profilePicUrl: string | undefined = undefined;
          try {
            if (remoteJid && !fromMe) {
              // Para chats individuales, usar el JID del remitente
              // Para grupos, usar el JID del grupo
              const picJid = remoteJid;
              profilePicUrl = await sock.profilePictureUrl(picJid, 'image');
              console.log(`[${clientId}] 📸 Profile pic obtained for ${picJid}`);
            }
          } catch (picError) {
            // No hay foto de perfil o error al obtenerla
            console.log(`[${clientId}] ⚠️ No profile pic for ${remoteJid}`);
          }

          await messageService.saveMessage({
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
          });

          console.log(`[${clientId}] ✅ Message saved to database`);
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
            console.log(`[${clientId}] 🏠 Using internal webhook (Templates): ${webhookUrl}`);
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

        console.log(`[${clientId}] ✅ Webhook sent (${webhookMode}): ${fromMe ? 'sent' : 'received'}`);
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
    const supabaseUrl = process.env.SUPABASE_URL;
    // Aceptar ambos nombres: SUPABASE_SERVICE_KEY o SERVICE_ROLE_KEY
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;

    console.log(`📌 Supabase URL: ${supabaseUrl ? 'Configured ✅' : 'Not configured ❌'}`);
    console.log(`📌 Supabase Key: ${supabaseKey ? 'Configured ✅' : 'Not configured ❌'}`);

    if (supabaseUrl && supabaseKey) {
      const updateUrl = `${supabaseUrl}/rest/v1/instances?document_id=eq.${clientId}`;
      console.log(`🌐 Updating Supabase at: ${updateUrl}`);

      const response = await axios.patch(
        updateUrl,
        data,
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
        }
      );
      console.log(`✅ Updated instance ${clientId} in Supabase - Status: ${response.status}`);

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
    } else {
      console.error('❌ Supabase credentials not configured - QR will NOT be saved to database!');
    }
  } catch (picError) {
    // No hay foto de perfil o error al obtenerla
    console.log(`[${clientId}] ⚠️ No profile pic for ${remoteJid}`);
  }

  await messageService.saveMessage({
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
  });

  console.log(`[${clientId}] ✅ Message saved to database`);
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
    console.log(`[${clientId}] 🏠 Using internal webhook (Templates): ${webhookUrl}`);
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

console.log(`[${clientId}] ✅ Webhook sent (${webhookMode}): ${fromMe ? 'sent' : 'received'}`);
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
    const supabaseUrl = process.env.SUPABASE_URL;
    // Aceptar ambos nombres: SUPABASE_SERVICE_KEY o SERVICE_ROLE_KEY
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;

    console.log(`📌 Supabase URL: ${supabaseUrl ? 'Configured ✅' : 'Not configured ❌'}`);
    console.log(`📌 Supabase Key: ${supabaseKey ? 'Configured ✅' : 'Not configured ❌'}`);

    if (supabaseUrl && supabaseKey) {
      const updateUrl = `${supabaseUrl}/rest/v1/instances?document_id=eq.${clientId}`;
      console.log(`🌐 Updating Supabase at: ${updateUrl}`);

      const response = await axios.patch(
        updateUrl,
        data,
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
        }
      );
      console.log(`✅ Updated instance ${clientId} in Supabase - Status: ${response.status}`);

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
    } else {
      console.error('❌ Supabase credentials not configured - QR will NOT be saved to database!');
      console.error('❌ Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables');
    }
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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase credentials not configured. Cannot restore sessions.');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Buscar todas las sesiones que tienen credenciales guardadas
    // Asumimos que si existe la key 'creds', la sesión es válida
    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .select('session_id')
      .eq('key', 'creds');

    if (error) {
      console.error('❌ Error fetching sessions from Supabase:', error);
      return;
    }

    if (!data || data.length === 0) {
      console.log('ℹ️ No existing sessions found in database');
      return;
    }

    // Eliminar duplicados por si acaso (aunque key='creds' debería ser único por session_id)
    const sessionIds = [...new Set(data.map(row => row.session_id))];

    console.log(`📂 Found ${sessionIds.length} session(s) in database`);

    // Restaurar cada sesión
    for (const clientId of sessionIds) {
      try {
        console.log(`🔄 Restoring session: ${clientId}`);
        await createWhatsAppSession(clientId);
        // Pequeña pausa entre conexiones
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error: any) {
        console.error(`❌ Failed to restore session ${clientId}:`, error.message);
      }
    }

    console.log(`✅ Session restoration complete. Active sessions: ${sessions.size}`);
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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn(`[${instanceId}] ⚠️ Supabase credentials missing, skipping contact sync`);
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

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
