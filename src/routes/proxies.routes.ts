import { Router, Request, Response } from 'express';
import { proxyService } from '../services/proxy.service';

const router = Router();

/**
 * GET /api/proxies
 * Obtener todos los proxies
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { data, error } = await proxyService['supabase']
      .from('proxies')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ proxies: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/proxies/available
 * Obtener proxies disponibles (activos y saludables)
 */
router.get('/available', async (req: Request, res: Response) => {
  try {
    const proxy = await proxyService.getAvailableProxy();
    res.json({ proxy });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/proxies
 * Crear nuevo proxy
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, type, host, port, username, password, country, city } = req.body;

    if (!name || !type || !host || !port) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await proxyService['supabase']
      .from('proxies')
      .insert({
        name,
        type,
        host,
        port,
        username,
        password,
        country,
        city,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ proxy: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/proxies/:id
 * Actualizar proxy
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data, error } = await proxyService['supabase']
      .from('proxies')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ proxy: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/proxies/:id
 * Eliminar proxy
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { error } = await proxyService['supabase']
      .from('proxies')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/proxies/:id/health-check
 * Verificar salud del proxy
 */
router.post('/:id/health-check', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const isHealthy = await proxyService.healthCheck(id);

    res.json({ healthy: isHealthy });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/proxies/instance/:instanceId
 * Obtener proxy asignado a una instancia
 */
router.get('/instance/:instanceId', async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    const proxy = await proxyService.getProxyForInstance(instanceId);

    res.json({ proxy });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/proxies/assign
 * Asignar proxy a instancia
 */
router.post('/assign', async (req: Request, res: Response) => {
  try {
    const { instanceId, proxyId, rotationEnabled, rotationIntervalHours } = req.body;

    if (!instanceId || !proxyId) {
      return res.status(400).json({ error: 'Missing instanceId or proxyId' });
    }

    const success = await proxyService.assignProxyToInstance(
      instanceId,
      proxyId,
      rotationEnabled || false,
      rotationIntervalHours || 24
    );

    if (!success) {
      return res.status(500).json({ error: 'Failed to assign proxy' });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
