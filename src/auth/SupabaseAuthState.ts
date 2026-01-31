import {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
  initAuthCreds,
  BufferJSON,
  proto
} from 'baileys';
import { supabase } from '../lib/supabase';

// Definir tipos para las claves de sesión
type SessionData = {
    session_id: string;
    key: string;
    value: any;
};

export const useSupabaseAuthState = async (sessionId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
    // const supabaseUrl = process.env.SUPABASE_URL; // Removed local config
    const tableName = 'whatsapp_sessions';

    // Función helper para leer datos
    const readData = async (key: string): Promise<any | null> => {
        try {
            const { data, error } = await supabase
                .from(tableName)
                .select('value')
                .eq('session_id', sessionId)
                .eq('key', key)
                .single();

            if (error || !data) return null;
            return JSON.parse(JSON.stringify(data.value), BufferJSON.reviver);
        } catch (error) {
            return null;
        }
    };

    // Función helper para escribir datos
    const writeData = async (key: string, value: any): Promise<void> => {
        try {
            const jsonValue = JSON.parse(JSON.stringify(value, BufferJSON.replacer));

            const { error } = await supabase
                .from(tableName)
                .upsert({
                    session_id: sessionId,
                    key: key,
                    value: jsonValue,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'session_id,key' });

            if (error) {
                console.error(`Error saving session data for ${key}:`, error);
            }
        } catch (error) {
            console.error(`Error processing session data for ${key}:`, error);
        }
    };

    // Función helper para eliminar datos
    const removeData = async (key: string): Promise<void> => {
        try {
            await supabase
                .from(tableName)
                .delete()
                .eq('session_id', sessionId)
                .eq('key', key);
        } catch (error) {
            console.error(`Error deleting session data for ${key}:`, error);
        }
    };

    // Cargar credenciales iniciales
    const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data: { [key: string]: any } = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            const key = `${type}-${id}`;
                            let value = await readData(key);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            if (value) {
                                data[id] = value;
                            }
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const updates: any[] = [];
                    const deletions: string[] = [];

                    for (const category in data) {
                        const cat = category as keyof SignalDataTypeMap;
                        for (const id in data[cat]) {
                            const key = `${cat}-${id}`;
                            const value = data[cat]?.[id];
                            if (value) {
                                const jsonValue = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
                                updates.push({
                                    session_id: sessionId,
                                    key: key,
                                    value: jsonValue,
                                    updated_at: new Date().toISOString()
                                });
                            } else {
                                deletions.push(key);
                            }
                        }
                    }

                    // Batch updates (Supabase supports bulk upsert)
                    if (updates.length > 0) {
                        // Process in chunks of 50 to avoid payload limits or timeouts
                        const chunkSize = 50;
                        for (let i = 0; i < updates.length; i += chunkSize) {
                            const chunk = updates.slice(i, i + chunkSize);
                            try {
                                const { error } = await supabase
                                    .from(tableName)
                                    .upsert(chunk, { onConflict: 'session_id,key' });

                                if (error) console.error('Error batch saving session data:', error);
                            } catch (err) {
                                console.error('Error batch saving session data (exception):', err);
                            }
                        }
                    }

                    // Batch deletions
                    if (deletions.length > 0) {
                        // Process in chunks of 50
                        const chunkSize = 50;
                        for (let i = 0; i < deletions.length; i += chunkSize) {
                            const chunk = deletions.slice(i, i + chunkSize);
                            try {
                                await supabase
                                    .from(tableName)
                                    .delete()
                                    .eq('session_id', sessionId)
                                    .in('key', chunk);
                            } catch (err) {
                                console.error('Error batch deleting session data:', err);
                            }
                        }
                    }
                },
            },
        },
        saveCreds: async () => {
            await writeData('creds', creds);
        },
    };
};
