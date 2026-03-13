# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app

# Build tools needed for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Remove dev dependencies, keep only production deps (with compiled native modules)
RUN npm prune --omit=dev

# Stage 2: Production
FROM node:22-alpine
WORKDIR /app

# Copy production node_modules (native modules already compiled in builder)
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/dist dist/
COPY package*.json ./
COPY data/ data/

VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
