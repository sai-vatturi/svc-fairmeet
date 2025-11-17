FROM node:20-alpine

WORKDIR /app

# Install dependencies (production only)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source
COPY src ./src

ENV NODE_ENV=production
# Cloud Run sets PORT; default to 8080
ENV PORT=8080

EXPOSE 8080

CMD ["node", "src/server.js"]
