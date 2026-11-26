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
- **Revogação imediata**: o `AccessTokenGuard` também confere se a sessão (`sid` do JWT) ainda tem refresh token ativo. Logout, "encerrar sessão", redefinição de senha e reuso de refresh derrubam o access token **na hora**, sem esperar os 15 min. O custo é uma consulta indexada por requisição.

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
   - grava `PASSWORD_RESET_REQUESTED` na auditoria;
   - coloca na fila (job `send_email`) o e-mail com o link `APP_URL/reset-password?token=…`.
3. Quem envia é o `apps/worker` (ver [worker.md](worker.md)). A API não espera o SMTP: isso faria a resposta demorar mais quando a conta existe, o que entregaria a informação pelo tempo de resposta. Como o job entra na mesma transação do token, não existe token sem e-mail nem e-mail sem token, e um SMTP fora do ar só atrasa o envio (retentativa).

**Redefinição (`reset`)**
1. Valida a nova senha (tamanho, política de senha) e gera o hash Argon2id **fora** da transação.
2. Numa transação, com **lock de linha no token**, para que dois envios do mesmo link não o usem duas vezes:
   - confere se o token não foi usado e não expirou;
   - marca o token como usado;
   - grava a nova senha e atualiza `password_changed_at`, o que derruba os access tokens já emitidos;
   - zera o bloqueio por tentativas;
   - **revoga todas as sessões** (refresh tokens);
   - grava `PASSWORD_RESET_COMPLETED` na auditoria.
3. Coloca na fila, na mesma transação, o aviso de "sua senha foi alterada", e limpa os cookies do navegador.

- **Rate limit:** 5 pedidos/min e 10 redefinições/min por IP.
- **Link inválido, usado ou expirado:** `400 "Link inválido ou expirado. Peça um novo."`, sem dizer qual dos três casos aconteceu.

### Sessões ativas: `GET /sessions`, `DELETE /sessions/:id`, `DELETE /sessions/others`

- Cada sessão é uma família de refresh tokens. A lista mostra o token mais recente de cada família ativa: dispositivo (deduzido do user-agent), IP e último uso. A sessão atual é identificada pelo `sid` do access token.
- Encerrar uma sessão revoga a família inteira, e o dispositivo cai na próxima requisição. Sessão de outra pessoa responde 404.
- `GET /security/access-log` lista as últimas tentativas de login (sucesso ou falha), vindas da `audit_logs`.
- Não há geolocalização por IP: a API mostra "Local não identificado" em vez de inventar uma cidade.

### Chaves de API: `/api-keys`

- A **chave secreta** (`sk_test_…`, 32 bytes aleatórios) aparece **uma única vez**, na criação ou na rotação. O banco guarda só o SHA-256 e o começo/fim (`sk_test_91be…59d0`) para exibir. Mesmo critério dos refresh tokens: se o banco vazar, as chaves não vazam.
- A **chave publicável** (`pk_test_…`) é pública por definição e fica inteira. Ela é criada no primeiro acesso.
- Rotacionar revoga a secreta mais recente e cria outra numa transação. Limite de 5 secretas ativas. Criação e revogação vão para a auditoria.
- Ainda não existe autenticação de requisições por chave de API: `lastUsedAt` e `callsLast7d` ficam vazios até isso entrar.

### Verificação em duas etapas (2FA): `/auth/2fa/*`

**Método:** app autenticador (TOTP, RFC 6238): Google Authenticator, Authy, 1Password…

- Código de 6 dígitos que muda a cada 30 s. É HMAC-SHA1 sobre o número do período, implementado com `node:crypto` e testado com os vetores oficiais da RFC 6238.
- Funciona sem internet no celular e **não depende do e-mail**. Isso importa: o e-mail já é a porta da redefinição de senha, então um código por e-mail protegeria pouco.
- Aceita o período atual e um de cada lado, para o relógio do celular um pouco fora de hora.
- **Anti-replay:** a API guarda o último período aceito (`two_factor_last_step`). O mesmo código não entra duas vezes, nem dentro dos 30 s. O consumo é um `UPDATE` condicional, então duas requisições simultâneas com o mesmo código não passam juntas.

**Ativação** (com o usuário logado):
1. `POST /auth/2fa/setup` gera o segredo **pendente** e devolve a URI `otpauth://` para o QR code, mais a chave para digitar à mão. Ainda não vale para o login.
2. `POST /auth/2fa/enable { code }`: o primeiro código prova que o app foi configurado certo. O 2FA passa a valer e a API devolve **10 códigos de recuperação**, mostrados uma única vez.

**Segredo cifrado em repouso:** o segredo TOTP precisa ser lido de volta, então não dá para guardar só o hash (como fazemos com senhas e tokens).
- Ele é gravado com **AES-256-GCM** (`common/secret-box.ts`), com IV aleatório por valor e tag de integridade.
- A chave vem de `DATA_ENCRYPTION_KEY`, fora do banco. Se o banco vazar, os segredos não vazam.
- **Perder essa chave** invalida o 2FA de todo mundo: guarde fora da VPS.

**Login com 2FA:**
1. Com a senha certa, `POST /auth/login` **não abre sessão** e não zera o contador de falhas. Ele devolve `{ twoFactorRequired: true }` e um cookie de desafio `__Secure-kora_2fa`:
   - `HttpOnly`, `SameSite=Strict` e `Path=/auth/2fa`;
   - vale 5 minutos;
   - é um JWT com audiência própria (`kora-2fa`), então não serve como access token, e vice-versa.
2. `POST /auth/2fa/verify { code }` aceita o código do app **ou** um código de recuperação (`xxxx-xxxx`, sem diferenciar maiúsculas, com ou sem hífen). Com o código certo, abre a sessão e grava `LOGIN_SUCCESS` com `method: 'totp' | 'recovery'`.
3. **Código errado conta como falha de login:** 5 seguidas travam a conta por 15 min, igual à senha. Sem esse limite, 6 dígitos (1 milhão de combinações) cairiam por força bruta.

**Códigos de recuperação:**
- 10 códigos de 8 caracteres, sem letras ambíguas (`i`, `l`, `o`, `0`, `1`).
- O banco guarda só o SHA-256. Cada código vale uma vez.
- `POST /auth/2fa/recovery-codes { code }` gera 10 novos e invalida os antigos.

**Desativar:** `POST /auth/2fa/disable { password, code }` exige **senha e código**. Quem encontrar uma sessão aberta não consegue desligar o 2FA.

**Avisos e auditoria:**
- Ativar e desativar mandam e-mail de alerta.
- Ficam na auditoria `TWO_FACTOR_ENABLED`, `TWO_FACTOR_DISABLED` e `TWO_FACTOR_RECOVERY_REGENERATED`.
- Redefinir a senha **não** desliga o 2FA. Sem o celular e sem os códigos, só um administrador, direto no banco, consegue liberar a conta.
