import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Asegurar que las variables de entorno estén cargadas
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

class SupabaseSingleton {
    private static instance: SupabaseClient;

    private constructor() { }

    public static getInstance(): SupabaseClient {
        if (!SupabaseSingleton.instance) {
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;

            if (!supabaseUrl || !supabaseKey) {
                throw new Error('❌ Supabase credentials missing (SUPABASE_URL, SUPABASE_SERVICE_KEY)');
            }

            console.log('🔌 Initializing shared Supabase client...');
            SupabaseSingleton.instance = createClient(supabaseUrl, supabaseKey, {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                },
                db: {
                    schema: 'public',
                },
            });
        }

        return SupabaseSingleton.instance;
    }
}

export const supabase = SupabaseSingleton.getInstance();
