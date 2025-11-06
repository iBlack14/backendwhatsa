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
  try {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');

    if (!apiKey) {
      return res.status(401).json({ 
        error: 'API Key required',
        message: 'Please provide an API Key in the Authorization header'
      });
    }

    // Validar contra variable de entorno (para desarrollo/testing)
    if (process.env.MASTER_API_KEY && apiKey === process.env.MASTER_API_KEY) {
      return next();
    }

    // Validar contra base de datos
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, username, api_key')
      .eq('api_key', apiKey)
      .single();

    if (error || !profile) {
      return res.status(401).json({ 
        error: 'Invalid API Key',
        message: 'The provided API Key is not valid or has been revoked'
      });
    }

    // Agregar información del usuario al request
    (req as any).user = {
      id: profile.id,
      username: profile.username,
    };

    next();
  } catch (error: any) {
    console.error('Error validating API Key:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to validate API Key'
    });
  }
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
