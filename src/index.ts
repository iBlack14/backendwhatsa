// Forced update
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import routes from './routes';
import { restoreAllSessions } from './whatsapp';
import { generalLimiter } from './middleware/rate-limit.middleware';
import logger, { loggers } from './utils/logger';
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
      console.warn(`[CORS] ❌ Blocked request from unauthorized origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Trust Proxy for Docker/Reverse Proxy (Easypanel)
app.set('trust proxy', 1);

// Rate limiting general - DESHABILITADO para permitir envío/recepción ilimitada de mensajes
// app.use('/api/', generalLimiter);

// Logging middleware con Pino
app.use((req, res, next) => {
  loggers.apiRequest(req.method, req.path, req.ip);
  next();
});

// Routes
app.use(routes);

// Error handler con logger
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  loggers.apiError(req.method, req.path, err, 500);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

// Initialize WebSocket
wsService.initialize(httpServer);

// Start server
httpServer.listen(PORT, '0.0.0.0', async () => {
  const host = process.env.HOST || 'localhost';

  logger.info('WhatsApp Backend Server started successfully');
  logger.info(`Server listening on: http://0.0.0.0:${PORT}`);
  logger.info(`Local access: http://localhost:${PORT}`);
  logger.info(`Network access: http://${host}:${PORT}`);
  logger.info(`Health endpoint: http://${host}:${PORT}/health`);
  logger.info(`WebSocket endpoint: ws://${host}:${PORT}/socket.io/`);

  logger.info('Available API endpoints:');
  logger.info('   POST   /api/create-session');
  logger.info('   POST   /api/generate-qr');
  logger.info('   GET    /api/qr/:clientId');
  logger.info('   GET    /api/profile/:documentId');
  logger.info('   GET    /api/sessions');
  logger.info('   POST   /api/send-message');
  logger.info('   POST   /api/send-message/:clientId (N8N format)');
  logger.info('   POST   /api/send-image/:clientId (N8N format)');
  logger.info('   POST   /api/disconnect/:clientId');
  logger.info('   POST   /api/disconnect-session/:documentId');
  logger.info('   POST   /api/update-webhook/:clientId');
  logger.info('   GET    /api/contacts/:instanceId');
  logger.info('   GET    /api/contacts/search/:instanceId?q=');
  logger.info('   POST   /api/messages/send');

  // Initialize existing sessions
  logger.info('Initializing existing WhatsApp sessions...');
  try {
    await restoreAllSessions();
    logger.info('Session initialization completed successfully');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Session initialization failed');
  }
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  logger.info('Received shutdown signal, terminating gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received termination signal, shutting down gracefully...');
  process.exit(0);
});
