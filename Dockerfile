# Uma imagem por app do monorepo. Contexto de build: raiz do repositório.
#   docker build --build-arg APP=api    -t kora-api .
#   docker build --build-arg APP=worker -t kora-worker .
# O healthcheck fica no compose: cada app checa a saúde de um jeito.

FROM node:24-alpine AS base
RUN npm install -g pnpm@11.18.0
WORKDIR /repo

FROM base AS build
ARG APP=api
# Todos os package.json do workspace: o lockfile descreve o monorepo inteiro.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/${APP} apps/${APP}
# Compila o app e os pacotes de que ele depende, depois isola só o que roda.
RUN pnpm --filter "@kora/${APP}..." build \
 && pnpm --filter "@kora/${APP}" deploy --prod /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
CMD ["node", "dist/main.js"]
