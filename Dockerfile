FROM node:20-alpine

WORKDIR /app

# Instalar dependencias de sistema necesarias
RUN apk add --no-cache python3 make g++ docker-cli

# Copiar package files
COPY package*.json ./

# Instalar TODAS las dependencias (incluyendo devDependencies para compilar)
RUN npm install

# Copiar código fuente
COPY . .

# Compilar TypeScript
RUN npm run build

# Limpiar devDependencies después de compilar
RUN npm prune --production

# Crear directorio para sesiones
RUN mkdir -p sessions

# Exponer puerto
EXPOSE 4000

# Comando de inicio
CMD ["node", "dist/index.js"]
