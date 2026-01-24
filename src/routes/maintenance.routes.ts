
import { Router, Request, Response } from 'express';
import { supabase } from '../lib/supabase';

const router = Router();

// Endpoint peligroso: Borra TODOS los chats y mensajes
router.post('/reset-all-chats', async (req: Request, res: Response) => {
    try {
        const { confirm } = req.body;

        if (confirm !== 'CONFIRM_RESET_ALL') {
            return res.status(400).json({ error: 'Confirmation required. Send confirm: "CONFIRM_RESET_ALL"' });
        }

        console.log('⚠️ INICIANDO RESET TOTAL DE CHATS Y MENSAJES...');

        // 1. Borrar mensajes primero (por foreign keys)
        const { error: msgError } = await supabase
            .from('messages')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Truco para borrar todo, delete sin where a veces falla en clientes

        if (msgError) throw msgError;

        // 2. Borrar chats
        const { error: chatError } = await supabase
            .from('chats')
            .delete()
            .neq('instance_id', 'full_reset');

        if (chatError) throw chatError;

        console.log('✅ RESET COMPLETADO. Base de datos de chats limpia.');

        res.json({ success: true, message: 'All chats and messages have been deleted.' });

    } catch (error: any) {
        console.error('Error resetting chats:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
