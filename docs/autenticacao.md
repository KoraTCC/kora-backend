# Autenticação: decisões de segurança

Este documento registra **o que** foi feito na autenticação e **por quê**. Ele é atualizado a cada entrega.

## Visão geral

| Aspecto               | Decisão                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| Hash de senha         | scrypt (`node:crypto`) + pepper HMAC-SHA256                                  |
| Sessão                | JWT de acesso (15 min) + refresh token opaco (7 dias, rotativo)              |
| Transporte dos tokens | Cookies `httpOnly`, `Secure`, `SameSite`; nunca em `localStorage`            |
| CSRF                  | `SameSite` + checagem de `Origin` em métodos que alteram estado              |
| Abuso                 | Rate limit por IP (API e Nginx) e, no login, bloqueio por conta              |
| Rastreabilidade       | Tabela `audit_logs` com eventos de autenticação, IP e user-agent             |

## Senhas

**Algoritmo: scrypt.** É uma função de derivação de chave *memory-hard*: cada tentativa custa CPU **e** memória, o que encarece ataques com GPU/ASIC. Ela é recomendada pela OWASP como alternativa ao Argon2id e já vem no Node (`crypto.scrypt`), sem dependência nativa.

- Parâmetros: `N=2^15, r=8, p=3`. Fazem parte da tabela da OWASP, usam cerca de 32 MiB por hash e levam cerca de 200 ms. Outra opção da tabela (`N=2^17, r=8, p=1`) usa 128 MiB e limitaria logins simultâneos numa VPS pequena.
- Salt aleatório de 16 bytes por senha, contra rainbow tables e para que senhas iguais não gerem hashes iguais.
- **Pepper**: antes do scrypt, a senha passa por `HMAC-SHA256(pepper, senha)`. O pepper fica em variável de ambiente e não no banco. Quem vazar só o banco não consegue testar senhas offline.
- Unicode normalizado (NFKC): a mesma senha digitada em teclados/SOs diferentes gera o mesmo hash.
- Formato autodescritivo `scrypt$ln=15,r=8,p=3$<salt>$<hash>`. Permite aumentar o custo no futuro e refazer o hash de forma transparente no próximo login (`needsRehash`).
- Comparação em tempo constante (`timingSafeEqual`).
- Versão assíncrona do scrypt: roda no threadpool do libuv, sem travar o event loop.

**Política** (NIST SP 800-63B): de 12 a 128 caracteres, sem regras de composição ("precisa ter símbolo"), que só levam a senhas previsíveis. São recusadas senhas comuns, repetitivas, iguais ao nome ou que contenham o e-mail.

## Tokens e cookies

- **Access token**: JWT HS256 com 15 min de validade, claims `sub` (usuário), `sid` (sessão), `iss` e `aud`. Algoritmo fixado na verificação para evitar ataques de troca para `alg`.
- **Refresh token**: 32 bytes aleatórios (`base64url`), **opaco**. O banco guarda só o SHA-256: um vazamento do banco não entrega sessões válidas. A sessão tem limite absoluto de 30 dias, mesmo renovando o refresh.

| Cookie                       | Conteúdo      | Flags                                                   |
| ---------------------------- | ------------- | ------------------------------------------------------- |
| `__Host-kora_at`             | access token  | `HttpOnly; Secure; SameSite=Lax; Path=/`                |
| `__Secure-kora_rt`           | refresh token | `HttpOnly; Secure; SameSite=Strict; Path=/auth`         |

- `HttpOnly`: o JavaScript da página não lê os tokens. Um XSS não consegue roubá-los, ao contrário do que acontece com o `localStorage`.
- Prefixo `__Host-`: o navegador exige `Secure`, `Path=/` e ausência de `Domain`. O cookie fica preso ao host da API e outro subdomínio não consegue sobrescrevê-lo.
- O refresh só viaja para `/auth/*` e com `SameSite=Strict`.
- Em desenvolvimento sem HTTPS (`COOKIE_SECURE=false`), os nomes ficam sem prefixo.

## CSRF e borda HTTP

- `SameSite` bloqueia o envio de cookies em requisições vindas de outros sites.
- `OriginGuard`: POST/PUT/PATCH/DELETE com `Origin` fora da allowlist (`FRONTEND_ORIGINS`) recebem 403.
- CORS só para o frontend, com `credentials: true`.
- `helmet` (CSP, HSTS, nosniff, frame-ancestors…), `Cache-Control: no-store` nas rotas de auth.
- Nginx sobrescreve o `X-Forwarded-For`, e a API confia em exatamente 1 proxy (`TRUST_PROXY=1`). Assim o cliente não consegue forjar o IP para fugir do rate limit.
- Logs com redação de senha, tokens, cookies e `Authorization`.

## Fluxos

### Criar conta: `POST /auth/register`

1. Valida com zod (`@kora/contracts`): e-mail normalizado em minúsculas, nome e senha. Campos extras são descartados, o que impede mass assignment.
2. Aplica a política de senha.
3. Gera o hash scrypt.
4. Em **uma transação**: cria o usuário, abre a sessão (refresh token) e grava `REGISTER` na auditoria.
5. Seta os cookies e devolve só `{ id, name, email, createdAt }`.

- Rate limit: 5 cadastros/min por IP.
- **Trade-off conhecido**: e-mail duplicado devolve `409`, o que permite descobrir se um e-mail tem conta (enumeração). Evitar isso exige verificação de e-mail no cadastro, que está prevista como evolução. Até lá, o rate limit reduz o abuso.

### Sessão atual: `GET /auth/me`

O front não consegue ler os cookies (`httpOnly`), então pergunta à API se existe sessão.

1. `AccessTokenGuard` lê o cookie de acesso e valida assinatura, algoritmo (fixo em HS256), validade, `iss` e `aud`.
2. Carrega o usuário e recusa tokens emitidos antes de `password_changed_at`: trocar a senha derruba os access tokens antigos.
3. Devolve `{ user }`, ou `401 "Sessão expirada ou inválida."` em qualquer falha.

- O guard e o decorator `@CurrentUser()` servem para qualquer rota que exija login.
- **Limitação atual**: ainda não existe `POST /auth/refresh`. Quando o access token vence (15 min), `/auth/me` responde 401 e o usuário precisa entrar de novo.
