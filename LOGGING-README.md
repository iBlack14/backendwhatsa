# 📋 Sistema de Logging Mejorado - BLXK Backend

## 🎯 Overview

Se ha implementado un sistema de logging profesional y estructurado para el backend BLXK, diseñado para proporcionar visibilidad completa, seguridad y métricas de rendimiento en producción.

## 🚀 Características Principales

### ✨ **Logging Estructurado**
- **Niveles de log**: `silent`, `fatal`, `error`, `warn`, `info`, `debug`, `trace`
- **Contextos específicos**: `api`, `whatsapp`, `database`, `docker`, `websocket`, `auth`, `cron`, `system`, `security`, `performance`
- **Formato JSON** para producción y formato legible para desarrollo
- **Sanitización automática** de datos sensibles (passwords, tokens, API keys)

### 🔒 **Seguridad Integrada**
- **Detección de ataques**: SQL Injection, Path Traversal, User-Agents sospechosos
- **Logging de eventos CORS** no autorizados
- **Rate limiting** para evitar spam de logs
- **Alertas de seguridad** con diferentes niveles de severidad

### 📊 **Métricas de Rendimiento**
- **Tracking automático** de tiempo de ejecución
- **Decoradores** para medir funciones específicas
- **Métricas del sistema**: CPU, memoria, uptime
- **Monitoring de endpoints** con tiempos de respuesta

### 🔄 **Gestión de Errores**
- **Captura de excepciones no manejadas**
- **Logging de rechazos de promesas**
- **Graceful shutdown** con logging completo
- **Request IDs** para seguimiento

## 📁 Archivos Nuevos

```
src/
├── utils/
│   └── enhanced-logger.ts     # Logger principal con StructuredLogger
├── middleware/
│   └── logging.middleware.ts  # Middleware de Express mejorado
├── config/
│   └── logging.config.ts     # Configuración de logging
└── scripts/
    └── log-monitor.ts        # Script de monitoreo en tiempo real
```

## ⚙️ Configuración

### Variables de Entorno

```bash
# Nivel de log (silent, fatal, error, warn, info, debug, trace)
LOG_LEVEL=info

# Entorno
NODE_ENV=production

# Formato de log (json o pretty)
LOG_FORMAT=json

# Métricas de rendimiento
ENABLE_PERFORMANCE_LOGGING=true

# Logging de seguridad
ENABLE_SECURITY_LOGGING=true

# Logging de base de datos
ENABLE_DB_LOGGING=false

# Logging de WhatsApp
ENABLE_WHATSAPP_LOGGING=true

# Contextos habilitados (separados por coma)
ENABLED_LOG_CONTEXTS=api,whatsapp,auth,security,system

# Sanitización de datos sensibles
SANITIZE_LOGS=true
```

### Configuración por Entorno

#### 🏭 **Producción**
- Formato JSON estructurado
- Nivel INFO por defecto
- Sin colores
- Métricas de rendimiento habilitadas
- Logging de seguridad máximo

#### 🛠️ **Desarrollo**
- Formato legible con colores
- Nivel DEBUG por defecto
- Timestamps legibles
- Todos los contextos habilitados

#### 🧪 **Testing**
- Nivel SILENT para no contaminar tests
- Formato JSON
- Métricas deshabilitadas

## 🔧 Uso

### **1. Logger Básico**

```typescript
import { StructuredLogger } from './utils/enhanced-logger';

// Log de información
StructuredLogger.systemMetrics();

// Log de error
StructuredLogger.whatsappOperation('send_message_failed', clientId, { error: 'Connection timeout' }, false);
```

### **2. Performance Tracking**

```typescript
import { performanceTracker } from './utils/enhanced-logger';

// Manual
performanceTracker.start('database_query');
// ... operación
const duration = performanceTracker.end('database_query');

// Con decorador
class MyService {
  @performanceTracker.timer('expensive_operation')
  async expensiveOperation(data: any) {
    // Esta función será medida automáticamente
  }
}
```

### **3. Middleware en Express**

```typescript
import { productionLoggingMiddleware } from './middleware/logging.middleware';

// Aplicar middleware completo (producción)
app.use(productionLoggingMiddleware);

// O middleware individual
app.use(loggingMiddleware);
app.use(securityLoggingMiddleware);
```

## 📊 Monitoreo en Tiempo Real

### **Script de Monitoreo**

```bash
# Ejecutar monitoreo interactivo
npm run log:monitor

# O ejecutar directamente
npx ts-node scripts/log-monitor.ts
```

### **Comandos del Monitor**

```
log-monitor> level error          # Filtrar por nivel
log-monitor> context whatsapp     # Filtrar por contexto  
log-monitor> search "timeout"    # Buscar texto
log-monitor> errors              # Mostrar solo errores
log-monitor> stats               # Ver estadísticas
log-monitor> clear               # Limpiar filtros
log-monitor> help                # Mostrar ayuda
log-monitor> exit                # Salir
```

## 🔍 Ejemplos de Logs

### **Producción (JSON)**
```json
{
  "level": "info",
  "time": "2025-01-22T12:00:00.000Z",
  "context": "api",
  "service": "blxk-backend",
  "version": "3.0.0",
  "environment": "production",
  "method": "POST",
  "url": "/api/send-message",
  "statusCode": 200,
  "duration": 145,
  "requestId": "uuid-v4"
}
```

### **Desarrollo (Pretty)**
```
🕐 12:00:00 [API] [INFO] HTTP Request completed
🕐 12:00:01 [WHATSAPP] [ℹ️ INFO] WhatsApp message sent
🕐 12:00:02 [SECURITY] [⚠️ WARN] Suspicious user agent detected
```

## 🚨 Alertas de Seguridad

### **Eventos Detectados**
- **CORS no autorizado**: Intentos de acceso desde orígenes no permitidos
- **Path Traversal**: Intentos de acceso a archivos del sistema
- **SQL Injection**: Patrones de inyección SQL en URLs
- **User-Agents sospechosos**: Bots, scanners, herramientas de hacking
- **Rate Limit Exceeded**: Exceso de requests por IP

### **Niveles de Severidad**
- **LOW**: Eventos informativos de seguridad
- **MEDIUM**: Actividad sospechosa pero no maliciosa
- **HIGH**: Intentos claros de ataque
- **CRITICAL**: Errores del sistema o ataques exitosos

## 📈 Métricas Disponibles

### **Rendimiento**
- Tiempo de respuesta por endpoint
- Duración de operaciones de base de datos
- Tiempo de ejecución de funciones críticas
- Uso de memoria y CPU

### **Sistema**
- Uptime del servidor
- Memoria utilizada (RSS, Heap, etc.)
- Contadores de requests por contexto
- Estadísticas de errores

## 🔧 Integración con Sistemas Externos

### **Elasticsearch**
```bash
ELASTICSEARCH_URL=https://your-elasticsearch.com:9200
```

### **Datadog**
```bash
DATADOG_API_KEY=your-datadog-key
```

### **Sentry**
```bash
SENTRY_DSN=your-sentry-dsn
```

## 🚀 Despliegue

### **Docker**
```dockerfile
# Copiar configuración de logging
COPY src/config/logging.config.ts ./src/config/
COPY src/utils/enhanced-logger.ts ./src/utils/
COPY src/middleware/logging.middleware.ts ./src/middleware/

# Variables de entorno
ENV LOG_LEVEL=info
ENV LOG_FORMAT=json
ENV ENABLE_SECURITY_LOGGING=true
```

### **Easypanel**
```bash
# Configurar variables en el panel
EASYPANEL_LOGS=true
DOCKER_LOG_DRIVER=json-file
LOG_LEVEL=info
```

## 🛠️ Scripts Útiles

```json
{
  "scripts": {
    "log:monitor": "ts-node scripts/log-monitor.ts",
    "log:validate": "ts-node -e \"import('./src/config/logging.config').then(m => m.validateLoggingConfig())\"",
    "log:stats": "tail -f logs/app.log | grep -E '\\[ERROR\\]|\\[WARN\\]'"
  }
}
```

## 📝 Mejores Prácticas

### **✅ Recomendado**
- Usar contextos específicos para cada módulo
- Incluir Request IDs en logs de API
- Sanitizar datos sensibles siempre
- Configurar niveles apropiados por entorno
- Monitorear logs de seguridad constantemente

### **❌ Evitar**
- Logs con información personal (PII)
- Nivel DEBUG en producción
- Ignorar errores de seguridad
- Logs excesivamente verbosos
- No incluir contexto en los logs

## 🔍 Debugging

### **Problemas Comunes**

1. **Logs no aparecen**: Verificar `LOG_LEVEL` y `ENABLED_LOG_CONTEXTS`
2. **Formato incorrecto**: Revisar `LOG_FORMAT` y `NODE_ENV`
3. **Performance impact**: Reducir nivel de log o deshabilitar contextos no necesarios
4. **Datos sensibles**: Asegurar que `SANITIZE_LOGS=true`

### **Comandos de Debug**
```bash
# Validar configuración
npm run log:validate

# Ver logs de errores en tiempo real
npm run log:monitor
log-monitor> errors

# Estadísticas de logs
npm run log:monitor
log-monitor> stats
```

---

## 🎉 Conclusión

Este sistema de logging proporciona:
- **Visibilidad completa** del sistema
- **Seguridad proactiva** con detección de amenazas
- **Métricas de rendimiento** para optimización
- **Facilidad de debugging** con herramientas interactivas
- **Integración** con sistemas de monitoreo externos

Perfecto para producción profesional y desarrollo eficiente! 🚀
