FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY prisma ./prisma
COPY prisma.config.ts tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache curl && addgroup -S nodejs && adduser -S venueflow -G nodejs
COPY --from=build --chown=venueflow:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=venueflow:nodejs /app/dist ./dist
COPY --from=build --chown=venueflow:nodejs /app/prisma ./prisma
COPY --from=build --chown=venueflow:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=venueflow:nodejs /app/package.json ./package.json
USER venueflow
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -f http://localhost:3000/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
