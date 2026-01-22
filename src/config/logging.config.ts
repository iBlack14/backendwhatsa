/**
 * Configuración de Logging para Producción
 * Archivo de configuración para despliegue en producción
 */

// Variables de entorno para logging
export const LOGGING_CONFIG = {
  // Nivel de log (silent, fatal, error, warn, info, debug, trace)
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  
  // Entorno
  NODE_ENV: process.env.NODE_ENV || 'production',
  
  // Versión de la aplicación
  APP_VERSION: process.env.APP_VERSION || '3.0.0',
  
  // Configuración de salida
  LOG_FORMAT: process.env.LOG_FORMAT || 'json', // json o pretty
  
  // Archivo de log (opcional)
  LOG_FILE: process.env.LOG_FILE || null,
  
  // Rotación de logs
  LOG_ROTATION: process.env.LOG_ROTATION === 'true',
  
  // Métricas de rendimiento
  ENABLE_PERFORMANCE_LOGGING: process.env.ENABLE_PERFORMANCE_LOGGING !== 'false',
  
  // Logging de seguridad
  ENABLE_SECURITY_LOGGING: process.env.ENABLE_SECURITY_LOGGING !== 'false',
  
  // Logging de base de datos
  ENABLE_DB_LOGGING: process.env.ENABLE_DB_LOGGING === 'true',
  
  // Logging de WhatsApp
  ENABLE_WHATSAPP_LOGGING: process.env.ENABLE_WHATSAPP_LOGGING !== 'false',
  
  // Rate limiting para logs (evitar spam)
  LOG_RATE_LIMIT: parseInt(process.env.LOG_RATE_LIMIT || '1000'), // logs por minuto
  
  // Contextos habilitados
  ENABLED_LOG_CONTEXTS: (process.env.ENABLED_LOG_CONTEXTS || 'api,whatsapp,auth,security,system').split(','),
  
  // Sanitización de datos sensibles
  SANITIZE_LOGS: process.env.SANITIZE_LOGS !== 'false',
  
  // Métricas del sistema
  SYSTEM_METRICS_INTERVAL: parseInt(process.env.SYSTEM_METRICS_INTERVAL || '60000'), // ms
  
  // Alertas
  ENABLE_ERROR_ALERTS: process.env.ENABLE_ERROR_ALERTS === 'true',
  ERROR_ALERT_WEBHOOK: process.env.ERROR_ALERT_WEBHOOK || null,
  
  // Integración con sistemas externos
  ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL || null,
  DATADOG_API_KEY: process.env.DATADOG_API_KEY || null,
  SENTRY_DSN: process.env.SENTRY_DSN || null,
  
  // Configuración específica para Docker/Easypanel
  DOCKER_LOG_DRIVER: process.env.DOCKER_LOG_DRIVER || 'json-file',
  EASYPANEL_LOGS: process.env.EASYPANEL_LOGS === 'true',
};

// Validación de configuración
export const validateLoggingConfig = (): void => {
  const requiredVars = ['NODE_ENV'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    process.exit(1);
  }
  
  // Validar nivel de log
  const validLevels = ['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'];
  if (!validLevels.includes(LOGGING_CONFIG.LOG_LEVEL)) {
    console.error('❌ Invalid LOG_LEVEL. Valid values:', validLevels.join(', '));
    process.exit(1);
  }
  
  // Validar formato de log
  const validFormats = ['json', 'pretty'];
  if (!validFormats.includes(LOGGING_CONFIG.LOG_FORMAT)) {
    console.error('❌ Invalid LOG_FORMAT. Valid values:', validFormats.join(', '));
    process.exit(1);
  }
  
  console.log('✅ Logging configuration validated successfully');
};

// Configuración para diferentes entornos
export const getEnvironmentConfig = () => {
  const isProduction = LOGGING_CONFIG.NODE_ENV === 'production';
  const isDevelopment = LOGGING_CONFIG.NODE_ENV === 'development';
  const isTest = LOGGING_CONFIG.NODE_ENV === 'test';
  
  return {
    isProduction,
    isDevelopment,
    isTest,
    
    // Configuración específica por entorno
    config: {
      development: {
        level: 'debug',
        format: 'pretty',
        enableColors: true,
        enableTimestamp: true,
        enablePerformanceLogging: true,
        enableSecurityLogging: true,
        enableDbLogging: true,
        enableWhatsappLogging: true,
      },
      
      production: {
        level: LOGGING_CONFIG.LOG_LEVEL,
        format: 'json',
        enableColors: false,
        enableTimestamp: true,
        enablePerformanceLogging: LOGGING_CONFIG.ENABLE_PERFORMANCE_LOGGING,
        enableSecurityLogging: LOGGING_CONFIG.ENABLE_SECURITY_LOGGING,
        enableDbLogging: LOGGING_CONFIG.ENABLE_DB_LOGGING,
        enableWhatsappLogging: LOGGING_CONFIG.ENABLE_WHATSAPP_LOGGING,
      },
      
      test: {
        level: 'silent',
        format: 'json',
        enableColors: false,
        enableTimestamp: false,
        enablePerformanceLogging: false,
        enableSecurityLogging: false,
        enableDbLogging: false,
        enableWhatsappLogging: false,
      }
    }
  };
};

// Plantilla para variables de entorno
export const ENV_TEMPLATE = `
# ========================================
# CONFIGURACIÓN DE LOGGING - BLXK BACKEND
# ========================================

# Nivel de log (silent, fatal, error, warn, info, debug, trace)
LOG_LEVEL=info

# Entorno
NODE_ENV=production

# Versión de la aplicación
APP_VERSION=3.0.0

# Formato de log (json o pretty)
LOG_FORMAT=json

# Archivo de log (opcional)
# LOG_FILE=/var/log/blxk-backend.log

# Rotación de logs
LOG_ROTATION=true

# Métricas de rendimiento
ENABLE_PERFORMANCE_LOGGING=true

# Logging de seguridad
ENABLE_SECURITY_LOGGING=true

# Logging de base de datos
ENABLE_DB_LOGGING=false

# Logging de WhatsApp
ENABLE_WHATSAPP_LOGGING=true

# Rate limiting para logs (logs por minuto)
LOG_RATE_LIMIT=1000

# Contextos habilitados (separados por coma)
ENABLED_LOG_CONTEXTS=api,whatsapp,auth,security,system

# Sanitización de datos sensibles
SANITIZE_LOGS=true

# Intervalo de métricas del sistema (ms)
SYSTEM_METRICS_INTERVAL=60000

# Alertas de errores
ENABLE_ERROR_ALERTS=false
# ERROR_ALERT_WEBHOOK=https://hooks.slack.com/...

# Integración con sistemas externos
# ELASTICSEARCH_URL=https://your-elasticsearch.com:9200
# DATADOG_API_KEY=your-datadog-key
# SENTRY_DSN=your-sentry-dsn

# Configuración Docker
DOCKER_LOG_DRIVER=json-file
EASYPANEL_LOGS=true
`;

export default LOGGING_CONFIG;
