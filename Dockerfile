# Stage 1: Build frontend
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js db.js ./
COPY --from=build /app/dist ./dist
RUN mkdir -p /data

ENV PORT=3001
ENV DB_PATH=/data/boomerang.db
EXPOSE ${PORT}
VOLUME /data

CMD ["node", "server.js"]
