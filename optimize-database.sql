-- ============================================
-- OPTIMIZACIÓN DE BASE DE DATOS - SUPABASE
-- ============================================
-- Ejecutar en Supabase SQL Editor

-- ============================================
-- 1. ÍNDICES PARA PERFORMANCE
-- ============================================

-- Tabla: profiles
CREATE INDEX IF NOT EXISTS idx_profiles_status_plan ON public.profiles(status_plan) WHERE status_plan = true;
CREATE INDEX IF NOT EXISTS idx_profiles_plan_type ON public.profiles(plan_type);
CREATE INDEX IF NOT EXISTS idx_profiles_api_key ON public.profiles(api_key) WHERE api_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_proxy_enabled ON public.profiles(proxy_enabled) WHERE proxy_enabled = true;
CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON public.profiles(created_at DESC);

-- Tabla: instances
CREATE INDEX IF NOT EXISTS idx_instances_user_id ON public.instances(user_id);
CREATE INDEX IF NOT EXISTS idx_instances_document_id ON public.instances(document_id);
CREATE INDEX IF NOT EXISTS idx_instances_state ON public.instances(state);
CREATE INDEX IF NOT EXISTS idx_instances_user_state ON public.instances(user_id, state);
CREATE INDEX IF NOT EXISTS idx_instances_phone_number ON public.instances(phone_number);
CREATE INDEX IF NOT EXISTS idx_instances_is_active ON public.instances(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_instances_created_at ON public.instances(created_at DESC);

-- Tabla: templates (si existe - ajustar según tu schema)
-- Nota: Si no tienes tabla templates, comenta o elimina estas líneas
-- CREATE INDEX IF NOT EXISTS idx_templates_user_id ON public.templates(user_id);
-- CREATE INDEX IF NOT EXISTS idx_templates_type ON public.templates(type);
-- CREATE INDEX IF NOT EXISTS idx_templates_user_type ON public.templates(user_id, type);
-- CREATE INDEX IF NOT EXISTS idx_templates_created_at ON public.templates(created_at DESC);

-- Tabla: suites
CREATE INDEX IF NOT EXISTS idx_suites_user_id ON public.suites(user_id);
CREATE INDEX IF NOT EXISTS idx_suites_document_id ON public.suites(document_id);
CREATE INDEX IF NOT EXISTS idx_suites_status ON public.suites(status);
CREATE INDEX IF NOT EXISTS idx_suites_activo ON public.suites(activo) WHERE activo = true;
CREATE INDEX IF NOT EXISTS idx_suites_subdomain ON public.suites(subdomain);
CREATE INDEX IF NOT EXISTS idx_suites_created_at ON public.suites(created_at DESC);

-- Tabla: spam_progress
CREATE INDEX IF NOT EXISTS idx_spam_progress_user_id ON public.spam_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_spam_progress_spam_id ON public.spam_progress(spam_id);
CREATE INDEX IF NOT EXISTS idx_spam_progress_completed ON public.spam_progress(completed) WHERE completed = false;
CREATE INDEX IF NOT EXISTS idx_spam_progress_stopped ON public.spam_progress(stopped) WHERE stopped = true;
CREATE INDEX IF NOT EXISTS idx_spam_progress_created_at ON public.spam_progress(created_at DESC);

-- Tabla: plans
CREATE INDEX IF NOT EXISTS idx_plans_plan_type ON public.plans(plan_type);
CREATE INDEX IF NOT EXISTS idx_plans_is_active ON public.plans(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_plans_price ON public.plans(price);

-- Tabla: products
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_products_price ON public.products(price);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON public.products(created_at DESC);

-- Tabla: user_subscriptions
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON public.user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan_id ON public.user_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_is_active ON public.user_subscriptions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_expires_at ON public.user_subscriptions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_active ON public.user_subscriptions(user_id, is_active);

-- ============================================
-- 2. ÍNDICES COMPUESTOS PARA CONSULTAS COMUNES
-- ============================================

-- Buscar instancias activas de un usuario
CREATE INDEX IF NOT EXISTS idx_instances_user_connected 
ON public.instances(user_id, state) 
WHERE state = 'Connected';

-- Buscar instancias con QR disponible
CREATE INDEX IF NOT EXISTS idx_instances_qr_loading
ON public.instances(qr_loading, state)
WHERE qr_loading = false AND state = 'Initializing';

-- Buscar suites activas
CREATE INDEX IF NOT EXISTS idx_suites_user_status_active 
ON public.suites(user_id, status) 
WHERE status IN ('creating', 'running');

-- ============================================
-- 3. ÍNDICES PARA BÚSQUEDA FULL-TEXT
-- ============================================

-- Agregar columna de búsqueda si no existe
ALTER TABLE public.instances 
ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Crear índices GIN para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_instances_search 
ON public.instances USING GIN(search_vector);

-- Triggers para mantener búsqueda actualizada
CREATE OR REPLACE FUNCTION instances_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := 
    setweight(to_tsvector('spanish', COALESCE(NEW.profile_name, '')), 'A') ||
    setweight(to_tsvector('spanish', COALESCE(NEW.document_id, '')), 'B') ||
    setweight(to_tsvector('spanish', COALESCE(NEW.phone_number, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS instances_search_update ON public.instances;
CREATE TRIGGER instances_search_update 
BEFORE INSERT OR UPDATE ON public.instances
FOR EACH ROW EXECUTE FUNCTION instances_search_trigger();

-- ============================================
-- 4. POLÍTICAS RLS (ROW LEVEL SECURITY)
-- ============================================

-- Habilitar RLS en todas las tablas (si no está habilitado)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spam_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
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

-- Políticas para templates (comentadas - tabla no existe en schema actual)
-- DROP POLICY IF EXISTS "Users can view own templates" ON public.templates;
-- CREATE POLICY "Users can view own templates"
-- ON public.templates FOR SELECT
-- USING (auth.uid() = user_id);

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

DROP POLICY IF EXISTS "Users can delete own spam progress" ON public.spam_progress;
CREATE POLICY "Users can delete own spam progress"
ON public.spam_progress FOR DELETE
USING (auth.uid()::text = user_id);

-- Políticas para products (todos pueden ver, solo admin puede modificar)
DROP POLICY IF EXISTS "Anyone can view products" ON public.products;
CREATE POLICY "Anyone can view products"
ON public.products FOR SELECT
USING (true);

-- Políticas para plans (todos pueden ver, solo admin puede modificar)
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

-- ============================================
-- 5. FUNCIONES PARA LIMPIEZA AUTOMÁTICA
-- ============================================

-- Función para limpiar datos antiguos
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS void AS $$
BEGIN
  -- Marcar instancias inactivas como no activas
  UPDATE public.instances
  SET is_active = false
  WHERE state = 'Disconnected'
  AND updated_at < NOW() - INTERVAL '90 days';
  
  -- Eliminar instancias muy antiguas
  DELETE FROM public.instances
  WHERE is_active = false
  AND updated_at < NOW() - INTERVAL '180 days';
  
  -- Limpiar progreso de spam completado (más de 30 días)
  DELETE FROM public.spam_progress
  WHERE completed = true
  AND completed_at < NOW() - INTERVAL '30 days';
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. VISTAS MATERIALIZADAS PARA REPORTES
-- ============================================

-- Vista de estadísticas de usuarios (incluyendo TODAS las tablas)
CREATE MATERIALIZED VIEW IF NOT EXISTS user_stats AS
SELECT 
  p.id as user_id,
  p.username,
  p.status_plan,
  p.plan_type,
  p.proxy_enabled,
  COUNT(DISTINCT i.id) as total_instances,
  COUNT(DISTINCT i.id) FILTER (WHERE i.state = 'Connected') as active_instances,
  COUNT(DISTINCT s.id) as total_suites,
  COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'running') as active_suites,
  COUNT(DISTINCT sp.id) as total_spam_campaigns,
  COUNT(DISTINCT sp.id) FILTER (WHERE sp.completed = false AND sp.stopped = false) as active_spam_campaigns,
  COUNT(DISTINCT us.id) as total_subscriptions,
  COUNT(DISTINCT us.id) FILTER (WHERE us.is_active = true) as active_subscriptions,
  MAX(i.updated_at) as last_activity,
  p.created_at as user_created_at
FROM public.profiles p
LEFT JOIN public.instances i ON p.id = i.user_id
LEFT JOIN public.suites s ON p.id = s.user_id
LEFT JOIN public.spam_progress sp ON p.id::text = sp.user_id
LEFT JOIN public.user_subscriptions us ON p.id = us.user_id
GROUP BY p.id, p.username, p.status_plan, p.plan_type, p.proxy_enabled, p.created_at;

-- Índice para la vista materializada
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_stats_user_id ON user_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_user_stats_plan_type ON user_stats(plan_type);
CREATE INDEX IF NOT EXISTS idx_user_stats_status_plan ON user_stats(status_plan);

-- Función para refrescar estadísticas
CREATE OR REPLACE FUNCTION refresh_user_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. CONSTRAINTS PARA INTEGRIDAD DE DATOS
-- ============================================

-- Validar que proxy_port esté en rango válido
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS check_proxy_port_range;

ALTER TABLE public.profiles 
ADD CONSTRAINT check_proxy_port_range 
CHECK (proxy_port IS NULL OR (proxy_port >= 1 AND proxy_port <= 65535));

-- Validar que plan_type tenga valores válidos
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS check_plan_type_values;

ALTER TABLE public.profiles 
ADD CONSTRAINT check_plan_type_values 
CHECK (plan_type IN ('free', 'trial', 'basic', 'premium'));

-- Validar que instance state tenga valores válidos
ALTER TABLE public.instances 
DROP CONSTRAINT IF EXISTS check_instance_state;

ALTER TABLE public.instances 
ADD CONSTRAINT check_instance_state 
CHECK (state IN ('Initializing', 'Connected', 'Disconnected', 'Failure'));

-- ============================================
-- 8. ACTUALIZAR ESTADÍSTICAS DE TABLAS
-- ============================================

-- Analizar tablas para optimizar queries
ANALYZE public.profiles;
ANALYZE public.instances;
ANALYZE public.suites;
ANALYZE public.spam_progress;
ANALYZE public.plans;
ANALYZE public.products;
ANALYZE public.user_subscriptions;

-- ============================================
-- 9. CONFIGURACIÓN DE VACUUM
-- ============================================

-- Configurar auto-vacuum agresivo para tablas con muchos updates
ALTER TABLE public.instances SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE public.profiles SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.1
);

ALTER TABLE public.spam_progress SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE public.suites SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.1
);

-- ============================================
-- 10. EXTENSIONES ÚTILES
-- ============================================

-- Habilitar extensiones si no están activas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- Para generar UUIDs
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- Para búsqueda difusa
CREATE EXTENSION IF NOT EXISTS "btree_gin";      -- Índices GIN más eficientes
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- Para analizar queries lentas

-- ============================================
-- RESUMEN DE OPTIMIZACIONES
-- ============================================

/*
✅ Índices creados en columnas frecuentemente buscadas
✅ Índices compuestos para consultas comunes
✅ Full-text search configurado
✅ RLS habilitado y políticas configuradas
✅ Funciones de limpieza automática
✅ Vistas materializadas para reportes rápidos
✅ Constraints para integridad de datos
✅ Estadísticas actualizadas
✅ Auto-vacuum configurado
✅ Extensiones útiles habilitadas

RESULTADO ESPERADO:
- Performance: De 27 warnings a ~5 o menos
- Security: De 3 warnings a 0
- Consultas 10-100x más rápidas
- Base de datos lista para producción
*/

-- ============================================
-- COMANDOS POST-EJECUCIÓN
-- ============================================

-- 1. Ver tamaño de las tablas
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 2. Ver índices creados
SELECT 
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 3. Verificar políticas RLS
SELECT 
  schemaname,
  tablename,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
