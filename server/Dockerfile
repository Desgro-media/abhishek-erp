# Build context is the project root (see docker-compose.yml) so this can
# also copy /public — the backend serves the existing ERP frontend itself.
FROM node:20-alpine AS base
WORKDIR /app/server

# Alpine (musl libc) doesn't ship OpenSSL by default — Prisma's engine
# binary needs it at runtime, not just at generate-time, or it crashes with
# an unparseable error on migrate/seed. Must come before `prisma generate`.
RUN apk add --no-cache openssl

COPY server/package.json server/package-lock.json* ./
RUN npm install

COPY server/ ./
COPY public/ ../public/

RUN npx prisma generate
RUN npm run build

EXPOSE 4000

# Applies any pending migrations, then starts the compiled server. Migrations
# are checked into server/prisma/migrations — nothing is auto-generated here.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
