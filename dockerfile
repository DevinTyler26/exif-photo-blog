FROM node:18-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY . .
RUN pnpm install
RUN npm run build

FROM node:18-alpine AS production
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]