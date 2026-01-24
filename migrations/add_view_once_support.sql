-- =====================================================
-- SCRIPT PARA EJECUTAR EN SUPABASE SQL EDITOR
-- =====================================================
-- Fecha: 2026-01-24
-- Descripción: Agrega soporte para mensajes "View Once" con múltiples aperturas
-- =====================================================

-- 1. Agregar columna is_view_once (indica si el mensaje es "ver una vez")
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS is_view_once BOOLEAN DEFAULT false;

-- 2. Agregar columna view_once_opened_times (array de timestamps de cuándo se abrió)
-- Esto permite abrir el mensaje múltiples veces y rastrear cada apertura
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS view_once_opened_times JSONB DEFAULT '[]'::jsonb;

-- 3. Crear índice para búsquedas rápidas de mensajes view once
CREATE INDEX IF NOT EXISTS idx_messages_view_once 
ON public.messages(is_view_once) 
WHERE is_view_once = true;

-- 4. Comentarios para documentación
COMMENT ON COLUMN public.messages.is_view_once IS 
'Indica si el mensaje es de tipo "ver una vez" (view once). Estos mensajes son especiales de WhatsApp.';

COMMENT ON COLUMN public.messages.view_once_opened_times IS 
'Array de timestamps (JSONB) que registra cada vez que se abrió el mensaje. Permite múltiples aperturas.';

-- 5. Actualizar mensajes existentes que tengan view_once en el tipo
UPDATE public.messages 
SET is_view_once = true 
WHERE message_type LIKE 'view_once%' 
  AND (is_view_once IS NULL OR is_view_once = false);

-- =====================================================
-- FIN DEL SCRIPT - ¡Listo para usar!
-- =====================================================

-- Para verificar que funcionó:
SELECT 
  message_id, 
  message_type, 
  is_view_once, 
  view_once_opened_times,
  jsonb_array_length(view_once_opened_times) as times_opened
FROM messages 
WHERE is_view_once = true 
LIMIT 10;
