# 🔧 Solución: Montar Docker Socket en el Backend

## Problema
El backend no puede crear contenedores Docker porque no tiene acceso al socket de Docker.

## Solución
Montar el socket de Docker en el contenedor del backend.

## Pasos en Easypanel:

### 1. Ve a tu Backend en Easypanel
- Dashboard → Projects → blxk → blxkconecct-back

### 2. Ve a la pestaña "Advanced"

### 3. En la sección "Mounts", agrega:

**Type:** Bind
**Host Path:** `/var/run/docker.sock`
**Container Path:** `/var/run/docker.sock`

### 4. Guarda y Redeploy

El backend ahora tendrá acceso a Docker y podrá crear contenedores.

## Verificación

Después del redeploy, desde el terminal del backend ejecuta:
```bash
docker ps
```

Si ves la lista de contenedores, ¡funciona!

## Variables de Entorno

Asegúrate de tener:
```env
USE_EASYPANEL_API=false
EASYPANEL_BASE_DOMAIN=qn0goj.easypanel.host
DOCKER_NETWORK=easypanel
```

## Alternativa: Si no puedes montar el socket

Si Easypanel no te permite montar el socket por seguridad, necesitarás:
1. Usar un servicio externo para crear contenedores
2. O crear los contenedores manualmente desde el host
3. O usar Docker-in-Docker (más complejo)
