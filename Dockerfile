# NDP MCP-Server — образ для docker-пилота
FROM node:20-alpine

WORKDIR /app

# Прод-зависимости отдельным слоем (кешируется)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

# index.js слушает PORT (default 3000), SSE-транспорт: GET /http + POST /http/messages
CMD ["node", "src/index.js"]
