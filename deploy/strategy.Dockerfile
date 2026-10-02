FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG BASE_PATH=/english/
ENV VITE_BASE_PATH=${BASE_PATH}
RUN npm run build && npm test

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build --chown=1001:1001 /app/dist/client ./dist/client
COPY --chown=1001:1001 worker ./worker
COPY --chown=1001:1001 server ./server
COPY --chown=1001:1001 drizzle ./drizzle
COPY --chown=1001:1001 package.json ./package.json
USER 1001:1001
RUN node --input-type=module -e 'await import("./server/strategy-index.mjs")'
ENV NODE_ENV=production PORT=3100
EXPOSE 3100
CMD ["node","server/strategy-index.mjs"]
