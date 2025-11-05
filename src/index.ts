import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
import { restoreAllSessions } from './whatsapp';
import { generalLimiter } from './middleware/rate-limit.middleware';
import logger, { loggers } from './utils/logger';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting general
app.use('/api/', generalLimiter);

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

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  const host = process.env.HOST || 'localhost';
  
  logger.info('🚀 WhatsApp Backend Server started');
  logger.info(`🌐 Running on: http://0.0.0.0:${PORT}`);
  logger.info(`🌐 Local: http://localhost:${PORT}`);
  logger.info(`🌐 Network: http://${host}:${PORT}`);
  logger.info(`✅ Health check: http://${host}:${PORT}/health`);
  
  logger.info('📋 Available endpoints:');
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
  
  // Restaurar sesiones existentes
  logger.info('🔄 Restoring WhatsApp Sessions...');
  try {
    await restoreAllSessions();
    logger.info('✅ Sessions restored successfully');
  } catch (error: any) {
    logger.error({ error: error.message }, '❌ Error restoring sessions');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('🛑 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('🛑 Shutting down gracefully...');
  process.exit(0);
});
