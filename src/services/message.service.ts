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
      return true;
    } catch (error) {
      console.error('Error saving message:', error);
      return false;
    }
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
}

export const messageService = new MessageService();
