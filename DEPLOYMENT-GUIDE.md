# 🚀 Guía de Despliegue Completo - BLXK WhatsApp

## 📋 Tabla de Contenidos
1. [Configurar Supabase](#1-configurar-supabase)
2. [Configurar N8N](#2-configurar-n8n)
3. [Configurar Backend](#3-configurar-backend)
4. [Configurar Frontend](#4-configurar-frontend)
5. [Verificación](#5-verificación)

---

## 1️⃣ Configurar Supabase

### Paso 1: Crear proyecto en Supabase
1. Ve a https://supabase.com/dashboard
2. Click en "New Project"
3. Completa los datos:
   - **Name**: blxk-whatsapp
   - **Database Password**: (guarda esto)
   - **Region**: Closest to you

### Paso 2: Ejecutar el schema SQL
1. En Supabase Dashboard → **SQL Editor**
2. Click en "New Query"
3. Copia y pega el contenido de `SUPABASE-COMPLETE-SCHEMA.sql`
4. Click en **Run** (▶️)
5. Verifica que se crearon las tablas:
   ```sql
   SELECT tablename FROM pg_tables WHERE schemaname = 'public';
   ```

### Paso 3: Obtener credenciales
1. **Settings** → **API**
2. Copia:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** → Para el frontend
   - **service_role** (⚠️ secreto) → `SERVICE_ROLE_KEY`

---

## 2️⃣ Configurar N8N

### Paso 1: Importar workflow
1. En N8N → **Workflows** → **Import from File**
2. Selecciona `n8n-workflow-update-instance.json`
3. Click en **Import**

### Paso 2: Configurar credenciales de Supabase
1. Click en el nodo "Supabase - Update Instance"
2. **Credentials** → **Create New**
3. Completa:
   - **Host**: Tu `SUPABASE_URL` (sin https://)
   - **Service Role Key**: Tu `SERVICE_ROLE_KEY`
4. **Save**

### Paso 3: Activar el workflow
1. Click en el toggle **Active** (arriba a la derecha)
2. Copia la URL del webhook:
   ```
   https://tu-n8n.com/webhook/update-instance
   ```

---

## 3️⃣ Configurar Backend

### Variables de entorno en Easypanel:

```env
# Supabase (CRÍTICO)
SUPABASE_URL=https://tu-proyecto.supabase.co
SERVICE_ROLE_KEY=eyJhbGc...tu_service_role_key

# N8N (Opcional pero recomendado)
N8N_UPDATE_WEBHOOK=https://tu-n8n.com/webhook/update-instance

# Frontend (Para webhooks)
FRONTEND_URL=https://connect.blxkstudio.com

# Node
NODE_ENV=production
PORT=3000
```

### Verificación:
Después del deploy, en los logs deberías ver:
```
✅ Docker connection initialized
📌 Supabase URL: Configured ✅
📌 Supabase Key: Configured ✅
🔄 Restoring existing sessions...
```

---

## 4️⃣ Configurar Frontend

### Variables de entorno en Easypanel:

```env
# NextAuth
NEXTAUTH_URL=https://connect.blxkstudio.com
NEXTAUTH_SECRET=tu_secret_aqui

# Supabase (público)
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...tu_anon_key

# Backend
NEXT_PUBLIC_BACKEND_URL=https://api.connect.blxkstudio.com
NEXT_PUBLIC_BACKEND_READ_TOKEN=tu_token_aqui

# N8N
NEXT_PUBLIC_N8N_WEBHOOK_URL=https://tu-n8n.com/webhook/create-instance

# Node
NODE_ENV=production
PORT=3000
```

---

## 5️⃣ Verificación

### ✅ Checklist de verificación:

#### Supabase
- [ ] Todas las tablas creadas
- [ ] RLS habilitado
- [ ] Políticas creadas
- [ ] Triggers funcionando

#### N8N
- [ ] Workflow importado
- [ ] Credenciales de Supabase configuradas
- [ ] Workflow activado
- [ ] URL del webhook copiada

#### Backend
- [ ] Variables de entorno configuradas
- [ ] Logs muestran "Configured ✅"
- [ ] Servidor iniciado correctamente

#### Frontend
- [ ] Variables de entorno configuradas
- [ ] Build exitoso
- [ ] Sin errores en logs

### 🧪 Prueba completa:

1. **Crear instancia**:
   - Ve al frontend
   - Click en "Nueva Instancia"
   - Espera 1-2 segundos

2. **Verificar QR**:
   - El QR debería aparecer rápidamente
   - En logs del backend:
     ```
     📱 QR CODE GENERATED FOR: [id]
     💾 Saving QR to database...
     ✅ QR saved!
     ```

3. **Escanear QR**:
   - Abre WhatsApp
   - Ajustes → Dispositivos vinculados
   - Escanea el QR

4. **Verificar conexión**:
   - Estado debería cambiar a "Connected"
   - Nombre y foto de perfil deberían aparecer

---

## 🆘 Troubleshooting

### Problema: QR no aparece en frontend
**Solución**:
1. Verifica logs del backend: `📌 Supabase URL: Configured ✅`
2. Si dice "Not configured ❌", revisa variables de entorno
3. Verifica que N8N esté activo

### Problema: Error "SUPABASE_SERVICE_KEY not found"
**Solución**:
1. Verifica que la variable se llame `SERVICE_ROLE_KEY` o `SUPABASE_SERVICE_KEY`
2. Redeploy del backend

### Problema: Logs muestran "npm error signal SIGTERM"
**Solución**:
1. Aumentar memoria del contenedor a 512MB
2. Verificar que el puerto no esté hardcodeado

---

## 📞 Soporte

Si tienes problemas:
1. Revisa los logs del servicio con problemas
2. Verifica que todas las variables de entorno estén configuradas
3. Asegúrate de que los servicios estén en la misma red (si aplica)

---

## 🎉 ¡Listo!

Tu sistema BLXK WhatsApp debería estar funcionando correctamente.

**Timeline esperado:**
- ⏱️ T+0s: Usuario crea instancia
- ⏱️ T+0.5s: Backend genera QR
- ⏱️ T+0.6s: Backend guarda en Supabase
- ⏱️ T+1s: Frontend muestra QR
- ⏱️ T+1s: 🎉 Usuario puede escanear

**Antes:** 5-10 segundos  
**Ahora:** 1-2 segundos ⚡
