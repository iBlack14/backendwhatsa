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
