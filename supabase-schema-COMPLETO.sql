-- Crear extensión para UUID si no existe
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla de instancias
CREATE TABLE public.instances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  document_id text NOT NULL UNIQUE,
  user_id uuid,
  webhook_url text,
  state text DEFAULT 'Initializing'::text CHECK (state = ANY (ARRAY['Initializing'::text, 'Connected'::text, 'Disconnected'::text, 'Failure'::text])),
  is_active boolean DEFAULT true,
  message_received boolean DEFAULT false,
  message_sent boolean DEFAULT false,
  qr text,
  qr_loading boolean DEFAULT false,
  historycal_data jsonb,
  profile_name text,
  profile_pic_url text,
  phone_number text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT instances_pkey PRIMARY KEY (id),
  CONSTRAINT instances_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Tabla de planes
CREATE TABLE public.plans (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  plan_type character varying NOT NULL UNIQUE,
  name character varying NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  ram character varying NOT NULL,
  cpu integer NOT NULL,
  max_workflows integer NOT NULL,
  max_executions integer NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT plans_pkey PRIMARY KEY (id)
);

-- Tabla de productos (CORRECCIÓN AQUÍ: img text[] en vez de ARRAY)
CREATE TABLE public.products (
  id serial NOT NULL,
  name text NOT NULL,
  description text,
  price numeric DEFAULT 0,
  img text[],  -- CORREGIDO: especifica que es un array de texto
  fields jsonb DEFAULT '[]'::jsonb,
  active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT products_pkey PRIMARY KEY (id)
);

-- Tabla de perfiles
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  username text UNIQUE,
  status_plan boolean DEFAULT false,
  plan_type text DEFAULT 'free'::text CHECK (plan_type = ANY (ARRAY['free'::text, 'trial'::text, 'basic'::text, 'premium'::text])),
  plan_expires_at timestamp with time zone,
  created_by_google boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  api_key text,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Tabla de progreso de spam
CREATE TABLE public.spam_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  spam_id text NOT NULL UNIQUE,
  user_id text NOT NULL,
  total_contacts integer NOT NULL,
  current_contact integer DEFAULT 0,
  stopped boolean DEFAULT false,
  completed boolean DEFAULT false,
  started_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone,
  stopped_at timestamp with time zone,
  last_update timestamp with time zone DEFAULT now(),
  success jsonb DEFAULT '[]'::jsonb,
  errors jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT spam_progress_pkey PRIMARY KEY (id)
);

-- Tabla de suites
CREATE TABLE public.suites (
  id serial NOT NULL,
  document_id text DEFAULT (gen_random_uuid())::text UNIQUE,
  user_id uuid NOT NULL,
  name text NOT NULL,
  url text,
  activo boolean DEFAULT false,
  credencials jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  memory text,
  cpu integer,
  container_id text,
  subdomain text,
  port integer,
  status text DEFAULT 'creating'::text,
  CONSTRAINT suites_pkey PRIMARY KEY (id),
  CONSTRAINT suites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- Tabla de suscripciones de usuario
CREATE TABLE public.user_subscriptions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  instance_name character varying,
  instance_url text,
  is_active boolean DEFAULT true,
  current_workflows integer DEFAULT 0,
  current_executions integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone,
  CONSTRAINT user_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT user_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE CASCADE
);

-- Habilitar Row Level Security en todas las tablas
ALTER TABLE public.instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spam_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para profiles
CREATE POLICY "Users can view own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" 
  ON public.profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

-- Políticas RLS para instances
CREATE POLICY "Users can view own instances" 
  ON public.instances FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own instances" 
  ON public.instances FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own instances" 
  ON public.instances FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own instances" 
  ON public.instances FOR DELETE 
  USING (auth.uid() = user_id);

-- Políticas RLS para suites
CREATE POLICY "Users can view own suites" 
  ON public.suites FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own suites" 
  ON public.suites FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own suites" 
  ON public.suites FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own suites" 
  ON public.suites FOR DELETE 
  USING (auth.uid() = user_id);

-- Políticas RLS para spam_progress
CREATE POLICY "Users can view own spam progress" 
  ON public.spam_progress FOR SELECT 
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert own spam progress" 
  ON public.spam_progress FOR INSERT 
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update own spam progress" 
  ON public.spam_progress FOR UPDATE 
  USING (auth.uid()::text = user_id);

-- Políticas para products (todos pueden ver)
CREATE POLICY "Anyone can view products" 
  ON public.products FOR SELECT 
  USING (true);

-- Políticas para plans (todos pueden ver)
CREATE POLICY "Anyone can view plans" 
  ON public.plans FOR SELECT 
  USING (true);

-- Políticas para user_subscriptions
CREATE POLICY "Users can view own subscriptions" 
  ON public.user_subscriptions FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions" 
  ON public.user_subscriptions FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions" 
  ON public.user_subscriptions FOR UPDATE 
  USING (auth.uid() = user_id);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_instances_updated_at BEFORE UPDATE ON public.instances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON public.plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_spam_progress_updated_at BEFORE UPDATE ON public.spam_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_suites_updated_at BEFORE UPDATE ON public.suites
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_subscriptions_updated_at BEFORE UPDATE ON public.user_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Función para crear perfil automáticamente al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, created_by_google)
  VALUES (
    new.id,
    CASE 
      WHEN new.raw_app_meta_data->>'provider' = 'google' THEN true
      ELSE false
    END
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para crear perfil automáticamente
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Índices para mejor rendimiento
CREATE INDEX idx_instances_user_id ON public.instances(user_id);
CREATE INDEX idx_instances_document_id ON public.instances(document_id);
CREATE INDEX idx_suites_user_id ON public.suites(user_id);
CREATE INDEX idx_suites_document_id ON public.suites(document_id);
CREATE INDEX idx_spam_progress_user_id ON public.spam_progress(user_id);
CREATE INDEX idx_user_subscriptions_user_id ON public.user_subscriptions(user_id);
CREATE INDEX idx_profiles_plan_type ON public.profiles(plan_type);
CREATE INDEX idx_profiles_username ON public.profiles(username);