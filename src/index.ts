import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
import { restoreAllSessions } from './whatsapp';

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

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use(routes);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  const host = process.env.HOST || 'localhost';
  console.log('');
  console.log('🚀 ========================================');
  console.log(`📱 WhatsApp Backend Server`);
  console.log(`🌐 Running on: http://0.0.0.0:${PORT}`);
  console.log(`🌐 Local: http://localhost:${PORT}`);
  console.log(`🌐 Network: http://${host}:${PORT}`);
  console.log(`✅ Health check: http://${host}:${PORT}/health`);
  console.log('🚀 ========================================');
  console.log('');
  console.log('📋 Available endpoints:');
  console.log(`   POST   /api/create-session`);
  console.log(`   POST   /api/generate-qr`);
  console.log(`   GET    /api/qr/:clientId`);
  console.log(`   GET    /api/profile/:documentId`);
  console.log(`   GET    /api/sessions`);
  console.log(`   POST   /api/send-message`);
  console.log(`   POST   /api/send-message/:clientId (N8N format)`);
  console.log(`   POST   /api/send-image/:clientId (N8N format)`);
  console.log(`   POST   /api/disconnect/:clientId`);
  console.log(`   POST   /api/disconnect-session/:documentId`);
  console.log(`   POST   /api/update-webhook/:clientId`);
  console.log('');
  
  // Restaurar sesiones existentes
  console.log('');
  console.log('🔄 ========================================');
  console.log('📱 Restoring WhatsApp Sessions...');
  console.log('🔄 ========================================');
  try {
    await restoreAllSessions();
  } catch (error: any) {
    console.error('❌ Error restoring sessions:', error.message);
  }
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down gracefully...');
  process.exit(0);
});
