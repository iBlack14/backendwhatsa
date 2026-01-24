
const { createClient } = require('@supabase/supabase-js');

// Configuración directa (Tomada de tu .env)
const SUPABASE_URL = 'https://wasapi-supabase.ld4pxg.easypanel.host/';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function cleanDatabase() {
    console.log('🧹 INICIANDO LIMPIEZA DE BASE DE DATOS...');

    try {
        // 1. Borrar todos los mensajes
        console.log('1. Eliminando MENSAJES...');
        const { error: msgError } = await supabase
            .from('messages')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all trick

        if (msgError) console.error('Error borrando mensajes:', msgError);
        else console.log('✅ Mensajes eliminados.');

        // 2. Borrar todos los chats
        console.log('2. Eliminando CHATS...');
        const { error: chatError } = await supabase
            .from('chats')
            .delete()
            .neq('instance_id', 'full_reset');

        if (chatError) console.error('Error borrando chats:', chatError);
        else console.log('✅ Chats eliminados.');

        console.log('✨ LIMPIEZA COMPLETADA CON ÉXITO.');
        console.log('👉 Ahora recarga tu página web (F5). La lista debería estar vacía y lista para empezar de cero.');

    } catch (err) {
        console.error('CRITICAL ERROR:', err);
    }
}

cleanDatabase();
