FROM node:22-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @securelab/shared build
RUN pnpm --filter @securelab/host build

FROM nginx:1.27-alpine AS runtime
COPY apps/host/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/host/dist /usr/share/nginx/html

EXPOSE 8080
