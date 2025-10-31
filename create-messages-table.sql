-- =====================================================
-- TABLA DE MENSAJES PARA WHATSAPP
-- =====================================================

-- Crear tabla de mensajes si no existe
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES public.instances(document_id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL,
    message_id TEXT UNIQUE NOT NULL,
    sender_name TEXT,
    sender_phone TEXT,
    message_text TEXT,
    message_caption TEXT,
    message_type TEXT DEFAULT 'text', -- text, image, video, audio, document, etc.
    media_url TEXT,
    from_me BOOLEAN DEFAULT false,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    is_read BOOLEAN DEFAULT false,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_messages_instance_id ON public.messages(instance_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON public.messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON public.messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_from_me ON public.messages(from_me);
CREATE INDEX IF NOT EXISTS idx_messages_is_read ON public.messages(is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON public.messages(message_id);

-- Índice compuesto para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_messages_instance_timestamp 
ON public.messages(instance_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp 
ON public.messages(chat_id, timestamp DESC);

-- Índice de búsqueda de texto completo
CREATE INDEX IF NOT EXISTS idx_messages_text_search 
ON public.messages USING GIN(to_tsvector('spanish', COALESCE(message_text, '') || ' ' || COALESCE(message_caption, '')));

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar updated_at
DROP TRIGGER IF EXISTS trigger_update_messages_updated_at ON public.messages;
CREATE TRIGGER trigger_update_messages_updated_at
    BEFORE UPDATE ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION update_messages_updated_at();

-- Política de seguridad RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios solo pueden ver mensajes de sus propias instancias
DROP POLICY IF EXISTS "Users can view their own messages" ON public.messages;
CREATE POLICY "Users can view their own messages"
ON public.messages
FOR SELECT
USING (
    instance_id IN (
        SELECT document_id 
        FROM public.instances 
        WHERE user_id = auth.uid()
    )
);

-- Política: Los usuarios pueden insertar mensajes en sus propias instancias
DROP POLICY IF EXISTS "Users can insert messages to their instances" ON public.messages;
CREATE POLICY "Users can insert messages to their instances"
ON public.messages
FOR INSERT
WITH CHECK (
    instance_id IN (
        SELECT document_id 
        FROM public.instances 
        WHERE user_id = auth.uid()
    )
);

-- Política: Los usuarios pueden actualizar mensajes de sus propias instancias
DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
CREATE POLICY "Users can update their own messages"
ON public.messages
FOR UPDATE
USING (
    instance_id IN (
        SELECT document_id 
        FROM public.instances 
        WHERE user_id = auth.uid()
    )
);

-- Política: Los usuarios pueden eliminar mensajes de sus propias instancias
DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
CREATE POLICY "Users can delete their own messages"
ON public.messages
FOR DELETE
USING (
    instance_id IN (
        SELECT document_id 
        FROM public.instances 
        WHERE user_id = auth.uid()
    )
);

-- Comentarios para documentación
COMMENT ON TABLE public.messages IS 'Almacena todos los mensajes de WhatsApp recibidos y enviados';
COMMENT ON COLUMN public.messages.instance_id IS 'ID de la instancia de WhatsApp';
COMMENT ON COLUMN public.messages.chat_id IS 'ID del chat (número de teléfono o grupo)';
COMMENT ON COLUMN public.messages.message_id IS 'ID único del mensaje de WhatsApp';
COMMENT ON COLUMN public.messages.from_me IS 'Indica si el mensaje fue enviado por el usuario';
COMMENT ON COLUMN public.messages.is_read IS 'Indica si el mensaje ha sido leído';

-- Función para limpiar mensajes antiguos (opcional)
CREATE OR REPLACE FUNCTION cleanup_old_messages(days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.messages
    WHERE timestamp < NOW() - INTERVAL '1 day' * days_to_keep;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_messages IS 'Elimina mensajes más antiguos que el número de días especificado';

-- Vista para estadísticas de mensajes por instancia
CREATE OR REPLACE VIEW public.message_stats AS
SELECT 
    instance_id,
    COUNT(*) as total_messages,
    COUNT(*) FILTER (WHERE from_me = true) as sent_messages,
    COUNT(*) FILTER (WHERE from_me = false) as received_messages,
    COUNT(*) FILTER (WHERE is_read = false AND from_me = false) as unread_messages,
    MAX(timestamp) as last_message_at,
    DATE_TRUNC('day', timestamp) as message_date
FROM public.messages
GROUP BY instance_id, DATE_TRUNC('day', timestamp);

COMMENT ON VIEW public.message_stats IS 'Estadísticas de mensajes agrupados por instancia y fecha';

ANALYZE public.messages;
