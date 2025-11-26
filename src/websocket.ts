import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import logger from './utils/logger';

export class WebSocketService {
  private io: SocketIOServer | null = null;
  private userSockets: Map<string, Set<string>> = new Map();

  initialize(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: [
          process.env.FRONTEND_URL || 'http://localhost:3000',
          'http://localhost:3000',
          'http://localhost:3001',
        ],
        credentials: true,
      },
      path: '/socket.io/',
    });

    this.setupEventHandlers();
    logger.info('✅ WebSocket Server initialized');
  }

  private setupEventHandlers() {
    if (!this.io) return;

    this.io.on('connection', (socket) => {
      logger.info(`🔌 Client connected: ${socket.id}`);

      socket.on('authenticate', (data: { userId: string }) => {
        const { userId } = data;
        if (!userId) return;

        if (!this.userSockets.has(userId)) {
          this.userSockets.set(userId, new Set());
        }
        this.userSockets.get(userId)?.add(socket.id);

        socket.join(`user:${userId}`);
        logger.info(`✅ User authenticated: ${userId} (socket: ${socket.id})`);

        socket.emit('authenticated', { success: true });
      });

      socket.on('join_instance', (data: { instanceId: string }) => {
        const { instanceId } = data;
        socket.join(`instance:${instanceId}`);
        logger.info(`📱 Socket ${socket.id} joined instance: ${instanceId}`);
      });

      socket.on('leave_instance', (data: { instanceId: string }) => {
        const { instanceId } = data;
        socket.leave(`instance:${instanceId}`);
        logger.info(`📱 Socket ${socket.id} left instance: ${instanceId}`);
      });

      socket.on('typing', (data: { instanceId: string; chatId: string; isTyping: boolean }) => {
        const { instanceId, chatId, isTyping } = data;
        socket.to(`instance:${instanceId}`).emit('user_typing', {
          chatId,
          isTyping,
        });
      });

      socket.on('disconnect', () => {
        logger.info(`🔌 Client disconnected: ${socket.id}`);

        this.userSockets.forEach((socketIds, userId) => {
          socketIds.delete(socket.id);
          if (socketIds.size === 0) {
            this.userSockets.delete(userId);
          }
        });
      });
    });
  }

  emitNewMessage(instanceId: string, message: any) {
    if (!this.io) return;
    this.io.to(`instance:${instanceId}`).emit('new_message', message);
    logger.info(`📨 New message emitted to instance: ${instanceId}`);
  }

  emitInstanceStateChange(instanceId: string, state: string) {
    if (!this.io) return;
    this.io.to(`instance:${instanceId}`).emit('instance_state_change', {
      instanceId,
      state,
      timestamp: new Date().toISOString(),
    });
    logger.info(`🔄 Instance state change emitted: ${instanceId} -> ${state}`);
  }

  emitChatUpdate(instanceId: string, chatId: string, update: any) {
    if (!this.io) return;
    this.io.to(`instance:${instanceId}`).emit('chat_update', {
      chatId,
      ...update,
    });
  }

  emitMessageRead(instanceId: string, chatId: string, messageIds: string[]) {
    if (!this.io) return;
    this.io.to(`instance:${instanceId}`).emit('messages_read', {
      chatId,
      messageIds,
    });
  }

  emitPresenceUpdate(instanceId: string, chatId: string, isOnline: boolean) {
    if (!this.io) return;
    this.io.to(`instance:${instanceId}`).emit('presence_update', {
      chatId,
      isOnline,
      timestamp: new Date().toISOString(),
    });
  }

  emitErrorToUser(userId: string, error: { message: string; code?: string }) {
    if (!this.io) return;
    this.io.to(`user:${userId}`).emit('error', error);
  }

  getIO(): SocketIOServer | null {
    return this.io;
  }
}

export const wsService = new WebSocketService();
