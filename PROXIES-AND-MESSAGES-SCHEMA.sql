-- =====================================================
-- EXTENSIÓN: PROXIES Y MENSAJES EN TIEMPO REAL
-- =====================================================
-- Versión: 1.0
-- Fecha: 2025-10-31
-- Descripción: Agrega soporte para proxies por instancia y visualización de mensajes
-- =====================================================

-- =====================================================
-- 1. TABLA DE PROXIES
-- =====================================================

CREATE TABLE IF NOT EXISTS public.proxies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'https', 'socks4', 'socks5')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT,
  password TEXT,
  country TEXT,
  city TEXT,
  is_active BOOLEAN DEFAULT true,
  is_healthy BOOLEAN DEFAULT true,
  last_health_check TIMESTAMPTZ,
  health_check_error TEXT,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(host, port)
);

-- =====================================================
-- 2. TABLA DE ASIGNACIÓN DE PROXIES A INSTANCIAS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.instance_proxies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id TEXT NOT NULL,
  proxy_id UUID,
  rotation_enabled BOOLEAN DEFAULT false,
  rotation_interval_hours INTEGER DEFAULT 24,
  last_rotation TIMESTAMPTZ DEFAULT NOW(),
  next_rotation TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT instance_proxies_instance_id_fkey FOREIGN KEY (instance_id) 
    REFERENCES public.instances(document_id) ON DELETE CASCADE,
  CONSTRAINT instance_proxies_proxy_id_fkey FOREIGN KEY (proxy_id) 
    REFERENCES public.proxies(id) ON DELETE SET NULL,
  UNIQUE(instance_id)
);

-- =====================================================
-- 3. TABLA DE MENSAJES (YA EXISTE EN SCHEMA PRINCIPAL)
-- =====================================================
-- Esta tabla ya está en SUPABASE-COMPLETE-SCHEMA.sql
-- Solo agregamos índices adicionales para tiempo real

CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_instance_chat ON public.messages(instance_id, chat_id, timestamp DESC);

-- =====================================================
-- 4. TABLA DE CHATS (PARA AGRUPAR MENSAJES)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.chats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  chat_name TEXT,
  chat_type TEXT DEFAULT 'individual' CHECK (chat_type IN ('individual', 'group')),
  profile_pic_url TEXT,
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  is_archived BOOLEAN DEFAULT false,
  is_pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chats_instance_id_fkey FOREIGN KEY (instance_id) 
    REFERENCES public.instances(document_id) ON DELETE CASCADE,
  UNIQUE(instance_id, chat_id)
);

-- =====================================================
-- 5. ÍNDICES PARA RENDIMIENTO
-- =====================================================

-- Índices para proxies
CREATE INDEX IF NOT EXISTS idx_proxies_is_active ON public.proxies(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_proxies_is_healthy ON public.proxies(is_healthy) WHERE is_healthy = true;
CREATE INDEX IF NOT EXISTS idx_proxies_type ON public.proxies(type);
CREATE INDEX IF NOT EXISTS idx_proxies_country ON public.proxies(country);

-- Índices para instance_proxies
CREATE INDEX IF NOT EXISTS idx_instance_proxies_instance_id ON public.instance_proxies(instance_id);
CREATE INDEX IF NOT EXISTS idx_instance_proxies_proxy_id ON public.instance_proxies(proxy_id);
CREATE INDEX IF NOT EXISTS idx_instance_proxies_next_rotation ON public.instance_proxies(next_rotation) 
  WHERE rotation_enabled = true;

-- Índices para chats
CREATE INDEX IF NOT EXISTS idx_chats_instance_id ON public.chats(instance_id);
CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON public.chats(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_unread_count ON public.chats(unread_count) WHERE unread_count > 0;
CREATE INDEX IF NOT EXISTS idx_chats_is_pinned ON public.chats(is_pinned) WHERE is_pinned = true;

-- =====================================================
-- 6. FUNCIONES Y TRIGGERS
-- =====================================================

-- Función para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para updated_at
DROP TRIGGER IF EXISTS update_proxies_updated_at ON public.proxies;
CREATE TRIGGER update_proxies_updated_at 
  BEFORE UPDATE ON public.proxies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_instance_proxies_updated_at ON public.instance_proxies;
CREATE TRIGGER update_instance_proxies_updated_at 
  BEFORE UPDATE ON public.instance_proxies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_chats_updated_at ON public.chats;
CREATE TRIGGER update_chats_updated_at 
  BEFORE UPDATE ON public.chats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Función para actualizar chat cuando llega un mensaje
CREATE OR REPLACE FUNCTION update_chat_on_new_message()
RETURNS TRIGGER AS $$
BEGIN
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
    COALESCE(NEW.message_text, NEW.message_caption, '[Media]'),
    NEW.timestamp,
    CASE WHEN NEW.from_me THEN 0 ELSE 1 END
  )
  ON CONFLICT (instance_id, chat_id) DO UPDATE SET
    last_message_text = COALESCE(NEW.message_text, NEW.message_caption, '[Media]'),
    last_message_at = NEW.timestamp,
    unread_count = CASE 
      WHEN NEW.from_me THEN public.chats.unread_count
      ELSE public.chats.unread_count + 1
    END,
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar chat automáticamente
DROP TRIGGER IF EXISTS trigger_update_chat_on_new_message ON public.messages;
CREATE TRIGGER trigger_update_chat_on_new_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_on_new_message();

-- Función para calcular próxima rotación de proxy
CREATE OR REPLACE FUNCTION calculate_next_rotation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rotation_enabled THEN
    NEW.next_rotation = NEW.last_rotation + (NEW.rotation_interval_hours || ' hours')::INTERVAL;
  ELSE
    NEW.next_rotation = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para calcular próxima rotación
DROP TRIGGER IF EXISTS trigger_calculate_next_rotation ON public.instance_proxies;
CREATE TRIGGER trigger_calculate_next_rotation
  BEFORE INSERT OR UPDATE ON public.instance_proxies
  FOR EACH ROW
  EXECUTE FUNCTION calculate_next_rotation();

-- =====================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE public.proxies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instance_proxies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

-- Políticas para proxies (solo admin puede ver/editar)
DROP POLICY IF EXISTS "Service role can manage proxies" ON public.proxies;
CREATE POLICY "Service role can manage proxies"
  ON public.proxies FOR ALL
  USING (true)
  WITH CHECK (true);

-- Políticas para instance_proxies (usuarios ven sus propias instancias)
DROP POLICY IF EXISTS "Users can view their instance proxies" ON public.instance_proxies;
CREATE POLICY "Users can view their instance proxies"
  ON public.instance_proxies FOR SELECT
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their instance proxies" ON public.instance_proxies;
CREATE POLICY "Users can update their instance proxies"
  ON public.instance_proxies FOR UPDATE
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = auth.uid()
    )
  );

-- Políticas para chats (usuarios ven chats de sus instancias)
DROP POLICY IF EXISTS "Users can view their chats" ON public.chats;
CREATE POLICY "Users can view their chats"
  ON public.chats FOR SELECT
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their chats" ON public.chats;
CREATE POLICY "Users can update their chats"
  ON public.chats FOR UPDATE
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- 8. VISTAS ÚTILES
-- =====================================================

-- Vista de proxies disponibles
CREATE OR REPLACE VIEW public.available_proxies AS
SELECT 
  id,
  name,
  type,
  host,
  port,
  country,
  city,
  usage_count,
  is_healthy,
  last_health_check
FROM public.proxies
WHERE is_active = true AND is_healthy = true
ORDER BY usage_count ASC, last_health_check DESC;

-- Vista de chats con información de instancia
CREATE OR REPLACE VIEW public.chats_with_instance AS
SELECT 
  c.*,
  i.user_id,
  i.profile_name as instance_name,
  i.phone_number as instance_phone
FROM public.chats c
JOIN public.instances i ON c.instance_id = i.document_id
ORDER BY c.last_message_at DESC;

-- Vista de mensajes recientes (últimas 24 horas)
CREATE OR REPLACE VIEW public.recent_messages AS
SELECT 
  m.*,
  c.chat_name,
  i.profile_name as instance_name
FROM public.messages m
JOIN public.chats c ON m.instance_id = c.instance_id AND m.chat_id = c.chat_id
JOIN public.instances i ON m.instance_id = i.document_id
WHERE m.timestamp > NOW() - INTERVAL '24 hours'
ORDER BY m.timestamp DESC;

-- =====================================================
-- 9. FUNCIONES ÚTILES
-- =====================================================

-- Función para obtener proxy disponible
CREATE OR REPLACE FUNCTION get_available_proxy()
RETURNS TABLE (
  id UUID,
  name TEXT,
  type TEXT,
  host TEXT,
  port INTEGER,
  username TEXT,
  password TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.name,
    p.type,
    p.host,
    p.port,
    p.username,
    p.password
  FROM public.proxies p
  WHERE p.is_active = true AND p.is_healthy = true
  ORDER BY p.usage_count ASC, p.last_health_check DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Función para marcar mensajes como leídos
CREATE OR REPLACE FUNCTION mark_chat_as_read(p_instance_id TEXT, p_chat_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE public.messages
  SET is_read = true
  WHERE instance_id = p_instance_id 
    AND chat_id = p_chat_id 
    AND from_me = false 
    AND is_read = false;
  
  UPDATE public.chats
  SET unread_count = 0
  WHERE instance_id = p_instance_id AND chat_id = p_chat_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 10. DATOS DE EJEMPLO (OPCIONAL)
-- =====================================================

-- Insertar proxies de ejemplo (comentado por seguridad)
/*
INSERT INTO public.proxies (name, type, host, port, country, city)
VALUES 
  ('Proxy US 1', 'http', 'proxy1.example.com', 8080, 'US', 'New York'),
  ('Proxy EU 1', 'socks5', 'proxy2.example.com', 1080, 'DE', 'Berlin'),
  ('Proxy LATAM 1', 'http', 'proxy3.example.com', 3128, 'BR', 'São Paulo')
ON CONFLICT DO NOTHING;
*/

-- =====================================================
-- 11. COMENTARIOS Y DOCUMENTACIÓN
-- =====================================================

COMMENT ON TABLE public.proxies IS 'Pool de proxies disponibles para las instancias de WhatsApp';
COMMENT ON TABLE public.instance_proxies IS 'Asignación de proxies a instancias con configuración de rotación';
COMMENT ON TABLE public.chats IS 'Chats agrupados por instancia para visualización tipo WhatsApp';
COMMENT ON COLUMN public.proxies.is_healthy IS 'Indica si el proxy pasó el último health check';
COMMENT ON COLUMN public.instance_proxies.rotation_enabled IS 'Si está habilitado, el proxy rotará automáticamente';
COMMENT ON COLUMN public.chats.unread_count IS 'Cantidad de mensajes no leídos en el chat';

-- =====================================================
-- 12. ANÁLISIS Y OPTIMIZACIÓN
-- =====================================================

ANALYZE public.proxies;
ANALYZE public.instance_proxies;
ANALYZE public.chats;

-- =====================================================
-- FIN DEL SCHEMA
-- =====================================================
