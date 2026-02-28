# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Stage 2: Production
FROM node:22-alpine
WORKDIR /app
# better-sqlite3 needs build tools for native module
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist dist/
COPY data/ data/
VOLUME ["/app/data"]
EXPOSE 8080
CMD ["node", "dist/index.js"]
