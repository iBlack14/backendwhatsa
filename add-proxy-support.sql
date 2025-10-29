-- =============================================
-- AGREGAR SOPORTE DE PROXIES A PROFILES
-- =============================================

-- Agregar columnas para configuración de proxy
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS proxy_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS proxy_type text DEFAULT 'http' CHECK (proxy_type IN ('http', 'https', 'socks4', 'socks5')),
ADD COLUMN IF NOT EXISTS proxy_host text,
ADD COLUMN IF NOT EXISTS proxy_port integer,
ADD COLUMN IF NOT EXISTS proxy_username text,
ADD COLUMN IF NOT EXISTS proxy_password text,
ADD COLUMN IF NOT EXISTS proxy_country text,
ADD COLUMN IF NOT EXISTS proxy_rotation boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS proxy_rotation_minutes integer DEFAULT 30,
ADD COLUMN IF NOT EXISTS proxy_last_rotation timestamp with time zone;

-- Comentarios para documentación
COMMENT ON COLUMN public.profiles.proxy_enabled IS 'Si el usuario tiene proxy habilitado';
COMMENT ON COLUMN public.profiles.proxy_type IS 'Tipo de proxy: http, https, socks4, socks5';
COMMENT ON COLUMN public.profiles.proxy_host IS 'Host o IP del proxy';
COMMENT ON COLUMN public.profiles.proxy_port IS 'Puerto del proxy';
COMMENT ON COLUMN public.profiles.proxy_username IS 'Usuario para autenticación del proxy';
COMMENT ON COLUMN public.profiles.proxy_password IS 'Contraseña para autenticación del proxy (encriptada)';
COMMENT ON COLUMN public.profiles.proxy_country IS 'País del proxy (para geolocalización)';
COMMENT ON COLUMN public.profiles.proxy_rotation IS 'Si debe rotar el proxy automáticamente';
COMMENT ON COLUMN public.profiles.proxy_rotation_minutes IS 'Cada cuántos minutos rotar el proxy';
COMMENT ON COLUMN public.profiles.proxy_last_rotation IS 'Última vez que se rotó el proxy';

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_profiles_proxy_enabled ON public.profiles(proxy_enabled) WHERE proxy_enabled = true;

-- RLS: Los usuarios solo pueden ver/editar su propio proxy
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Política: Usuarios pueden ver su propio proxy
DROP POLICY IF EXISTS "Users can view own proxy config" ON public.profiles;
CREATE POLICY "Users can view own proxy config"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

-- Política: Usuarios pueden actualizar su propio proxy
DROP POLICY IF EXISTS "Users can update own proxy config" ON public.profiles;
CREATE POLICY "Users can update own proxy config"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id);

-- Función helper para validar configuración de proxy
CREATE OR REPLACE FUNCTION validate_proxy_config()
RETURNS TRIGGER AS $$
BEGIN
  -- Si proxy está habilitado, verificar campos requeridos
  IF NEW.proxy_enabled = true THEN
    IF NEW.proxy_host IS NULL OR NEW.proxy_host = '' THEN
      RAISE EXCEPTION 'Proxy host es requerido cuando proxy está habilitado';
    END IF;
    
    IF NEW.proxy_port IS NULL OR NEW.proxy_port < 1 OR NEW.proxy_port > 65535 THEN
      RAISE EXCEPTION 'Puerto de proxy debe estar entre 1 y 65535';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para validar configuración de proxy
DROP TRIGGER IF EXISTS validate_proxy_config_trigger ON public.profiles;
CREATE TRIGGER validate_proxy_config_trigger
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION validate_proxy_config();

-- Ejemplos de configuración:
-- 
-- Proxy básico sin autenticación:
-- UPDATE profiles SET 
--   proxy_enabled = true,
--   proxy_type = 'http',
--   proxy_host = '123.45.67.89',
--   proxy_port = 8080
-- WHERE id = 'user-uuid';
--
-- Proxy con autenticación:
-- UPDATE profiles SET 
--   proxy_enabled = true,
--   proxy_type = 'socks5',
--   proxy_host = 'proxy.brightdata.com',
--   proxy_port = 22225,
--   proxy_username = 'brd-customer-xxx',
--   proxy_password = 'your-password',
--   proxy_country = 'US'
-- WHERE id = 'user-uuid';
--
-- Proxy con rotación automática:
-- UPDATE profiles SET 
--   proxy_enabled = true,
--   proxy_rotation = true,
--   proxy_rotation_minutes = 30
-- WHERE id = 'user-uuid';
