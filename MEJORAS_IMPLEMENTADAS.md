# Mejoras Implementadas - WhatsApp Backend

## 📋 Resumen

Se han implementado dos mejoras importantes al backend de WhatsApp:

1. **🛡️ Sistema Anti-Duplicación de Mensajes**
2. **🔐 Soporte para Mensajes "Ver una vez" (View Once)**

---

## 🛡️ Sistema Anti-Duplicación de Mensajes

### Problema Resuelto
El backend estaba procesando y guardando el mismo mensaje múltiples veces en segundos consecutivos. Esto ocurre porque WhatsApp puede enviar el mismo mensaje varias veces a través de diferentes eventos.

### Solución Implementada

#### 1. Cache en Memoria (`processedMessages`)
- Se agregó un `Map` que almacena los IDs de mensajes procesados recientemente
- Cada mensaje procesado se marca con su ID y timestamp
- Si un mensaje con el mismo ID se recibe dentro de 2 minutos, se ignora automáticamente

```typescript
// Cache: messageId -> timestamp
const processedMessages = new Map<string, number>();
```

#### 2. Limpieza Automática
- Cada 5 minutos se ejecuta una limpieza automática
- Se eliminan mensajes más antiguos de 5 minutos del cache
- Esto previene que la memoria crezca indefinidamente

```typescript
setInterval(() => {
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  for (const [messageId, timestamp] of processedMessages.entries()) {
    if (timestamp < fiveMinutesAgo) {
      processedMessages.delete(messageId);
    }
  }
}, 5 * 60 * 1000);
```

#### 3. Detección en Tiempo Real
Cuando llega un mensaje:
```typescript
// Verificar si ya fue procesado
if (messageId && processedMessages.has(messageId)) {
  const lastProcessed = processedMessages.get(messageId)!;
  const twoMinutesAgo = Date.now() - (2 * 60 * 1000);
  
  if (lastProcessed > twoMinutesAgo) {
    console.log(`[WHATSAPP] ⏭️ Skipping duplicate message: ${messageId}`);
    continue; // Saltar
  }
}

// Marcar como procesado
if (messageId) {
  processedMessages.set(messageId, Date.now());
}
```

### Logs Mejorados
Ahora verás en la consola:
```
[WHATSAPP] ⏭️ Skipping duplicate message: AC36B496E336FC8163A9BD20A776EDE9
```

---

## 🔐 Soporte para Mensajes "Ver una vez" (View Once)

### Funcionalidad
Los mensajes "Ver una vez" son mensajes (imágenes/videos) que WhatsApp envía con cifrado de extremo a extremo que solo se pueden ver una vez en la aplicación móvil.

### Implementación

#### 1. Base de Datos (Nueva migración)
Se agregaron dos campos nuevos a la tabla `messages`:

```sql
-- Indica si es un mensaje "ver una vez"
is_view_once BOOLEAN DEFAULT false

-- Timestamp de cuando se abrió (para tracking)
view_once_opened_at TIMESTAMPTZ
```

**Archivo de migración**: `migrations/add_view_once_support.sql`

Para aplicar la migración:
```bash
# En Supabase SQL Editor, ejecutar el archivo:
migrations/add_view_once_support.sql
```

#### 2. TypeScript Interface
Se actualizó la interfaz `Message`:

```typescript
export interface Message {
  // ... campos existentes ...
  is_view_once?: boolean;         // Indica si es "ver una vez"
  view_once_opened_at?: Date;     // Cuándo se abrió
}
```

#### 3. Detección Automática
El backend ahora detecta automáticamente mensajes "View Once":

```typescript
const isViewOnce = messageType.startsWith('view_once');

const savedMessage = {
  // ... otros campos ...
  is_view_once: isViewOnce,
  view_once_opened_at: undefined, // Se actualizará cuando se abra
};
```

#### 4. Logs Especiales
Cuando se detecta un mensaje "View Once":
```
[WHATSAPP] Detected type: view_once_image
[WHATSAPP] 🔐 VIEW ONCE MESSAGE DETECTED - This message can only be viewed once!
```

#### 5. Etiquetas en UI
Las etiquetas de mensaje ahora incluyen:
- `🔐 Imagen (Ver una vez)`
- `🔐 Video (Ver una vez)`

---

## 📁 Archivos Modificados

### Backend
1. **`src/whatsapp.ts`**
   - Agregado sistema de cache anti-duplicación
   - Agregado detección de mensajes "View Once"
   - Logs mejorados

2. **`src/services/message.service.ts`**
   - Actualizada interfaz `Message`
   - Agregados campos `is_view_once` y `view_once_opened_at`
   - Actualizadas etiquetas de tipos de mensaje

### Migración
3. **`migrations/add_view_once_support.sql`** (NUEVO)
   - Agrega columnas a la tabla `messages`
   - Crea índices para búsquedas rápidas
   - Actualiza mensajes existentes

---

## 🎯 Uso en Frontend

### Mostrar Mensajes "View Once"
```typescript
// Ejemplo en React/Next.js
{messages.map(message => {
  if (message.is_view_once) {
    return (
      <div className="view-once-message">
        <Icon name="lock" />
        <span>🔐 {message.message_type === 'view_once_image' ? 'Imagen' : 'Video'} (Ver una vez)</span>
        {!message.view_once_opened_at && (
          <button onClick={() => openViewOnce(message.id)}>
            Ver ahora
          </button>
        )}
        {message.view_once_opened_at && (
          <span className="expired">Visto el {formatDate(message.view_once_opened_at)}</span>
        )}
      </div>
    );
  }
  
  // Mensaje normal
  return <MessageComponent message={message} />;
})}
```

### API para Marcar como Visto
Necesitarás crear un endpoint para marcar el mensaje como visto:

```typescript
// En tu API
async function markViewOnceAsOpened(messageId: string) {
  await supabase
    .from('messages')
    .update({ view_once_opened_at: new Date().toISOString() })
    .eq('message_id', messageId)
    .eq('is_view_once', true);
}
```

---

## 🧪 Testing

### Verificar Anti-Duplicación
1. Enviar un mensaje de WhatsApp a tu instancia
2. Check los logs - debería aparecer solo una vez
3. Si WhatsApp lo envía múltiples veces, deberías ver:
   ```
   [WHATSAPP] ⏭️ Skipping duplicate message: [ID]
   ```

### Verificar View Once
1. Enviar una imagen/video "Ver una vez" desde WhatsApp móvil
2. Check los logs:
   ```
   [WHATSAPP] Detected type: view_once_image
   [WHATSAPP] 🔐 VIEW ONCE MESSAGE DETECTED
   ```
3. Verificar en la base de datos:
   ```sql
   SELECT message_id, message_type, is_view_once, view_once_opened_at
   FROM messages
   WHERE is_view_once = true;
   ```

---

## 🔧 Configuración

No se requiere configuración adicional. El sistema funciona automáticamente.

### Variables de Entorno
Asegúrate de tener configuradas:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
```

---

## 📊 Monitoreo

### Logs Importantes
Busca estos logs en tu consola:

**Anti-Duplicación:**
- `⏭️ Skipping duplicate message` - Mensaje duplicado bloqueado

**View Once:**
- `🔐 VIEW ONCE MESSAGE DETECTED` - Mensaje "ver una vez" recibido

**General:**
- `💾 Message saved` - Mensaje guardado exitosamente
- `[WHATSAPP] Contact profile image retrieved` - Foto de perfil obtenida

---

## 🚀 Próximos Pasos

### Frontend
1. Implementar UI para mensajes "View Once"
2. Agregar endpoint para marcar como visto
3. Agregar confirmación antes de abrir (solo se puede ver una vez)

### Backend
1. Agregar webhook específico para eventos "View Once"
2. Implementar auto-eliminación de media después de ser visto
3. Agregar analytics para tracking de "View Once"

---

## 🤝 Contribuir

Si encuentras bugs o tienes sugerencias:
1. Revisa los logs en la consola
2. Verifica la tabla `messages` en Supabase
3. Crea un issue con detalles del problema

---

## 📝 Notas

- El cache de mensajes se limpia automáticamente cada 5 minutos
- Los mensajes duplicados se detectan dentro de una ventana de 2 minutos
- Los mensajes "View Once" se detectan automáticamente por su tipo
- La media de "View Once" se descarga y guarda en Supabase Storage

---

**Fecha de Implementación:** 2026-01-24  
**Versión:** 1.0
