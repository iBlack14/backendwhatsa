/**
 * Logger Simplificado para Backend BLXK
 * Sistema de logging básico sin errores de TypeScript
 */

import pino, { Logger } from 'pino';
import { config } from 'dotenv';

// Cargar variables de entorno
config();

// Configuración base del logger
const baseConfig = {
  level: process.env.LOG_LEVEL || 'info',
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
          const levels: any = {
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
  api: logger.child({ context: 'api' }),
  whatsapp: logger.child({ context: 'whatsapp' }),
  database: logger.child({ context: 'database' }),
  docker: logger.child({ context: 'docker' }),
  websocket: logger.child({ context: 'websocket' }),
  auth: logger.child({ context: 'auth' }),
  cron: logger.child({ context: 'cron' }),
  system: logger.child({ context: 'system' }),
  security: logger.child({ context: 'security' }),
  performance: logger.child({ context: 'performance' })
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
      loggers.performance.warn({ label }, 'Timer not found');
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(label);
    
    loggers.performance.info({ 
      label, 
      duration,
      durationMs: duration 
    }, 'Performance metric');
    
    return duration;
  }

  timer(label: string) {
    return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
      const method = descriptor.value;
      descriptor.value = async function (...args: any[]) {
        const timerLabel = `${label || propertyName}`;
        loggers.performance.debug({ 
          method: propertyName, 
          args: args.length 
        }, 'Method execution started');

        const start = Date.now();
        try {
          const result = await method.apply(this, args);
          const duration = Date.now() - start;
          
          loggers.performance.info({ 
            method: propertyName, 
            duration,
            success: true 
          }, 'Method execution completed');
          
          return result;
        } catch (error: any) {
          const duration = Date.now() - start;
          
          loggers.performance.error({ 
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
class StructuredLogger {
  static applicationStart(port: number, host: string): void {
    loggers.system.info({
      event: 'application_start',
      port,
      host,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: process.memoryUsage()
    }, '🚀 BLXK Backend Server started');
  }

  static gracefulShutdown(signal: string): void {
    loggers.system.info({
      event: 'graceful_shutdown',
      signal,
      uptime: process.uptime()
    }, '🛑 Shutting down gracefully...');
  }

  static httpRequest(req: any, res: any, duration?: number): void {
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
      loggers.api.warn(logData, 'HTTP Request completed with warning');
    } else {
      loggers.api.info(logData, 'HTTP Request completed');
    }
  }

  static httpError(req: any, error: Error, statusCode: number = 500): void {
    loggers.api.error({
      method: req.method,
      url: req.url,
      userAgent: req.get('user-agent'),
      ip: req.ip || req.connection.remoteAddress,
      error: error.message,
      stack: error.stack,
      statusCode
    }, 'HTTP Request failed');
  }

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

    loggers.whatsapp[level](logData, `WhatsApp ${operation}`);
  }

  static whatsappMessage(
    type: 'sent' | 'received',
    clientId: string,
    messageId?: string,
    to?: string,
    from?: string,
    messageType?: string
  ): void {
    loggers.whatsapp.info({
      event: `message_${type}`,
      clientId,
      messageId,
      to,
      from,
      messageType
    }, `WhatsApp message ${type}`);
  }

  static whatsappConnection(
    event: 'connecting' | 'connected' | 'disconnected' | 'reconnecting',
    clientId: string,
    details?: any
  ): void {
    loggers.whatsapp.info({
      event: `connection_${event}`,
      clientId,
      ...details
    }, `WhatsApp ${event}`);
  }

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

    loggers.database[level](logData, `Database ${operation}`);
  }

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

    loggers.docker[level](logData, `Docker ${operation}`);
  }

  static websocketEvent(
    event: string,
    socketId?: string,
    userId?: string,
    details?: any
  ): void {
    loggers.websocket.info({
      event,
      socketId,
      userId,
      ...details
    }, `WebSocket ${event}`);
  }

  static authEvent(
    event: 'login' | 'logout' | 'register' | 'failed_login',
    userId?: string,
    email?: string,
    details?: any
  ): void {
    loggers.auth.info({
      event,
      userId,
      email,
      ...details
    }, `Authentication ${event}`);
  }

  static securityEvent(
    event: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    details?: any
  ): void {
    loggers.security.warn({
      event,
      severity,
      ...details
    }, `Security event: ${event}`);
  }

  static systemMetrics(): void {
    const memUsage = process.memoryUsage();
    
    loggers.system.info({
      event: 'system_metrics',
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers
      },
      cpu: process.cpuUsage(),
      uptime: process.uptime()
    }, 'System metrics');
  }

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

    loggers.api[level](logData, `Webhook ${event} ${success ? 'sent' : 'failed'}`);
  }

  static rateLimitExceeded(
    ip: string,
    endpoint: string,
    limit: number,
    windowMs: number
  ): void {
    loggers.security.warn({
      event: 'rate_limit_exceeded',
      ip,
      endpoint,
      limit,
      windowMs
    }, 'Rate limit exceeded');
  }
}

export default logger;
export { logger, loggers, StructuredLogger, performanceTracker };
