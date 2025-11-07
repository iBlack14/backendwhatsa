-- =====================================================
-- SCHEMA COMPLETO PARA SUPABASE - BLXK WHATSAPP
-- =====================================================
-- Versión: 2.0
-- Fecha: 2025-10-31
-- Descripción: Schema completo con todas las tablas, políticas RLS, triggers e índices
-- Uso: Ejecutar en Supabase SQL Editor para crear toda la estructura
-- =====================================================

-- =====================================================
-- 1. EXTENSIONES
-- =====================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Para búsqueda de texto

-- =====================================================
-- 2. TABLAS PRINCIPALES
-- =====================================================

-- Tabla de perfiles de usuario
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID NOT NULL PRIMARY KEY,
  username TEXT UNIQUE,
  status_plan BOOLEAN DEFAULT false,
  plan_type TEXT DEFAULT 'free' CHECK (plan_type IN ('free', 'trial', 'basic', 'premium')),
  plan_expires_at TIMESTAMPTZ,
  created_by_google BOOLEAN DEFAULT false,
  api_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Tabla de instancias de WhatsApp
CREATE TABLE IF NOT EXISTS public.instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  webhook_url TEXT,
  state TEXT DEFAULT 'Initializing' CHECK (state IN ('Initializing', 'Connected', 'Disconnected', 'Failure')),
  is_active BOOLEAN DEFAULT true,
  message_received BOOLEAN DEFAULT false,
  message_sent BOOLEAN DEFAULT false,
  qr TEXT,
  qr_loading BOOLEAN DEFAULT false,
  historycal_data JSONB DEFAULT '[]'::jsonb,
  profile_name TEXT,
  profile_pic_url TEXT,
  phone_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT instances_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Tabla de mensajes de WhatsApp
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id TEXT UNIQUE NOT NULL,
  sender_name TEXT,
  sender_phone TEXT,
  message_text TEXT,
  message_caption TEXT,
  message_type TEXT DEFAULT 'text',
  media_url TEXT,
  from_me BOOLEAN DEFAULT false,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  is_read BOOLEAN DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT messages_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.instances(document_id) ON DELETE CASCADE
);

-- Tabla de planes de suscripción
CREATE TABLE IF NOT EXISTS public.plans (
  id UUID NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
  plan_type VARCHAR NOT NULL UNIQUE,
  name VARCHAR NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  ram VARCHAR NOT NULL,
  cpu INTEGER NOT NULL,
  max_workflows INTEGER NOT NULL,
  max_executions INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de suscripciones de usuario
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id UUID NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL,
  plan_id UUID NOT NULL,
  instance_name VARCHAR,
  instance_url TEXT,
  is_active BOOLEAN DEFAULT true,
  current_workflows INTEGER DEFAULT 0,
  current_executions INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT user_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE CASCADE
);

-- Tabla de productos
CREATE TABLE IF NOT EXISTS public.products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC DEFAULT 0,
  img TEXT[],
  fields JSONB DEFAULT '[]'::jsonb,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de suites (N8N, etc)
CREATE TABLE IF NOT EXISTS public.suites (
  id SERIAL PRIMARY KEY,
  document_id TEXT DEFAULT (gen_random_uuid())::text UNIQUE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  activo BOOLEAN DEFAULT false,
  credencials JSONB DEFAULT '{}'::jsonb,
  memory TEXT,
  cpu INTEGER,
  container_id TEXT,
  subdomain TEXT,
  port INTEGER,
  status TEXT DEFAULT 'creating',
  product_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT suites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- Tabla de progreso de spam
CREATE TABLE IF NOT EXISTS public.spam_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  spam_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  total_contacts INTEGER NOT NULL,
  current_contact INTEGER DEFAULT 0,
  stopped BOOLEAN DEFAULT false,
  completed BOOLEAN DEFAULT false,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  last_update TIMESTAMPTZ DEFAULT NOW(),
  success JSONB DEFAULT '[]'::jsonb,
  errors JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 3. ÍNDICES PARA RENDIMIENTO
-- =====================================================

-- Índices para profiles
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_plan_type ON public.profiles(plan_type);
CREATE INDEX IF NOT EXISTS idx_profiles_status_plan ON public.profiles(status_plan) WHERE status_plan = true;

-- Índices para instances
CREATE INDEX IF NOT EXISTS idx_instances_user_id ON public.instances(user_id);
CREATE INDEX IF NOT EXISTS idx_instances_document_id ON public.instances(document_id);
CREATE INDEX IF NOT EXISTS idx_instances_state ON public.instances(state);
CREATE INDEX IF NOT EXISTS idx_instances_created_at ON public.instances(created_at DESC);

-- Índices para messages
CREATE INDEX IF NOT EXISTS idx_messages_instance_id ON public.messages(instance_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON public.messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON public.messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_from_me ON public.messages(from_me);
CREATE INDEX IF NOT EXISTS idx_messages_is_read ON public.messages(is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON public.messages(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_instance_timestamp ON public.messages(instance_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp ON public.messages(chat_id, timestamp DESC);

-- Índice de búsqueda de texto completo
CREATE INDEX IF NOT EXISTS idx_messages_text_search 
ON public.messages USING GIN(to_tsvector('spanish', COALESCE(message_text, '') || ' ' || COALESCE(message_caption, '')));

-- Índices para suites
CREATE INDEX IF NOT EXISTS idx_suites_user_id ON public.suites(user_id);
CREATE INDEX IF NOT EXISTS idx_suites_document_id ON public.suites(document_id);
CREATE INDEX IF NOT EXISTS idx_suites_status ON public.suites(status);

-- Índices para spam_progress
CREATE INDEX IF NOT EXISTS idx_spam_progress_user_id ON public.spam_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_spam_progress_spam_id ON public.spam_progress(spam_id);
CREATE INDEX IF NOT EXISTS idx_spam_progress_completed ON public.spam_progress(completed) WHERE completed = false;

-- Índices para user_subscriptions
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON public.user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan_id ON public.user_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_active ON public.user_subscriptions(is_active) WHERE is_active = true;

-- =====================================================
-- 4. FUNCIONES Y TRIGGERS
-- =====================================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para updated_at
DROP TRIGGER IF EXISTS update_instances_updated_at ON public.instances;
CREATE TRIGGER update_instances_updated_at 
  BEFORE UPDATE ON public.instances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at 
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_messages_updated_at ON public.messages;
CREATE TRIGGER update_messages_updated_at 
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_plans_updated_at ON public.plans;
CREATE TRIGGER update_plans_updated_at 
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_suites_updated_at ON public.suites;
CREATE TRIGGER update_suites_updated_at 
  BEFORE UPDATE ON public.suites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_spam_progress_updated_at ON public.spam_progress;
CREATE TRIGGER update_spam_progress_updated_at 
  BEFORE UPDATE ON public.spam_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_subscriptions_updated_at ON public.user_subscriptions;
CREATE TRIGGER update_user_subscriptions_updated_at 
  BEFORE UPDATE ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Función para crear perfil automáticamente al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, created_by_google, username)
  VALUES (
    NEW.id,
    CASE 
      WHEN NEW.raw_app_meta_data->>'provider' = 'google' THEN true
      ELSE false
    END,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para crear perfil automáticamente
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Función para limpiar mensajes antiguos
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

-- =====================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spam_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Políticas para profiles
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" 
  ON public.profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

-- Políticas para instances
DROP POLICY IF EXISTS "Users can view own instances" ON public.instances;
CREATE POLICY "Users can view own instances" 
  ON public.instances FOR SELECT 
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own instances" ON public.instances;
CREATE POLICY "Users can insert own instances" 
  ON public.instances FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own instances" ON public.instances;
CREATE POLICY "Users can update own instances" 
  ON public.instances FOR UPDATE 
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own instances" ON public.instances;
CREATE POLICY "Users can delete own instances" 
  ON public.instances FOR DELETE 
  USING (auth.uid() = user_id);

-- Políticas para messages
DROP POLICY IF EXISTS "Users can view their own messages" ON public.messages;
CREATE POLICY "Users can view their own messages"
  ON public.messages FOR SELECT
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert messages to their instances" ON public.messages;
CREATE POLICY "Users can insert messages to their instances"
  ON public.messages FOR INSERT
  WITH CHECK (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
CREATE POLICY "Users can update their own messages"
  ON public.messages FOR UPDATE
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
CREATE POLICY "Users can delete their own messages"
  ON public.messages FOR DELETE
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = auth.uid()
    )
  );

-- Políticas para suites
DROP POLICY IF EXISTS "Users can view own suites" ON public.suites;
CREATE POLICY "Users can view own suites" 
  ON public.suites FOR SELECT 
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own suites" ON public.suites;
CREATE POLICY "Users can insert own suites" 
  ON public.suites FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own suites" ON public.suites;
CREATE POLICY "Users can update own suites" 
  ON public.suites FOR UPDATE 
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own suites" ON public.suites;
CREATE POLICY "Users can delete own suites" 
  ON public.suites FOR DELETE 
  USING (auth.uid() = user_id);

-- Políticas para spam_progress
DROP POLICY IF EXISTS "Users can view own spam progress" ON public.spam_progress;
CREATE POLICY "Users can view own spam progress" 
  ON public.spam_progress FOR SELECT 
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can insert own spam progress" ON public.spam_progress;
CREATE POLICY "Users can insert own spam progress" 
  ON public.spam_progress FOR INSERT 
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can update own spam progress" ON public.spam_progress;
CREATE POLICY "Users can update own spam progress" 
  ON public.spam_progress FOR UPDATE 
  USING (auth.uid()::text = user_id);

-- Políticas para products (todos pueden ver)
DROP POLICY IF EXISTS "Anyone can view products" ON public.products;
CREATE POLICY "Anyone can view products" 
  ON public.products FOR SELECT 
  USING (true);

-- Políticas para plans (todos pueden ver)
DROP POLICY IF EXISTS "Anyone can view plans" ON public.plans;
CREATE POLICY "Anyone can view plans" 
  ON public.plans FOR SELECT 
  USING (true);

-- Políticas para user_subscriptions
DROP POLICY IF EXISTS "Users can view own subscriptions" ON public.user_subscriptions;
CREATE POLICY "Users can view own subscriptions" 
  ON public.user_subscriptions FOR SELECT 
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own subscriptions" ON public.user_subscriptions;
CREATE POLICY "Users can insert own subscriptions" 
  ON public.user_subscriptions FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.user_subscriptions;
CREATE POLICY "Users can update own subscriptions" 
  ON public.user_subscriptions FOR UPDATE 
  USING (auth.uid() = user_id);

-- =====================================================
-- 6. VISTAS
-- =====================================================

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

-- =====================================================
-- 7. DATOS INICIALES (OPCIONAL)
-- =====================================================

-- Insertar planes por defecto
INSERT INTO public.plans (plan_type, name, price, ram, cpu, max_workflows, max_executions, is_active)
VALUES 
  ('free', 'Plan Gratuito', 0, '256MB', 1, 5, 100, true),
  ('trial', 'Prueba Gratuita 7 días', 0, '512MB', 1, 10, 500, true),
  ('basic', 'Plan Básico', 9.99, '1GB', 2, 25, 2000, true),
  ('premium', 'Plan Premium', 29.99, '2GB', 4, 100, 10000, true)
ON CONFLICT (plan_type) DO NOTHING;

-- =====================================================
-- 8. COMENTARIOS Y DOCUMENTACIÓN
-- =====================================================

COMMENT ON TABLE public.profiles IS 'Perfiles de usuario con información de suscripción';
COMMENT ON TABLE public.instances IS 'Instancias de WhatsApp conectadas';
COMMENT ON TABLE public.messages IS 'Mensajes de WhatsApp recibidos y enviados';
COMMENT ON TABLE public.plans IS 'Planes de suscripción disponibles';
COMMENT ON TABLE public.user_subscriptions IS 'Suscripciones activas de usuarios';
COMMENT ON TABLE public.suites IS 'Servicios adicionales (N8N, etc)';
COMMENT ON TABLE public.spam_progress IS 'Progreso de campañas de spam';

-- =====================================================
-- 9. ANÁLISIS Y OPTIMIZACIÓN
-- =====================================================

ANALYZE public.profiles;
ANALYZE public.instances;
ANALYZE public.messages;
ANALYZE public.plans;
ANALYZE public.user_subscriptions;
ANALYZE public.suites;
ANALYZE public.spam_progress;

-- =====================================================
-- FIN DEL SCHEMA
-- =====================================================
-- Para verificar que todo se creó correctamente:
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public';
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
  user_id UUID NOT NULL,  -- Cada usuario tiene sus propios proxies
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
  CONSTRAINT proxies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(user_id, host, port)  -- Único por usuario
);

-- Agregar columna user_id si no existe (para BD existentes)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'proxies' 
    AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.proxies ADD COLUMN user_id UUID;
    ALTER TABLE public.proxies ADD CONSTRAINT proxies_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

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
CREATE INDEX IF NOT EXISTS idx_proxies_user_id ON public.proxies(user_id);  -- ✅ Índice por usuario
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

-- Políticas para proxies (cada usuario ve solo sus propios proxies)
DROP POLICY IF EXISTS "Service role can manage proxies" ON public.proxies;
DROP POLICY IF EXISTS "Users can view own proxies" ON public.proxies;
DROP POLICY IF EXISTS "Users can manage own proxies" ON public.proxies;

-- ✅ Usuarios solo ven sus propios proxies
CREATE POLICY "Users can view own proxies"
  ON public.proxies FOR SELECT
  USING (auth.uid() = user_id);

-- ✅ Usuarios solo pueden crear/editar/eliminar sus propios proxies
CREATE POLICY "Users can manage own proxies"
  ON public.proxies FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

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

-- Vista de proxies disponibles (RLS filtra automáticamente por usuario)
DROP VIEW IF EXISTS public.available_proxies;
CREATE VIEW public.available_proxies AS
SELECT 
  id,
  user_id,  -- ✅ Incluir user_id
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

-- Función para obtener proxy disponible del usuario
CREATE OR REPLACE FUNCTION get_available_proxy(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  name TEXT,
  type TEXT,
  host TEXT,
  port INTEGER,
  username TEXT,
  password TEXT
) AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Si no se pasa user_id, usar el usuario autenticado
  v_user_id := COALESCE(p_user_id, auth.uid());
  
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
  WHERE p.user_id = v_user_id  -- ✅ Solo proxies del usuario
    AND p.is_active = true 
    AND p.is_healthy = true
  ORDER BY p.usage_count ASC, p.last_health_check DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
-- 13. SISTEMA DE PLAN FREE CON LÍMITES
-- =====================================================

-- Tabla de límites por plan
CREATE TABLE IF NOT EXISTS public.plan_limits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_type TEXT NOT NULL UNIQUE CHECK (plan_type IN ('free', 'trial', 'basic', 'premium', 'enterprise')),
  max_instances INTEGER NOT NULL DEFAULT 1,
  max_messages_per_day INTEGER NOT NULL DEFAULT 100,
  max_webhooks INTEGER NOT NULL DEFAULT 1,
  max_suites INTEGER NOT NULL DEFAULT 0,
  can_use_proxies BOOLEAN DEFAULT false,
  can_use_suites BOOLEAN DEFAULT false,
  support_level TEXT DEFAULT 'email' CHECK (support_level IN ('email', 'priority', '24/7', 'dedicated')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agregar columna max_suites si no existe (para BD existentes)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'plan_limits' 
    AND column_name = 'max_suites'
  ) THEN
    ALTER TABLE public.plan_limits ADD COLUMN max_suites INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Insertar límites de planes
INSERT INTO public.plan_limits (plan_type, max_instances, max_messages_per_day, max_webhooks, max_suites, can_use_proxies, can_use_suites, support_level)
VALUES 
  ('free', 1, 100, 1, 1, false, true, 'email'),
  ('trial', 2, 500, 3, 2, true, true, 'priority'),
  ('basic', 3, 1000, 5, 3, true, true, 'priority'),
  ('premium', 10, 10000, 20, 10, true, true, '24/7'),
  ('enterprise', 999, 999999, 999, 999, true, true, 'dedicated')
ON CONFLICT (plan_type) DO UPDATE SET
  max_instances = EXCLUDED.max_instances,
  max_messages_per_day = EXCLUDED.max_messages_per_day,
  max_webhooks = EXCLUDED.max_webhooks,
  max_suites = EXCLUDED.max_suites,
  can_use_proxies = EXCLUDED.can_use_proxies,
  can_use_suites = EXCLUDED.can_use_suites,
  support_level = EXCLUDED.support_level;

-- Tabla de uso diario (tracking)
CREATE TABLE IF NOT EXISTS public.daily_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  messages_sent INTEGER DEFAULT 0,
  instances_created INTEGER DEFAULT 0,
  webhooks_used INTEGER DEFAULT 0,
  suites_created INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT daily_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(user_id, usage_date)
);

-- Agregar columna suites_created si no existe (para BD existentes)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'daily_usage' 
    AND column_name = 'suites_created'
  ) THEN
    ALTER TABLE public.daily_usage ADD COLUMN suites_created INTEGER DEFAULT 0;
  END IF;
END $$;

-- Índices para daily_usage
CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date ON public.daily_usage(user_id, usage_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON public.daily_usage(usage_date DESC);

-- Habilitar RLS
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_usage ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
DROP POLICY IF EXISTS "Anyone can view plan limits" ON public.plan_limits;
CREATE POLICY "Anyone can view plan limits"
  ON public.plan_limits FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can view own usage" ON public.daily_usage;
CREATE POLICY "Users can view own usage"
  ON public.daily_usage FOR SELECT
  USING (auth.uid() = user_id);

-- Función para incrementar uso diario
CREATE OR REPLACE FUNCTION increment_daily_usage(
  p_user_id UUID,
  p_usage_type TEXT,
  p_increment INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.daily_usage (user_id, usage_date, messages_sent, instances_created, webhooks_used, suites_created)
  VALUES (
    p_user_id,
    CURRENT_DATE,
    CASE WHEN p_usage_type = 'messages_sent' THEN p_increment ELSE 0 END,
    CASE WHEN p_usage_type = 'instances_created' THEN p_increment ELSE 0 END,
    CASE WHEN p_usage_type = 'webhooks_used' THEN p_increment ELSE 0 END,
    CASE WHEN p_usage_type = 'suites_created' THEN p_increment ELSE 0 END
  )
  ON CONFLICT (user_id, usage_date) DO UPDATE SET
    messages_sent = CASE WHEN p_usage_type = 'messages_sent' THEN daily_usage.messages_sent + p_increment ELSE daily_usage.messages_sent END,
    instances_created = CASE WHEN p_usage_type = 'instances_created' THEN daily_usage.instances_created + p_increment ELSE daily_usage.instances_created END,
    webhooks_used = CASE WHEN p_usage_type = 'webhooks_used' THEN daily_usage.webhooks_used + p_increment ELSE daily_usage.webhooks_used END,
    suites_created = CASE WHEN p_usage_type = 'suites_created' THEN daily_usage.suites_created + p_increment ELSE daily_usage.suites_created END,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Función para verificar límites
CREATE OR REPLACE FUNCTION check_user_limit(
  p_user_id UUID,
  p_limit_type TEXT
)
RETURNS TABLE (
  allowed BOOLEAN,
  current_usage INTEGER,
  max_limit INTEGER,
  plan_type TEXT
) AS $$
DECLARE
  v_plan_type TEXT;
  v_current_usage INTEGER;
  v_max_limit INTEGER;
BEGIN
  SELECT p.plan_type INTO v_plan_type FROM public.profiles p WHERE p.id = p_user_id;

  IF p_limit_type = 'instances' THEN
    SELECT pl.max_instances INTO v_max_limit FROM public.plan_limits pl WHERE pl.plan_type = v_plan_type;
    SELECT COUNT(*) INTO v_current_usage FROM public.instances i WHERE i.user_id = p_user_id AND i.is_active = true;
  ELSIF p_limit_type = 'messages' THEN
    SELECT pl.max_messages_per_day INTO v_max_limit FROM public.plan_limits pl WHERE pl.plan_type = v_plan_type;
    SELECT COALESCE(du.messages_sent, 0) INTO v_current_usage FROM public.daily_usage du WHERE du.user_id = p_user_id AND du.usage_date = CURRENT_DATE;
  ELSIF p_limit_type = 'webhooks' THEN
    SELECT pl.max_webhooks INTO v_max_limit FROM public.plan_limits pl WHERE pl.plan_type = v_plan_type;
    SELECT COUNT(DISTINCT webhook_url) INTO v_current_usage FROM public.instances i WHERE i.user_id = p_user_id AND i.webhook_url IS NOT NULL;
  ELSIF p_limit_type = 'suites' THEN
    SELECT pl.max_suites INTO v_max_limit FROM public.plan_limits pl WHERE pl.plan_type = v_plan_type;
    SELECT COUNT(*) INTO v_current_usage FROM public.suites s WHERE s.user_id = p_user_id AND s.activo = true;
  END IF;

  RETURN QUERY SELECT 
    (v_current_usage < v_max_limit) as allowed,
    COALESCE(v_current_usage, 0) as current_usage,
    COALESCE(v_max_limit, 0) as max_limit,
    v_plan_type as plan_type;
END;
$$ LANGUAGE plpgsql;

-- Trigger para tracking de mensajes
CREATE OR REPLACE FUNCTION track_message_usage()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF NEW.from_me = true THEN
    SELECT user_id INTO v_user_id FROM public.instances WHERE document_id = NEW.instance_id;
    IF v_user_id IS NOT NULL THEN
      PERFORM increment_daily_usage(v_user_id, 'messages_sent', 1);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_track_message_usage ON public.messages;
CREATE TRIGGER trigger_track_message_usage
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION track_message_usage();

-- Vista de uso actual del usuario
DROP VIEW IF EXISTS public.user_usage_summary;
CREATE VIEW public.user_usage_summary AS
SELECT 
  p.id as user_id,
  p.username,
  p.plan_type,
  p.status_plan,
  pl.max_instances,
  pl.max_messages_per_day,
  pl.max_webhooks,
  pl.max_suites,
  (SELECT COUNT(*) FROM public.instances WHERE user_id = p.id AND is_active = true) as current_instances,
  COALESCE(du.messages_sent, 0) as messages_sent_today,
  (SELECT COUNT(DISTINCT webhook_url) FROM public.instances WHERE user_id = p.id AND webhook_url IS NOT NULL) as current_webhooks,
  (SELECT COUNT(*) FROM public.suites WHERE user_id = p.id AND activo = true) as current_suites,
  ROUND((COALESCE(du.messages_sent, 0)::NUMERIC / pl.max_messages_per_day::NUMERIC) * 100, 2) as messages_usage_percent
FROM public.profiles p
LEFT JOIN public.plan_limits pl ON p.plan_type = pl.plan_type
LEFT JOIN public.daily_usage du ON p.id = du.user_id AND du.usage_date = CURRENT_DATE;

-- Función de limpieza
CREATE OR REPLACE FUNCTION cleanup_old_usage_records()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.daily_usage WHERE usage_date < CURRENT_DATE - INTERVAL '30 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Actualizar trigger de creación de usuario para activar plan Free
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id, 
    created_by_google, 
    username,
    status_plan,
    plan_type,
    plan_expires_at,
    api_key
  )
  VALUES (
    NEW.id,
    CASE WHEN NEW.raw_app_meta_data->>'provider' = 'google' THEN true ELSE false END,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    true,
    'free',
    NULL,
    'sk_' || encode(gen_random_bytes(32), 'hex')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Actualizar usuarios existentes con plan Free
UPDATE public.profiles
SET 
  status_plan = true,
  plan_type = 'free',
  plan_expires_at = NULL
WHERE status_plan = false OR status_plan IS NULL;

-- Comentarios
COMMENT ON TABLE public.plan_limits IS 'Límites de uso por tipo de plan';
COMMENT ON TABLE public.daily_usage IS 'Tracking de uso diario por usuario';
COMMENT ON FUNCTION check_user_limit IS 'Verifica si el usuario puede realizar una acción según su plan';
COMMENT ON FUNCTION increment_daily_usage IS 'Incrementa el contador de uso diario';
COMMENT ON VIEW public.user_usage_summary IS 'Resumen del uso actual vs límites del plan';

ANALYZE public.plan_limits;
ANALYZE public.daily_usage;

-- =====================================================
-- 14. SISTEMA DE CHATBOTS
-- =====================================================

-- Tabla de chatbots
CREATE TABLE IF NOT EXISTS public.chatbots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  instance_id TEXT NOT NULL,
  name TEXT NOT NULL,
  welcome_message TEXT,
  default_response TEXT NOT NULL DEFAULT 'Lo siento, no entendí tu mensaje.',
  rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  total_conversations INTEGER DEFAULT 0,
  total_responses INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chatbots_user_id_fkey FOREIGN KEY (user_id) 
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT chatbots_instance_id_fkey FOREIGN KEY (instance_id) 
    REFERENCES public.instances(document_id) ON DELETE CASCADE,
  UNIQUE(instance_id)  -- Una instancia solo puede tener un chatbot activo
);

-- Tabla de logs de chatbot (opcional, para analytics)
CREATE TABLE IF NOT EXISTS public.chatbot_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chatbot_id UUID NOT NULL,
  user_phone TEXT NOT NULL,
  user_message TEXT NOT NULL,
  bot_response TEXT NOT NULL,
  rule_matched TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chatbot_logs_chatbot_id_fkey FOREIGN KEY (chatbot_id) 
    REFERENCES public.chatbots(id) ON DELETE CASCADE
);

-- Índices para chatbots
CREATE INDEX IF NOT EXISTS idx_chatbots_user_id ON public.chatbots(user_id);
CREATE INDEX IF NOT EXISTS idx_chatbots_instance_id ON public.chatbots(instance_id);
CREATE INDEX IF NOT EXISTS idx_chatbots_is_active ON public.chatbots(is_active) WHERE is_active = true;

-- Índices para logs
CREATE INDEX IF NOT EXISTS idx_chatbot_logs_chatbot_id ON public.chatbot_logs(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_logs_timestamp ON public.chatbot_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_chatbot_logs_user_phone ON public.chatbot_logs(user_phone);

-- RLS para chatbots
ALTER TABLE public.chatbots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own chatbots" ON public.chatbots;
CREATE POLICY "Users can view own chatbots"
  ON public.chatbots FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own chatbots" ON public.chatbots;
CREATE POLICY "Users can manage own chatbots"
  ON public.chatbots FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own chatbot logs" ON public.chatbot_logs;
CREATE POLICY "Users can view own chatbot logs"
  ON public.chatbot_logs FOR SELECT
  USING (
    chatbot_id IN (
      SELECT id FROM public.chatbots WHERE user_id = auth.uid()
    )
  );

-- Trigger para updated_at
DROP TRIGGER IF EXISTS update_chatbots_updated_at ON public.chatbots;
CREATE TRIGGER update_chatbots_updated_at 
  BEFORE UPDATE ON public.chatbots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Función para registrar interacción del chatbot
CREATE OR REPLACE FUNCTION log_chatbot_interaction(
  p_chatbot_id UUID,
  p_user_phone TEXT,
  p_user_message TEXT,
  p_bot_response TEXT,
  p_rule_matched TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  -- Insertar log
  INSERT INTO public.chatbot_logs (
    chatbot_id,
    user_phone,
    user_message,
    bot_response,
    rule_matched
  ) VALUES (
    p_chatbot_id,
    p_user_phone,
    p_user_message,
    p_bot_response,
    p_rule_matched
  );
  
  -- Actualizar contadores del chatbot
  UPDATE public.chatbots
  SET 
    total_responses = total_responses + 1,
    updated_at = NOW()
  WHERE id = p_chatbot_id;
END;
$$ LANGUAGE plpgsql;

-- Vista de estadísticas de chatbots
CREATE OR REPLACE VIEW public.chatbot_stats AS
SELECT 
  c.id,
  c.name,
  c.instance_id,
  c.is_active,
  c.total_conversations,
  c.total_responses,
  COUNT(DISTINCT cl.user_phone) as unique_users,
  COUNT(cl.id) as total_interactions,
  c.created_at,
  c.updated_at
FROM public.chatbots c
LEFT JOIN public.chatbot_logs cl ON c.id = cl.chatbot_id
GROUP BY c.id, c.name, c.instance_id, c.is_active, c.total_conversations, c.total_responses, c.created_at, c.updated_at;

-- Comentarios
COMMENT ON TABLE public.chatbots IS 'Configuración de chatbots por instancia';
COMMENT ON TABLE public.chatbot_logs IS 'Logs de interacciones con chatbots para analytics';
COMMENT ON COLUMN public.chatbots.rules IS 'Array JSON de reglas: [{"trigger": "hola", "response": "Hola!", "isActive": true}]';
COMMENT ON FUNCTION log_chatbot_interaction IS 'Registra una interacción del chatbot y actualiza contadores';

ANALYZE public.chatbots;
ANALYZE public.chatbot_logs;

-- =====================================================
-- 15. GESTIÓN DE TEMPLATES POR INSTANCIA
-- =====================================================

-- Agregar columnas de template management a instances si no existen
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'instances' 
    AND column_name = 'active_template'
  ) THEN
    ALTER TABLE public.instances ADD COLUMN active_template TEXT DEFAULT 'none' CHECK (active_template IN ('none', 'spam', 'chatbot'));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'instances' 
    AND column_name = 'template_config'
  ) THEN
    ALTER TABLE public.instances ADD COLUMN template_config JSONB DEFAULT '{}'::jsonb;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'instances' 
    AND column_name = 'template_updated_at'
  ) THEN
    ALTER TABLE public.instances ADD COLUMN template_updated_at TIMESTAMPTZ;
  END IF;
END $$;

-- Índice para búsqueda por template activo
CREATE INDEX IF NOT EXISTS idx_instances_active_template ON public.instances(active_template) WHERE active_template != 'none';

-- Vista de uso de recursos por usuario
CREATE OR REPLACE VIEW public.user_template_resources AS
SELECT 
  i.user_id,
  COUNT(*) as total_instances,
  COUNT(*) FILTER (WHERE i.active_template = 'spam') as spam_instances,
  COUNT(*) FILTER (WHERE i.active_template = 'chatbot') as chatbot_instances,
  COUNT(*) FILTER (WHERE i.active_template = 'none') as inactive_instances,
  -- Estimación de recursos (valores aproximados)
  SUM(CASE 
    WHEN i.active_template = 'spam' THEN 30 + 50 + 80  -- CPU + Memory + Bandwidth
    WHEN i.active_template = 'chatbot' THEN 20 + 40 + 30
    ELSE 0
  END) as total_resource_usage
FROM public.instances i
GROUP BY i.user_id;

-- Función para obtener template activo de una instancia
CREATE OR REPLACE FUNCTION get_instance_template(p_instance_id TEXT)
RETURNS TABLE (
  template_type TEXT,
  is_active BOOLEAN,
  config JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i.active_template,
    CASE 
      WHEN i.active_template = 'chatbot' THEN 
        (SELECT c.is_active FROM public.chatbots c WHERE c.instance_id = p_instance_id LIMIT 1)
      ELSE true
    END as is_active,
    i.template_config
  FROM public.instances i
  WHERE i.document_id = p_instance_id;
END;
$$ LANGUAGE plpgsql;

-- Comentarios
COMMENT ON COLUMN public.instances.active_template IS 'Template activo: none, spam, chatbot';
COMMENT ON COLUMN public.instances.template_config IS 'Configuración específica del template activo';
COMMENT ON VIEW public.user_template_resources IS 'Resumen de uso de recursos por templates del usuario';

-- =====================================================
-- FIN DEL SCHEMA
-- =====================================================
