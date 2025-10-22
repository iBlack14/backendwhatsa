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
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true, // Mostrar QR en terminal también
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
      console.log(`📱 QR Code generated for ${clientId}`);
      
      // Convertir QR a base64 para el frontend
      const qrBase64 = await QRCode.toDataURL(qr);
      session.qr = qrBase64;
      session.state = 'Initializing';
      
      await updateInstanceInN8N(clientId, {
        state: 'Initializing',
        qr: qrBase64,
        qr_loading: true,
      });
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
        // Eliminar sesión existente antes de reconectar
        sessions.delete(clientId);
        console.log(`🔄 Reconnecting session ${clientId}...`);
        await createWhatsAppSession(clientId);
      } else {
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
}

export async function sendMessage(
  clientId: string,
  to: string,
  message: string
): Promise<void> {
  const session = sessions.get(clientId);

  if (!session || session.state !== 'Connected') {
    throw new Error('Session not connected');
  }

  const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
  
  console.log(`📤 Sending message to ${to} from ${clientId}`);
  await session.sock.sendMessage(jid, { text: message });
  console.log(`✅ Message sent successfully`);
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
  try {
    // Primero intentar actualizar via N8N (si está configurado)
    const webhookUrl = process.env.N8N_UPDATE_WEBHOOK;
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
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (supabaseUrl && supabaseKey) {
      await axios.patch(
        `${supabaseUrl}/rest/v1/instances?document_id=eq.${clientId}`,
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
      console.log(`✅ Updated instance ${clientId} in Supabase`);
    } else {
      console.warn('⚠️ Supabase credentials not configured');
    }
  } catch (error: any) {
    console.error('❌ Error updating instance:', error.message);
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
