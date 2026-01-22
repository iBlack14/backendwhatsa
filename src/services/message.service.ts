import * as dotenv from 'dotenv';
import { supabase } from '../lib/supabase';

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
  // private supabase: SupabaseClient; // USAR SINGLETON

  constructor() {
    // const supabaseUrl = process.env.SUPABASE_URL;
    // const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;

    // if (!supabaseUrl || !supabaseKey) {
    //   throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    // }

    // this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Guardar mensaje en la base de datos
   */
  async saveMessage(message: Message): Promise<boolean> {
    try {
      // 1. Guardar el mensaje
      const { error } = await supabase
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
      const chatData = {
        instance_id: message.instance_id,
        chat_id: message.chat_id,
        chat_name: message.sender_name || message.chat_id.split('@')[0], // Default name
        chat_type: message.chat_id.includes('@g.us') ? 'group' : 'individual',
        profile_pic_url: message.profile_pic_url,
        last_message_text: message.message_text || `${this.getMessageTypeLabel(message.message_type)}`,
        last_message_at: message.timestamp.toISOString(),
        is_archived: false,
        is_pinned: false,
        unread_count: 0 // Default, will be recalculated/incremented via RPC or manual logic if needed, but for upsert we need base values
      };

      // OPTIMIZACIÓN: Usar UPSERT para evitar 2 llamadas a DB
      // Sin embargo, para incrementar unread_count correctamente sin leer primero, necesitamos lógica especial.
      // Si queremos mantenerlo simple y rápido, podemos usar upsert pero perderíamos el incremento exacto si no tenemos RPC.
      // Para no romper lógica "sin afectar aplicativo", mantendremos la lógica pero optimizada:
      // Intentar update primero, si no existe (rows affect 0), entonces insert.

      const { data: currentChat } = await supabase
        .from('chats')
        .select('unread_count, chat_name, profile_pic_url')
        .eq('instance_id', message.instance_id)
        .eq('chat_id', message.chat_id)
        .single();

      const newUnreadCount = currentChat
        ? (message.from_me ? currentChat.unread_count : currentChat.unread_count + 1)
        : (message.from_me ? 0 : 1);

      const upsertData = {
        instance_id: message.instance_id,
        chat_id: message.chat_id,
        chat_type: chatData.chat_type,
        last_message_text: chatData.last_message_text,
        last_message_at: chatData.last_message_at,
        unread_count: newUnreadCount,
        // Solo actualizar nombre/foto si no existen o si queremos forzar (aquí conservamos lógica original de preservar nombre existente)
        chat_name: currentChat?.chat_name || chatData.chat_name,
        profile_pic_url: message.profile_pic_url || currentChat?.profile_pic_url,
      };

      await supabase
        .from('chats')
        .upsert(upsertData, { onConflict: 'instance_id,chat_id' });
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
      const { data, error } = await supabase
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
      const { data, error } = await supabase
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
      await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('instance_id', instanceId)
        .eq('chat_id', chatId)
        .eq('from_me', false)
        .eq('is_read', false);

      // Resetear contador de no leídos
      await supabase
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
      const { error } = await supabase
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
      const { error } = await supabase
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
      const { data, error } = await supabase
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

      if (!session || !session.sock) {
        return { success: false, error: 'Instance not connected' };
      }

      // Enviar mensaje usando Baileys
      const sentMessage = await session.sock.sendMessage(chatId, { text: message });

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
