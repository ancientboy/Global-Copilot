FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
FROM node:24.19.0-bookworm-slim
RUN npm install --global @openai/codex@0.160.0 && mkdir /data && chown node:node /data
WORKDIR /app
COPY --from=build /app/dist/client ./dist/client
COPY --from=build /app/server ./server
COPY --from=build /app/worker ./worker
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json
USER node
ENV DATA_DIR=/data PORT=3000
EXPOSE 3000
CMD ["node","server/index.mjs"]
