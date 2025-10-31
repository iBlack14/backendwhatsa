# 🔧 Variables de Entorno REQUERIDAS para el Backend

## ⚠️ CRÍTICO: Sin estas variables, el QR NO aparecerá en el frontend

El backend genera el QR correctamente, pero **NO puede guardarlo en Supabase** sin estas variables.

### Variables OBLIGATORIAS en Easypanel:

```env
# Supabase (CRÍTICO - Sin esto el QR no llega al frontend)
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_KEY=tu_service_role_key_aqui

# N8N (Opcional - pero recomendado)
N8N_UPDATE_WEBHOOK=https://tu-n8n.com/webhook/update-instance

# Frontend (Para webhooks de mensajes)
FRONTEND_URL=https://connect.blxkstudio.com
```

---

## 📋 Cómo obtener las credenciales de Supabase:

1. Ve a tu proyecto en Supabase: https://supabase.com/dashboard
2. **Settings** → **API**
3. Copia:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (⚠️ NO la anon key) → `SUPABASE_SERVICE_KEY`

---

## 🚀 Cómo configurar en Easypanel:

1. Ve a tu servicio backend en Easypanel
2. **Environment** → **Add Variable**
3. Agrega cada variable con su valor
4. **Redeploy** el servicio

---

## ✅ Verificación:

Después de configurar, en los logs del backend deberías ver:

```
📌 Supabase URL: Configured ✅
📌 Supabase Key: Configured ✅
✅ Updated instance [...] in Supabase - Status: 200
✅ QR saved! Frontend should receive it within 1-2 seconds.
```

Si ves "Not configured ❌", las variables NO están configuradas correctamente.
