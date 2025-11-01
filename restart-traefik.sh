#!/bin/bash

echo "🔄 Reiniciando Traefik para recargar configuración..."

# Encontrar el contenedor de Traefik
TRAEFIK_CONTAINER=$(docker ps --filter "name=traefik" --format "{{.Names}}" | head -n 1)

if [ -z "$TRAEFIK_CONTAINER" ]; then
  echo "❌ No se encontró el contenedor de Traefik"
  exit 1
fi

echo "📦 Contenedor encontrado: $TRAEFIK_CONTAINER"

# Reiniciar Traefik
docker restart $TRAEFIK_CONTAINER

echo "✅ Traefik reiniciado"
echo "⏳ Espera 10 segundos para que Traefik recargue la configuración..."
sleep 10
echo "✅ Listo! Prueba acceder a tu instancia de N8N ahora"
