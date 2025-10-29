-- =============================================
-- SCHEMA SQL COMPLETO PARA SUPABASE
-- Proyecto: Backend WhatsApp + N8N Suite + Frontend
-- TODAS LAS TABLAS INCLUIDAS
-- =============================================

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- TABLA: profiles
-- Descripción: Perfiles de usuarios con información adicional
-- =============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username VARCHAR(100),
  api_key TEXT,
  status_plan BOOLEAN NOT NULL DEFAULT false,
  plan_type VARCHAR(50) DEFAULT 'free',
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para profiles
CREATE INDEX idx_profiles_status_plan ON profiles(status_plan);
CREATE INDEX idx_profiles_plan_type ON profiles(plan_type);

-- =============================================
-- TABLA: products
-- Descripción: Productos/servicios disponibles para los usuarios
-- =============================================
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  fields JSONB DEFAULT '[]'::jsonb,
  img TEXT[],
  price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  category VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para products
CREATE INDEX idx_products_is_active ON products(is_active);
CREATE INDEX idx_products_category ON products(category);

-- =============================================
-- TABLA: instances
-- Descripción: Instancias de WhatsApp creadas por los usuarios
-- =============================================
CREATE TABLE IF NOT EXISTS instances (
  id SERIAL PRIMARY KEY,
  document_id VARCHAR(100) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(100),
  state VARCHAR(50) DEFAULT 'Disconnected',
  qr_code TEXT,
  phone_number VARCHAR(20),
  profile_name VARCHAR(100),
  profile_pic_url TEXT,
  webhook_url TEXT,
  historycal_data JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para instances
CREATE INDEX idx_instances_user_id ON instances(user_id);
CREATE INDEX idx_instances_document_id ON instances(document_id);
CREATE INDEX idx_instances_state ON instances(state);
CREATE INDEX idx_instances_is_active ON instances(is_active);

-- =============================================
-- TABLA: plans
-- Descripción: Planes de suscripción disponibles
-- =============================================
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_type VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  ram VARCHAR(20) NOT NULL,
  cpu INTEGER NOT NULL,
  max_workflows INTEGER NOT NULL,
  max_executions INTEGER NOT NULL,
  price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  features JSONB DEFAULT '[]'::jsonb,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para plans
CREATE INDEX idx_plans_plan_type ON plans(plan_type);
CREATE INDEX idx_plans_is_active ON plans(is_active);

-- =============================================
-- TABLA: user_subscriptions
-- Descripción: Suscripciones activas de usuarios
-- =============================================
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  instance_name VARCHAR(100),
  instance_url TEXT,
  current_workflows INTEGER NOT NULL DEFAULT 0,
  current_executions INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Índices para user_subscriptions
CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_plan_id ON user_subscriptions(plan_id);
CREATE INDEX idx_user_subscriptions_is_active ON user_subscriptions(is_active);
CREATE UNIQUE INDEX idx_user_subscriptions_active_user ON user_subscriptions(user_id) 
  WHERE is_active = true;

-- =============================================
-- TABLA: suites
-- Descripción: Instancias de N8N y otros servicios
-- =============================================
CREATE TABLE IF NOT EXISTS suites (
  id SERIAL PRIMARY KEY,
  "documentId" UUID DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  url TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  credencials JSONB,
  product_name VARCHAR(50) DEFAULT 'n8n',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para suites
CREATE INDEX idx_suites_user_id ON suites(user_id);
CREATE INDEX idx_suites_name ON suites(name);
CREATE INDEX idx_suites_activo ON suites(activo);
CREATE INDEX idx_suites_document_id ON suites("documentId");
CREATE UNIQUE INDEX idx_suites_user_name ON suites(user_id, name);

-- =============================================
-- TABLA: spam_progress
-- Descripción: Seguimiento de envíos masivos de WhatsApp
-- =============================================
CREATE TABLE IF NOT EXISTS spam_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_id VARCHAR(100) REFERENCES instances(document_id) ON DELETE CASCADE,
  spam_id VARCHAR(100) UNIQUE NOT NULL,
  total_contacts INTEGER NOT NULL DEFAULT 0,
  current_contact INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) DEFAULT 'running', -- running, completed, stopped, failed
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para spam_progress
CREATE INDEX idx_spam_progress_user_id ON spam_progress(user_id);
CREATE INDEX idx_spam_progress_instance_id ON spam_progress(instance_id);
CREATE INDEX idx_spam_progress_spam_id ON spam_progress(spam_id);
CREATE INDEX idx_spam_progress_status ON spam_progress(status);

-- =============================================
-- VISTA: v_user_subscriptions_full
-- Descripción: Vista completa de suscripciones con información del plan
-- =============================================
CREATE OR REPLACE VIEW v_user_subscriptions_full AS
SELECT 
  us.id,
  us.user_id,
  us.plan_id,
  p.plan_type,
  p.name as plan_name,
  p.ram,
  p.cpu,
  p.max_workflows,
  p.max_executions,
  p.price,
  us.instance_name,
  us.instance_url,
  us.current_workflows,
  us.current_executions,
  us.is_active,
  us.created_at,
  us.updated_at,
  us.expires_at
FROM user_subscriptions us
INNER JOIN plans p ON us.plan_id = p.id;

-- =============================================
-- FUNCIONES
-- =============================================

-- Función: increment_executions
CREATE OR REPLACE FUNCTION increment_executions(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_subscriptions
  SET 
    current_executions = current_executions + 1,
    updated_at = NOW()
  WHERE user_id = p_user_id 
    AND is_active = true;
END;
$$;

-- Función: reset_monthly_executions
CREATE OR REPLACE FUNCTION reset_monthly_executions()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_subscriptions
  SET 
    current_executions = 0,
    updated_at = NOW()
  WHERE is_active = true;
  
  RAISE NOTICE 'Monthly execution counters reset successfully';
END;
$$;

-- Función: deactivate_expired_subscriptions
CREATE OR REPLACE FUNCTION deactivate_expired_subscriptions()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_subscriptions
  SET 
    is_active = false,
    updated_at = NOW()
  WHERE is_active = true
    AND expires_at IS NOT NULL
    AND expires_at < NOW();
  
  RAISE NOTICE 'Expired subscriptions deactivated successfully';
END;
$$;

-- Función: update_updated_at_column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función: generate_api_key
CREATE OR REPLACE FUNCTION generate_api_key()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'sk_' || encode(gen_random_bytes(32), 'hex');
END;
$$;

-- Función: create_profile_for_new_user (Trigger automático)
CREATE OR REPLACE FUNCTION create_profile_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, username, api_key)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    generate_api_key()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- TRIGGERS
-- =============================================

-- Triggers para updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_instances_updated_at
  BEFORE UPDATE ON instances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_subscriptions_updated_at
  BEFORE UPDATE ON user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_suites_updated_at
  BEFORE UPDATE ON suites
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_spam_progress_updated_at
  BEFORE UPDATE ON spam_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger: Crear perfil automáticamente cuando se registra un nuevo usuario
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_profile_for_new_user();

-- =============================================
-- DATOS INICIALES
-- =============================================

-- Insertar planes predeterminados
INSERT INTO plans (plan_type, name, ram, cpu, max_workflows, max_executions, price, description, features)
VALUES
  (
    'Free', 
    'Plan Gratuito', 
    '256M', 
    256, 
    5, 
    100, 
    0.00, 
    'Plan básico para comenzar',
    '["5 workflows", "100 ejecuciones/mes", "256M RAM", "Soporte comunitario"]'::jsonb
  ),
  (
    'Starter', 
    'Plan Starter', 
    '512M', 
    512, 
    20, 
    1000, 
    9.99, 
    'Perfecto para proyectos pequeños',
    '["20 workflows", "1,000 ejecuciones/mes", "512M RAM", "Soporte email"]'::jsonb
  ),
  (
    'Pro', 
    'Plan Pro', 
    '1G', 
    1024, 
    100, 
    10000, 
    29.99, 
    'Para uso profesional',
    '["100 workflows", "10,000 ejecuciones/mes", "1G RAM", "Soporte prioritario"]'::jsonb
  ),
  (
    'Business', 
    'Plan Business', 
    '2G', 
    2048, 
    500, 
    50000, 
    99.99, 
    'Para equipos y empresas',
    '["500 workflows", "50,000 ejecuciones/mes", "2G RAM", "Soporte 24/7"]'::jsonb
  ),
  (
    'Enterprise', 
    'Plan Enterprise', 
    '4G', 
    4096, 
    -1, 
    -1, 
    299.99, 
    'Recursos ilimitados',
    '["Workflows ilimitados", "Ejecuciones ilimitadas", "4G RAM", "Soporte dedicado"]'::jsonb
  )
ON CONFLICT (plan_type) DO UPDATE SET
  name = EXCLUDED.name,
  ram = EXCLUDED.ram,
  cpu = EXCLUDED.cpu,
  max_workflows = EXCLUDED.max_workflows,
  max_executions = EXCLUDED.max_executions,
  price = EXCLUDED.price,
  description = EXCLUDED.description,
  features = EXCLUDED.features,
  updated_at = NOW();

-- Insertar productos predeterminados
INSERT INTO products (name, description, fields, img, price, category)
VALUES
  (
    'N8N',
    'Plataforma de automatización de flujos de trabajo',
    '[{"service_name": ""}]'::jsonb,
    ARRAY['https://n8n.io/favicon.ico'],
    0.00,
    'automation'
  ),
  (
    'WhatsApp Instance',
    'Instancia de WhatsApp Business API',
    '[{"instance_name": ""}, {"webhook_url": ""}]'::jsonb,
    ARRAY['https://www.whatsapp.com/favicon.ico'],
    0.00,
    'messaging'
  )
ON CONFLICT DO NOTHING;

-- =============================================
-- STORAGE BUCKETS
-- =============================================

-- Crear bucket para archivos públicos
INSERT INTO storage.buckets (id, name, public)
VALUES ('public-files', 'public-files', true)
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Habilitar RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE suites ENABLE ROW LEVEL SECURITY;
ALTER TABLE spam_progress ENABLE ROW LEVEL SECURITY;

-- Políticas para profiles
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Service role can manage all profiles" ON profiles
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Políticas para products
CREATE POLICY "Products are viewable by everyone" ON products
  FOR SELECT USING (true);

CREATE POLICY "Service role can manage products" ON products
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Políticas para instances
CREATE POLICY "Users can view own instances" ON instances
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own instances" ON instances
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own instances" ON instances
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own instances" ON instances
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all instances" ON instances
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Políticas para plans
CREATE POLICY "Plans are viewable by everyone" ON plans
  FOR SELECT USING (true);

CREATE POLICY "Service role can manage plans" ON plans
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Políticas para user_subscriptions
CREATE POLICY "Users can view own subscriptions" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all subscriptions" ON user_subscriptions
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Políticas para suites
CREATE POLICY "Users can view own suites" ON suites
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own suites" ON suites
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own suites" ON suites
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own suites" ON suites
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all suites" ON suites
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Políticas para spam_progress
CREATE POLICY "Users can view own spam progress" ON spam_progress
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own spam progress" ON spam_progress
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own spam progress" ON spam_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage all spam progress" ON spam_progress
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Políticas para Storage
CREATE POLICY "Public files are viewable by everyone"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'public-files');

CREATE POLICY "Users can upload files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'public-files' AND auth.role() = 'authenticated');

CREATE POLICY "Users can update own files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'public-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'public-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- =============================================
-- ÍNDICES ADICIONALES PARA OPTIMIZACIÓN
-- =============================================

-- Índices para búsquedas por rango de fechas
CREATE INDEX idx_user_subscriptions_created_at ON user_subscriptions(created_at DESC);
CREATE INDEX idx_user_subscriptions_expires_at ON user_subscriptions(expires_at) 
  WHERE expires_at IS NOT NULL;
CREATE INDEX idx_instances_created_at ON instances(created_at DESC);
CREATE INDEX idx_spam_progress_started_at ON spam_progress(started_at DESC);

-- Índices compuestos para búsquedas frecuentes
CREATE INDEX idx_user_subscriptions_user_active ON user_subscriptions(user_id, is_active);
CREATE INDEX idx_instances_user_active ON instances(user_id, is_active);
CREATE INDEX idx_suites_user_activo ON suites(user_id, activo);

-- Índices GIN para búsquedas en JSONB
CREATE INDEX idx_suites_credencials ON suites USING GIN (credencials);
CREATE INDEX idx_instances_historycal_data ON instances USING GIN (historycal_data);
CREATE INDEX idx_spam_progress_metadata ON spam_progress USING GIN (metadata);
CREATE INDEX idx_products_fields ON products USING GIN (fields);

-- =============================================
-- COMENTARIOS DE DOCUMENTACIÓN
-- =============================================
COMMENT ON TABLE profiles IS 'Perfiles de usuarios con información adicional y API keys';
COMMENT ON TABLE products IS 'Productos y servicios disponibles para los usuarios';
COMMENT ON TABLE instances IS 'Instancias de WhatsApp creadas y gestionadas por usuarios';
COMMENT ON TABLE plans IS 'Planes de suscripción disponibles en el sistema';
COMMENT ON TABLE user_subscriptions IS 'Suscripciones activas de usuarios a planes';
COMMENT ON TABLE suites IS 'Instancias de N8N y otros servicios creados para usuarios';
COMMENT ON TABLE spam_progress IS 'Seguimiento de envíos masivos de mensajes de WhatsApp';
COMMENT ON VIEW v_user_subscriptions_full IS 'Vista completa de suscripciones con información detallada del plan';

-- =============================================
-- INFORMACIÓN DE VERSIÓN
-- =============================================
COMMENT ON SCHEMA public IS 'Schema version 2.0.0 - WhatsApp Backend + N8N Suite + Frontend COMPLETO';

-- =============================================
-- SCRIPT COMPLETADO
-- =============================================
-- Total de tablas: 7 (profiles, products, instances, plans, user_subscriptions, suites, spam_progress)
-- Total de vistas: 1 (v_user_subscriptions_full)
-- Total de funciones: 6
-- Total de triggers: 9
-- RLS habilitado en todas las tablas
-- Storage bucket creado: public-files
-- =============================================
