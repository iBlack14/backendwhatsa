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
      // 1. PRIMERO: Asegurar que el chat existe (para evitar errores de Foreign Key)
      await this.updateOrCreateChat(message);

      // 2. LUEGO: Guardar el mensaje
      const { error } = await supabase
        .from('messages')
        .upsert({
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
        }, { onConflict: 'message_id' });

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

      // LÓGICA DE NOMBRE DE CHAT CORREGIDA:
      // 1. Si es mensaje ENTRANTE (!from_me) y tiene nombre, usamos ese nombre (CORRIGE nombres erróneos y actualiza contactos).
      // 2. Si ya existe un nombre en DB y no tenemos uno mejor entrante, lo conservamos.
      // 3. Si no hay nada, usamos el ID/Número.
      // ⚠️ IMPORTANTE: Nunca usar message.sender_name si from_me=true, porque ese es TU nombre (ej. "Alonso"), no el del contacto.

      let finalChatName = currentChat?.chat_name; // Por defecto: mantener el que existe

      if (!message.from_me) {
        // MENSAJE ENTRANTE (Lo que importa para el nombre del chat)

        if (message.sender_name) {
          const name = message.sender_name.trim();
          // Validar: Que no sea ".", que no sea tu propio nombre común
          const isBadName = name === '.' || name.toLowerCase().includes('alonso huancas');

          if (!isBadName) {
            finalChatName = name; // Nombre válido, lo usamos
          }
        }

        // Si no tenemos nombre válido y no hay nombre previo, el fallback final será el número (abajo)
      }

      if (!finalChatName) {
        // Si aún no tenemos nombre (nuevo chat outgoing sin respuesta aun), usamos el número.
        finalChatName = message.chat_id.split('@')[0];
      }

      const upsertData = {
        instance_id: message.instance_id,
        chat_id: message.chat_id,
        chat_type: chatData.chat_type,
        last_message_text: chatData.last_message_text,
        last_message_at: chatData.last_message_at,
        unread_count: newUnreadCount,
        chat_name: finalChatName,
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
      // Normalizar IDs para buscar ambas versiones (con y sin sufijo)
      const cleanId = chatId.replace('@s.whatsapp.net', '').replace('@g.us', '');
      const pattern = chatId.includes('@g.us')
        ? `chat_id.eq.${chatId}` // Grupos usan ID exacto usualmente
        : `chat_id.eq.${cleanId},chat_id.eq.${cleanId}@s.whatsapp.net`; // Individuall: buscar ambos

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('instance_id', instanceId)
        .or(pattern)
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

  async sendImage(instanceId: string, chatId: string, imageUrl: string, caption?: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const { getSession } = require('../whatsapp');
      const session = getSession(instanceId);

      if (!session || !session.sock) {
        return { success: false, error: 'Instance not connected' };
      }

      // Enviar imagen usando Baileys (soporta URL y Base64)
      const sentMessage = await session.sock.sendMessage(chatId, {
        image: { url: imageUrl },
        caption: caption || ''
      });

      if (!sentMessage) {
        return { success: false, error: 'Failed to send image' };
      }

      // Guardar el mensaje en la base de datos
      const messageData: Message = {
        instance_id: instanceId,
        chat_id: chatId,
        message_id: sentMessage.key.id || `msg_${Date.now()}`,
        message_text: caption || '',
        message_type: 'image',
        media_url: imageUrl.startsWith('data:') ? undefined : imageUrl, // No guardar base64 gigante en media_url si es posible, o guardarlo si es necesario
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
      console.error('Error sending image:', error);
      return {
        success: false,
        error: error.message || 'Failed to send image'
      };
    }
  }
}

export const messageService = new MessageService();
