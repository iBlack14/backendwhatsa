/**
 * WHATSAPP SESSION MANAGER
 * ====================================
 * Módulo principal para gestión de sesiones de WhatsApp con Baileys.
 * Maneja la conexión, autenticación, QR y eventos de WhatsApp.
 * 
 * Arquitectura refactorizada:
 * - Utiliza MessageProcessor para procesar mensajes
 * - Delega el manejo de multimedia a MediaHandler
 * - Usa messageParser para análisis de mensajes
 */

import makeWASocket, {
  DisconnectReason,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
// @ts-ignore - QRCode no tiene tipos oficiales, funciona correctamente
import QRCode from 'qrcode';
import { WhatsAppSession } from './types';
import { proxyService } from './services/proxy.service';
import { useSupabaseAuthState } from './auth/SupabaseAuthState';
import { wsService } from './websocket';
import { supabase } from './lib/supabase';
import { whatsappLogger } from './utils/logger';
import { processAndSaveMessage } from './handlers/MessageProcessor';

/**
 * Mapa de sesiones activas de WhatsApp.
 * Key: clientId (instance ID)
 * Value: WhatsAppSession (socket, estado, QR, etc.)
 */
const sessions = new Map<string, WhatsAppSession>();

/**
 * Crea y configura una nueva sesión de WhatsApp usando Baileys.
 * 
 * Flujo de inicialización:
 * 1. Verifica que la sesión no exista ya
 * 2. Carga el estado de autenticación desde Supabase
 * 3. Configura el proxy si está disponible
 * 4. Crea el socket de WhatsApp
 * 5. Registra event listeners (conexión, mensajes, contactos)
 * 
 * @param clientId - ID único de la instancia de WhatsApp
 */
export async function createWhatsAppSession(clientId: string): Promise<void> {
  // Evitar duplicación de sesiones
  if (sessions.has(clientId)) {
    console.warn(`[${clientId}] ⚠️ Session already exists, skipping creation.`);
    return;
  }

  console.log(`[${clientId}] 🔄 Creating WhatsApp session...`);

  // ──────────────────────────────────────
  // 📋 PASO 1: Cargar estado de autenticación
  // ──────────────────────────────────────

  const { state, saveCreds } = await useSupabaseAuthState(clientId);

  // ──────────────────────────────────────
  // 🌐 PASO 2: Configurar proxy (si existe)
  // ──────────────────────────────────────

  const proxy = await proxyService.getProxyForInstance(clientId);
  let agent = proxy ? proxyService.createProxyAgent(proxy) : undefined;

  if (proxy) {
    console.log(`[${clientId}] 🌐 Using proxy: ${proxy.host}:${proxy.port}`);
  }

  // ──────────────────────────────────────
  // 🔁 PASO 3: Configurar caché de reintentos
  // ──────────────────────────────────────

  const retryMap = new Map<string, any>();
  const msgRetryCounterCache: any = {
    get: (key: string) => retryMap.get(key),
    set: (key: string, value: any) => { retryMap.set(key, value) },
    del: (key: string) => retryMap.delete(key),
    flushAll: () => retryMap.clear()
  };

  // ──────────────────────────────────────
  // 🔌 PASO 4: Crear socket de WhatsApp
  // ──────────────────────────────────────

  const sock = makeWASocket({
    auth: state,
    browser: ['Chrome (Linux)', '', ''], // Emular navegador Chrome
    logger: whatsappLogger.child({ clientId }, { level: 'fatal' }), // Logs mínimos
    connectTimeoutMs: 60000,  // 1 minuto para conectar
    defaultQueryTimeoutMs: 60000, // 1 minuto timeout por query
    keepAliveIntervalMs: 30000, // Ping cada 30 segundos
    agent, // Proxy agent si existe
    msgRetryCounterCache,
    retryRequestDelayMs: 250,
  });

  // Crear objeto de sesión
  const session: WhatsAppSession = {
    clientId,
    sock,
    qr: null,
    state: 'Initializing'
  };

  sessions.set(clientId, session);
  console.log(`[${clientId}] ✅ Session object created.`);

  // ──────────────────────────────────────
  // 🎧 PASO 5: Registrar event listeners
  // ──────────────────────────────────────

  // 🔐 Evento: Actualización de credenciales
  sock.ev.on('creds.update', saveCreds);

  // 🔌 Evento: Cambio en el estado de conexión
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // ──────────────────────
    // QR Code actualizado
    // ──────────────────────
    if (qr) {
      const qrBase64 = await QRCode.toDataURL(qr);
      session.qr = qrBase64;

      console.log(`[${clientId}] 📱 QR Code generated.`);

      await updateInstanceInN8N(clientId, {
        state: 'Initializing',
        qr: qrBase64,
        qr_loading: false
      });
    }

    // ──────────────────────
    // Conexión cerrada
    // ──────────────────────
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log(`[${clientId}] 🔄 Connection closed, reconnecting in 2s...`);
        sessions.delete(clientId);
        setTimeout(() => createWhatsAppSession(clientId), 2000);
      } else {
        console.log(`[${clientId}] ❌ Logged out, session terminated.`);
        sessions.delete(clientId);
        await updateInstanceInN8N(clientId, {
          state: 'Disconnected',
          qr: null,
          qr_loading: false
        });
      }
    }

    // ──────────────────────
    // Conexión exitosa
    // ──────────────────────
    else if (connection === 'open') {
      session.state = 'Connected';
      session.qr = null;

      const user = sock.user;
      if (user) {
        session.phoneNumber = user.id.split(':')[0];
        session.profileName = user.name || '';

        // Intentar obtener foto de perfil
        try {
          session.profilePicUrl = await sock.profilePictureUrl(user.id, 'image');
        } catch (e) {
          console.warn(`[${clientId}] ⚠️ Could not fetch profile picture.`);
        }

        console.log(`[${clientId}] ✅ Connected as ${session.phoneNumber}`);
      }

      // Actualizar base de datos
      await updateInstanceInN8N(clientId, {
        state: 'Connected',
        qr: null,
        qr_loading: false,
        phone_number: session.phoneNumber,
        profile_name: session.profileName,
        profile_pic_url: session.profilePicUrl,
      });

      // Notificar via WebSocket
      wsService.emitInstanceStateChange(clientId, 'Connected');
    }
  });

  // 👥 Evento: Actualización de contactos
  sock.ev.on('contacts.upsert', async (contacts) => {
    await syncContacts(clientId, contacts);
  });

  // 📥 Evento: Nuevos mensajes recibidos
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      await processAndSaveMessage(clientId, sock, msg);
    }
  });

  // 🔄 Evento: Actualización de mensajes existentes
  // IMPORTANTE: Maneja desencriptación diferida de mensajes "Ver una vez"
  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      if (update.update.message) {
        // Reconstruir objeto de mensaje completo
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

  console.log(`[${clientId}] 🎧 Event listeners registered.`);
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
    try {
      // Intentar cerrar el socket gracefuly
      if (session.sock) {
        // Solo intentar logout si el socket parece estar abierto o conectado
        await session.sock.logout().catch((err: any) => {
          console.warn(`[${clientId}] ⚠️ Error during logout (cleanup will continue):`, err?.message || err);
        });

        // También cerramos la conexión de WS si está abierta y no fue cerrada por logout
        try {
          session.sock.end(undefined);
        } catch (e) { }
      }
    } catch (error) {
      console.error(`[${clientId}] ❌ Error disconnecting session:`, error);
    } finally {
      // SIEMPRE eliminar la sesión del mapa, pase lo que pase
      sessions.delete(clientId);
      console.log(`[${clientId}] 🗑️ Session removed from memory.`);
    }
  } else {
    console.log(`[${clientId}] ⚠️ Session not found to disconnect.`);
  }
}

async function updateInstanceInN8N(clientId: string, data: any): Promise<void> {
  try {
    await supabase.from('instances').update(data).eq('document_id', clientId);
  } catch (e) { }
}

/**
 * Restaura todas las sesiones de WhatsApp guardadas en Supabase.
 * Útil para reiniciar el servidor sin perder conexiones activas.
 */
export async function restoreAllSessions(): Promise<void> {
  try {
    const { data } = await supabase
      .from('whatsapp_sessions')
      .select('session_id')
      .eq('key', 'creds');

    if (!data) return;

    // Extraer IDs únicos con tipado correcto
    const sessionIds = [...new Set(
      data.map((row: { session_id: string }) => row.session_id)
    )];

    // Crear sesiones con delay de 2 segundos entre cada una
    for (const clientId of sessionIds) {
      await createWhatsAppSession(clientId as string);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`✅ Restored ${sessionIds.length} WhatsApp sessions`);
  } catch (error) {
    console.error('❌ Error restoring sessions:', error);
  }
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
