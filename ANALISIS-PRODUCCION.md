# 🔍 Análisis de Producción y Mejoras

## ✅ Estado Actual del Proyecto

### Arquitectura General
```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Frontend   │────►│   Backend    │────►│  Supabase   │
│  (Next.js)  │     │  (Express)   │     │  (Database) │
└─────────────┘     └───────┬──────┘     └─────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │    Docker    │
                    │  (N8N Suite) │
                    └──────────────┘
```

---

## 🚨 PROBLEMAS CRÍTICOS (RESOLVER YA)

### 1. ⚠️ SEGURIDAD - CORS Abierto a Todo
**Archivo**: `src/index.ts` línea 13-17

```typescript
// ❌ PROBLEMA
app.use(cors({
  origin: '*', // PELIGROSO EN PRODUCCIÓN
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
```

**Solución**:
```typescript
// ✅ CORRECCIÓN
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'https://tu-dominio.com',
  'https://www.tu-dominio.com'
];

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (mobile apps, curl, postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
  maxAge: 86400, // 24 horas de cache
}));
```

---

### 2. ⚠️ FALTA AUTENTICACIÓN EN BACKEND

**Problema**: El backend NO valida tokens ni API keys

**Archivos afectados**: `src/routes.ts` - TODAS las rutas

```typescript
// ❌ PROBLEMA - Sin autenticación
router.post('/api/send-message/:clientId', async (req, res) => {
  // Cualquiera puede enviar mensajes
});
```

**Solución**: Crear middleware de autenticación

```typescript
// ✅ CREAR: src/middlewares/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

export async function authenticateApiKey(
  req: Request, 
  res: Response, 
  next: NextFunction
) {
  const apiKey = req.headers.authorization?.replace('Bearer ', '');

  if (!apiKey) {
    return res.status(401).json({ error: 'API Key required' });
  }

  try {
    // Verificar API key en Supabase
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, status_plan')
      .eq('api_key', apiKey)
      .single();

    if (error || !profile) {
      return res.status(401).json({ error: 'Invalid API Key' });
    }

    if (!profile.status_plan) {
      return res.status(403).json({ error: 'No active plan' });
    }

    // Adjuntar user_id a la request
    (req as any).userId = profile.id;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Para rutas que solo necesitan service role
export function authenticateServiceRole(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!authHeader || !authHeader.includes(serviceKey || '')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
```

**Aplicar en routes.ts**:
```typescript
import { authenticateApiKey } from './middlewares/auth.middleware';

// Proteger rutas críticas
router.post('/api/send-message/:clientId', 
  authenticateApiKey,  // ✅ Agregar esto
  async (req, res) => {
    // ...
  }
);
```

---

### 3. ⚠️ RATE LIMITING - Falta Limitador de Requests

**Problema**: Un usuario puede hacer miles de requests por segundo

**Solución**: Implementar rate limiting

```bash
npm install express-rate-limit
```

```typescript
// ✅ AGREGAR EN: src/index.ts
import rateLimit from 'express-rate-limit';

// Rate limiter general
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por IP
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter estricto para mensajes
const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30, // 30 mensajes por minuto
  message: 'Message rate limit exceeded',
});

// Aplicar
app.use('/api/', generalLimiter);
app.use('/api/send-message', messageLimiter);
app.use('/api/send-image', messageLimiter);
```

---

### 4. ⚠️ LOGS SIN ROTACIÓN

**Problema**: Los logs no se guardan ni rotan, solo console.log

**Solución**: Usar winston + log rotation

```bash
npm install winston winston-daily-rotate-file
```

```typescript
// ✅ CREAR: src/utils/logger.ts
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // Logs de errores
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
    }),
    // Logs combinados
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
    }),
  ],
});

// En desarrollo también mostrar en consola
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}

export default logger;

// Usar en toda la app
// logger.info('Message sent', { userId, to });
// logger.error('Error sending message', { error, userId });
```

---

### 5. ⚠️ VARIABLES DE ENTORNO NO VALIDADAS

**Problema**: El app puede arrancar sin variables críticas

**Solución**: Validar env vars al inicio

```typescript
// ✅ CREAR: src/config/env.validation.ts
import dotenv from 'dotenv';
dotenv.config();

interface EnvConfig {
  PORT: number;
  NODE_ENV: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  BASE_DOMAIN: string;
  DOCKER_NETWORK: string;
  N8N_ENCRYPTION_KEY: string;
}

function validateEnv(): EnvConfig {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`  - ${key}`));
    process.exit(1);
  }

  return {
    PORT: Number(process.env.PORT) || 4000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!,
    BASE_DOMAIN: process.env.BASE_DOMAIN || 'localhost',
    DOCKER_NETWORK: process.env.DOCKER_NETWORK || 'bridge',
    N8N_ENCRYPTION_KEY: process.env.N8N_ENCRYPTION_KEY || 'default-key',
  };
}

export const env = validateEnv();

// Usar en index.ts
import { env } from './config/env.validation';
const PORT = env.PORT;
```

---

## ⚡ MEJORAS DE RENDIMIENTO

### 6. Caché de Base de Datos

**Problema**: Cada request consulta Supabase (lento y costoso)

**Solución**: Implementar Redis o caché en memoria

```bash
npm install node-cache
```

```typescript
// ✅ CREAR: src/utils/cache.ts
import NodeCache from 'node-cache';

// Cache con TTL de 5 minutos
export const cache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
});

// Wrapper para cachear funciones
export function cacheWrapper<T>(
  key: string,
  ttl: number,
  fn: () => Promise<T>
): Promise<T> {
  const cached = cache.get<T>(key);
  if (cached) return Promise.resolve(cached);

  return fn().then(result => {
    cache.set(key, result, ttl);
    return result;
  });
}

// Ejemplo de uso en plans.service.ts
async getPlan(planType: PlanType): Promise<Plan | undefined> {
  return cacheWrapper(
    `plan:${planType}`,
    3600, // 1 hora
    async () => {
      const { data, error } = await this.supabase
        .from('plans')
        .select('*')
        .eq('plan_type', planType)
        .single();
      
      return data;
    }
  );
}
```

---

### 7. Conexión Pool para Supabase

**Problema**: Se crea cliente de Supabase en cada archivo

**Solución**: Singleton pattern

```typescript
// ✅ CREAR: src/lib/supabase.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_KEY || '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        db: {
          schema: 'public',
        },
        global: {
          headers: {
            'x-application-name': 'whatsapp-backend',
          },
        },
      }
    );
  }
  return supabaseInstance;
}

// Usar en todos lados
import { getSupabaseClient } from './lib/supabase';
const supabase = getSupabaseClient();
```

---

### 8. Compresión de Respuestas

```bash
npm install compression
```

```typescript
// En index.ts
import compression from 'compression';

app.use(compression({
  level: 6,
  threshold: 100 * 1000, // Solo comprimir > 100KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
}));
```

---

## 🔒 MEJORAS DE SEGURIDAD

### 9. Helmet para Headers de Seguridad

```bash
npm install helmet
```

```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));
```

---

### 10. Sanitización de Inputs

```bash
npm install express-validator
```

```typescript
import { body, validationResult } from 'express-validator';

// Middleware de validación
const validateSendMessage = [
  body('to')
    .trim()
    .matches(/^\d{10,15}$/)
    .withMessage('Invalid phone number'),
  body('message')
    .trim()
    .isLength({ min: 1, max: 4096 })
    .withMessage('Message must be between 1 and 4096 characters'),
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
];

// Usar
router.post('/api/send-message', 
  authenticateApiKey,
  validateSendMessage,
  async (req, res) => {
    // ...
  }
);
```

---

### 11. Encriptar Datos Sensibles

```typescript
// ✅ CREAR: src/utils/crypto.ts
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-32-char-key-change-this!';
const IV_LENGTH = 16;

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(ENCRYPTION_KEY.slice(0, 32)),
    iv
  );
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

export function decrypt(text: string): string {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift()!, 'hex');
  const encrypted = parts.join(':');
  
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(ENCRYPTION_KEY.slice(0, 32)),
    iv
  );
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Usar para guardar credenciales
const encryptedCreds = encrypt(JSON.stringify(credentials));
```

---

## 📊 MONITOREO Y OBSERVABILIDAD

### 12. Health Checks Mejorados

```typescript
// ✅ MEJORAR: src/routes.ts
router.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    checks: {
      database: 'unknown',
      docker: 'unknown',
      memory: {
        used: process.memoryUsage().heapUsed / 1024 / 1024,
        total: process.memoryUsage().heapTotal / 1024 / 1024,
      },
    },
  };

  try {
    // Check database
    const { error } = await getSupabaseClient()
      .from('plans')
      .select('id')
      .limit(1);
    
    health.checks.database = error ? 'unhealthy' : 'healthy';
  } catch (e) {
    health.checks.database = 'unhealthy';
    health.status = 'degraded';
  }

  try {
    // Check Docker
    await docker.ping();
    health.checks.docker = 'healthy';
  } catch (e) {
    health.checks.docker = 'unhealthy';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

---

### 13. Métricas con Prometheus

```bash
npm install prom-client
```

```typescript
// ✅ CREAR: src/utils/metrics.ts
import { Registry, Counter, Histogram } from 'prom-client';

export const register = new Registry();

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const messagesCounter = new Counter({
  name: 'whatsapp_messages_sent_total',
  help: 'Total number of WhatsApp messages sent',
  labelNames: ['status'],
  registers: [register],
});

export const sessionsGauge = new Counter({
  name: 'whatsapp_active_sessions',
  help: 'Number of active WhatsApp sessions',
  registers: [register],
});

// Middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration
      .labels(req.method, req.path, res.statusCode.toString())
      .observe(duration);
  });
  
  next();
});

// Endpoint de métricas
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

---

## 🐳 MEJORAS DE DOCKER

### 14. Multi-stage Build Optimizado

```dockerfile
# ✅ MEJORAR: Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Cache de dependencias
COPY package*.json ./
RUN npm ci --only=production

# Build
COPY . .
RUN npm run build

# Imagen final más pequeña
FROM node:20-alpine

WORKDIR /app

# Instalar solo producción
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Usuario no-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p sessions && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/index.js"]
```

---

### 15. Docker Compose para Desarrollo

```yaml
# ✅ CREAR: docker-compose.yml
version: '3.8'

services:
  backend:
    build: .
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=development
      - PORT=4000
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
    volumes:
      - ./sessions:/app/sessions
      - ./logs:/app/logs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 3s
      retries: 3

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  redis_data:
```

---

## 📱 MEJORAS DE FRONTEND

### 16. Manejo de Errores Mejorado

```typescript
// ✅ CREAR: src/lib/api-client.ts
import axios, { AxiosError } from 'axios';
import { toast } from 'sonner';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_BACKEND_URL,
  timeout: 30000,
});

// Interceptor de requests
apiClient.interceptors.request.use((config) => {
  // Agregar API key desde localStorage/session
  const apiKey = localStorage.getItem('api_key');
  if (apiKey) {
    config.headers.Authorization = `Bearer ${apiKey}`;
  }
  return config;
});

// Interceptor de responses
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response) {
      const status = error.response.status;
      const message = (error.response.data as any)?.error || 'Error';
      
      switch (status) {
        case 401:
          toast.error('No autorizado. Verifica tu API key');
          break;
        case 403:
          toast.error('Acceso denegado');
          break;
        case 429:
          toast.error('Demasiadas peticiones. Intenta más tarde');
          break;
        case 500:
          toast.error('Error del servidor');
          break;
        default:
          toast.error(message);
      }
    } else if (error.request) {
      toast.error('Sin conexión al servidor');
    }
    
    return Promise.reject(error);
  }
);

export default apiClient;
```

---

### 17. Optimización de Imágenes

```typescript
// Ya está bien configurado en next.config.mjs ✅
// Pero agregar componente wrapper

// ✅ CREAR: src/components/OptimizedImage.tsx
import Image from 'next/image';

interface OptimizedImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
}

export default function OptimizedImage({
  src,
  alt,
  width = 400,
  height = 300,
  priority = false,
}: OptimizedImageProps) {
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      placeholder="blur"
      blurDataURL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
      loading={priority ? 'eager' : 'lazy'}
      quality={85}
    />
  );
}
```

---

## 🗄️ MEJORAS DE BASE DE DATOS

### 18. Índices Adicionales

```sql
-- ✅ AGREGAR AL SCHEMA

-- Índice para búsquedas de API key (muy frecuente)
CREATE INDEX idx_profiles_api_key ON profiles(api_key) WHERE api_key IS NOT NULL;

-- Índice para búsquedas de instancias activas
CREATE INDEX idx_instances_user_state ON instances(user_id, state) WHERE is_active = true;

-- Índice para búsquedas de spam en progreso
CREATE INDEX idx_spam_progress_user_status ON spam_progress(user_id, status) 
  WHERE status IN ('running', 'pending');

-- Índice para limpieza de sesiones antiguas
CREATE INDEX idx_instances_created_inactive ON instances(created_at) 
  WHERE is_active = false;
```

---

### 19. Función de Limpieza Automática

```sql
-- ✅ AGREGAR AL SCHEMA

-- Limpiar instancias inactivas antiguas (>30 días)
CREATE OR REPLACE FUNCTION cleanup_old_instances()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM instances
  WHERE is_active = false
    AND created_at < NOW() - INTERVAL '30 days';
  
  RAISE NOTICE 'Old inactive instances cleaned';
END;
$$;

-- Limpiar spam_progress completados (>7 días)
CREATE OR REPLACE FUNCTION cleanup_old_spam_progress()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM spam_progress
  WHERE status = 'completed'
    AND completed_at < NOW() - INTERVAL '7 days';
  
  RAISE NOTICE 'Old spam progress cleaned';
END;
$$;
```

---

## 📋 CHECKLIST DE PRODUCCIÓN

### Seguridad
- [ ] CORS configurado con dominios específicos
- [ ] Autenticación con API keys implementada
- [ ] Rate limiting en todas las rutas
- [ ] Helmet para headers de seguridad
- [ ] Validación de inputs con express-validator
- [ ] Encriptación de datos sensibles
- [ ] Variables de entorno validadas
- [ ] HTTPS habilitado (Traefik/Nginx)

### Rendimiento
- [ ] Caché implementado (Redis o NodeCache)
- [ ] Compresión de respuestas
- [ ] Connection pooling
- [ ] Índices de base de datos optimizados
- [ ] CDN para assets estáticos
- [ ] Imágenes optimizadas (WebP)

### Monitoreo
- [ ] Logs con rotación (Winston)
- [ ] Health checks completos
- [ ] Métricas con Prometheus
- [ ] Alertas configuradas
- [ ] APM (New Relic, Datadog)
- [ ] Error tracking (Sentry)

### Docker
- [ ] Multi-stage build
- [ ] Usuario no-root
- [ ] Health checks
- [ ] Resource limits
- [ ] Volúmenes persistentes
- [ ] Network configurado

### Base de Datos
- [ ] Backups automáticos
- [ ] RLS verificado
- [ ] Índices optimizados
- [ ] Funciones de limpieza programadas
- [ ] Monitoreo de queries lentos

### Infraestructura
- [ ] SSL/TLS configurado
- [ ] Firewall configurado
- [ ] Reverse proxy (Nginx/Traefik)
- [ ] Auto-scaling (si aplica)
- [ ] Disaster recovery plan

---

## 🚀 PLAN DE IMPLEMENTACIÓN

### Fase 1: Seguridad Crítica (1-2 días)
1. Configurar CORS específico
2. Implementar autenticación
3. Agregar rate limiting
4. Helmet headers

### Fase 2: Logging y Monitoreo (2-3 días)
1. Winston con rotación
2. Health checks mejorados
3. Métricas básicas
4. Error tracking

### Fase 3: Performance (3-4 días)
1. Caché en memoria
2. Compresión
3. Índices de BD
4. Optimizaciones de queries

### Fase 4: Docker y Deploy (2-3 días)
1. Multi-stage Dockerfile
2. Docker Compose
3. CI/CD pipeline
4. Monitoreo de producción

---

## 🎯 PRIORIDAD ALTA - HACER YA

1. **CORS**: Restringir a dominios específicos
2. **Autenticación**: Implementar API key validation
3. **Rate Limiting**: Prevenir abuso
4. **Logs**: Winston con rotación
5. **Variables .env**: Crear .env.example

---

## 💰 COSTOS ESTIMADOS

### Infraestructura Mensual
- **VPS** (4GB RAM, 2 vCPU): ~$20-40/mes
- **Supabase** (Plan Pro): ~$25/mes
- **CDN** (Cloudflare): Gratis - $20/mes
- **Monitoreo** (Sentry Free): $0
- **Total**: ~$45-85/mes

### Tiempo de Desarrollo
- Seguridad: 2-3 días
- Performance: 3-4 días
- Monitoreo: 2-3 días
- **Total**: ~7-10 días

---

## 📞 CONTACTOS ÚTILES

- **Supabase Docs**: https://supabase.com/docs
- **Docker Best Practices**: https://docs.docker.com/develop/dev-best-practices/
- **OWASP Security**: https://owasp.org/www-project-top-ten/

---

**Próximos pasos**: Implementar en orden de prioridad, empezando por seguridad crítica.
