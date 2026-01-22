/**
 * Tipos para el sistema de logging
 */

export interface LogData {
  method?: string;
  url?: string;
  userAgent?: string;
  ip?: string;
  statusCode?: number;
  duration?: number;
  contentLength?: number;
  [key: string]: any;
}

export interface WhatsAppLogData {
  operation: string;
  clientId: string;
  details?: any;
  success?: boolean;
}

export interface DatabaseLogData {
  operation: string;
  table: string;
  duration?: number;
  success?: boolean;
  error?: Error;
}

export interface DockerLogData {
  operation: string;
  containerName?: string;
  details?: any;
  success?: boolean;
}

export interface WebSocketLogData {
  event: string;
  socketId?: string;
  userId?: string;
  details?: any;
}

export interface AuthLogData {
  event: 'login' | 'logout' | 'register' | 'failed_login';
  userId?: string;
  email?: string;
  details?: any;
}

export interface SecurityLogData {
  event: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details?: any;
}

export interface SystemMetricsData {
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
  cpu: NodeJS.CpuUsage;
  uptime: number;
}

export interface WebhookLogData {
  url: string;
  event: string;
  success: boolean;
  responseTime?: number;
  error?: Error;
}

export interface RateLimitData {
  ip: string;
  endpoint: string;
  limit: number;
  windowMs: number;
}

export type LogLevelType = 'silent' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
export type LogContextType = 'api' | 'whatsapp' | 'database' | 'docker' | 'websocket' | 'auth' | 'cron' | 'system' | 'security' | 'performance';

export interface LoggerInstance {
  info: (data: any, message?: string) => void;
  warn: (data: any, message?: string) => void;
  error: (data: any, message?: string) => void;
  debug: (data: any, message?: string) => void;
  trace: (data: any, message?: string) => void;
}

export interface PerformanceTrackerInstance {
  start: (label: string) => void;
  end: (label: string) => number;
  timer: (label: string) => PropertyDescriptor;
}
