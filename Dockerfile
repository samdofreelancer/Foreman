FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    FOREMAN_PORT=4318 \
    FOREMAN_HOST=0.0.0.0 \
    FOREMAN_ALLOW_NON_LOOPBACK_BIND=1 \
    FOREMAN_DATA_DIR=/data \
    FOREMAN_NO_OPEN=1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && mkdir -p /data \
    && chown -R node:node /app /data

COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 4318

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4318/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/cli.js"]
