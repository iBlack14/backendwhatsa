/**
 * Logger estructurado con Pino
 * Reemplaza console.log con logging profesional
 */

import pino from 'pino';

/**
 * Configuración del logger
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: false,
      hideObject: false,
      customPrettifiers: {
        time: (timestamp: any) => `🕐 ${timestamp}`,
      },
      messageFormat: (log: any, messageKey: string) => {
        const emoji = log.level === 30 ? '✅' : log.level === 40 ? '⚠️' : log.level === 50 ? '❌' : 'ℹ️';
        const module = log.module ? `[${log.module.toUpperCase()}]` : '';
        return `${emoji} ${module} ${log[messageKey]}`;
      },
    },
  },
  base: {
    env: process.env.NODE_ENV || 'development',
  },
});

/**
 * Logger específico para WhatsApp operations
 */
export const whatsappLogger = logger.child({ module: 'whatsapp' });

/**
 * Logger específico para API requests
 */
export const apiLogger = logger.child({ module: 'api' });

/**
 * Logger específico para Database operations
 */
export const dbLogger = logger.child({ module: 'database' });

/**
 * Logger específico para Docker/Easypanel operations
 */
export const dockerLogger = logger.child({ module: 'docker' });

/**
 * Helper functions para logging común
 */
export const loggers = {
  /**
   * Log de inicio de sesión WhatsApp
   */
  sessionCreated: (clientId: string, details?: any) => {
    whatsappLogger.info({ clientId, ...details }, 'WhatsApp session created');
  },

  /**
   * Log de mensaje enviado
   */
  messageSent: (clientId: string, to: string, messageId?: string) => {
    whatsappLogger.info({ clientId, to, messageId }, 'Message sent successfully');
  },

  /**
   * Log de mensaje recibido
   */
  messageReceived: (clientId: string, from: string, type: string) => {
    whatsappLogger.info({ clientId, from, type }, 'Message received');
  },

  /**
   * Log de error en WhatsApp
   */
  whatsappError: (clientId: string, error: Error, context?: any) => {
    whatsappLogger.error({ clientId, error: error.message, stack: error.stack, ...context }, 'WhatsApp error');
  },

  /**
   * Log de API request
   */
  apiRequest: (method: string, path: string, ip?: string, userId?: string) => {
    apiLogger.info({ method, path, ip, userId }, 'API request');
  },

  /**
   * Log de API error
   */
  apiError: (method: string, path: string, error: Error, statusCode?: number) => {
    apiLogger.error({ method, path, error: error.message, statusCode }, 'API error');
  },

  /**
   * Log de operación de base de datos
   */
  dbQuery: (operation: string, table: string, duration?: number) => {
    dbLogger.debug({ operation, table, duration }, 'Database query');
  },

  /**
   * Log de error de base de datos
   */
  dbError: (operation: string, table: string, error: Error) => {
    dbLogger.error({ operation, table, error: error.message }, 'Database error');
  },

  /**
   * Log de operación Docker
   */
  dockerOperation: (operation: string, containerName: string, details?: any) => {
    dockerLogger.info({ operation, containerName, ...details }, 'Docker operation');
  },

  /**
   * Log de error Docker
   */
  dockerError: (operation: string, error: Error, context?: any) => {
    dockerLogger.error({ operation, error: error.message, ...context }, 'Docker error');
  },

  /**
   * Log de webhook enviado
   */
  webhookSent: (url: string, event: string, success: boolean) => {
    whatsappLogger.info({ url, event, success }, 'Webhook sent');
  },

  /**
   * Log de rate limit excedido
   */
  rateLimitExceeded: (ip: string, endpoint: string) => {
    apiLogger.warn({ ip, endpoint }, 'Rate limit exceeded');
  },
};

export default logger;
