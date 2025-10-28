# Multi-stage build for client/server architecture
FROM node:18-alpine AS base
# Install system dependencies including build tools for native modules
RUN apk add --no-cache \
    curl \
    dumb-init \
    python3 \
    py3-setuptools \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Create app user for security with explicit group membership
RUN addgroup -g 1001 -S nodejs && \
    adduser -S albumfinder -u 1001 -G nodejs

# Build client stage
FROM base AS client-builder
WORKDIR /app/client
# Copy client package files
COPY client/package*.json ./
RUN npm ci
# Copy client source (including new modular structure)
COPY client/ ./
RUN npm run build

# Build server dependencies stage
FROM base AS server-deps
WORKDIR /app/server
# Copy server package files
COPY server/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM base AS production
WORKDIR /app

# Copy server dependencies
COPY --from=server-deps --chown=albumfinder:nodejs /app/server/node_modules ./server/node_modules

# Copy server source - includes existing modular structure
COPY --chown=albumfinder:nodejs server/ ./server/

# Copy built client assets to server's public directory
COPY --from=client-builder --chown=albumfinder:nodejs /app/client/dist ./server/public

# Copy root package.json if it exists (for compatibility)
COPY --chown=albumfinder:nodejs package*.json ./

# Set working directory to server
WORKDIR /app/server

# Create logs directory for potential logging
RUN mkdir -p logs && chown albumfinder:nodejs logs

# Create data directory as mount point
# NOTE: Actual permissions will be set by the init container in docker-compose
RUN mkdir -p /app/server/data && chown albumfinder:nodejs /app/server/data

# Health check - using the correct port environment variable
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/healthz || exit 1

# ✅ SECURITY: Always run as non-root user (no entrypoint needed!)
USER albumfinder

# Expose port
EXPOSE ${PORT:-3000}

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the server
CMD ["node", "app.js"]
