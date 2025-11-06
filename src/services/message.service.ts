import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

export interface Message {
  id?: string;
  instance_id: string;
  chat_id: string;
  message_id: string;
  sender_name?: string;
  sender_phone?: string;
  message_text?: string;
  message_caption?: string;
  message_type: string;
  media_url?: string;
  from_me: boolean;
  timestamp: Date;
  is_read: boolean;
  metadata?: any;
  profile_pic_url?: string;
}

export interface Chat {
  id?: string;
  instance_id: string;
  chat_id: string;
  chat_name?: string;
  chat_type: 'individual' | 'group';
  profile_pic_url?: string;
  last_message_text?: string;
  last_message_at?: Date;
  unread_count: number;
  is_archived: boolean;
  is_pinned: boolean;
}

/**
 * Servicio para gestionar mensajes y chats
 */
export class MessageService {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Guardar mensaje en la base de datos
   */
  async saveMessage(message: Message): Promise<boolean> {
    try {
      // 1. Guardar el mensaje
      const { error } = await this.supabase
        .from('messages')
        .insert({
          instance_id: message.instance_id,
          chat_id: message.chat_id,
          message_id: message.message_id,
          sender_name: message.sender_name,
          sender_phone: message.sender_phone,
          message_text: message.message_text,
          message_caption: message.message_caption,
          message_type: message.message_type,
          media_url: message.media_url,
          from_me: message.from_me,
          timestamp: message.timestamp.toISOString(),
          is_read: message.is_read,
          metadata: message.metadata,
        });

      if (error) {
        console.error('Error saving message:', error);
        return false;
      }

      console.log(`💾 Message saved: ${message.message_id}`);

      // 2. Actualizar o crear el chat
      await this.updateOrCreateChat(message);

      return true;
    } catch (error) {
      console.error('Error saving message:', error);
      return false;
    }
  }

  /**
   * Actualizar o crear chat con el último mensaje
   */
  private async updateOrCreateChat(message: Message): Promise<void> {
    try {
      // Verificar si el chat existe
      const { data: existingChat } = await this.supabase
        .from('chats')
        .select('*')
        .eq('instance_id', message.instance_id)
        .eq('chat_id', message.chat_id)
        .single();

      const chatData = {
        instance_id: message.instance_id,
        chat_id: message.chat_id,
        chat_name: message.sender_name || message.chat_id.split('@')[0],
        chat_type: message.chat_id.includes('@g.us') ? 'group' : 'individual',
        profile_pic_url: message.profile_pic_url || existingChat?.profile_pic_url,
        last_message_text: message.message_text || `${this.getMessageTypeLabel(message.message_type)}`,
        last_message_at: message.timestamp.toISOString(),
        unread_count: existingChat 
          ? (message.from_me ? existingChat.unread_count : existingChat.unread_count + 1)
          : (message.from_me ? 0 : 1),
        is_archived: existingChat?.is_archived || false,
        is_pinned: existingChat?.is_pinned || false,
      };

      if (existingChat) {
        // Actualizar chat existente
        await this.supabase
          .from('chats')
          .update(chatData)
          .eq('instance_id', message.instance_id)
          .eq('chat_id', message.chat_id);
      } else {
        // Crear nuevo chat
        await this.supabase
          .from('chats')
          .insert(chatData);
      }
    } catch (error) {
      console.error('Error updating/creating chat:', error);
    }
  }

  /**
   * Obtener etiqueta legible del tipo de mensaje
   */
  private getMessageTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      image: '🖼️ Imagen',
      video: '🎥 Video',
      audio: '🎵 Audio',
      voice: '🎤 Nota de voz',
      document: '📄 Documento',
      sticker: '🎨 Sticker',
      location: '📍 Ubicación',
      contact: '👤 Contacto',
      contacts: '👥 Contactos',
      poll: '📊 Encuesta',
      reaction: '❤️ Reacción',
    };
    return labels[type] || '📎 Archivo';
  }

  /**
   * Obtener mensajes de un chat
   */
  async getMessages(instanceId: string, chatId: string, limit: number = 50): Promise<Message[]> {
    try {
      const { data, error } = await this.supabase
        .from('messages')
        .select('*')
        .eq('instance_id', instanceId)
        .eq('chat_id', chatId)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error getting messages:', error);
        return [];
      }

      return (data as any[]).map(m => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })) as Message[];
    } catch (error) {
      console.error('Error getting messages:', error);
      return [];
    }
  }

  /**
   * Obtener chats de una instancia
   */
  async getChats(instanceId: string): Promise<Chat[]> {
    try {
      const { data, error } = await this.supabase
        .from('chats')
        .select('*')
        .eq('instance_id', instanceId)
        .order('is_pinned', { ascending: false })
        .order('last_message_at', { ascending: false });

      if (error) {
        console.error('Error getting chats:', error);
        return [];
      }

      return (data as any[]).map(c => ({
        ...c,
        last_message_at: c.last_message_at ? new Date(c.last_message_at) : undefined,
      })) as Chat[];
    } catch (error) {
      console.error('Error getting chats:', error);
      return [];
    }
  }

  /**
   * Marcar chat como leído
   */
  async markChatAsRead(instanceId: string, chatId: string): Promise<boolean> {
    try {
      // Marcar mensajes como leídos
      await this.supabase
        .from('messages')
        .update({ is_read: true })
        .eq('instance_id', instanceId)
        .eq('chat_id', chatId)
        .eq('from_me', false)
        .eq('is_read', false);

      // Resetear contador de no leídos
      await this.supabase
        .from('chats')
        .update({ unread_count: 0 })
        .eq('instance_id', instanceId)
        .eq('chat_id', chatId);

      return true;
    } catch (error) {
      console.error('Error marking chat as read:', error);
      return false;
    }
  }

  /**
   * Archivar/desarchivar chat
   */
  async toggleArchiveChat(instanceId: string, chatId: string, archived: boolean): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('chats')
        .update({ is_archived: archived })
        .eq('instance_id', instanceId)
        .eq('chat_id', chatId);

      if (error) {
        console.error('Error toggling archive:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error toggling archive:', error);
      return false;
    }
  }

  /**
   * Fijar/desfijar chat
   */
  async togglePinChat(instanceId: string, chatId: string, pinned: boolean): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('chats')
        .update({ is_pinned: pinned })
        .eq('instance_id', instanceId)
        .eq('chat_id', chatId);

      if (error) {
        console.error('Error toggling pin:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error toggling pin:', error);
      return false;
    }
  }

  /**
   * Buscar mensajes
   */
  async searchMessages(instanceId: string, query: string, limit: number = 50): Promise<Message[]> {
    try {
      const { data, error } = await this.supabase
        .from('messages')
        .select('*')
        .eq('instance_id', instanceId)
        .or(`message_text.ilike.%${query}%,message_caption.ilike.%${query}%`)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error searching messages:', error);
        return [];
      }

      return (data as any[]).map(m => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })) as Message[];
    } catch (error) {
      console.error('Error searching messages:', error);
      return [];
    }
  }

  /**
   * Enviar mensaje de WhatsApp
   */
  async sendMessage(instanceId: string, chatId: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Obtener la sesión de WhatsApp desde el gestor de sesiones
      const { getSession } = require('../whatsapp');
      const session = getSession(instanceId);

      if (!session || !session.socket) {
        return { success: false, error: 'Instance not connected' };
      }

      // Enviar mensaje usando Baileys
      const sentMessage = await session.socket.sendMessage(chatId, { text: message });

      if (!sentMessage) {
        return { success: false, error: 'Failed to send message' };
      }

      // Guardar mensaje en la base de datos
      const messageData: Message = {
        instance_id: instanceId,
        chat_id: chatId,
        message_id: sentMessage.key.id || `msg_${Date.now()}`,
        message_text: message,
        message_type: 'text',
        from_me: true,
        timestamp: new Date(),
        is_read: false,
      };

      await this.saveMessage(messageData);

      return { 
        success: true, 
        messageId: messageData.message_id 
      };
    } catch (error: any) {
      console.error('Error sending message:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to send message' 
      };
    }
  }
}

export const messageService = new MessageService();
