import { Router, Request, Response } from 'express';
import {
  createWhatsAppSession,
  sendMessage,
  getSession,
  getAllSessions,
  disconnectSession,
} from './whatsapp';
import { CreateSessionRequest, SendMessageRequest } from './types';
import dockerService from './services/docker.service';
import easypanelService from './services/easypanel.service';
import { createClient } from '@supabase/supabase-js';
import plansRouter from './routes/plans.routes';
import proxiesRouter from './routes/proxies.routes';
import messagesRouter from './routes/messages.routes';
import { validateApiKey } from './middleware/auth.middleware';

const router = Router();

// Supabase client - aceptar ambos nombres de variable
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY || ''
);

// Health check
router.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    message: 'WhatsApp Backend is running',
    timestamp: new Date().toISOString()
  });
});

// ✅ Proteger TODAS las rutas con API key
// Crear sesión
router.post('/api/create-session', validateApiKey, async (req: Request, res: Response) => {
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
router.get('/api/qr/:clientId', validateApiKey, (req: Request, res: Response) => {
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
router.get('/api/sessions', validateApiKey, (req: Request, res: Response) => {
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
router.post('/api/send-message', validateApiKey, async (req: Request, res: Response) => {
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
router.post('/api/disconnect/:clientId', validateApiKey, async (req: Request, res: Response) => {
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
router.post('/api/disconnect-session/:documentId', validateApiKey, async (req: Request, res: Response) => {
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
router.post('/api/send-message/:clientId', validateApiKey, async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { number, message } = req.body;

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
router.post('/api/send-image/:clientId', validateApiKey, async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { number, file, message } = req.body;

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

// ========== RUTAS DE EASYPANEL / N8N ==========

/**
 * Crear nueva instancia de n8n
 */
router.post('/api/suite/create-n8n', async (req: Request, res: Response) => {
  try {
    const { service_name, user_id, memory, cpu } = req.body;

    console.log('[Suite] Creating n8n instance:', { service_name, user_id });

    // Validaciones
    if (!service_name) {
      return res.status(400).json({ error: 'service_name is required' });
    }

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Validar formato del nombre
    if (!/^[a-z0-9_-]+$/.test(service_name)) {
      return res.status(400).json({ 
        error: 'Invalid service name. Use only lowercase letters, numbers, hyphens and underscores' 
      });
    }

    // Validar nombre reservado
    if (service_name === 'n8n_free_treal') {
      return res.status(400).json({ 
        error: 'The name "n8n_free_treal" is reserved by the system' 
      });
    }

    // Verificar si ya existe en Supabase
    const { data: existingInDb } = await supabase
      .from('suites')
      .select('id, name')
      .eq('user_id', user_id)
      .eq('name', service_name)
      .single();

    if (existingInDb) {
      // Verificar si el contenedor Docker realmente existe
      const containerExists = await dockerService.containerExists(service_name);
      
      if (!containerExists) {
        // Registro huérfano - eliminar de Supabase
        console.log(`[Suite] Cleaning orphaned record: ${service_name}`);
        await supabase
          .from('suites')
          .delete()
          .eq('id', existingInDb.id);
        
        console.log(`[Suite] Orphaned record deleted, proceeding with creation`);
      } else {
        return res.status(400).json({ 
          error: `Ya existe una instancia con el nombre "${service_name}". Por favor usa otro nombre o elimina la instancia anterior.` 
        });
      }
    }

    // Decidir si usar Easypanel API o Docker directo
    const useEasypanelAPI = process.env.USE_EASYPANEL_API === 'true';
    let result;

    if (useEasypanelAPI) {
      console.log('[Suite] Using Easypanel API to create instance');
      
      // Verificar si el servicio ya existe en Easypanel
      const exists = await easypanelService.serviceExists(service_name);
      if (exists) {
        return res.status(400).json({ 
          error: 'A service with this name already exists in Easypanel' 
        });
      }

      // Crear instancia con Easypanel API
      result = await easypanelService.createN8nInstance({
        serviceName: service_name,
        userId: user_id,
        memory: memory || '256M',
        cpu: cpu || 256,
      });
    } else {
      console.log('[Suite] Using Docker direct to create instance');
      
      // Verificar si el contenedor ya existe en Docker
      const exists = await dockerService.containerExists(service_name);
      if (exists) {
        return res.status(400).json({ 
          error: 'A Docker container with this name already exists' 
        });
      }

      // Crear instancia con Docker
      result = await dockerService.createN8nInstance({
        serviceName: service_name,
        userId: user_id,
        memory: memory || '256M',
        cpu: cpu || 256,
      });
    }

    // Guardar en Supabase
    const { data: suiteData, error: supabaseError } = await supabase
      .from('suites')
      .insert({
        user_id: user_id,
        name: service_name,
        url: result.url,
        activo: true,
        credencials: {
          ...result.credentials,
          product: 'n8n',
          port: (result as any).port || null,
          container_id: (result as any).containerId || null,
          service_id: (result as any).service?.id || null,
        },
      })
      .select()
      .single();

    if (supabaseError) {
      console.error('[Suite] Error saving to Supabase:', supabaseError);
      // Intentar eliminar el contenedor si falló guardar en Supabase
      try {
        await dockerService.deleteInstance(service_name);
      } catch (cleanupError) {
        console.error('[Suite] Error cleaning up Docker container:', cleanupError);
      }
      throw supabaseError;
    }

    console.log('[Suite] ✅ n8n instance created successfully:', service_name);

    res.json({
      success: true,
      message: 'n8n instance created successfully',
      data: {
        ...result,
        documentId: suiteData.documentId,
      },
    });
  } catch (error: any) {
    console.error('[Suite] ❌ Error creating n8n instance:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to create n8n instance' 
    });
  }
});

/**
 * Iniciar instancia
 */
router.post('/api/suite/init', async (req: Request, res: Response) => {
  try {
    const { name_service } = req.body;

    if (!name_service) {
      return res.status(400).json({ error: 'name_service is required' });
    }

    console.log('[Suite] Starting instance:', name_service);

    const result = await dockerService.startInstance(name_service);

    // Actualizar estado en Supabase
    await supabase
      .from('suites')
      .update({ activo: true })
      .eq('name', name_service);

    console.log('[Suite] ✅ Instance started:', name_service);

    res.json(result);
  } catch (error: any) {
    console.error('[Suite] ❌ Error starting instance:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Pausar instancia
 */
router.post('/api/suite/pause', async (req: Request, res: Response) => {
  try {
    const { name_service } = req.body;

    if (!name_service) {
      return res.status(400).json({ error: 'name_service is required' });
    }

    console.log('[Suite] Pausing instance:', name_service);

    const result = await dockerService.pauseInstance(name_service);

    // Actualizar estado en Supabase
    await supabase
      .from('suites')
      .update({ activo: false })
      .eq('name', name_service);

    console.log('[Suite] ✅ Instance paused:', name_service);

    res.json(result);
  } catch (error: any) {
    console.error('[Suite] ❌ Error pausing instance:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Eliminar instancia
 */
router.post('/api/suite/delete', async (req: Request, res: Response) => {
  try {
    const { name_service } = req.body;

    if (!name_service) {
      return res.status(400).json({ error: 'name_service is required' });
    }

    console.log('[Suite] Deleting instance:', name_service);

    // Eliminar contenedor Docker
    const result = await dockerService.deleteInstance(name_service);

    // Eliminar de Supabase
    await supabase
      .from('suites')
      .delete()
      .eq('name', name_service);

    console.log('[Suite] ✅ Instance deleted:', name_service);

    res.json(result);
  } catch (error: any) {
    console.error('[Suite] ❌ Error deleting instance:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Obtener estado de instancia
 */
router.get('/api/suite/status/:serviceName', async (req: Request, res: Response) => {
  try {
    const { serviceName } = req.params;
    const status = await dockerService.getInstanceStatus(serviceName);
    res.json(status);
  } catch (error: any) {
    console.error('[Suite] ❌ Error getting status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Obtener métricas de uso
 */
router.post('/api/suite/usage', async (req: Request, res: Response) => {
  try {
    const { name_service } = req.body;

    if (!name_service) {
      return res.status(400).json({ error: 'name_service is required' });
    }

    const metrics = await dockerService.getInstanceMetrics(name_service);
    res.json(metrics);
  } catch (error: any) {
    console.error('[Suite] ❌ Error getting metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

// Montar rutas de planes y suscripciones
router.use('/api', plansRouter);

// Montar rutas de proxies
router.use('/api/proxies', proxiesRouter);

// Montar rutas de mensajes y chats
router.use('/api/messages', messagesRouter);

export default router;
