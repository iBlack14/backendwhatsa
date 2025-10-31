# 🔧 Variables de Entorno para el Backend

## ⚠️ CRÍTICO: Sin estas variables, el QR NO aparecerá en el frontend

El backend genera el QR correctamente, pero **NO puede guardarlo en Supabase** sin estas variables.

---

## Variables OBLIGATORIAS

```env
# Supabase (CRÍTICO - Sin esto el QR no llega al frontend)
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_KEY=tu_service_role_key_aqui
# También acepta: SERVICE_ROLE_KEY=tu_service_role_key_aqui

# Frontend (Para webhooks de mensajes)
FRONTEND_URL=https://connect.blxkstudio.com

# Node
NODE_ENV=production
PORT=3000
```

---

## Variables OPCIONALES

```env
# N8N (Opcional - El sistema funciona perfectamente sin esto)
N8N_UPDATE_WEBHOOK=https://tu-n8n.com/webhook/update-instance
```

> **NOTA**: N8N es completamente opcional. El backend actualiza Supabase directamente.
> Solo configura N8N si necesitas procesamiento adicional o integraciones.

---

## 📋 Cómo obtener las credenciales de Supabase

1. Ve a tu proyecto en Supabase: https://supabase.com/dashboard
2. **Settings** → **API**
3. Copia:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (⚠️ NO la anon key) → `SUPABASE_SERVICE_KEY`

---

## 🚀 Cómo configurar en Easypanel

1. Ve a tu servicio backend en Easypanel
2. **Environment** → **Add Variable**
3. Agrega cada variable con su valor
4. **Redeploy** el servicio

---

## ✅ Verificación

Después de configurar, en los logs del backend deberías ver:

```
📌 Supabase URL: Configured ✅
📌 Supabase Key: Configured ✅
✅ Updated instance [...] in Supabase - Status: 204
✅ QR saved! Frontend should receive it within 1-2 seconds.
```

Si N8N está configurado, también verás:
```
✅ Also updated via N8N
```

Si N8N NO está configurado o falla:
```
ℹ️ N8N update skipped (not critical): [razón]
```

---

## 🆘 Troubleshooting

### Error: "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set"
**Solución**: Verifica que las variables estén configuradas correctamente en Easypanel.

### Error: "Not configured ❌"
**Solución**: Las variables no están llegando al contenedor. Verifica:
1. Que los nombres sean exactos (case-sensitive)
2. Que hayas hecho redeploy después de agregar las variables
3. Que no haya espacios extra en los valores

### N8N genera errores
**Solución**: No te preocupes, N8N es opcional. El sistema funciona sin él.
Si quieres deshabilitarlo, simplemente elimina la variable `N8N_UPDATE_WEBHOOK`.
