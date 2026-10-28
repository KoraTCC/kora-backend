# Autenticação: decisões de segurança

Este documento registra **o que** foi feito na autenticação e **por quê**. Ele é atualizado a cada entrega.

## Visão geral

| Aspecto               | Decisão                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| Hash de senha         | Argon2id (`node:crypto`) com pepper no parâmetro `secret`                    |
| Sessão                | JWT de acesso (15 min) + refresh token opaco (7 dias, rotativo)              |
| Transporte dos tokens | Cookies `httpOnly`, `Secure`, `SameSite`; nunca em `localStorage`            |
| CSRF                  | `SameSite` + checagem de `Origin` em métodos que alteram estado              |
| Abuso                 | Rate limit por IP na API e, no login, bloqueio por conta                     |
| Rastreabilidade       | Tabela `audit_logs` com eventos de autenticação, IP e user-agent             |

## Senhas

**Algoritmo: Argon2id.** Venceu a Password Hashing Competition (2015), é padronizado na RFC 9106 e é a primeira recomendação da OWASP para senhas. É *memory-hard*: cada tentativa custa CPU **e** memória, o que encarece ataques com GPU/ASIC. A variante `id` combina a resistência a ataques de canal lateral do Argon2i com a resistência a GPU do Argon2d. O Node 24.7+ traz Argon2 nativo (`crypto.argon2`), então não há dependência externa nem binário nativo para compilar. bcrypt foi descartado: limita a senha a 72 bytes e não é *memory-hard*.

- Parâmetros: `m=19 MiB, t=2, p=1`, a configuração mínima recomendada pela OWASP. Leva cerca de 80 ms por hash e cabe numa VPS de 1 vCPU com vários logins simultâneos.
- Salt aleatório de 16 bytes por senha, contra rainbow tables e para que senhas iguais não gerem hashes iguais.
- **Pepper**: vai no parâmetro `secret` do próprio Argon2 (RFC 9106, seção 3.1). Fica em variável de ambiente e não no banco: quem vazar só o banco não consegue testar senhas offline.
- Unicode normalizado (NFKC, `normalizePassword` de `@kora/contracts`) antes do tamanho, da política e do hash: representações compatíveis não contornam a política e a mesma senha digitada em teclados/SOs diferentes gera o mesmo hash.
- Formato PHC padrão: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`, o mesmo de outras bibliotecas de Argon2. Permite aumentar o custo no futuro e refazer o hash de forma transparente no próximo login (`needsRehash`).
- Comparação em tempo constante (`timingSafeEqual`).
- Versão assíncrona: roda no threadpool do libuv, sem travar o event loop.

**Migração do scrypt.** As primeiras contas foram criadas com scrypt (`scrypt$ln=15,r=8,p=3$...`). Esses hashes continuam aceitos no login; como `needsRehash` devolve true para eles, o login regrava a senha em Argon2id. É o mesmo mecanismo que serve para subir o custo do Argon2 no futuro. O código do scrypt pode ser removido quando não houver mais nenhum `scrypt$` em `users.password_hash`.

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
- O Nginx da VPS precisa sobrescrever o `X-Forwarded-For` (ver `docs/deploy.md`), e a API confia em exatamente 1 proxy (`TRUST_PROXY=1`). Assim o cliente não consegue forjar o IP para fugir do rate limit.
- Logs com redação de senha, tokens, cookies e `Authorization`.

## Fluxos

### Criar conta: `POST /auth/register`

1. Valida com zod (`@kora/contracts`): e-mail normalizado em minúsculas, nome e senha. Campos extras são descartados, o que impede mass assignment.
2. Aplica a política de senha.
3. Gera o hash Argon2id.
4. Em **uma transação**: cria o usuário, abre a sessão (refresh token) e grava `REGISTER` na auditoria.
5. Seta os cookies e devolve só `{ id, name, email, createdAt }`.

- Rate limit: 5 cadastros/min por IP.
- **Trade-off conhecido**: e-mail duplicado devolve `409`, o que permite descobrir se um e-mail tem conta (enumeração). Evitar isso exige verificação de e-mail no cadastro, que está prevista como evolução. Até lá, o rate limit reduz o abuso.

### Entrar: `POST /auth/login`

1. Valida com zod (`loginSchema`): e-mail normalizado e senha de até 128 caracteres. A política de senha não é aplicada no login, para não revelar regras sobre contas que já existem.
2. Busca o usuário pelo e-mail. Se não existir, roda o Argon2id contra um hash fictício: o tempo de resposta é o mesmo de um e-mail cadastrado.
3. Conta travada (`locked_until` no futuro) é recusada sem nem testar a senha.
4. Senha errada soma uma falha com um `UPDATE` atômico (sem corrida entre requisições paralelas). Na **5ª falha seguida** a conta trava por **15 minutos** e o contador zera.
5. Senha certa: zera falhas e bloqueio, refaz o hash se ele for scrypt ou se os parâmetros do Argon2id mudaram (`needsRehash`) e, em **uma transação**, abre a sessão e grava `LOGIN_SUCCESS`.
6. Seta os mesmos cookies do cadastro e devolve `{ user }`.

- E-mail inexistente, senha errada e conta travada devolvem a **mesma** resposta: `401 "E-mail ou senha incorretos."`. Assim o login não serve para descobrir quais e-mails têm conta.
- Auditoria: `LOGIN_FAILURE` (com `reason`: `unknown_email`, `wrong_password` ou `locked`), `ACCOUNT_LOCKED` e `LOGIN_SUCCESS`.
- Rate limit: 10 tentativas/min por IP, somado ao bloqueio por conta.
- **Trade-off conhecido**: quem souber um e-mail pode travar a conta de propósito errando a senha 5 vezes. O bloqueio é curto (15 min) para limitar esse dano.

### Sessão atual: `GET /auth/me`

O front não consegue ler os cookies (`httpOnly`), então pergunta à API se existe sessão.

1. `AccessTokenGuard` lê o cookie de acesso e valida assinatura, algoritmo (fixo em HS256), validade, `iss` e `aud`.
2. Carrega o usuário e recusa tokens emitidos antes de `password_changed_at`: trocar a senha derruba os access tokens antigos.
3. Devolve `{ user }`, ou `401 "Sessão expirada ou inválida."` em qualquer falha.

- O guard e o decorator `@CurrentUser()` servem para qualquer rota que exija login.

### Renovar a sessão: `POST /auth/refresh`

O access token dura 15 min. Quando a API responde 401, o front chama esta rota uma vez e repete a requisição original.

1. Lê o refresh token do cookie (que só viaja para `/auth/*`, com `SameSite=Strict`) e busca o SHA-256 dele no banco, com lock de linha: renovações simultâneas do mesmo token são serializadas.
2. Token inexistente, vencido ou além do limite absoluto da sessão (30 dias): 401.
3. **Rotação**: em uma transação, emite um refresh novo na mesma família, revoga o usado (`revoked_at`) e aponta para o sucessor (`replaced_by_id`). Também emite um access token novo.
4. **Detecção de reuso**: se chegar um token que já foi rotacionado, alguém tem uma cópia dele. A família inteira é revogada e o evento `REFRESH_REUSE` vai para a auditoria. O ladrão e a vítima precisam entrar de novo, e só a vítima sabe a senha.
5. Em qualquer falha, os cookies são apagados e a resposta é `401 "Sessão expirada ou inválida."`.

- **Janela de tolerância (10 s)**: duas abas podem renovar ao mesmo tempo com o mesmo token. Um token rotacionado há menos de 10 s é só recusado, sem derrubar a família. Essa recusa não apaga os cookies: a aba que perdeu a corrida usa os cookies novos que a outra resposta gravou e repete a requisição.
- Rate limit: 30 renovações/min por IP.
- **Limitação conhecida**: depois de um reuso, os access tokens já emitidos para a família continuam válidos até vencer (no máximo 15 min). O `AccessTokenGuard` não consulta o banco de sessões, para não pagar uma consulta a cada requisição.

### Encerrar a sessão: `POST /auth/logout`

1. Lê o refresh token do cookie e localiza sua família no banco com lock de linha.
2. Revoga todos os refresh tokens ainda ativos da família.
3. Registra `LOGOUT` na auditoria e apaga os cookies de acesso e refresh.
4. Responde `204` mesmo quando o cookie está ausente ou já é inválido, mantendo o logout idempotente.

- O endpoint não depende de um access token válido, então também funciona quando o JWT curto já expirou.
- Como o access token é stateless, uma cópia dele pode continuar válida até sua expiração, por no máximo 15 minutos.

### Esqueceu a senha: `POST /auth/password/forgot` e `POST /auth/password/reset`

**Pedido (`forgot`)**
1. Responde **sempre `202 { ok: true }`**, exista ou não a conta. Assim, a rota não serve para descobrir quais e-mails estão cadastrados.
2. Se a conta existe, numa transação:
   - invalida os links anteriores, para que só o mais recente valha;
   - gera um token de 32 bytes aleatórios e guarda **só o SHA-256** dele, com validade de **30 minutos**;
   - grava `PASSWORD_RESET_REQUESTED` na auditoria.
3. O e-mail com o link `APP_URL/reset-password?token=…` é enviado **em segundo plano**. Esperar o SMTP faria a resposta demorar mais quando a conta existe, o que entregaria a informação pelo tempo de resposta.

**Redefinição (`reset`)**
1. Valida a nova senha (tamanho, política de senha) e gera o hash Argon2id **fora** da transação.
2. Numa transação, com **lock de linha no token**, para que dois envios do mesmo link não o usem duas vezes:
   - confere se o token não foi usado e não expirou;
   - marca o token como usado;
   - grava a nova senha e atualiza `password_changed_at`, o que derruba os access tokens já emitidos;
   - zera o bloqueio por tentativas;
   - **revoga todas as sessões** (refresh tokens);
   - grava `PASSWORD_RESET_COMPLETED` na auditoria.
3. Envia um aviso de "sua senha foi alterada" e limpa os cookies do navegador.

- **Rate limit:** 5 pedidos/min e 10 redefinições/min por IP.
- **Link inválido, usado ou expirado:** `400 "Link inválido ou expirado. Peça um novo."`, sem dizer qual dos três casos aconteceu.
