/**
 * Middleware de Logging Mejorado para Express
 * Proporciona logging estructurado de requests HTTP con métricas de rendimiento
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { StructuredLogger, performanceTracker } from '../utils/enhanced-logger';

// Extender Request para incluir tracking
declare global {
  namespace Express {
    interface Request {
      id?: string;
      startTime?: number;
      userId?: string;
    }
  }
}

/**
 * Middleware principal de logging HTTP
 */
export const loggingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Asignar ID único al request
  req.id = randomUUID();
  req.startTime = Date.now();

  // Log inicial del request
  StructuredLogger.httpRequest(req, res);

  // Sobrescribir res.end para capturar el tiempo de respuesta
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any, cb?: any): Response {
    // Calcular duración
    const duration = req.startTime ? Date.now() - req.startTime : 0;
    
    // Log final del request con métricas
    StructuredLogger.httpRequest(req, res, duration);
    
    // Llamar al método original
    return originalEnd.call(this, chunk, encoding, cb);
  };

  next();
};

/**
 * Middleware para logging de errores HTTP
 */
export const errorLoggingMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const duration = req.startTime ? Date.now() - req.startTime : 0;
  
  StructuredLogger.httpError(req, error, res.statusCode);
  
  // Log adicional para errores críticos
  if (res.statusCode >= 500) {
    StructuredLogger.securityEvent('server_error', 'high', {
      requestId: req.id,
      error: error.message,
      stack: error.stack,
      url: req.url,
      method: req.method,
      userAgent: req.get('user-agent'),
      ip: req.ip
    });
  }
  
  next();
};

/**
 * Middleware para tracking de rendimiento por endpoint
 */
export const performanceMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const endpoint = `${req.method} ${req.route?.path || req.path}`;
  performanceTracker.start(endpoint);
  
  res.on('finish', () => {
    performanceTracker.end(endpoint);
  });
  
  next();
};

/**
 * Middleware para logging de autenticación
 */
export const authLoggingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const originalSend = res.send;
  
  res.send = function(data: any) {
    // Detectar eventos de autenticación
    if (req.path.includes('/auth/') || req.path.includes('/login') || req.path.includes('/register')) {
      const isLogin = req.path.includes('/login');
      const isRegister = req.path.includes('/register');
      
      if (res.statusCode === 200 && (isLogin || isRegister)) {
        const event = isLogin ? 'login' : 'register';
        StructuredLogger.authEvent(event, req.userId, undefined, {
          requestId: req.id,
          userAgent: req.get('user-agent'),
          ip: req.ip
        });
      } else if (res.statusCode === 401 && isLogin) {
        StructuredLogger.authEvent('failed_login', undefined, undefined, {
          requestId: req.id,
          userAgent: req.get('user-agent'),
          ip: req.ip
        });
      }
    }
    
    return originalSend.call(this, data);
  };
  
  next();
};

/**
 * Middleware para logging de CORS
 */
export const corsLoggingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const origin = req.get('origin');
  
  if (origin) {
    StructuredLogger.securityEvent('cors_request', 'low', {
      requestId: req.id,
      origin,
      method: req.method,
      url: req.url,
      userAgent: req.get('user-agent')
    });
  }
  
  next();
};

/**
 * Middleware para logging de requests sospechosos
 */
export const securityLoggingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const userAgent = req.get('user-agent') || '';
  const ip = req.ip || req.connection.remoteAddress;
  
  // Detectar patrones sospechosos
  const suspiciousPatterns = [
    /bot/i,
    /crawler/i,
    /scanner/i,
    /sqlmap/i,
    /nikto/i,
    /nmap/i
  ];
  
  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(userAgent));
  
  if (isSuspicious) {
    StructuredLogger.securityEvent('suspicious_user_agent', 'medium', {
      requestId: req.id,
      userAgent,
      ip,
      method: req.method,
      url: req.url
    });
  }
  
  // Detectar intentos de path traversal
  const pathTraversalPatterns = [
    /\.\.\//,
    /%2e%2e%2f/,
    /%2e%2e/,
    /\.\.\\/
  ];
  
  const hasPathTraversal = pathTraversalPatterns.some(pattern => pattern.test(req.url));
  
  if (hasPathTraversal) {
    StructuredLogger.securityEvent('path_traversal_attempt', 'high', {
      requestId: req.id,
      url: req.url,
      userAgent,
      ip
    });
  }
  
  // Detectar intentos de inyección SQL
  const sqlInjectionPatterns = [
    /('|(\\')|(;)|(\\;)|(\%27)|(\%3B))/i,
    /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/i,
    /\w*((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))/i,
    /((\%27)|(\'))union/i,
    /exec(\s|\+)+(s|x)p\w+/i,
    /UNION[^a-zA-Z]/i,
    /SELECT[^a-zA-Z]/i,
    /INSERT[^a-zA-Z]/i,
    /DELETE[^a-zA-Z]/i,
    /UPDATE[^a-zA-Z]/i
  ];
  
  const hasSQLInjection = sqlInjectionPatterns.some(pattern => pattern.test(req.url));
  
  if (hasSQLInjection) {
    StructuredLogger.securityEvent('sql_injection_attempt', 'critical', {
      requestId: req.id,
      url: req.url,
      userAgent,
      ip
    });
  }
  
  next();
};

/**
 * Middleware para logging de rate limiting
 */
export const rateLimitLoggingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  res.on('limit', () => {
    StructuredLogger.securityEvent('request_size_limit_exceeded', 'medium', {
      requestId: req.id,
      url: req.url,
      method: req.method,
      contentLength: req.get('content-length'),
      userAgent: req.get('user-agent'),
      ip: req.ip
    });
  });
  
  next();
};

/**
 * Middleware combinado para producción
 */
export const productionLoggingMiddleware = [
  corsLoggingMiddleware,
  securityLoggingMiddleware,
  loggingMiddleware,
  performanceMiddleware,
  authLoggingMiddleware,
  rateLimitLoggingMiddleware
];

/**
 * Middleware simplificado para desarrollo
 */
export const developmentLoggingMiddleware = [
  loggingMiddleware,
  errorLoggingMiddleware
];
