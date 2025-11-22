import { Router } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const router = Router();

// Singleton para cliente Supabase
let supabaseInstance: SupabaseClient | null = null;

function getSupabase() {
    if (!supabaseInstance) {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            throw new Error('Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_KEY');
        }

        supabaseInstance = createClient(supabaseUrl, supabaseKey);
    }
    return supabaseInstance;
}

// Guardar o actualizar configuración del chatbot
router.post('/chatbot', async (req, res) => {
    try {
        const supabase = getSupabase();
        const { instanceId, chatbotName, welcomeMessage, defaultResponse, rules } = req.body;

        if (!instanceId || !chatbotName || !rules) {
            return res.status(400).json({ error: 'Faltan datos requeridos' });
        }

        // Upsert: Crear o actualizar si ya existe
        const { data, error } = await supabase
            .from('instance_chatbots')
            .upsert({
                instance_id: instanceId,
                chatbot_name: chatbotName,
                welcome_message: welcomeMessage,
                default_response: defaultResponse,
                rules: rules,
                is_active: true,
                updated_at: new Date()
            }, { onConflict: 'instance_id' })
            .select();

        if (error) throw error;

        res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error saving chatbot:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener configuración del chatbot
router.get('/chatbot/:instanceId', async (req, res) => {
    try {
        const supabase = getSupabase();
        const { instanceId } = req.params;

        const { data, error } = await supabase
            .from('instance_chatbots')
            .select('*')
            .eq('instance_id', instanceId)
            .single();

        if (error && error.code !== 'PGRST116') throw error; // Ignorar error si no existe

        res.json({ chatbot: data || null });
    } catch (error: any) {
        console.error('Error fetching chatbot:', error);
        res.status(500).json({ error: error.message });
    }
});

// Desactivar chatbot
router.post('/chatbot/toggle', async (req, res) => {
    try {
        const supabase = getSupabase();
        const { instanceId, isActive } = req.body;

        const { data, error } = await supabase
            .from('instance_chatbots')
            .update({ is_active: isActive })
            .eq('instance_id', instanceId)
            .select();

        if (error) throw error;

        res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error toggling chatbot:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
