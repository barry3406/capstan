FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npx capstan build --target node-standalone

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist/standalone/package.json ./package.json
RUN npm install --omit=dev

COPY --from=builder /app/dist/standalone/dist ./dist

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV CAPSTAN_HOST=0.0.0.0

CMD ["node", "dist/_capstan_server.js"]
