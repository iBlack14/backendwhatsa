import { Router, Request, Response } from 'express';
import { contactService } from '../services/contact.service';
import { messagesReadLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

/**
 * GET /api/contacts/:instanceId
 * Obtener todos los contactos de una instancia
 */
router.get('/:instanceId', messagesReadLimiter, async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;

    const contacts = await contactService.getContacts(instanceId, limit);

    res.json({
      success: true,
      contacts,
      count: contacts.length
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/contacts/search/:instanceId
 * Buscar contactos con búsqueda inteligente
 */
router.get('/search/:instanceId', messagesReadLimiter, async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const results = await contactService.searchContacts(instanceId, query, limit);

    res.json({
      success: true,
      results,
      count: results.length,
      query: query.trim()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/contacts/stats/:instanceId
 * Obtener estadísticas de contactos
 */
router.get('/stats/:instanceId', messagesReadLimiter, async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;

    const stats = await contactService.getContactStats(instanceId);

    res.json({
      success: true,
      stats
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/contacts/detail/:instanceId/:jid
 * Obtener detalle de un contacto
 */
router.get('/detail/:instanceId/:jid', messagesReadLimiter, async (req: Request, res: Response) => {
  try {
    const { instanceId, jid } = req.params;

    const contact = await contactService.getContactByJid(instanceId, jid);

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
    }

    res.json({
      success: true,
      contact
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/contacts/sync/:instanceId
 * Sincronizar contactos desde WhatsApp
 */
router.post('/sync/:instanceId', async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    const { contacts } = req.body;

    if (!contacts || !Array.isArray(contacts)) {
      return res.status(400).json({
        success: false,
        error: 'Contacts array is required'
      });
    }

    const syncedCount = await contactService.syncContacts(instanceId, contacts);

    res.json({
      success: true,
      synced: syncedCount,
      total: contacts.length,
      message: `Synced ${syncedCount} contacts successfully`
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/contacts/block/:instanceId/:jid
 * Bloquear/desbloquear contacto
 */
router.post('/block/:instanceId/:jid', async (req: Request, res: Response) => {
  try {
    const { instanceId, jid } = req.params;
    const { blocked } = req.body;

    if (blocked === undefined) {
      return res.status(400).json({
        success: false,
        error: 'blocked field is required'
      });
    }

    const success = await contactService.toggleBlockContact(instanceId, jid, blocked);

    if (!success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to update contact block status'
      });
    }

    res.json({
      success: true,
      message: blocked ? 'Contact blocked' : 'Contact unblocked'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/contacts/:instanceId/:jid
 * Eliminar contacto
 */
router.delete('/:instanceId/:jid', async (req: Request, res: Response) => {
  try {
    const { instanceId, jid } = req.params;

    const success = await contactService.deleteContact(instanceId, jid);

    if (!success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to delete contact'
      });
    }

    res.json({
      success: true,
      message: 'Contact deleted successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
