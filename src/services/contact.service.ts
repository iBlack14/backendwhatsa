import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

export interface Contact {
  id?: string;
  instance_id: string;
  jid: string;
  name?: string;
  push_name?: string;
  profile_pic_url?: string;
  is_blocked: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface ContactSearchResult extends Contact {
  similarity_score?: number;
  last_message_at?: Date;
  unread_count?: number;
}

/**
 * Servicio para gestionar contactos de WhatsApp
 */
export class ContactService {
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
   * Guardar o actualizar contacto
   */
  async saveContact(contact: Contact): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('contacts')
        .upsert({
          instance_id: contact.instance_id,
          jid: contact.jid,
          name: contact.name,
          push_name: contact.push_name,
          profile_pic_url: contact.profile_pic_url,
          is_blocked: contact.is_blocked,
        }, {
          onConflict: 'instance_id,jid',
        });

      if (error) {
        console.error('Error saving contact:', error);
        return false;
      }

      console.log(`💾 Contact saved: ${contact.jid}`);
      return true;
    } catch (error) {
      console.error('Error saving contact:', error);
      return false;
    }
  }

  /**
   * Obtener contactos de una instancia
   */
  async getContacts(instanceId: string, limit: number = 100): Promise<Contact[]> {
    try {
      const { data, error } = await this.supabase
        .from('contacts')
        .select('*')
        .eq('instance_id', instanceId)
        .eq('is_blocked', false)
        .order('name', { ascending: true })
        .limit(limit);

      if (error) {
        console.error('Error getting contacts:', error);
        return [];
      }

      return data as Contact[];
    } catch (error) {
      console.error('Error getting contacts:', error);
      return [];
    }
  }

  /**
   * Buscar contactos con búsqueda inteligente (similar matches)
   * Usa búsqueda fuzzy con trigram similarity
   */
  async searchContacts(
    instanceId: string,
    query: string,
    limit: number = 20
  ): Promise<ContactSearchResult[]> {
    try {
      if (!query || query.trim().length === 0) {
        return [];
      }

      const searchTerm = query.trim().toLowerCase();

      // Búsqueda con similitud usando ILIKE para PostgreSQL
      // Busca en: nombre, push_name y número de teléfono (jid)
      const { data, error } = await this.supabase
        .from('contacts')
        .select(`
          *,
          chats!inner(
            last_message_at,
            unread_count
          )
        `)
        .eq('instance_id', instanceId)
        .eq('is_blocked', false)
        .or(`name.ilike.%${searchTerm}%,push_name.ilike.%${searchTerm}%,jid.ilike.%${searchTerm}%`)
        .order('name', { ascending: true })
        .limit(limit);

      if (error) {
        console.error('Error searching contacts:', error);

        // Fallback: búsqueda simple sin joins si hay error
        const { data: simpleData, error: simpleError } = await this.supabase
          .from('contacts')
          .select('*')
          .eq('instance_id', instanceId)
          .eq('is_blocked', false)
          .or(`name.ilike.%${searchTerm}%,push_name.ilike.%${searchTerm}%,jid.ilike.%${searchTerm}%`)
          .order('name', { ascending: true })
          .limit(limit);

        if (simpleError) {
          console.error('Error in fallback search:', simpleError);
          return [];
        }

        return this.calculateSimilarityScores(simpleData || [], searchTerm);
      }

      // Calcular scores de similitud
      return this.calculateSimilarityScores(data || [], searchTerm);
    } catch (error) {
      console.error('Error searching contacts:', error);
      return [];
    }
  }

  /**
   * Calcular score de similitud para ordenar resultados
   */
  private calculateSimilarityScores(
    contacts: any[],
    searchTerm: string
  ): ContactSearchResult[] {
    return contacts.map(contact => {
      let score = 0;
      const term = searchTerm.toLowerCase();
      const name = (contact.name || '').toLowerCase();
      const pushName = (contact.push_name || '').toLowerCase();
      const phone = (contact.jid || '').split('@')[0];

      // Coincidencia exacta = máximo score
      if (name === term || pushName === term || phone === term) {
        score = 100;
      }
      // Comienza con el término
      else if (name.startsWith(term) || pushName.startsWith(term) || phone.startsWith(term)) {
        score = 80;
      }
      // Contiene el término
      else if (name.includes(term) || pushName.includes(term) || phone.includes(term)) {
        score = 60;
      }
      // Similitud por palabras
      else {
        const nameWords = name.split(' ');
        const pushWords = pushName.split(' ');
        const termWords = term.split(' ');

        let wordMatches = 0;
        termWords.forEach((termWord: string) => {
          if (nameWords.some((w: string) => w.includes(termWord)) ||
              pushWords.some((w: string) => w.includes(termWord))) {
            wordMatches++;
          }
        });

        score = (wordMatches / termWords.length) * 40;
      }

      return {
        ...contact,
        similarity_score: score,
        last_message_at: contact.chats?.[0]?.last_message_at,
        unread_count: contact.chats?.[0]?.unread_count || 0,
      };
    }).sort((a, b) => (b.similarity_score || 0) - (a.similarity_score || 0));
  }

  /**
   * Obtener contacto por JID
   */
  async getContactByJid(instanceId: string, jid: string): Promise<Contact | null> {
    try {
      const { data, error } = await this.supabase
        .from('contacts')
        .select('*')
        .eq('instance_id', instanceId)
        .eq('jid', jid)
        .single();

      if (error) {
        console.error('Error getting contact:', error);
        return null;
      }

      return data as Contact;
    } catch (error) {
      console.error('Error getting contact:', error);
      return null;
    }
  }

  /**
   * Bloquear/desbloquear contacto
   */
  async toggleBlockContact(instanceId: string, jid: string, blocked: boolean): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('contacts')
        .update({ is_blocked: blocked })
        .eq('instance_id', instanceId)
        .eq('jid', jid);

      if (error) {
        console.error('Error toggling block contact:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error toggling block contact:', error);
      return false;
    }
  }

  /**
   * Eliminar contacto
   */
  async deleteContact(instanceId: string, jid: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('contacts')
        .delete()
        .eq('instance_id', instanceId)
        .eq('jid', jid);

      if (error) {
        console.error('Error deleting contact:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error deleting contact:', error);
      return false;
    }
  }

  /**
   * Sincronizar contactos desde WhatsApp
   */
  async syncContacts(instanceId: string, contacts: any[]): Promise<number> {
    try {
      let syncedCount = 0;

      for (const contact of contacts) {
        const contactData: Contact = {
          instance_id: instanceId,
          jid: contact.id,
          name: contact.name || contact.notify || contact.verifiedName,
          push_name: contact.notify,
          is_blocked: false,
        };

        const saved = await this.saveContact(contactData);
        if (saved) syncedCount++;
      }

      console.log(`✅ Synced ${syncedCount}/${contacts.length} contacts for instance ${instanceId}`);
      return syncedCount;
    } catch (error) {
      console.error('Error syncing contacts:', error);
      return 0;
    }
  }

  /**
   * Obtener estadísticas de contactos
   */
  async getContactStats(instanceId: string): Promise<{
    total: number;
    blocked: number;
    withChats: number;
    withUnread: number;
  }> {
    try {
      const { data: allContacts } = await this.supabase
        .from('contacts')
        .select('*')
        .eq('instance_id', instanceId);

      const { data: blockedContacts } = await this.supabase
        .from('contacts')
        .select('*')
        .eq('instance_id', instanceId)
        .eq('is_blocked', true);

      const { data: chatsCount } = await this.supabase
        .from('chats')
        .select('chat_id')
        .eq('instance_id', instanceId);

      const { data: unreadCount } = await this.supabase
        .from('chats')
        .select('chat_id')
        .eq('instance_id', instanceId)
        .gt('unread_count', 0);

      return {
        total: allContacts?.length || 0,
        blocked: blockedContacts?.length || 0,
        withChats: chatsCount?.length || 0,
        withUnread: unreadCount?.length || 0,
      };
    } catch (error) {
      console.error('Error getting contact stats:', error);
      return {
        total: 0,
        blocked: 0,
        withChats: 0,
        withUnread: 0,
      };
    }
  }
}

export const contactService = new ContactService();
