#!/bin/bash

# =============================================
# Script de Deployment - WhatsApp Backend
# =============================================

set -e  # Exit on error

echo "🚀 Starting deployment..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ Error: .env file not found${NC}"
    echo "Create .env from .env.example and fill in the values"
    exit 1
fi

# Load environment variables
source .env

# Validate required environment variables
REQUIRED_VARS=("SUPABASE_URL" "SUPABASE_SERVICE_KEY" "NODE_ENV")

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}❌ Error: $var is not set in .env${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✅ Environment variables validated${NC}"

# Install dependencies
echo "📦 Installing dependencies..."
npm ci --production=false

# Run tests (if available)
if [ -f "package.json" ] && grep -q "\"test\"" package.json; then
    echo "🧪 Running tests..."
    npm test || echo -e "${YELLOW}⚠️  Tests failed but continuing...${NC}"
fi

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

if [ ! -d "dist" ]; then
    echo -e "${RED}❌ Build failed: dist directory not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build successful${NC}"

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p sessions
mkdir -p logs

# Clean production dependencies
echo "🧹 Cleaning dev dependencies..."
npm prune --production

# Check Docker
if command -v docker &> /dev/null; then
    echo "🐳 Docker is available"
    docker --version
else
    echo -e "${YELLOW}⚠️  Docker not found, Docker features will not work${NC}"
fi

# Backup old deployment (if exists)
if [ -d "../backendwhatsa-backup" ]; then
    echo "🗑️  Removing old backup..."
    rm -rf ../backendwhatsa-backup
fi

if [ -d "../backendwhatsa-old" ]; then
    echo "💾 Creating backup..."
    mv ../backendwhatsa-old ../backendwhatsa-backup
fi

# Health check function
health_check() {
    local url="http://localhost:${PORT:-4000}/health"
    local max_attempts=30
    local attempt=1
    
    echo "🏥 Waiting for health check..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f -s "$url" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Health check passed${NC}"
            return 0
        fi
        
        echo "Attempt $attempt/$max_attempts..."
        sleep 2
        ((attempt++))
    done
    
    echo -e "${RED}❌ Health check failed after $max_attempts attempts${NC}"
    return 1
}

# Start server based on environment
if [ "$NODE_ENV" = "production" ]; then
    echo "🚀 Starting production server..."
    
    # Stop old process if exists
    if [ -f "server.pid" ]; then
        OLD_PID=$(cat server.pid)
        if ps -p $OLD_PID > /dev/null 2>&1; then
            echo "🛑 Stopping old server (PID: $OLD_PID)..."
            kill $OLD_PID
            sleep 2
        fi
        rm server.pid
    fi
    
    # Start new process
    nohup node dist/index.js > logs/server.log 2>&1 &
    NEW_PID=$!
    echo $NEW_PID > server.pid
    
    echo "🆔 New server PID: $NEW_PID"
    
    # Wait a bit and check health
    sleep 3
    
    if health_check; then
        echo -e "${GREEN}✅ Deployment successful!${NC}"
        echo ""
        echo "Server is running on:"
        echo "  - http://localhost:${PORT:-4000}"
        echo "  - PID: $NEW_PID"
        echo ""
        echo "To view logs:"
        echo "  tail -f logs/server.log"
        echo ""
        echo "To stop server:"
        echo "  kill $NEW_PID"
        echo "  # or"
        echo "  npm run stop"
    else
        echo -e "${RED}❌ Server failed to start properly${NC}"
        echo "Check logs: tail -f logs/server.log"
        exit 1
    fi
else
    echo "🔧 Starting development server..."
    npm run dev
fi

echo ""
echo -e "${GREEN}🎉 Deployment complete!${NC}"
