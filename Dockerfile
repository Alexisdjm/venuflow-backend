FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY prisma ./prisma
COPY prisma.config.ts tsconfig*.json nest-cli.json ./
COPY src ./src
# prisma.config.ts requires DATABASE_URL to load. Generate does not connect.
# This value stays in the build stage and is not the runtime database.
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV DATABASE_URL=$DATABASE_URL
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
