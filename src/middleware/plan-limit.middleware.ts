/**
 * Plan Limit Validation Middleware
 * Valida límites de uso según el plan del usuario
 */

import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY || ''
);

interface PlanLimit {
  allowed: boolean;
  current_usage: number;
  max_limit: number;
  plan_type: string;
}

/**
 * Middleware para validar límite de instancias
 */
export const validateInstanceLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.body.userId || req.query.userId;

    if (!userId) {
      return res.status(400).json({ error: 'userId es requerido' });
    }

    // Verificar límite de instancias
    const { data, error } = await supabase.rpc('check_user_limit', {
      p_user_id: userId,
      p_limit_type: 'instances',
    });

    if (error) {
      console.error('Error checking instance limit:', error);
      return res.status(500).json({ error: 'Error al verificar límite' });
    }

    const limit: PlanLimit = data[0];

    if (!limit.allowed) {
      return res.status(403).json({
        error: 'Límite de instancias alcanzado',
        message: `Has alcanzado el límite de ${limit.max_limit} instancia(s) para el plan ${limit.plan_type}`,
        current: limit.current_usage,
        max: limit.max_limit,
        plan: limit.plan_type,
        upgrade_required: true,
      });
    }

    // Agregar info del límite al request para uso posterior
    req.planLimit = limit;
    next();
  } catch (error: any) {
    console.error('Error in validateInstanceLimit:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Middleware para validar límite de mensajes
 */
export const validateMessageLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Obtener userId desde la instancia
    const { instanceId, clientId } = req.body;
    const instanceIdToUse = instanceId || clientId;

    if (!instanceIdToUse) {
      return res.status(400).json({ error: 'instanceId o clientId es requerido' });
    }

    // Obtener userId de la instancia
    const { data: instance, error: instanceError } = await supabase
      .from('instances')
      .select('user_id')
      .eq('document_id', instanceIdToUse)
      .single();

    if (instanceError || !instance) {
      return res.status(404).json({ error: 'Instancia no encontrada' });
    }

    // Verificar límite de mensajes
    const { data, error } = await supabase.rpc('check_user_limit', {
      p_user_id: instance.user_id,
      p_limit_type: 'messages',
    });

    if (error) {
      console.error('Error checking message limit:', error);
      return res.status(500).json({ error: 'Error al verificar límite' });
    }

    const limit: PlanLimit = data[0];

    if (!limit.allowed) {
      return res.status(429).json({
        error: 'Límite de mensajes alcanzado',
        message: `Has alcanzado el límite de ${limit.max_limit} mensajes por día para el plan ${limit.plan_type}`,
        current: limit.current_usage,
        max: limit.max_limit,
        plan: limit.plan_type,
        upgrade_required: true,
        resets_at: 'medianoche',
      });
    }

    // Agregar info del límite al request
    req.planLimit = limit;
    req.userId = instance.user_id;
    next();
  } catch (error: any) {
    console.error('Error in validateMessageLimit:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Middleware para validar plan activo
 */
export const validateActivePlan = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.body.userId || req.query.userId || req.params.userId;

    if (!userId) {
      return res.status(400).json({ error: 'userId es requerido' });
    }

    // Verificar estado del plan
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('status_plan, plan_type, plan_expires_at')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!profile.status_plan) {
      return res.status(403).json({
        error: 'Plan inactivo',
        message: 'Tu plan está inactivo. Contacta soporte para más información.',
        plan_active: false,
      });
    }

    // Agregar info del plan al request
    req.userPlan = profile;
    next();
  } catch (error: any) {
    console.error('Error in validateActivePlan:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Middleware para validar límite de suites
 */
export const validateSuiteLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.body.userId || req.body.user_id;

    if (!userId) {
      return res.status(400).json({ error: 'userId es requerido' });
    }

    // Verificar límite de suites
    const { data, error } = await supabase.rpc('check_user_limit', {
      p_user_id: userId,
      p_limit_type: 'suites',
    });

    if (error) {
      console.error('Error checking suite limit:', error);
      return res.status(500).json({ error: 'Error al verificar límite' });
    }

    const limit: PlanLimit = data[0];

    if (!limit.allowed) {
      return res.status(403).json({
        error: 'Límite de suites alcanzado',
        message: `Has alcanzado el límite de ${limit.max_limit} suite(s) para el plan ${limit.plan_type}`,
        current: limit.current_usage,
        max: limit.max_limit,
        plan: limit.plan_type,
        upgrade_required: true,
      });
    }

    // Agregar info del límite al request
    req.planLimit = limit;
    next();
  } catch (error: any) {
    console.error('Error in validateSuiteLimit:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Función helper para incrementar uso después de una acción exitosa
 */
export const incrementUsage = async (
  userId: string,
  usageType: 'messages_sent' | 'instances_created' | 'webhooks_used' | 'suites_created',
  increment: number = 1
) => {
  try {
    await supabase.rpc('increment_daily_usage', {
      p_user_id: userId,
      p_usage_type: usageType,
      p_increment: increment,
    });
  } catch (error) {
    console.error('Error incrementing usage:', error);
  }
};

/**
 * Función helper para obtener resumen de uso
 */
export const getUserUsageSummary = async (userId: string) => {
  try {
    const { data, error } = await supabase
      .from('user_usage_summary')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Error getting usage summary:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getUserUsageSummary:', error);
    return null;
  }
};

// Extender tipos de Express
declare global {
  namespace Express {
    interface Request {
      planLimit?: PlanLimit;
      userPlan?: {
        status_plan: boolean;
        plan_type: string;
        plan_expires_at: string | null;
      };
      userId?: string;
    }
  }
}
