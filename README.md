# Kora — Backend

Backend do TCC **Checkout em Stablecoins**. A proposta de arquitetura está em [`docs/Arquitetura_Backend_TCC_Checkout_Stablecoins.pdf`](docs/Arquitetura_Backend_TCC_Checkout_Stablecoins.pdf).

## Fluxo de trabalho (gitflow)

- `main`: produção. Só recebe merges de `release/*` e `hotfix/*`.
- `develop`: integração. Recebe as PRs das `feature/*`.
- `feature/<nome>`: sai de `develop` e volta por Pull Request.
- `release/x.y.z`: estabiliza `develop` antes de ir para `main`.
- `hotfix/<nome>`: sai de `main` para correções urgentes.

Commits seguem [Conventional Commits](https://www.conventionalcommits.org/pt-br/). Toda mudança entra por PR.
