# Shared monorepo image; compose targets select the start command.
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY tsconfig.base.json tsconfig.json jest.config.cjs ./
RUN npm ci
RUN npm install -g tsx

FROM base AS api
ENV NODE_ENV=production
EXPOSE 3000
CMD ["tsx", "apps/api/src/main.ts"]

FROM base AS worker-http
ENV NODE_ENV=production
CMD ["tsx", "apps/worker-http/src/main.ts"]

# Browser worker needs Firefox from Playwright
FROM mcr.microsoft.com/playwright:v1.62.1-jammy AS worker-browser
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY tsconfig.base.json tsconfig.json jest.config.cjs ./
RUN npm ci
RUN npm install -g tsx
ENV NODE_ENV=production
CMD ["tsx", "apps/worker-browser/src/main.ts"]
