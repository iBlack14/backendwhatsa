# 🤖 Backend de WhatsApp con Baileys

Backend para gestionar sesiones de WhatsApp usando Baileys.

## 🚀 Inicio Rápido

### 1. Instalar dependencias

```bash
cd backend
npm install
```

### 2. Configurar variables de entorno

Copia `.env.example` a `.env` y ajusta los valores:

```bash
cp .env.example .env
```

Edita `.env`:
```env
PORT=4000
N8N_UPDATE_WEBHOOK=https://blxk-n8n.1mrj9n.easypanel.host/webhook/update-instance
SUPABASE_URL=https://blxk-supabase.1mrj9n.easypanel.host
SUPABASE_SERVICE_KEY=tu_service_key_aqui
```

**Nota**: El backend ahora actualiza Supabase directamente como respaldo si N8N falla.

### 3. Iniciar el servidor

**Modo desarrollo:**
```bash
npm run dev
```

**Modo producción:**
```bash
npm run build
npm start
```

---

## 📡 API Endpoints

### Health Check
```bash
GET /health
```

Respuesta:
```json
{
  "status": "ok",
  "message": "WhatsApp Backend is running",
  "timestamp": "2025-01-20T20:00:00.000Z"
}
```

### Crear Sesión
```bash
POST /api/create-session
Content-Type: application/json

{
  "clientId": "user-123"
}
```

Respuesta:
```json
{
  "success": true,
  "message": "Session created successfully",
  "clientId": "user-123"
}
```

### Obtener QR
```bash
GET /api/qr/:clientId
```

Respuesta:
```json
{
  "qr": "data:image/png;base64,...",
  "state": "Initializing",
  "phoneNumber": null,
  "profileName": null
}
```

### Listar Sesiones
```bash
GET /api/sessions
```

Respuesta:
```json
{
  "success": true,
  "count": 2,
  "sessions": [
    {
      "clientId": "user-123",
      "state": "Connected",
      "phoneNumber": "1234567890",
      "profileName": "John Doe",
      "hasQR": false
    }
  ]
}
```

### Enviar Mensaje
```bash
POST /api/send-message
Content-Type: application/json

{
  "clientId": "user-123",
  "to": "1234567890",
  "message": "Hola desde la API!"
}
```

Respuesta:
```json
{
  "success": true,
  "message": "Message sent successfully"
}
```

### Desconectar Sesión
```bash
POST /api/disconnect/:clientId
```

Respuesta:
```json
{
  "success": true,
  "message": "Session disconnected successfully"
}
```

---

## 🧪 Probar el Backend

### 1. Health Check
```bash
curl http://localhost:4000/health
```

### 2. Crear sesión de prueba
```bash
curl -X POST http://localhost:4000/api/create-session \
  -H "Content-Type: application/json" \
  -d '{"clientId": "test-123"}'
```

Verás un **QR code en la terminal**. Escanéalo con WhatsApp.

### 3. Obtener QR
```bash
curl http://localhost:4000/api/qr/test-123
```

### 4. Enviar mensaje de prueba
```bash
curl -X POST http://localhost:4000/api/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "test-123",
    "to": "1234567890",
    "message": "Hola desde la API!"
  }'
```

---

## 📁 Estructura del Proyecto

```
backend/
├── src/
│   ├── index.ts          # Servidor Express
│   ├── whatsapp.ts       # Lógica de Baileys
│   ├── routes.ts         # Rutas de la API
│   └── types.ts          # Tipos TypeScript
├── sessions/             # Sesiones de WhatsApp (auto-generado)
├── .env.example          # Ejemplo de variables de entorno
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔗 Integración con N8N

El backend se comunica automáticamente con N8N para actualizar el estado de las instancias:

- **QR generado** → N8N → Supabase
- **Conexión exitosa** → N8N → Supabase
- **Desconexión** → N8N → Supabase

---

## 🆘 Troubleshooting

### Error: "Cannot find module '@whiskeysockets/baileys'"
```bash
npm install @whiskeysockets/baileys @hapi/boom
```

### Error: "Port 4000 already in use"
Cambia el puerto en `.env`:
```env
PORT=5000
```

### QR no se genera
- Verifica que N8N esté activo
- Revisa los logs del backend
- Verifica la URL de N8N en `.env`

### Sesión se desconecta constantemente
- Verifica tu conexión a internet
- Asegúrate de que WhatsApp esté actualizado
- Revisa los logs para ver el error específico

---

## 📊 Logs

El backend muestra logs detallados:

```
🔄 Creating session for user-123...
📱 QR Code generated for user-123
✅ Connection opened for user-123
📞 Phone: 1234567890
👤 Name: John Doe
✅ Updated instance user-123 in N8N
📤 Sending message to 9876543210 from user-123
✅ Message sent successfully
```

---

## 🚀 Próximos Pasos

1. ✅ Backend funcionando
2. ⏳ Conectar con el frontend Next.js
3. ⏳ Probar crear instancia desde la UI
4. ⏳ Probar enviar mensajes desde la UI

---

¡Listo! Tu backend de WhatsApp está configurado 🎉
