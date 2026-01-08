/**
 * Logger profesional con Winston
 * Reemplaza Pino con Winston para logging con rotación de archivos
 */

import logger from '../config/logger.config';

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
    whatsappLogger.info('WhatsApp session created', { clientId, ...details });
  },

  /**
   * Log de mensaje enviado
   */
  messageSent: (clientId: string, to: string, messageId?: string) => {
    whatsappLogger.info('Message sent successfully', { clientId, to, messageId });
  },

  /**
   * Log de mensaje recibido
   */
  messageReceived: (clientId: string, from: string, type: string) => {
    whatsappLogger.info('Message received', { clientId, from, type });
  },

  /**
   * Log de error en WhatsApp
   */
  whatsappError: (clientId: string, error: Error, context?: any) => {
    whatsappLogger.error('WhatsApp error', {
      clientId,
      error: error.message,
      stack: error.stack,
      ...context
    });
  },

  /**
   * Log de API request
   */
  apiRequest: (method: string, path: string, ip?: string, userId?: string) => {
    apiLogger.info('API request', { method, path, ip, userId });
  },

  /**
   * Log de API error
   */
  apiError: (method: string, path: string, error: Error, statusCode?: number) => {
    apiLogger.error('API error', { method, path, error: error.message, statusCode });
  },

  /**
   * Log de operación de base de datos
   */
  dbQuery: (operation: string, table: string, duration?: number) => {
    dbLogger.debug('Database query', { operation, table, duration });
  },

  /**
   * Log de error de base de datos
   */
  dbError: (operation: string, table: string, error: Error) => {
    dbLogger.error('Database error', { operation, table, error: error.message });
  },

  /**
   * Log de operación Docker
   */
  dockerOperation: (operation: string, containerName: string, details?: any) => {
    dockerLogger.info('Docker operation', { operation, containerName, ...details });
  },

  /**
   * Log de error Docker
   */
  dockerError: (operation: string, error: Error, context?: any) => {
    dockerLogger.error('Docker error', { operation, error: error.message, ...context });
  },

  /**
   * Log de webhook enviado
   */
  webhookSent: (url: string, event: string, success: boolean) => {
    whatsappLogger.info('Webhook sent', { url, event, success });
  },

  /**
   * Log de rate limit excedido
   */
  rateLimitExceeded: (ip: string, endpoint: string) => {
    apiLogger.warn('Rate limit exceeded', { ip, endpoint });
  },
};

export default logger;
