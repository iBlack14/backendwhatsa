import { Router, Request, Response } from 'express';
import { messageService } from '../services/message.service';
import { messagesReadLimiter, sendMessageLimiter } from '../middleware/rate-limit.middleware';
import { supabase } from '../lib/supabase';

const router = Router();

/**
 * GET /api/messages/chats/:instanceId
 * Obtener todos los chats de una instancia
 */
router.get('/chats/:instanceId', async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    const chats = await messageService.getChats(instanceId);

    res.json({ chats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/messages/:instanceId/:chatId
 * Obtener mensajes de un chat específico
 */
router.get('/:instanceId/:chatId', async (req: Request, res: Response) => {
  try {
    const { instanceId, chatId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const messages = await messageService.getMessages(instanceId, chatId, limit);

    res.json({ messages });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/messages/send
 * Enviar mensaje de WhatsApp
 */
router.post('/send', sendMessageLimiter, async (req: Request, res: Response) => {
  try {
    const { instanceId, chatId, message } = req.body;

    if (!instanceId || !chatId || !message) {
      return res.status(400).json({ error: 'Missing required fields: instanceId, chatId, message' });
    }

    const result = await messageService.sendMessage(instanceId, chatId, message);

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to send message' });
    }

    res.json({
      success: true,
      messageId: result.messageId,
      message: 'Message sent successfully'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/messages/mark-read
 * Marcar chat como leído
 */
router.post('/mark-read', async (req: Request, res: Response) => {
  try {
    const { instanceId, chatId } = req.body;

    if (!instanceId || !chatId) {
      return res.status(400).json({ error: 'Missing instanceId or chatId' });
    }

    const success = await messageService.markChatAsRead(instanceId, chatId);

    if (!success) {
      return res.status(500).json({ error: 'Failed to mark as read' });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/messages/archive
 * Archivar/desarchivar chat
 */
router.post('/archive', async (req: Request, res: Response) => {
  try {
    const { instanceId, chatId, archived } = req.body;

    if (!instanceId || !chatId || archived === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const success = await messageService.toggleArchiveChat(instanceId, chatId, archived);

    if (!success) {
      return res.status(500).json({ error: 'Failed to archive chat' });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/messages/pin
 * Fijar/desfijar chat
 */
router.post('/pin', async (req: Request, res: Response) => {
  try {
    const { instanceId, chatId, pinned } = req.body;

    if (!instanceId || !chatId || pinned === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const success = await messageService.togglePinChat(instanceId, chatId, pinned);

    if (!success) {
      return res.status(500).json({ error: 'Failed to pin chat' });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/messages/search/:instanceId
 * Buscar mensajes
 */
router.get('/search/:instanceId', async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 50;

    if (!query) {
      return res.status(400).json({ error: 'Missing search query' });
    }

    const messages = await messageService.searchMessages(instanceId, query, limit);

    res.json({ messages });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/messages/stats/:instanceId
 * Obtener estadísticas de mensajes
 */
router.get('/stats/:instanceId', async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;

    const { data, error } = await supabase
      .from('message_stats')
      .select('*')
      .eq('instance_id', instanceId)
      .order('message_date', { ascending: false })
      .limit(30);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ stats: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/messages/send-image
 * Enviar imagen vía WhatsApp (soporta URL o Base64)
 */
router.post('/send-image', async (req: Request, res: Response) => {
  try {
    const { instanceId, chatId, file, message } = req.body;

    if (!instanceId || !chatId || !file) {
      return res.status(400).json({ error: 'Missing required fields: instanceId, chatId, file' });
    }

    const { getSession } = require('../whatsapp');
    const session = getSession(instanceId);

    if (!session || !session.sock) {
      return res.status(400).json({ error: 'Instance not connected' });
    }

    const result = await messageService.sendImage(instanceId, chatId, file, message);

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to send image' });
    }

    res.json({
      success: true,
      messageId: result.messageId,
      message: 'Image sent successfully'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/messages/send-audio
 * Enviar audio/nota de voz vía WhatsApp (soporta URL o Base64)
 */
router.post('/send-audio', async (req: Request, res: Response) => {
  try {
    const { instanceId, chatId, file } = req.body;

    if (!instanceId || !chatId || !file) {
      return res.status(400).json({ error: 'Missing required fields: instanceId, chatId, file' });
    }

    const { getSession } = require('../whatsapp');
    const session = getSession(instanceId);

    if (!session || !session.sock) {
      return res.status(400).json({ error: 'Instance not connected' });
    }

    const result = await messageService.sendAudio(instanceId, chatId, file);

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to send audio' });
    }

    res.json({
      success: true,
      messageId: result.messageId,
      message: 'Audio sent successfully'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
