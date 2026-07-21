# Stage 1: Build frontend
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# dist.zip is the OTA bundle the native shell downloads via /api/bundle/*
# (same public assets the SPA serves — see server.js). Built here so every
# image ships a bundle matching its own APP_VERSION.
RUN apk add --no-cache zip && npm run build && cd dist && zip -qr /app/dist.zip .

# Stage 2: Install production deps on build platform to avoid QEMU issues
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 3: Production (runs on target platform)
FROM node:22-alpine
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# All server runtime modules live in server/ — copied wholesale, so a new
# module can never be silently dropped from the image (the old explicit
# file list was the #1 documented prod-crash trap).
COPY server ./server
COPY migrations ./migrations
COPY scripts ./scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist.zip ./dist.zip
RUN mkdir -p /data

ENV PORT=3001
ENV DB_PATH=/data/boomerang.db
EXPOSE ${PORT}
VOLUME /data

CMD ["node", "server/server.js"]
