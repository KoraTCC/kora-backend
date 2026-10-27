# Kora — Backend

Backend do TCC **Checkout em Stablecoins**. A proposta de arquitetura está em [`docs/arquitetura.md`](docs/arquitetura.md).

## Fluxo de trabalho (gitflow)

- `main`: produção. Só recebe merges de `release/*` e `hotfix/*`.
- `develop`: integração. Recebe as PRs das `feature/*`.
- `feature/<nome>`: sai de `develop` e volta por Pull Request.
- `release/x.y.z`: estabiliza `develop` antes de ir para `main`.
- `hotfix/<nome>`: sai de `main` para correções urgentes.

Commits seguem [Conventional Commits](https://www.conventionalcommits.org/pt-br/). Toda mudança entra por PR.

## Estrutura

```
apps/api/            API NestJS (TypeORM + PostgreSQL)
packages/contracts/  Schemas zod e tipos compartilhados com o frontend
infra/docker/        docker-compose de desenvolvimento e de produção (sem proxy: o Nginx é da VPS)
docs/                Arquitetura e guia de deploy
```

## Rodando localmente

Requisitos: Node 24+, pnpm 11 e Docker.

```bash
pnpm install
docker compose -f infra/docker/docker-compose.dev.yml up -d   # Postgres + Mailpit
cp apps/api/.env.example apps/api/.env
pnpm --filter @kora/api migration:run
pnpm --filter @kora/api start:dev                               # http://localhost:3000/health
```

- Mailpit (e-mails de desenvolvimento): http://localhost:8025
- Testes: `pnpm test` (unitários) e `pnpm test:e2e` (usam o banco `kora_test` do compose de dev)
- Nova migration: `pnpm --filter @kora/api migration:generate src/database/migrations/<Nome>`. Depois registre a classe em `src/database/migrations/index.ts`.

## Deploy

Veja [`docs/deploy.md`](docs/deploy.md). As decisões de segurança da autenticação estão em [`docs/autenticacao.md`](docs/autenticacao.md).
