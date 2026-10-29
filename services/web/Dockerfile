# Stage 1: build the static dashboard (TypeScript + Vite). Only dev
# dependencies are needed here; nothing from this stage except dist/ ships.
FROM node:26.12.1-slim AS build
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json components.json ./
COPY public/ ./public/
COPY src/ ./src/
RUN npm run build

# Stage 2: the runtime image is the tiny Express server plus dist/.
FROM node:26.12.1-slim
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server.js ./
COPY --chown=node:node --from=build /build/dist/ ./dist/

ENV NODE_ENV=production
EXPOSE 3001
USER node
CMD ["node", "server.js"]
