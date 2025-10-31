import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { WhatsAppSession } from './types';

const sessions = new Map<string, WhatsAppSession>();

export async function createWhatsAppSession(clientId: string): Promise<void> {
  if (sessions.has(clientId)) {
    console.log(`✅ Session ${clientId} already exists`);
    return;
  }

  console.log(`🔄 Creating session for ${clientId}...`);

  const sessionPath = path.join(__dirname, '../sessions', clientId);
  
  // Asegurar que el directorio de sesiones existe
  const sessionsDir = path.join(__dirname, '../sessions');
  if (!fs.existsSync(sessionsDir)) {
    console.log('📁 Creating sessions directory...');
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
  
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    browser: ['Chrome (Linux)', '', ''],
    // Configuración adicional para mejorar conexión
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
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

  // ✅✅ WEBHOOK: Notificar al frontend cuando se envían/reciben mensajes
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log(`[${clientId}] 📨 messages.upsert event - ${messages.length} message(s)`);
    
    for (const msg of messages) {
      try {
        const fromMe = msg.key.fromMe;
        const remoteJid = msg.key.remoteJid;
        const messageId = msg.key.id;
        
        console.log(`[${clientId}] ${fromMe ? '📤 Sent' : '📥 Received'} message - ${remoteJid}`);
        
        // Obtener URL del frontend desde variable de entorno
        const frontendUrl = process.env.FRONTEND_URL;
        
        if (!frontendUrl) {
          console.warn(`[${clientId}] ⚠️ FRONTEND_URL not configured, skipping webhook`);
          continue;
        }
        
        // Enviar webhook al frontend
        const webhookUrl = `${frontendUrl}/api/webhooks/whatsapp`;
        
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
        
        console.log(`[${clientId}] ✅ Webhook sent to frontend: ${fromMe ? 'sent' : 'received'}`);
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
    // Primero intentar actualizar via N8N (si está configurado)
    const webhookUrl = process.env.N8N_UPDATE_WEBHOOK;
    console.log(`📌 N8N webhook URL: ${webhookUrl ? 'Configured ✅' : 'Not configured ❌'}`);
    
    if (webhookUrl) {
      try {
        await axios.put(webhookUrl, {
          documentId: clientId,
          ...data,
        });
        console.log(`✅ Updated instance ${clientId} via N8N`);
      } catch (n8nError: any) {
        console.warn('⚠️ N8N update failed, will try Supabase directly:', n8nError.message);
      }
    }

    // También actualizar directamente en Supabase como respaldo
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
  console.log('🔄 Restoring existing sessions...');
  
  const sessionsDir = path.join(__dirname, '../sessions');
  
  // Verificar si el directorio de sesiones existe
  if (!fs.existsSync(sessionsDir)) {
    console.log('⚠️ No sessions directory found. Creating...');
    fs.mkdirSync(sessionsDir, { recursive: true });
    return;
  }

  // Leer todas las carpetas de sesiones
  const sessionFolders = fs.readdirSync(sessionsDir);
  
  if (sessionFolders.length === 0) {
    console.log('ℹ️ No existing sessions found');
    return;
  }

  console.log(`📂 Found ${sessionFolders.length} session folder(s)`);
  
  // Restaurar cada sesión que tenga credenciales guardadas
  for (const clientId of sessionFolders) {
    const sessionPath = path.join(sessionsDir, clientId);
    
    // Verificar si es un directorio
    if (!fs.statSync(sessionPath).isDirectory()) {
      continue;
    }

    // Verificar si tiene credenciales (archivo creds.json)
    const credsPath = path.join(sessionPath, 'creds.json');
    if (!fs.existsSync(credsPath)) {
      console.log(`⚠️ Skipping ${clientId} - no credentials found`);
      continue;
    }

    try {
      console.log(`🔄 Restoring session: ${clientId}`);
      await createWhatsAppSession(clientId);
      // Pequeña pausa entre conexiones para evitar sobrecarga
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error: any) {
      console.error(`❌ Failed to restore session ${clientId}:`, error.message);
    }
  }
  
  console.log(`✅ Session restoration complete. Active sessions: ${sessions.size}`);
}
