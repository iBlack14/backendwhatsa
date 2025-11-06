-- =====================================================
-- FIX: TRIGGER PARA ACTUALIZAR CHATS CON MENSAJES
-- =====================================================
-- Este script corrige el trigger para que muestre mejor
-- información en los chats cuando no hay texto
-- =====================================================

-- Función mejorada para actualizar chat cuando llega un mensaje
CREATE OR REPLACE FUNCTION update_chat_on_new_message()
RETURNS TRIGGER AS $$
DECLARE
  display_text TEXT;
  type_labels JSONB := '{
    "image": "🖼️ Imagen",
    "video": "🎥 Video",
    "audio": "🎵 Audio",
    "voice": "🎤 Nota de voz",
    "document": "📄 Documento",
    "sticker": "🎨 Sticker",
    "location": "📍 Ubicación",
    "contact": "👤 Contacto",
    "contacts": "👥 Contactos",
    "poll": "📊 Encuesta",
    "reaction": "❤️ Reacción"
  }'::JSONB;
BEGIN
  -- Determinar qué texto mostrar
  IF NEW.message_text IS NOT NULL AND NEW.message_text != '' THEN
    -- Si hay texto, usarlo
    display_text := NEW.message_text;
  ELSIF NEW.message_caption IS NOT NULL AND NEW.message_caption != '' THEN
    -- Si hay caption, usarlo
    display_text := NEW.message_caption;
  ELSIF NEW.message_type IS NOT NULL AND NEW.message_type != 'text' THEN
    -- Si es un tipo específico, mostrar el icono
    display_text := COALESCE(
      type_labels->>NEW.message_type,
      '📎 ' || INITCAP(NEW.message_type)
    );
  ELSE
    -- Fallback
    display_text := '[Mensaje]';
  END IF;

  -- Insertar o actualizar chat
  INSERT INTO public.chats (
    instance_id,
    chat_id,
    chat_name,
    last_message_text,
    last_message_at,
    unread_count
  ) VALUES (
    NEW.instance_id,
    NEW.chat_id,
    NEW.sender_name,
    display_text,
    NEW.timestamp,
    CASE WHEN NEW.from_me THEN 0 ELSE 1 END
  )
  ON CONFLICT (instance_id, chat_id) DO UPDATE SET
    last_message_text = display_text,
    last_message_at = NEW.timestamp,
    unread_count = CASE 
      WHEN NEW.from_me THEN public.chats.unread_count
      ELSE public.chats.unread_count + 1
    END,
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recrear el trigger
DROP TRIGGER IF EXISTS trigger_update_chat_on_new_message ON public.messages;
CREATE TRIGGER trigger_update_chat_on_new_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_on_new_message();

-- =====================================================
-- ACTUALIZAR CHATS EXISTENTES
-- =====================================================
-- Este script actualiza los chats existentes para que
-- muestren mejor información basada en los mensajes

DO $$
DECLARE
  chat_record RECORD;
  last_msg RECORD;
  display_text TEXT;
  type_labels JSONB := '{
    "image": "🖼️ Imagen",
    "video": "🎥 Video",
    "audio": "🎵 Audio",
    "voice": "🎤 Nota de voz",
    "document": "📄 Documento",
    "sticker": "🎨 Sticker",
    "location": "📍 Ubicación",
    "contact": "👤 Contacto",
    "contacts": "👥 Contactos",
    "poll": "📊 Encuesta",
    "reaction": "❤️ Reacción"
  }'::JSONB;
BEGIN
  -- Iterar sobre cada chat
  FOR chat_record IN 
    SELECT DISTINCT instance_id, chat_id 
    FROM public.chats
  LOOP
    -- Obtener el último mensaje de este chat
    SELECT * INTO last_msg
    FROM public.messages
    WHERE instance_id = chat_record.instance_id
      AND chat_id = chat_record.chat_id
    ORDER BY timestamp DESC
    LIMIT 1;

    IF FOUND THEN
      -- Determinar qué texto mostrar
      IF last_msg.message_text IS NOT NULL AND last_msg.message_text != '' THEN
        display_text := last_msg.message_text;
      ELSIF last_msg.message_caption IS NOT NULL AND last_msg.message_caption != '' THEN
        display_text := last_msg.message_caption;
      ELSIF last_msg.message_type IS NOT NULL AND last_msg.message_type != 'text' THEN
        display_text := COALESCE(
          type_labels->>last_msg.message_type,
          '📎 ' || INITCAP(last_msg.message_type)
        );
      ELSE
        display_text := '[Mensaje]';
      END IF;

      -- Actualizar el chat
      UPDATE public.chats
      SET 
        last_message_text = display_text,
        last_message_at = last_msg.timestamp,
        updated_at = NOW()
      WHERE instance_id = chat_record.instance_id
        AND chat_id = chat_record.chat_id;
    END IF;
  END LOOP;

  RAISE NOTICE 'Chats actualizados correctamente';
END $$;

-- =====================================================
-- VERIFICAR RESULTADOS
-- =====================================================

-- Ver chats actualizados
SELECT 
  instance_id,
  chat_id,
  chat_name,
  last_message_text,
  last_message_at,
  unread_count
FROM public.chats
ORDER BY last_message_at DESC
LIMIT 20;

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================
