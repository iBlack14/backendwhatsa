/**
 * Rate Limiting Middleware
 * Protege las APIs contra abuso y ataques DDoS
 */

import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * Rate limiter general para todas las APIs
 * 100 requests por 15 minutos por IP
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests
  message: {
    error: 'Demasiadas peticiones desde esta IP, intenta nuevamente en 15 minutos',
    retryAfter: '15 minutos',
  },
  standardHeaders: true, // Retorna info en headers `RateLimit-*`
  legacyHeaders: false, // Deshabilita headers `X-RateLimit-*`
  handler: (req: Request, res: Response) => {
    console.warn(`[Rate Limit] IP ${req.ip} excedió el límite general`);
    res.status(429).json({
      error: 'Demasiadas peticiones, intenta nuevamente más tarde',
      retryAfter: '15 minutos',
    });
  },
});

/**
 * Rate limiter estricto para creación de sesiones
 * 5 sesiones por hora por IP
 */
export const createSessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5, // 5 sesiones
  message: {
    error: 'Límite de creación de sesiones alcanzado, intenta en 1 hora',
    retryAfter: '1 hora',
  },
  skipSuccessfulRequests: false,
  handler: (req: Request, res: Response) => {
    console.warn(`[Rate Limit] IP ${req.ip} excedió límite de creación de sesiones`);
    res.status(429).json({
      error: 'Has alcanzado el límite de sesiones por hora',
      retryAfter: '1 hora',
      tip: 'Si necesitas más sesiones, contacta soporte',
    });
  },
});

/**
 * Rate limiter para envío de mensajes
 * 30 mensajes por minuto por IP
 */
export const sendMessageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30, // 30 mensajes
  message: {
    error: 'Límite de envío de mensajes alcanzado, intenta en 1 minuto',
    retryAfter: '1 minuto',
  },
  skipSuccessfulRequests: false,
  handler: (req: Request, res: Response) => {
    console.warn(`[Rate Limit] IP ${req.ip} excedió límite de envío de mensajes`);
    res.status(429).json({
      error: 'Has enviado demasiados mensajes, espera 1 minuto',
      retryAfter: '1 minuto',
      tip: 'Para evitar bloqueos de WhatsApp, respeta los límites',
    });
  },
});

/**
 * Rate limiter para autenticación
 * 5 intentos por 15 minutos por IP
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 intentos
  message: {
    error: 'Demasiados intentos de autenticación, intenta en 15 minutos',
    retryAfter: '15 minutos',
  },
  skipSuccessfulRequests: true, // No contar requests exitosos
  handler: (req: Request, res: Response) => {
    console.warn(`[Rate Limit] IP ${req.ip} excedió límite de autenticación`);
    res.status(429).json({
      error: 'Demasiados intentos fallidos, intenta en 15 minutos',
      retryAfter: '15 minutos',
      tip: 'Si olvidaste tu contraseña, usa "Recuperar contraseña"',
    });
  },
});

/**
 * Rate limiter para webhooks
 * 60 requests por minuto por IP
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 60, // 60 requests
  message: {
    error: 'Límite de webhooks alcanzado, intenta en 1 minuto',
    retryAfter: '1 minuto',
  },
  handler: (req: Request, res: Response) => {
    console.warn(`[Rate Limit] IP ${req.ip} excedió límite de webhooks`);
    res.status(429).json({
      error: 'Demasiados webhooks, espera 1 minuto',
      retryAfter: '1 minuto',
    });
  },
});

/**
 * Rate limiter para Suite/N8N operations
 * 10 operaciones por minuto por IP
 */
export const suiteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // 10 operaciones
  message: {
    error: 'Límite de operaciones de Suite alcanzado, intenta en 1 minuto',
    retryAfter: '1 minuto',
  },
  handler: (req: Request, res: Response) => {
    console.warn(`[Rate Limit] IP ${req.ip} excedió límite de operaciones Suite`);
    res.status(429).json({
      error: 'Demasiadas operaciones en Suite, espera 1 minuto',
      retryAfter: '1 minuto',
    });
  },
});

/**
 * Rate limiter para endpoints de mensajes (GET)
 * Más permisivo porque se usa con WebSockets como backup
 * 500 requests por 15 minutos por IP
 */
export const messagesReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 500, // 500 requests
  message: {
    error: 'Límite de consultas de mensajes alcanzado, intenta en 15 minutos',
    retryAfter: '15 minutos',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    console.warn(`[Rate Limit] IP ${req.ip} excedió límite de consultas de mensajes`);
    res.status(429).json({
      error: 'Demasiadas consultas de mensajes, espera 15 minutos',
      retryAfter: '15 minutos',
      tip: 'Usa WebSockets/Realtime para actualizaciones en tiempo real',
    });
  },
});
