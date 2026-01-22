/**
 * Logger Profesional Mejorado para Backend BLXK
 * Sistema de logging estructurado con niveles, contextos y métricas
 * Optimizado para producción y desarrollo
 */

import pino, { Logger } from 'pino';
import { config } from 'dotenv';

// Cargar variables de entorno
config();

// Niveles de log personalizados
enum LogLevel {
  SILENT = 'silent',
  FATAL = 'fatal',
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
  TRACE = 'trace'
}

// Contextos de aplicación
enum LogContext {
  API = 'api',
  WHATSAPP = 'whatsapp',
  DATABASE = 'database',
  DOCKER = 'docker',
  WEBSOCKET = 'websocket',
  AUTH = 'auth',
  CRON = 'cron',
  SYSTEM = 'system',
  SECURITY = 'security',
  PERFORMANCE = 'performance'
}

// Configuración base del logger
const baseConfig = {
  level: process.env.LOG_LEVEL || LogLevel.INFO,
  formatters: {
    level: (label: string) => ({ level: label }),
    log: (object: any) => {
      // Sanitizar datos sensibles
      if (object.password) object.password = '[REDACTED]';
      if (object.token) object.token = '[REDACTED]';
      if (object.apiKey) object.apiKey = '[REDACTED]';
      if (object.authorization) object.authorization = '[REDACTED]';
      return object;
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'blxk-backend',
    version: process.env.APP_VERSION || '3.0.0',
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid,
    hostname: process.env.HOSTNAME || 'unknown'
  }
};

// Configuración para desarrollo
const devConfig = {
  ...baseConfig,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname,service,version',
      messageFormat: '{context} [{level}] {msg}',
      customPrettifiers: {
        time: (timestamp: string) => `🕐 ${new Date(timestamp).toLocaleTimeString()}`,
        level: (label: string) => {
          const levels = {
            fatal: '🔴 FATAL',
            error: '❌ ERROR', 
            warn: '⚠️  WARN',
            info: 'ℹ️  INFO',
            debug: '🐛 DEBUG',
            trace: '🔍 TRACE'
          };
          return levels[label] || label.toUpperCase();
        }
      }
    }
  }
};

// Configuración para producción
const prodConfig = {
  ...baseConfig,
  // En producción usamos JSON structured logging
  // para mejor integración con sistemas de monitoreo
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err
  }
};

// Crear logger principal
const logger: Logger = pino(
  process.env.NODE_ENV === 'production' ? prodConfig : devConfig
);

// Logger específico para cada contexto
const loggers = {
  [LogContext.API]: logger.child({ context: LogContext.API }),
  [LogContext.WHATSAPP]: logger.child({ context: LogContext.WHATSAPP }),
  [LogContext.DATABASE]: logger.child({ context: LogContext.DATABASE }),
  [LogContext.DOCKER]: logger.child({ context: LogContext.DOCKER }),
  [LogContext.WEBSOCKET]: logger.child({ context: LogContext.WEBSOCKET }),
  [LogContext.AUTH]: logger.child({ context: LogContext.AUTH }),
  [LogContext.CRON]: logger.child({ context: LogContext.CRON }),
  [LogContext.SYSTEM]: logger.child({ context: LogContext.SYSTEM }),
  [LogContext.SECURITY]: logger.child({ context: LogContext.SECURITY }),
  [LogContext.PERFORMANCE]: logger.child({ context: LogContext.PERFORMANCE })
};

// Métricas de rendimiento
class PerformanceTracker {
  private timers: Map<string, number> = new Map();

  start(label: string): void {
    this.timers.set(label, Date.now());
  }

  end(label: string): number {
    const startTime = this.timers.get(label);
    if (!startTime) {
      loggers[LogContext.PERFORMANCE].warn({ label }, 'Timer not found');
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(label);
    
    loggers[LogContext.PERFORMANCE].info({ 
      label, 
      duration,
      durationMs: duration 
    }, 'Performance metric');
    
    return duration;
  }

  // Decorador para medir tiempo de ejecución de funciones
  timer(label: string) {
    return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
      const method = descriptor.value;
      descriptor.value = async function (...args: any[]) {
        const timerLabel = `${label || propertyName}`;
        loggers[LogContext.PERFORMANCE].debug({ 
          method: propertyName, 
          args: args.length 
        }, 'Method execution started');

        const start = Date.now();
        try {
          const result = await method.apply(this, args);
          const duration = Date.now() - start;
          
          loggers[LogContext.PERFORMANCE].info({ 
            method: propertyName, 
            duration,
            success: true 
          }, 'Method execution completed');
          
          return result;
        } catch (error) {
          const duration = Date.now() - start;
          
          loggers[LogContext.PERFORMANCE].error({ 
            method: propertyName, 
            duration, 
            error: error.message,
            success: false 
          }, 'Method execution failed');
          
          throw error;
        }
      };
      return descriptor;
    };
  }
}

const performanceTracker = new PerformanceTracker();

// Sistema de logging estructurado
export class StructuredLogger {
  /**
   * Log de inicio de aplicación
   */
  static applicationStart(port: number, host: string): void {
    loggers[LogContext.SYSTEM].info({
      event: 'application_start',
      port,
      host,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: process.memoryUsage()
    }, '🚀 BLXK Backend Server started');
  }

  /**
   * Log de shutdown graceful
   */
  static gracefulShutdown(signal: string): void {
    loggers[LogContext.SYSTEM].info({
      event: 'graceful_shutdown',
      signal,
      uptime: process.uptime()
    }, '🛑 Shutting down gracefully...');
  }

  /**
   * Log de request HTTP
   */
  static httpRequest(req: any, res: any, duration?: number): void {
    const context = LogContext.API;
    const logData = {
      method: req.method,
      url: req.url,
      userAgent: req.get('user-agent'),
      ip: req.ip || req.connection.remoteAddress,
      statusCode: res.statusCode,
      duration,
      contentLength: res.get('content-length')
    };

    if (res.statusCode >= 400) {
      loggers[context].warn(logData, 'HTTP Request completed with warning');
    } else {
      loggers[context].info(logData, 'HTTP Request completed');
    }
  }

  /**
   * Log de error HTTP
   */
  static httpError(req: any, error: Error, statusCode: number = 500): void {
    loggers[LogContext.API].error({
      method: req.method,
      url: req.url,
      userAgent: req.get('user-agent'),
      ip: req.ip || req.connection.remoteAddress,
      error: error.message,
      stack: error.stack,
      statusCode
    }, 'HTTP Request failed');
  }

  /**
   * Log de operación WhatsApp
   */
  static whatsappOperation(
    operation: string, 
    clientId: string, 
    details?: any, 
    success: boolean = true
  ): void {
    const level = success ? 'info' : 'error';
    const logData = {
      operation,
      clientId,
      ...details
    };

    loggers[LogContext.WHATSAPP][level](logData, `WhatsApp ${operation}`);
  }

  /**
   * Log de mensaje WhatsApp
   */
  static whatsappMessage(
    type: 'sent' | 'received',
    clientId: string,
    messageId?: string,
    to?: string,
    from?: string,
    messageType?: string
  ): void {
    loggers[LogContext.WHATSAPP].info({
      event: `message_${type}`,
      clientId,
      messageId,
      to,
      from,
      messageType
    }, `WhatsApp message ${type}`);
  }

  /**
   * Log de conexión/desconexión WhatsApp
   */
  static whatsappConnection(
    event: 'connecting' | 'connected' | 'disconnected' | 'reconnecting',
    clientId: string,
    details?: any
  ): void {
    loggers[LogContext.WHATSAPP].info({
      event: `connection_${event}`,
      clientId,
      ...details
    }, `WhatsApp ${event}`);
  }

  /**
   * Log de operación de base de datos
   */
  static databaseOperation(
    operation: string,
    table: string,
    duration?: number,
    success: boolean = true,
    error?: Error
  ): void {
    const level = success ? 'debug' : 'error';
    const logData = {
      operation,
      table,
      duration,
      ...(error && { error: error.message, stack: error.stack })
    };

    loggers[LogContext.DATABASE][level](logData, `Database ${operation}`);
  }

  /**
   * Log de operación Docker
   */
  static dockerOperation(
    operation: string,
    containerName?: string,
    details?: any,
    success: boolean = true
  ): void {
    const level = success ? 'info' : 'error';
    const logData = {
      operation,
      containerName,
      ...details
    };

    loggers[LogContext.DOCKER][level](logData, `Docker ${operation}`);
  }

  /**
   * Log de evento WebSocket
   */
  static websocketEvent(
    event: string,
    socketId?: string,
    userId?: string,
    details?: any
  ): void {
    loggers[LogContext.WEBSOCKET].info({
      event,
      socketId,
      userId,
      ...details
    }, `WebSocket ${event}`);
  }

  /**
   * Log de evento de autenticación
   */
  static authEvent(
    event: 'login' | 'logout' | 'register' | 'failed_login',
    userId?: string,
    email?: string,
    details?: any
  ): void {
    loggers[LogContext.AUTH].info({
      event,
      userId,
      email,
      ...details
    }, `Authentication ${event}`);
  }

  /**
   * Log de evento de seguridad
   */
  static securityEvent(
    event: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    details?: any
  ): void {
    loggers[LogContext.SECURITY].warn({
      event,
      severity,
      ...details
    }, `Security event: ${event}`);
  }

  /**
   * Log de métricas de sistema
   */
  static systemMetrics(): void {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    loggers[LogContext.SYSTEM].info({
      event: 'system_metrics',
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: process.uptime()
    }, 'System metrics');
  }

  /**
   * Log de webhook enviado
   */
  static webhookSent(
    url: string,
    event: string,
    success: boolean,
    responseTime?: number,
    error?: Error
  ): void {
    const level = success ? 'info' : 'error';
    const logData = {
      url,
      event,
      responseTime,
      ...(error && { error: error.message })
    };

    loggers[LogContext.API][level](logData, `Webhook ${event} ${success ? 'sent' : 'failed'}`);
  }

  /**
   * Log de rate limit
   */
  static rateLimitExceeded(
    ip: string,
    endpoint: string,
    limit: number,
    windowMs: number
  ): void {
    loggers[LogContext.SECURITY].warn({
      event: 'rate_limit_exceeded',
      ip,
      endpoint,
      limit,
      windowMs
    }, 'Rate limit exceeded');
  }
}

// Exportaciones
export {
  logger,
  loggers,
  StructuredLogger,
  performanceTracker,
  LogLevel,
  LogContext
};

export default logger;
