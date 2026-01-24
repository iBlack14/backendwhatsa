-- =====================================================
-- SCHEMA COMPLETO PARA SUPABASE - BLXK WHATSAPP
-- =====================================================
-- Versión: 3.0
-- Fecha: 2025-11-07
-- Descripción: Schema completo con todas las tablas, políticas RLS, triggers e índices
-- Incluye: Sistema de API Keys, Plan Gratuito Automático, Manejo de Usernames Duplicados
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
  openai_api_key TEXT,
  gemini_api_key TEXT,
  must_change_password BOOLEAN DEFAULT false,
  temp_password TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Agregar columnas si no existen (para BD existentes)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'must_change_password'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN must_change_password BOOLEAN DEFAULT false;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'temp_password'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN temp_password TEXT;
  END IF;
END $$;

-- Tabla de sesiones de WhatsApp (Baileys)
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (session_id, key)
);

-- Índices para whatsapp_sessions
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_session_id ON public.whatsapp_sessions(session_id);

-- Habilitar RLS
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- Políticas para whatsapp_sessions (Servicio puede todo, usuarios nada por defecto o ajustar según necesidad)
-- Asumiendo que el backend usa service_role, no necesita políticas permisivas para anon/authenticated si no acceden directo.
-- Pero si se quiere que el usuario dueño de la instancia pueda ver (aunque no es usual para sesiones internas):
-- CREATE POLICY "Service role manages A" ON public.whatsapp_sessions USING (true) WITH CHECK (true);

-- Trigger para updated_at

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS update_whatsapp_sessions_updated_at ON public.whatsapp_sessions;
CREATE TRIGGER update_whatsapp_sessions_updated_at 
  BEFORE UPDATE ON public.whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Tabla de instancias de WhatsApp
CREATE TABLE IF NOT EXISTS public.instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  webhook_url TEXT,
  state TEXT DEFAULT 'Initializing' CHECK (state IN ('Initializing', 'Connected', 'Disconnected', 'Failure')),
  active_template TEXT DEFAULT 'none' CHECK (active_template IN ('none', 'spam', 'chatbot', 'calentamiento')),
  template_config JSONB DEFAULT '{}'::jsonb,
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

-- Tabla de contactos de WhatsApp
CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id TEXT NOT NULL,
  jid TEXT NOT NULL,
  name TEXT,
  push_name TEXT,
  profile_pic_url TEXT,
  is_blocked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT contacts_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.instances(document_id) ON DELETE CASCADE,
  UNIQUE(instance_id, jid)
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

DROP TRIGGER IF EXISTS update_contacts_updated_at ON public.contacts;
CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON public.contacts
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
DECLARE
  v_username TEXT;
  v_base_username TEXT;
  v_counter INTEGER := 1;
  v_exists BOOLEAN;
BEGIN
  -- Obtener username base del metadata o email
  v_base_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );
  
  v_username := v_base_username;
  
  -- Si el username ya existe, agregar sufijo numérico
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM public.profiles WHERE username = v_username
    ) INTO v_exists;
    
    EXIT WHEN NOT v_exists;
    
    v_username := v_base_username || '_' || v_counter;
    v_counter := v_counter + 1;
    
    -- Máximo 100 intentos
    EXIT WHEN v_counter > 100;
  END LOOP;
  
  -- Crear perfil para el nuevo usuario con plan gratuito
  INSERT INTO public.profiles (
    id, 
    username,
    created_by_google,
    status_plan, 
    plan_type,
    created_at
  )
  VALUES (
    NEW.id,
    v_username,
    CASE WHEN NEW.raw_app_meta_data->>'provider' = 'google' THEN true ELSE false END,
    true,  -- ✅ Plan activo por defecto
    'free',  -- ✅ Plan gratuito
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log del error pero no bloquear el registro
  RAISE WARNING 'Error creando perfil para usuario %: %', NEW.id, SQLERRM;
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
  USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
  ON public.profiles FOR UPDATE 
  USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" 
  ON public.profiles FOR INSERT 
  WITH CHECK ((select auth.uid()) = id);

-- Políticas para instances
DROP POLICY IF EXISTS "Users can view own instances" ON public.instances;
CREATE POLICY "Users can view own instances" 
  ON public.instances FOR SELECT 
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own instances" ON public.instances;
CREATE POLICY "Users can insert own instances" 
  ON public.instances FOR INSERT 
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own instances" ON public.instances;
CREATE POLICY "Users can update own instances" 
  ON public.instances FOR UPDATE 
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own instances" ON public.instances;
CREATE POLICY "Users can delete own instances" 
  ON public.instances FOR DELETE 
  USING ((select auth.uid()) = user_id);


-- Políticas para contacts
DROP POLICY IF EXISTS "Users can view own contacts" ON public.contacts;
CREATE POLICY "Users can view own contacts"
  ON public.contacts FOR SELECT
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert own contacts" ON public.contacts;
CREATE POLICY "Users can insert own contacts"
  ON public.contacts FOR INSERT
  WITH CHECK (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update own contacts" ON public.contacts;
CREATE POLICY "Users can update own contacts"
  ON public.contacts FOR UPDATE
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete own contacts" ON public.contacts;
CREATE POLICY "Users can delete own contacts"
  ON public.contacts FOR DELETE
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

-- Políticas para messages
DROP POLICY IF EXISTS "Users can view their own messages" ON public.messages;
CREATE POLICY "Users can view their own messages"
  ON public.messages FOR SELECT
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert messages to their instances" ON public.messages;
CREATE POLICY "Users can insert messages to their instances"
  ON public.messages FOR INSERT
  WITH CHECK (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
CREATE POLICY "Users can update their own messages"
  ON public.messages FOR UPDATE
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
CREATE POLICY "Users can delete their own messages"
  ON public.messages FOR DELETE
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

-- Políticas para suites
DROP POLICY IF EXISTS "Users can view own suites" ON public.suites;
CREATE POLICY "Users can view own suites" 
  ON public.suites FOR SELECT 
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own suites" ON public.suites;
CREATE POLICY "Users can insert own suites" 
  ON public.suites FOR INSERT 
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own suites" ON public.suites;
CREATE POLICY "Users can update own suites" 
  ON public.suites FOR UPDATE 
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own suites" ON public.suites;
CREATE POLICY "Users can delete own suites" 
  ON public.suites FOR DELETE 
  USING ((select auth.uid()) = user_id);

-- Políticas para spam_progress
DROP POLICY IF EXISTS "Users can view own spam progress" ON public.spam_progress;
CREATE POLICY "Users can view own spam progress" 
  ON public.spam_progress FOR SELECT 
  USING ((select auth.uid())::text = user_id);

DROP POLICY IF EXISTS "Users can insert own spam progress" ON public.spam_progress;
CREATE POLICY "Users can insert own spam progress" 
  ON public.spam_progress FOR INSERT 
  WITH CHECK ((select auth.uid())::text = user_id);

DROP POLICY IF EXISTS "Users can update own spam progress" ON public.spam_progress;
CREATE POLICY "Users can update own spam progress" 
  ON public.spam_progress FOR UPDATE 
  USING ((select auth.uid())::text = user_id);

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
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own subscriptions" ON public.user_subscriptions;
CREATE POLICY "Users can insert own subscriptions" 
  ON public.user_subscriptions FOR INSERT 
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.user_subscriptions;
CREATE POLICY "Users can update own subscriptions" 
  ON public.user_subscriptions FOR UPDATE 
  USING ((select auth.uid()) = user_id);

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

-- Combined policy for all operations on own proxies
CREATE POLICY "Users can manage own proxies"
  ON public.proxies FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- Políticas para instance_proxies (usuarios ven sus propias instancias)
DROP POLICY IF EXISTS "Users can view their instance proxies" ON public.instance_proxies;
CREATE POLICY "Users can view their instance proxies"
  ON public.instance_proxies FOR SELECT
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update their instance proxies" ON public.instance_proxies;
CREATE POLICY "Users can update their instance proxies"
  ON public.instance_proxies FOR UPDATE
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

-- Políticas para chats (usuarios ven chats de sus instancias)
DROP POLICY IF EXISTS "Users can view their chats" ON public.chats;
CREATE POLICY "Users can view their chats"
  ON public.chats FOR SELECT
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update their chats" ON public.chats;
CREATE POLICY "Users can update their chats"
  ON public.chats FOR UPDATE
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
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
DROP FUNCTION IF EXISTS get_available_proxy(UUID);
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
  USING ((select auth.uid()) = user_id);

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

-- Actualizar usuarios existentes con plan Free y generar API keys
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
DROP POLICY IF EXISTS "Users can manage own chatbots" ON public.chatbots;

-- Combined policy for all operations on own chatbots
CREATE POLICY "Users can manage own chatbots"
  ON public.chatbots FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own chatbot logs" ON public.chatbot_logs;
CREATE POLICY "Users can view own chatbot logs"
  ON public.chatbot_logs FOR SELECT
  USING (
    chatbot_id IN (
      SELECT id FROM public.chatbots WHERE user_id = (select auth.uid())
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
DROP FUNCTION IF EXISTS get_instance_template(TEXT);
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
-- 16. CONTADORES ANTI-BAN Y RATE LIMITING
-- =====================================================

-- Tabla de contadores anti-ban (persistencia)
CREATE TABLE IF NOT EXISTS public.anti_ban_counters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  messages_sent_today INTEGER DEFAULT 0,
  messages_sent_this_hour INTEGER DEFAULT 0,
  recent_errors INTEGER DEFAULT 0,
  last_reset_day DATE DEFAULT CURRENT_DATE,
  last_reset_hour INTEGER DEFAULT EXTRACT(HOUR FROM NOW()),
  last_error_time TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT anti_ban_counters_user_id_fkey FOREIGN KEY (user_id) 
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT anti_ban_counters_instance_id_fkey FOREIGN KEY (instance_id) 
    REFERENCES public.instances(document_id) ON DELETE CASCADE
);

-- Tabla de rate limiting por usuario
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  request_count INTEGER DEFAULT 0,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  last_request TIMESTAMPTZ DEFAULT NOW(),
  blocked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT rate_limits_user_id_fkey FOREIGN KEY (user_id) 
    REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(user_id, endpoint)
);

-- Tabla de rate limiting por IP (backup)
CREATE TABLE IF NOT EXISTS public.rate_limits_ip (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_count INTEGER DEFAULT 0,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  last_request TIMESTAMPTZ DEFAULT NOW(),
  blocked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ip_address, endpoint)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_anti_ban_counters_instance_id ON public.anti_ban_counters(instance_id);
CREATE INDEX IF NOT EXISTS idx_anti_ban_counters_user_id ON public.anti_ban_counters(user_id);
CREATE INDEX IF NOT EXISTS idx_anti_ban_counters_last_activity ON public.anti_ban_counters(last_activity);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_endpoint ON public.rate_limits(user_id, endpoint);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON public.rate_limits(window_start);

CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_endpoint ON public.rate_limits_ip(ip_address, endpoint);
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_window_start ON public.rate_limits_ip(window_start);

-- RLS para contadores
ALTER TABLE public.anti_ban_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits_ip ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own counters" ON public.anti_ban_counters;
DROP POLICY IF EXISTS "Users can manage own counters" ON public.anti_ban_counters;

-- Combined policy for all operations on own counters
CREATE POLICY "Users can manage own counters" 
  ON public.anti_ban_counters FOR ALL 
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own rate limits" ON public.rate_limits;
CREATE POLICY "Users can view own rate limits"
  ON public.rate_limits FOR SELECT
  USING ((select auth.uid()) = user_id);

-- Triggers para updated_at
DROP TRIGGER IF EXISTS update_anti_ban_counters_updated_at ON public.anti_ban_counters;
CREATE TRIGGER update_anti_ban_counters_updated_at 
  BEFORE UPDATE ON public.anti_ban_counters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Función para obtener/crear contador anti-ban
DROP FUNCTION IF EXISTS get_or_create_anti_ban_counter(TEXT, UUID);
CREATE OR REPLACE FUNCTION get_or_create_anti_ban_counter(
  p_instance_id TEXT,
  p_user_id UUID
)
RETURNS TABLE (
  messages_sent_today INTEGER,
  messages_sent_this_hour INTEGER,
  recent_errors INTEGER,
  last_reset_day DATE,
  last_reset_hour INTEGER
) AS $$
DECLARE
  v_counter RECORD;
  v_current_day DATE := CURRENT_DATE;
  v_current_hour INTEGER := EXTRACT(HOUR FROM NOW());
BEGIN
  -- Intentar obtener contador existente
  SELECT * INTO v_counter
  FROM public.anti_ban_counters
  WHERE instance_id = p_instance_id;
  
  -- Si no existe, crear uno nuevo
  IF NOT FOUND THEN
    INSERT INTO public.anti_ban_counters (
      instance_id,
      user_id,
      messages_sent_today,
      messages_sent_this_hour,
      recent_errors,
      last_reset_day,
      last_reset_hour
    ) VALUES (
      p_instance_id,
      p_user_id,
      0,
      0,
      0,
      v_current_day,
      v_current_hour
    )
    RETURNING * INTO v_counter;
  ELSE
    -- Resetear contador diario si cambió el día
    IF v_counter.last_reset_day < v_current_day THEN
      UPDATE public.anti_ban_counters
      SET 
        messages_sent_today = 0,
        messages_sent_this_hour = 0,
        last_reset_day = v_current_day,
        last_reset_hour = v_current_hour,
        last_activity = NOW()
      WHERE instance_id = p_instance_id
      RETURNING * INTO v_counter;
    END IF;
    
    -- Resetear contador por hora si cambió la hora
    IF v_counter.last_reset_hour < v_current_hour THEN
      UPDATE public.anti_ban_counters
      SET 
        messages_sent_this_hour = 0,
        last_reset_hour = v_current_hour,
        last_activity = NOW()
      WHERE instance_id = p_instance_id
      RETURNING * INTO v_counter;
    END IF;
  END IF;
  
  RETURN QUERY SELECT 
    v_counter.messages_sent_today,
    v_counter.messages_sent_this_hour,
    v_counter.recent_errors,
    v_counter.last_reset_day,
    v_counter.last_reset_hour;
END;
$$ LANGUAGE plpgsql;

-- Función para incrementar contador de mensajes
CREATE OR REPLACE FUNCTION increment_anti_ban_counter(
  p_instance_id TEXT
)
RETURNS void AS $$
BEGIN
  UPDATE public.anti_ban_counters
  SET 
    messages_sent_today = messages_sent_today + 1,
    messages_sent_this_hour = messages_sent_this_hour + 1,
    last_activity = NOW(),
    updated_at = NOW()
  WHERE instance_id = p_instance_id;
END;
$$ LANGUAGE plpgsql;

-- Función para registrar error
CREATE OR REPLACE FUNCTION record_anti_ban_error(
  p_instance_id TEXT
)
RETURNS void AS $$
BEGIN
  UPDATE public.anti_ban_counters
  SET 
    recent_errors = recent_errors + 1,
    last_error_time = NOW(),
    last_activity = NOW(),
    updated_at = NOW()
  WHERE instance_id = p_instance_id;
END;
$$ LANGUAGE plpgsql;

-- Función para verificar rate limit por usuario
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id UUID,
  p_endpoint TEXT,
  p_limit INTEGER DEFAULT 100,
  p_window_minutes INTEGER DEFAULT 60
)
RETURNS TABLE (
  allowed BOOLEAN,
  current_count INTEGER,
  reset_at TIMESTAMPTZ
) AS $$
DECLARE
  v_limit RECORD;
  v_window_start TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Calcular inicio de ventana
  v_window_start := v_now - (p_window_minutes || ' minutes')::INTERVAL;
  
  -- Obtener o crear registro de rate limit
  SELECT * INTO v_limit
  FROM public.rate_limits
  WHERE user_id = p_user_id AND endpoint = p_endpoint;
  
  -- Si no existe, crear
  IF NOT FOUND THEN
    INSERT INTO public.rate_limits (user_id, endpoint, request_count, window_start, last_request)
    VALUES (p_user_id, p_endpoint, 1, v_now, v_now)
    RETURNING * INTO v_limit;
    
    RETURN QUERY SELECT true, 1, v_now + (p_window_minutes || ' minutes')::INTERVAL;
    RETURN;
  END IF;
  
  -- Verificar si está bloqueado
  IF v_limit.blocked_until IS NOT NULL AND v_limit.blocked_until > v_now THEN
    RETURN QUERY SELECT false, v_limit.request_count, v_limit.blocked_until;
    RETURN;
  END IF;
  
  -- Verificar si la ventana expiró
  IF v_limit.window_start < v_window_start THEN
    -- Resetear contador
    UPDATE public.rate_limits
    SET 
      request_count = 1,
      window_start = v_now,
      last_request = v_now,
      blocked_until = NULL
    WHERE user_id = p_user_id AND endpoint = p_endpoint;
    
    RETURN QUERY SELECT true, 1, v_now + (p_window_minutes || ' minutes')::INTERVAL;
    RETURN;
  END IF;
  
  -- Incrementar contador
  UPDATE public.rate_limits
  SET 
    request_count = request_count + 1,
    last_request = v_now
  WHERE user_id = p_user_id AND endpoint = p_endpoint
  RETURNING request_count INTO v_limit;
  
  -- Verificar si excedió el límite
  IF v_limit.request_count > p_limit THEN
    -- Bloquear por el resto de la ventana
    UPDATE public.rate_limits
    SET blocked_until = window_start + (p_window_minutes || ' minutes')::INTERVAL
    WHERE user_id = p_user_id AND endpoint = p_endpoint;
    
    RETURN QUERY SELECT false, v_limit.request_count, v_limit.window_start + (p_window_minutes || ' minutes')::INTERVAL;
    RETURN;
  END IF;
  
  RETURN QUERY SELECT true, v_limit.request_count, v_limit.window_start + (p_window_minutes || ' minutes')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- Función de limpieza de instancias inactivas (> 24 horas)
CREATE OR REPLACE FUNCTION cleanup_inactive_instances()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  -- Eliminar contadores de instancias inactivas por más de 24 horas
  DELETE FROM public.anti_ban_counters
  WHERE last_activity < NOW() - INTERVAL '24 hours';
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- Función de limpieza de rate limits antiguos
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  -- Eliminar rate limits de más de 7 días
  DELETE FROM public.rate_limits
  WHERE window_start < NOW() - INTERVAL '7 days';
  
  DELETE FROM public.rate_limits_ip
  WHERE window_start < NOW() - INTERVAL '7 days';
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- Comentarios
COMMENT ON TABLE public.anti_ban_counters IS 'Contadores persistentes para sistema anti-ban';
COMMENT ON TABLE public.rate_limits IS 'Rate limiting por usuario y endpoint';
COMMENT ON TABLE public.rate_limits_ip IS 'Rate limiting por IP (backup)';
COMMENT ON FUNCTION get_or_create_anti_ban_counter IS 'Obtiene o crea contador anti-ban con reset automático';
COMMENT ON FUNCTION check_rate_limit IS 'Verifica y aplica rate limit por usuario';
COMMENT ON FUNCTION cleanup_inactive_instances IS 'Elimina contadores de instancias inactivas > 24h';

ANALYZE public.anti_ban_counters;
ANALYZE public.rate_limits;
ANALYZE public.rate_limits_ip;

-- =====================================================
-- 17. SISTEMA DE API KEYS Y SEGURIDAD
-- =====================================================

-- Asegurar que api_key sea único y no nulo
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_key_unique'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT api_key_unique UNIQUE (api_key);
  END IF;
END $$;

-- Función para generar API key única
CREATE OR REPLACE FUNCTION generate_api_key()
RETURNS TEXT AS $$
DECLARE
  v_api_key TEXT;
  v_exists BOOLEAN;
BEGIN
  LOOP
    -- Generar API key con formato: sk_live_{random_32_chars}
    v_api_key := 'sk_live_' || encode(gen_random_bytes(24), 'hex');
    
    -- Verificar que no exista
    SELECT EXISTS(
      SELECT 1 FROM public.profiles WHERE api_key = v_api_key
    ) INTO v_exists;
    
    EXIT WHEN NOT v_exists;
  END LOOP;
  
  RETURN v_api_key;
END;
$$ LANGUAGE plpgsql;

-- Trigger para generar API key automáticamente al crear perfil
CREATE OR REPLACE FUNCTION auto_generate_api_key()
RETURNS TRIGGER AS $$
BEGIN
  -- Si no tiene API key, generar una
  IF NEW.api_key IS NULL OR NEW.api_key = '' THEN
    BEGIN
      NEW.api_key := generate_api_key();
    EXCEPTION WHEN OTHERS THEN
      -- Si falla, usar un valor por defecto temporal
      NEW.api_key := 'sk_live_' || encode(gen_random_bytes(24), 'hex');
      RAISE WARNING 'Error generando API key, usando valor temporal: %', SQLERRM;
    END;
  END IF;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Si todo falla, permitir que el registro continúe sin API key
  RAISE WARNING 'Error en trigger auto_generate_api_key: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_generate_api_key ON public.profiles;
CREATE TRIGGER trigger_auto_generate_api_key
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_api_key();

-- Tabla de tracking de uso de API keys
CREATE TABLE IF NOT EXISTS public.api_key_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  status_code INTEGER,
  response_time_ms INTEGER,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_api_key_usage_user_id ON public.api_key_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_timestamp ON public.api_key_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_api_key ON public.api_key_usage(api_key);

-- Tabla de historial de API keys (para rotación)
CREATE TABLE IF NOT EXISTS public.api_key_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old_api_key TEXT NOT NULL,
  new_api_key TEXT NOT NULL,
  reason TEXT,
  revoked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS para api_key_usage
ALTER TABLE public.api_key_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own API usage" ON public.api_key_usage;
CREATE POLICY "Users can view own API usage"
  ON public.api_key_usage FOR SELECT
  USING ((select auth.uid()) = user_id);

-- RLS para api_key_history
ALTER TABLE public.api_key_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own API key history" ON public.api_key_history;
CREATE POLICY "Users can view own API key history"
  ON public.api_key_history FOR SELECT
  USING ((select auth.uid()) = user_id);

-- Función para regenerar API key
DROP FUNCTION IF EXISTS regenerate_api_key(UUID, TEXT);
CREATE OR REPLACE FUNCTION regenerate_api_key(
  p_user_id UUID,
  p_reason TEXT DEFAULT 'User requested'
)
RETURNS TABLE (
  new_api_key TEXT,
  success BOOLEAN
) AS $$
DECLARE
  v_old_api_key TEXT;
  v_new_api_key TEXT;
BEGIN
  -- Obtener API key actual
  SELECT api_key INTO v_old_api_key
  FROM public.profiles
  WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::TEXT, false;
    RETURN;
  END IF;
  
  -- Generar nueva API key
  v_new_api_key := generate_api_key();
  
  -- Actualizar perfil
  UPDATE public.profiles
  SET api_key = v_new_api_key
  WHERE id = p_user_id;
  
  -- Guardar en historial
  INSERT INTO public.api_key_history (user_id, old_api_key, new_api_key, reason)
  VALUES (p_user_id, v_old_api_key, v_new_api_key, p_reason);
  
  RETURN QUERY SELECT v_new_api_key, true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para registrar uso de API
CREATE OR REPLACE FUNCTION log_api_usage(
  p_user_id UUID,
  p_api_key TEXT,
  p_endpoint TEXT,
  p_method TEXT,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_status_code INTEGER DEFAULT 200,
  p_response_time_ms INTEGER DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO public.api_key_usage (
    user_id,
    api_key,
    endpoint,
    method,
    ip_address,
    user_agent,
    status_code,
    response_time_ms
  ) VALUES (
    p_user_id,
    p_api_key,
    p_endpoint,
    p_method,
    p_ip_address,
    p_user_agent,
    p_status_code,
    p_response_time_ms
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para obtener estadísticas de uso de API
DROP FUNCTION IF EXISTS get_api_usage_stats(UUID, INTEGER);
CREATE OR REPLACE FUNCTION get_api_usage_stats(
  p_user_id UUID,
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  total_requests BIGINT,
  successful_requests BIGINT,
  failed_requests BIGINT,
  avg_response_time_ms NUMERIC,
  most_used_endpoint TEXT,
  requests_by_day JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status_code < 400) as success,
      COUNT(*) FILTER (WHERE status_code >= 400) as failed,
      AVG(response_time_ms) as avg_time
    FROM public.api_key_usage
    WHERE user_id = p_user_id
      AND timestamp > NOW() - (p_days || ' days')::INTERVAL
  ),
  top_endpoint AS (
    SELECT endpoint
    FROM public.api_key_usage
    WHERE user_id = p_user_id
      AND timestamp > NOW() - (p_days || ' days')::INTERVAL
    GROUP BY endpoint
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ),
  daily_stats AS (
    SELECT jsonb_object_agg(
      date_trunc('day', timestamp)::DATE,
      count
    ) as by_day
    FROM (
      SELECT
        date_trunc('day', timestamp) as day,
        COUNT(*) as count
      FROM public.api_key_usage
      WHERE user_id = p_user_id
        AND timestamp > NOW() - (p_days || ' days')::INTERVAL
      GROUP BY date_trunc('day', timestamp)
      ORDER BY day DESC
    ) daily
  )
  SELECT
    COALESCE(stats.total, 0),
    COALESCE(stats.success, 0),
    COALESCE(stats.failed, 0),
    ROUND(COALESCE(stats.avg_time, 0)::NUMERIC, 2),
    COALESCE(top_endpoint.endpoint, 'N/A'),
    COALESCE(daily_stats.by_day, '{}'::JSONB)
  FROM stats
  LEFT JOIN top_endpoint ON true
  LEFT JOIN daily_stats ON true;
END;
$$ LANGUAGE plpgsql;

-- Generar API keys para usuarios existentes que no tengan
UPDATE public.profiles
SET api_key = generate_api_key()
WHERE api_key IS NULL OR api_key = '';

-- Comentarios
COMMENT ON FUNCTION generate_api_key IS 'Genera una API key única con formato sk_live_{random}';
COMMENT ON FUNCTION regenerate_api_key IS 'Regenera la API key de un usuario y guarda en historial';
COMMENT ON FUNCTION log_api_usage IS 'Registra el uso de la API para tracking y analytics';
COMMENT ON FUNCTION get_api_usage_stats IS 'Obtiene estadísticas de uso de API de un usuario';
COMMENT ON TABLE public.api_key_usage IS 'Tracking de todas las llamadas a la API';
COMMENT ON TABLE public.api_key_history IS 'Historial de rotación de API keys';

ANALYZE public.api_key_usage;
ANALYZE public.api_key_history;

-- =====================================================
-- TABLA DE PAGOS (IZIPAY)
-- =====================================================

-- Crear tabla de pagos
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  transaction_id TEXT,
  amount NUMERIC NOT NULL,
  currency TEXT DEFAULT 'PEN',
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  payment_method TEXT,
  plan_type TEXT,
  plan_name TEXT,
  customer_email TEXT,
  izipay_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments(created_at DESC);

-- Trigger para updated_at
DROP TRIGGER IF EXISTS update_payments_updated_at ON public.payments;
CREATE TRIGGER update_payments_updated_at 
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Habilitar RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
CREATE POLICY "Users can view own payments" 
  ON public.payments FOR SELECT 
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own payments" ON public.payments;
CREATE POLICY "Users can insert own payments" 
  ON public.payments FOR INSERT 
  WITH CHECK ((select auth.uid()) = user_id);

-- Comentarios
COMMENT ON TABLE public.payments IS 'Registro de pagos realizados por los usuarios';
COMMENT ON COLUMN public.payments.order_id IS 'ID único de la orden de pago';
COMMENT ON COLUMN public.payments.transaction_id IS 'ID de transacción de Izipay';
COMMENT ON COLUMN public.payments.status IS 'Estado del pago: pending, paid, failed, refunded';
COMMENT ON COLUMN public.payments.izipay_response IS 'Respuesta completa de Izipay en formato JSON';

ANALYZE public.payments;

-- =====================================================
-- 7. TABLA DE CHATBOTS (PERSISTENCIA)
-- =====================================================
-- Versión: 1.0
-- Fecha: 2024-11-22
-- Descripción: Persistencia de configuración de chatbots por instancia
-- =====================================================

-- Crear tabla para persistencia de chatbots
CREATE TABLE IF NOT EXISTS instance_chatbots (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  instance_id TEXT NOT NULL UNIQUE,
  chatbot_name TEXT NOT NULL,
  welcome_message TEXT,
  default_response TEXT,
  rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Crear índice para búsquedas rápidas por instancia
CREATE INDEX IF NOT EXISTS idx_instance_chatbots_instance_id ON instance_chatbots(instance_id);

-- Trigger para actualizar updated_at (Reutilizamos la función existente)
DROP TRIGGER IF EXISTS update_instance_chatbots_updated_at ON instance_chatbots;
CREATE TRIGGER update_instance_chatbots_updated_at
    BEFORE UPDATE ON instance_chatbots
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Políticas RLS para Chatbots
ALTER TABLE public.instance_chatbots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own chatbots" ON public.instance_chatbots;
CREATE POLICY "Users can view own chatbots"
  ON public.instance_chatbots FOR SELECT
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert own chatbots" ON public.instance_chatbots;
CREATE POLICY "Users can insert own chatbots"
  ON public.instance_chatbots FOR INSERT
  WITH CHECK (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update own chatbots" ON public.instance_chatbots;
CREATE POLICY "Users can update own chatbots"
  ON public.instance_chatbots FOR UPDATE
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete own chatbots" ON public.instance_chatbots;
CREATE POLICY "Users can delete own chatbots"
  ON public.instance_chatbots FOR DELETE
  USING (
    instance_id IN (
      SELECT document_id FROM public.instances WHERE user_id = (select auth.uid())
    )
  );

-- =====================================================
-- FIN DEL SCHEMA
-- =====================================================