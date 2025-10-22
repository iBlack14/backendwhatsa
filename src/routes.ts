import { Router, Request, Response } from 'express';
import {
  createWhatsAppSession,
  sendMessage,
  getSession,
  getAllSessions,
  disconnectSession,
} from './whatsapp';
import { CreateSessionRequest, SendMessageRequest } from './types';

const router = Router();

// Health check
router.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    message: 'WhatsApp Backend is running',
    timestamp: new Date().toISOString()
  });
});

// Crear sesión
router.post('/api/create-session', async (req: Request, res: Response) => {
  try {
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    
    let { clientId } = req.body as CreateSessionRequest;

    // Limpiar el = del inicio si existe (bug de N8N)
    if (clientId && clientId.startsWith('=')) {
      clientId = clientId.substring(1);
      console.log('🧹 Cleaned clientId:', clientId);
    }

    console.log('📋 ClientId received:', clientId);
    console.log('📋 ClientId type:', typeof clientId);

    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required' });
    }

    await createWhatsAppSession(clientId);

    res.json({
      success: true,
      message: 'Session created successfully',
      clientId,
    });
  } catch (error: any) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener QR
router.get('/api/qr/:clientId', (req: Request, res: Response) => {
  const { clientId } = req.params;
  const session = getSession(clientId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    qr: session.qr,
    state: session.state,
    phoneNumber: session.phoneNumber,
    profileName: session.profileName,
  });
});

// Obtener todas las sesiones
router.get('/api/sessions', (req: Request, res: Response) => {
  const sessions = getAllSessions();
  
  const sessionsData = sessions.map(s => ({
    clientId: s.clientId,
    state: s.state,
    phoneNumber: s.phoneNumber,
    profileName: s.profileName,
    hasQR: !!s.qr,
  }));

  res.json({
    success: true,
    count: sessionsData.length,
    sessions: sessionsData,
  });
});

// Enviar mensaje
router.post('/api/send-message', async (req: Request, res: Response) => {
  try {
    const { clientId, to, message } = req.body as SendMessageRequest;

    if (!clientId || !to || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields: clientId, to, message' 
      });
    }

    await sendMessage(clientId, to, message);

    res.json({
      success: true,
      message: 'Message sent successfully',
    });
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Desconectar sesión
router.post('/api/disconnect/:clientId', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    await disconnectSession(clientId);

    res.json({
      success: true,
      message: 'Session disconnected successfully',
    });
  } catch (error: any) {
    console.error('Error disconnecting session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Desconectar sesión (ruta alternativa para compatibilidad)
router.post('/api/disconnect-session/:documentId', async (req: Request, res: Response) => {
  try {
    const { documentId } = req.params;
    await disconnectSession(documentId);

    res.json({
      success: true,
      message: 'Session disconnected successfully',
    });
  } catch (error: any) {
    console.error('Error disconnecting session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generar QR para sesión existente
router.post('/api/generate-qr', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.body;

    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required' });
    }

    // Verificar si la sesión ya existe
    const existingSession = getSession(clientId);
    
    if (existingSession && existingSession.state === 'Connected') {
      return res.status(400).json({ 
        error: 'Session is already connected',
        state: existingSession.state 
      });
    }

    // Si existe pero está desconectada, desconectarla primero
    if (existingSession) {
      await disconnectSession(clientId);
    }

    // Crear nueva sesión (generará QR automáticamente)
    await createWhatsAppSession(clientId);

    res.json({
      success: true,
      message: 'QR generation started',
      clientId,
    });
  } catch (error: any) {
    console.error('Error generating QR:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener perfil de WhatsApp
router.get('/api/profile/:documentId', (req: Request, res: Response) => {
  const { documentId } = req.params;
  const session = getSession(documentId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.state !== 'Connected') {
    return res.status(400).json({ 
      error: 'Session not connected',
      state: session.state 
    });
  }

  res.json({
    name: session.profileName || 'Unknown',
    profilePicUrl: session.profilePicUrl || null,
    number: session.phoneNumber || null,
  });
});

// Actualizar webhook (para compatibilidad con N8N)
router.post('/api/update-webhook/:clientId', (req: Request, res: Response) => {
  const { clientId } = req.params;
  const { webhook_url } = req.body;

  console.log(`📝 Webhook updated for ${clientId}:`, webhook_url);

  res.json({
    success: true,
    message: 'Webhook updated successfully',
  });
});

// Enviar mensaje (formato N8N con API Key)
router.post('/api/send-message/:clientId', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { number, message } = req.body;
    const apiKey = req.headers.authorization;

    // Verificar API Key (opcional - puedes agregar validación aquí)
    if (!apiKey) {
      return res.status(401).json({ error: 'API Key required' });
    }

    if (!number || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields: number, message' 
      });
    }

    await sendMessage(clientId, number, message);

    res.json({
      success: true,
      message: 'Message sent successfully',
      to: number,
    });
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enviar imagen (formato N8N con API Key)
router.post('/api/send-image/:clientId', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { number, file, message } = req.body;
    const apiKey = req.headers.authorization;

    // Verificar API Key (opcional)
    if (!apiKey) {
      return res.status(401).json({ error: 'API Key required' });
    }

    if (!number || !file) {
      return res.status(400).json({ 
        error: 'Missing required fields: number, file' 
      });
    }

    const session = getSession(clientId);
    if (!session || session.state !== 'Connected') {
      return res.status(400).json({ error: 'Session not connected' });
    }

    const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
    
    console.log(`📤 Sending image to ${number} (JID: ${jid}) from ${clientId}`);
    console.log(`📷 Image URL: ${file}`);
    console.log(`💬 Caption: ${message || '(no caption)'}`);
    
    try {
      const result = await session.sock.sendMessage(jid, {
        image: { url: file },
        caption: message || '',
      });
      
      console.log(`✅ Image sent successfully. Message ID:`, result?.key?.id);
    } catch (sendError: any) {
      console.error(`❌ Error sending message:`, sendError.message);
      throw sendError;
    }

    res.json({
      success: true,
      message: 'Image sent successfully',
      to: number,
    });
  } catch (error: any) {
    console.error('Error sending image:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
