import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY || ''
);

/**
 * Middleware para validar API Key
 * Verifica que el API Key en el header Authorization sea válido
 */
export async function validateApiKey(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();

  try {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');

    if (!apiKey) {
      // ✅ Log intento sin API key
      await logFailedAttempt(req, null, 'No API key provided');

      return res.status(401).json({
        error: 'API Key required',
        message: 'Please provide an API Key in the Authorization header'
      });
    }

    // Validar contra variable de entorno (para desarrollo/testing)
    if (process.env.MASTER_API_KEY && apiKey === process.env.MASTER_API_KEY) {
      console.log('[AUTH] ✅ Master API key used');
      return next();
    }

    // Validar contra base de datos
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, username, api_key, status_plan')
      .eq('api_key', apiKey)
      .single();

    if (error || !profile) {
      // ✅ Log API key inválida
      await logFailedAttempt(req, apiKey, 'Invalid API key');

      return res.status(401).json({
        error: 'Invalid API Key',
        message: 'The provided API Key is not valid or has been revoked'
      });
    }

    // Verificar que tenga plan activo
    if (!profile.status_plan) {
      await logFailedAttempt(req, apiKey, 'No active plan');

      return res.status(403).json({
        error: 'No active plan',
        message: 'Please activate a plan to use the API'
      });
    }

    // Agregar información del usuario al request
    (req as any).user = {
      id: profile.id,
      username: profile.username,
      apiKey: apiKey,
    };

    // ✅ Registrar uso exitoso (sin await para no bloquear)
    const responseTime = Date.now() - startTime;
    logApiUsage(profile.id, apiKey, req.path, req.method, req.ip, req.get('user-agent'), 200, responseTime)
      .catch(err => console.error('[AUTH] Error logging API usage:', err));

    console.log(`[AUTH] ✅ API key validated for user: ${profile.username}`);
    next();
  } catch (error: any) {
    console.error('[AUTH] Error validating API Key:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to validate API Key'
    });
  }
}

/**
 * Registrar uso de API en Supabase
 */
async function logApiUsage(
  userId: string,
  apiKey: string,
  endpoint: string,
  method: string,
  ipAddress: string | undefined,
  userAgent: string | undefined,
  statusCode: number,
  responseTimeMs: number
) {
  try {
    await supabase.rpc('log_api_usage', {
      p_user_id: userId,
      p_api_key: apiKey,
      p_endpoint: endpoint,
      p_method: method,
      p_ip_address: ipAddress || null,
      p_user_agent: userAgent || null,
      p_status_code: statusCode,
      p_response_time_ms: responseTimeMs,
    });
  } catch (error) {
    console.error('[AUTH] Error logging API usage:', error);
  }
}

/**
 * Registrar intento fallido
 */
async function logFailedAttempt(
  req: Request,
  apiKey: string | null,
  reason: string
) {
  // console.warn(`[AUTH] ❌ Failed attempt: ${reason} - IP: ${req.ip} - Path: ${req.path}`);

  // Aquí podrías agregar lógica adicional como:
  // - Bloquear IP después de X intentos
  // - Enviar alerta de seguridad
  // - Guardar en tabla de security_logs
}

/**
 * Middleware opcional para validar API Key
 * Si no hay API Key, continúa sin validar
 */
export function optionalApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers.authorization;

  if (!apiKey) {
    return next();
  }

  return validateApiKey(req, res, next);
}
