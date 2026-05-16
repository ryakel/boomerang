# Stage 1: Build frontend
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

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
COPY server.js db.js seed.js emailNotifications.js pushNotifications.js pushoverNotifications.js digestBuilder.js notifAi.js userTime.js gmailSync.js weatherSync.js notionMCP.js patternDetection.js ./
COPY adviserTools.js adviserToolsTasks.js adviserToolsIntegrations.js adviserToolsMisc.js ./
COPY migrations ./migrations
COPY scripts ./scripts
COPY --from=build /app/dist ./dist
RUN mkdir -p /data

ENV PORT=3001
ENV DB_PATH=/data/boomerang.db
EXPOSE ${PORT}
VOLUME /data

CMD ["node", "server.js"]
