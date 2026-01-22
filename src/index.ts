// Forced update
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import routes from './routes';
import { restoreAllSessions } from './whatsapp';
import { generalLimiter } from './middleware/rate-limit.middleware';
import { StructuredLogger, performanceTracker } from './utils/enhanced-logger';
import { productionLoggingMiddleware } from './middleware/logging.middleware';
import { wsService } from './websocket';

const app = express();
const httpServer = createServer(app);
const PORT = Number(process.env.PORT) || 4000;

// ✅ CORS restrictivo - Solo permitir frontend autorizado
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:3000', // Desarrollo
  'http://localhost:3001', // Desarrollo alternativo
];

app.use(cors({
  origin: function (origin, callback) {
    // Permitir requests sin origin (como Postman) solo en desarrollo
    if (!origin && process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }

    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      StructuredLogger.securityEvent('cors_blocked', 'medium', {
        origin,
        userAgent: origin ? 'unknown' : 'no-origin'
      });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting general - DESHABILITADO para permitir envío/recepción ilimitada de mensajes
// app.use('/api/', generalLimiter);

// Aplicar middleware de logging mejorado
if (process.env.NODE_ENV === 'production') {
  app.use(productionLoggingMiddleware);
} else {
  // En desarrollo usar logging simplificado
  app.use((req, res, next) => {
    StructuredLogger.httpRequest(req, res);
    next();
  });
}

// Routes
app.use(routes);

// Error handler con logger mejorado
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  StructuredLogger.httpError(req, err, 500);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    requestId: req.id
  });
});

// Initialize WebSocket
wsService.initialize(httpServer);

// Start server
httpServer.listen(PORT, '0.0.0.0', async () => {
  const host = process.env.HOST || 'localhost';

  // Log de inicio mejorado
  StructuredLogger.applicationStart(PORT, host);

  // Log de endpoints disponibles
  const endpoints = [
    'POST   /api/create-session',
    'POST   /api/generate-qr',
    'GET    /api/qr/:clientId',
    'GET    /api/profile/:documentId',
    'GET    /api/sessions',
    'POST   /api/send-message',
    'POST   /api/send-message/:clientId (N8N format)',
    'POST   /api/send-image/:clientId (N8N format)',
    'POST   /api/disconnect/:clientId',
    'POST   /api/disconnect-session/:documentId',
    'POST   /api/update-webhook/:clientId',
    'GET    /api/contacts/:instanceId',
    'GET    /api/contacts/search/:instanceId?q=',
    'POST   /api/messages/send'
  ];

  StructuredLogger.systemMetrics();
  
  // Restaurar sesiones existentes
  StructuredLogger.whatsappOperation('restore_sessions', 'system', {}, true);
  try {
    performanceTracker.start('restore_all_sessions');
    await restoreAllSessions();
    const duration = performanceTracker.end('restore_all_sessions');
    StructuredLogger.whatsappOperation('sessions_restored', 'system', { 
      totalSessions: duration, 
      success: true 
    }, true);
  } catch (error: any) {
    StructuredLogger.whatsappOperation('sessions_restore_failed', 'system', { 
      error: error.message 
    }, false);
  }
});

// Graceful shutdown mejorado
const gracefulShutdown = (signal: string) => {
  StructuredLogger.gracefulShutdown(signal);
  
  // Cerrar conexiones WebSocket
  wsService.close();
  
  // Cerrar servidor HTTP
  setTimeout(() => {
    process.exit(0);
  }, 5000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Capturar errores no manejados
process.on('uncaughtException', (error) => {
  StructuredLogger.securityEvent('uncaught_exception', 'critical', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  StructuredLogger.securityEvent('unhandled_rejection', 'critical', {
    reason: reason instanceof Error ? reason.message : reason,
    promise: promise.toString()
  });
});
