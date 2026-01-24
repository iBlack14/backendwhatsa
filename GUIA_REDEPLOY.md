# 🚀 GUÍA DE REDEPLOY - MENSAJES "VIEW ONCE"

## 📋 RESUMEN
Esta guía te indicará **exactamente qué hacer** para desplegar las mejoras:
1. ✅ Sistema anti-duplicación de mensajes
2. ✅ Soporte para mensajes "View Once" con múltiples aperturas

---

## 🎯 PASO 1: EJECUTAR SQL EN SUPABASE

### 1.1 Abrir Supabase SQL Editor
1. Ve a tu proyecto en [https://supabase.com](https://supabase.com)
2. En el menú izquierdo, click en **"SQL Editor"**
3. Click en **"New query"**

### 1.2 Copiar y Ejecutar el Siguiente Script

```sql
-- =====================================================
-- SCRIPT PARA EJECUTAR EN SUPABASE SQL EDITOR
-- =====================================================
-- Fecha: 2026-01-24
-- Descripción: Agrega soporte para mensajes "View Once" con múltiples aperturas
-- =====================================================

-- 1. Agregar columna is_view_once (indica si el mensaje es "ver una vez")
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS is_view_once BOOLEAN DEFAULT false;

-- 2. Agregar columna view_once_opened_times (array de timestamps de cuándo se abrió)
-- Esto permite abrir el mensaje múltiples veces y rastrear cada apertura
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS view_once_opened_times JSONB DEFAULT '[]'::jsonb;

-- 3. Crear índice para búsquedas rápidas de mensajes view once
CREATE INDEX IF NOT EXISTS idx_messages_view_once 
ON public.messages(is_view_once) 
WHERE is_view_once = true;

-- 4. Comentarios para documentación
COMMENT ON COLUMN public.messages.is_view_once IS 
'Indica si el mensaje es de tipo "ver una vez" (view once). Estos mensajes son especiales de WhatsApp.';

COMMENT ON COLUMN public.messages.view_once_opened_times IS 
'Array de timestamps (JSONB) que registra cada vez que se abrió el mensaje. Permite múltiples aperturas.';

-- 5. Actualizar mensajes existentes que tengan view_once en el tipo
UPDATE public.messages 
SET is_view_once = true 
WHERE message_type LIKE 'view_once%' 
  AND (is_view_once IS NULL OR is_view_once = false);

-- =====================================================
-- FIN DEL SCRIPT - ¡Listo para usar!
-- =====================================================
```

### 1.3 Ejecutar el Script
1. **Pega** todo el código SQL de arriba en el editor
2. Click en **"Run"** (o presiona `Ctrl + Enter`)
3. Deberías ver: **"Success. No rows returned"**

### 1.4 Verificar que Funcionó
Ejecuta esta query para verificar:

```sql
-- Verificar las nuevas columnas
SELECT 
  column_name, 
  data_type, 
  column_default
FROM information_schema.columns 
WHERE table_name = 'messages' 
  AND column_name IN ('is_view_once', 'view_once_opened_times');
```

Deberías ver 2 filas con las nuevas columnas.

---

## 🔧 PASO 2: REDEPLOY DEL BACKEND

### Opción A: Si usas un servicio de hosting (Railway, Render, etc.)

1. **Commitear los cambios a Git:**
   ```bash
   cd backendwhatsa-main
   git add .
   git commit -m "feat: agregar soporte para mensajes view once con múltiples aperturas"
   git push origin main
   ```

2. El deploy automático debería iniciar en tu plataforma

### Opción B: Si ejecutas localmente o en tu servidor

1. **Instalar dependencias (por si acaso):**
   ```bash
   cd backendwhatsa-main
   npm install
   ```

2. **Compilar TypeScript:**
   ```bash
   npm run build
   ```

3. **Reiniciar el servidor:**
   
   **Con PM2:**
   ```bash
   pm2 restart backendwhatsa
   ```
   
   **Sin PM2:**
   ```bash
   # Detener el proceso actual (Ctrl+C)
   # Luego iniciar de nuevo
   npm start
   # O
   npm run dev
   ```

---

## ✅ PASO 3: VERIFICAR QUE FUNCIONA

### 3.1 Ver los Logs del Backend

Deberías iniciar a ver estos logs cuando lleguen mensajes:

```
[WHATSAPP] Processing 1 message(s) for ddf8ba21-6d68-457c-9e47-5d6b1045e001-1769042219504
[WHATSAPP] Inbound message from 281076266172578@lid
[WHATSAPP] Detected type: text
💾 Message saved: AC36B496E336FC8163A9BD20A776EDE9
```

**Si llega un duplicado, verás:**
```
[WHATSAPP] ⏭️ Skipping duplicate message: AC36B496E336FC8163A9BD20A776EDE9
```

**Si llega un mensaje "View Once", verás:**
```
[WHATSAPP] Detected type: view_once_image
[WHATSAPP] 🔐 VIEW ONCE MESSAGE DETECTED - This message can only be viewed once!
💾 Message saved: SOME_MESSAGE_ID
```

### 3.2 Probar el Endpoint de View Once

```bash
# Marcar un mensaje como visto
curl -X POST http://localhost:3000/api/messages/mark-viewed \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "MENSAJE_ID_AQUI"
  }'
```

**Respuesta esperada (primera vez):**
```json
{
  "success": true,
  "viewedAt": "2026-01-24T22:30:00.000Z",
  "totalViews": 1,
  "allViewTimes": ["2026-01-24T22:30:00.000Z"],
  "message": "View once message opened. Total opens: 1"
}
```

**Respuesta esperada (segunda vez):**
```json
{
  "success": true,
  "viewedAt": "2026-01-24T22:31:00.000Z",
  "totalViews": 2,
  "allViewTimes": [
    "2026-01-24T22:30:00.000Z",
    "2026-01-24T22:31:00.000Z"
  ],
  "message": "View once message opened. Total opens: 2"
}
```

### 3.3 Verificar en la Base de Datos

```sql
-- Ver mensajes "view once"
SELECT 
  message_id,
  message_type,
  is_view_once,
  view_once_opened_times,
  jsonb_array_length(view_once_opened_times) as veces_abierto,
  timestamp
FROM messages 
WHERE is_view_once = true
ORDER BY timestamp DESC
LIMIT 10;
```

---

## 🎨 PASO 4: INTEGRAR EN EL FRONTEND (OPCIONAL)

Si quieres mostrar estos mensajes en tu frontend:

### 4.1 Usar el Componente React

Ya creé un componente completo en:
```
frontwaspa/components/ViewOnceMessage.tsx
```

### 4.2 Ejemplo de Uso

```tsx
import { ViewOnceMessage } from '@/components/ViewOnceMessage';

// En tu componente de chat
{messages.map(message => {
  if (message.is_view_once) {
    return (
      <ViewOnceMessage
        key={message.id}
        message={message}
        onOpen={async (messageId) => {
          // Llamar al API
          await fetch('/api/messages/mark-viewed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId })
          });
        }}
      />
    );
  }
  
  // Mensaje normal
  return <RegularMessage key={message.id} message={message} />;
})}
```

---

## 📊 ARCHIVOS MODIFICADOS

### Backend (`backendwhatsa-main`)
✅ `main.sql` - Schema actualizado con nuevas columnas
✅ `src/whatsapp.ts` - Detecta mensajes view once y anti-duplicación
✅ `src/services/message.service.ts` - Interface y guardado actualizado
✅ `src/routes/messages.routes.ts` - Endpoint para marcar como visto

### Migración
✅ `migrations/add_view_once_support.sql` - Script SQL para ejecutar

### Frontend (`frontwaspa`)
✅ `components/ViewOnceMessage.tsx` - Componente React completo

---

## 🐛 TROUBLESHOOTING

### Problema: "Column 'is_view_once' does not exist"
**Solución:** No ejecutaste el script SQL. Ve al PASO 1.

### Problema: Error al compilar TypeScript
**Solución:**
```bash
npm install
rm -rf dist
npm run build
```

### Problema: Mensajes duplicados siguen apareciendo
**Solución:** El cache se limpia cada 5 minutos. Espera un momento y los duplicados dejarán de aparecer.

### Problema: El endpoint /mark-viewed no responde
**Solución:** Verifica que el servidor esté corriendo y que hayas reiniciado después del deploy.

---

## 📞 SOPORTE

Si algo no funciona:

1. **Revisa los logs del backend** - Ahí verás los errores
2. **Verifica que ejecutaste el SQL** - Corre el query de verificación
3. **Asegúrate de haber reiniciado el servidor** - Sin esto no funcionará

---

## ✨ CARACTERÍSTICAS FINALES

### ✅ Anti-Duplicación
- Los mensajes duplicados se detectan automáticamente
- Se ignoran mensajes repetidos en una ventana de 2 minutos
- Cache se limpia automáticamente cada 5 minutos

### ✅ Mensajes "View Once"
- Se detectan automáticamente mensajes view_once_image y view_once_video
- **Puedes abrir el mensaje cuantas veces quieras** (no solo una vez)
- Cada apertura se registra con su timestamp
- El array `view_once_opened_times` guarda todas las aperturas
- Endpoint `/api/messages/mark-viewed` listo para usar

---

**¡Listo! Tu backend ahora tiene soporte completo para View Once con múltiples aperturas 🎉**
