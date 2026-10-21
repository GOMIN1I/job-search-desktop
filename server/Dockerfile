# Сервер поиска Job Search Desktop: ищет по расписанию, когда компьютер человека выключен.
# Сборка из корня репозитория: docker build -f server/Dockerfile -t jsd-search-server .
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY server ./server
RUN npx esbuild server/src/server.ts --bundle --platform=node --format=cjs --target=node22 --outfile=server/dist/server.js

FROM node:24-slim
WORKDIR /srv
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
COPY --from=build /app/server/dist/server.js ./server.js
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8787
USER node
CMD ["node", "server.js"]
