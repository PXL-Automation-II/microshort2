FROM node:26.12.1-slim

WORKDIR /app

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src/ ./src/

ENV NODE_ENV=production
EXPOSE 3000
USER node

CMD ["node", "src/index.js"]
