# 🐳 Configuración Final - Docker API para n8n

## ✅ Lo que se ha hecho:

1. ✅ Creado `src/services/docker.service.ts` - Servicio para gestionar Docker
2. ✅ Actualizado `src/routes.ts` - Rutas usando Docker en lugar de Easypanel API
3. ✅ Listo para desplegar

---

## 📦 Paso 1: Instalar Dependencia

```bash
cd "C:\Users\huanc\Downloads\back wazil\backendwhatsa"
npm install dockerode @types/dockerode
```

---

## 🔧 Paso 2: Configurar Variables de Entorno

En Easypanel, actualiza las variables de tu backend (**backwha**):

```env
# Mantén las que ya tienes
NODE_ENV=production
PORT=4000
SUPABASE_URL=https://blxk-supabase.1mrj9n.easypanel.host
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
N8N_UPDATE_WEBHOOK=https://blxk-n8n.1mrj9n.easypanel.host/webhook/update-instance
BACKEND_READ_TOKEN=8fK2mNp9rXwY4zQvL7jH3sT6nBcD1gFe5aW0xE9uV2iR4oP8qJ7yM3kU6hG1bS5t
BACKEND_UPDATE_INSTANCE_TOKEN=3dR9wQ2pL5nK8jH6mF4xV7cB1zT0yU9gE2aW5sO8iP3qR6kJ4hN7lM1bD0vG5fX
FRONTEND_URL=https://blxk-frontwha.1mrj9n.easypanel.host

# Nuevas variables para Docker
DOCKER_NETWORK=easypanel
BASE_DOMAIN=1mrj9n.easypanel.host
N8N_IMAGE=n8nio/n8n:latest
N8N_ENCRYPTION_KEY=TU_CLAVE_GENERADA
```

**Genera N8N_ENCRYPTION_KEY:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## 🐳 Paso 3: Configurar Docker Socket

Tu backend necesita acceso al Docker socket para crear contenedores.

En Easypanel, ve a **backwha** → **Volumes** y agrega:

**Host Path:** `/var/run/docker.sock`  
**Container Path:** `/var/run/docker.sock`

Esto permite que el backend se comunique con Docker.

---

## 🚀 Paso 4: Desplegar

```bash
git add .
git commit -m "Add Docker API integration for n8n"
git push
```

Easypanel redesplegará automáticamente.

---

## 🧪 Paso 5: Probar

### **Health Check:**
```bash
curl https://blxk-backwha.1mrj9n.easypanel.host/health
```

### **Crear Instancia:**
```bash
curl -X POST https://blxk-backwha.1mrj9n.easypanel.host/api/suite/create-n8n \
  -H "Content-Type: application/json" \
  -d '{
    "service_name": "n8n_user_final",
    "user_id": "user-123",
    "memory": "256M",
    "cpu": 256
  }'
```

**Respuesta esperada:**
```json
{
  "success": true,
  "message": "n8n instance created successfully",
  "data": {
    "containerId": "abc123...",
    "url": "https://n8n_user_final.1mrj9n.easypanel.host",
    "credentials": {
      "username": "user_user-123",
      "password": "xYz123..."
    }
  }
}
```

---

## 📊 Verificaciones:

### **1. En Docker (desde el servidor):**
```bash
docker ps | grep n8n_user_final
```

### **2. En Supabase:**
- Ve a la tabla `suites`
- Deberías ver el nuevo registro

### **3. Acceder a n8n:**
- Abre: `https://n8n_user_final.1mrj9n.easypanel.host`
- Usa las credenciales devueltas

---

## 🎯 Ventajas de Docker API:

✅ **Control Total** - Creas contenedores directamente  
✅ **Sin API Externa** - No depende de API de Easypanel  
✅ **Más Rápido** - Comunicación directa con Docker  
✅ **Más Confiable** - Menos puntos de falla  
✅ **Traefik Automático** - Los labels configuran el proxy automáticamente  

---

## 🔒 Seguridad:

El backend tiene acceso al Docker socket, lo que es poderoso pero seguro porque:
- Solo crea contenedores con configuración específica
- Usa labels de Easypanel para integración
- Los contenedores están en la red de Easypanel
- Traefik maneja SSL automáticamente

---

## 🐛 Troubleshooting:

### **Error: "Cannot connect to Docker daemon"**
→ Falta montar el Docker socket. Agrega el volumen en Easypanel.

### **Error: "Network easypanel not found"**
→ Cambia `DOCKER_NETWORK` a la red correcta (puede ser `bridge` o el nombre de tu red).

### **Error: "Permission denied"**
→ El contenedor necesita permisos para acceder al socket. Puede necesitar ejecutarse como root.

---

## ✅ Checklist Final:

- [ ] Dependencia `dockerode` instalada
- [ ] Variables de entorno configuradas
- [ ] Docker socket montado (`/var/run/docker.sock`)
- [ ] Código desplegado
- [ ] Health check funciona
- [ ] Crear instancia funciona
- [ ] Contenedor aparece en Docker
- [ ] Registro aparece en Supabase
- [ ] URL de n8n accesible

---

**¡Listo para crear instancias de n8n automáticamente con Docker!** 🐳🎉
