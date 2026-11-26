# Worker e fila de jobs

O `apps/worker` é o segundo app do monorepo: um NestJS **sem HTTP** que faz o trabalho em segundo plano. Ele roda num container próprio, sem porta, e conversa com a API só pelo banco.

```
API ── muda algo ──┬──▶ tabela de negócio (ex.: cobrança)     ← mesma transação
                   └──▶ jobs (tipo + payload + run_at)          (padrão outbox)
                              │
Worker (loop) ── reserva ─────┘  SELECT … FOR UPDATE SKIP LOCKED
          ├── executa o handler do tipo
          ├── ok    → status = done
          └── falha → attempts + 1, run_at = agora + backoff
                      (esgotou → status = failed)
```

## Por que um app separado

| Na API | No worker |
|---|---|
| Responde em milissegundos | Pode demorar (SMTP lento, retentativas por horas) |
| Reinicia a cada deploy | Uma tarefa interrompida volta para a fila |
| Escala com o número de usuários | Escala com o volume de trabalho |

## Fila de jobs (`jobs`)

- **Gravar:** `enqueueJob(manager, type, payload)`, em `@kora/database`. Recebe o `EntityManager` de quem chama, para entrar **na mesma transação** da mudança. Se a mudança for desfeita, o job some junto; se ela for gravada, o job com certeza existe.
- **Reservar:** o worker marca até 10 jobs prontos com `locked_until = agora + 60 s`, usando `FOR UPDATE SKIP LOCKED`. Com mais de um worker, cada um pega linhas diferentes, sem duplicar. Se um worker morrer no meio, a reserva vence e outro retoma o job.
- **Retentativa:** a cada falha, espera mais antes de tentar de novo: 30 s, 2 min, 10 min, 1 h e 6 h. Esgotadas as tentativas (6 por padrão), o job fica `failed`, com o `last_error` para alguém investigar.
- **Pelo menos uma vez:** se o worker morrer depois de executar e antes de marcar `done`, o job roda de novo. Por isso **todo handler precisa ser idempotente**: rodar duas vezes tem que dar o mesmo resultado.
- **Tipo desconhecido** falha de vez (tentar de novo não resolve).
- **Limpeza:** jobs `done` somem depois de 7 dias; `failed` depois de 30.

## Tipos de job

| Tipo | Quem enfileira | O que faz |
|---|---|---|
| `send_email` | API: reset de senha, senha alterada, 2FA ativado/desativado | Envia por SMTP (nodemailer) com o remetente `MAIL_FROM` |

### `send_email`
- A API não tem mais SMTP: `MailService.queue(mensagem, manager)` só grava o job, **na transação** que gerou o e-mail. Se o token de reset não for gravado, o e-mail também não é; se for, o e-mail com certeza sai.
- O payload é a mensagem pronta (`to`, `subject`, `text`, `html`). O e-mail de reset traz o link com o token, então, quando o job termina (`done`, ou `failed` de vez), **o payload vira `{}`**: o link não fica parado no banco. Nas retentativas ele é mantido, senão não haveria o que reenviar.
- SMTP fora do ar → retentativa com backoff. Depois de 6 falhas (cerca de 7 h), o job fica `failed`; o link de reset já teria vencido (30 min) de qualquer forma.
- Efeito colateral aceito do "pelo menos uma vez": se o worker morrer entre o envio e o `done`, o e-mail chega duas vezes.

## Tarefas periódicas

| Tarefa | Intervalo | O que faz |
|---|---|---|
| `expire-charges` | 30 s | Marca como `expired` as cobranças `pending` com o prazo vencido. Antes isso só acontecia quando alguém lia a cobrança |
| `cleanup-jobs` | 1 h | Apaga jobs antigos da fila |

Cada tarefa tem uma trava, para nunca rodar duas vezes ao mesmo tempo no mesmo worker. Elas são idempotentes, então podem rodar em mais de um worker sem problema.

## Saúde do container

Sem HTTP, o Docker não tem a quem perguntar se o worker está vivo. A cada ciclo, o worker grava o horário em `/tmp/worker-heartbeat`, e o healthcheck do compose considera o container travado se o arquivo ficar mais de 60 s sem atualizar.

## Configuração (`.env`)

| Variável | Padrão | Uso |
|---|---|---|
| `DATABASE_URL` | (obrigatória) | Mesmo banco da API |
| `WORKER_POLL_INTERVAL_MS` | `1000` | Espera entre buscas com a fila vazia |
| `WORKER_BATCH_SIZE` | `10` | Jobs reservados por vez |
| `WORKER_LOCK_SECONDS` | `60` | Duração da reserva de um job |
| `WORKER_EXPIRE_INTERVAL_MS` | `30000` | Intervalo da expiração de cobranças |
| `WORKER_CLEANUP_INTERVAL_MS` | `3600000` | Intervalo da limpeza da fila |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | Servidor SMTP (o padrão é o Mailpit do compose de dev) |
| `SMTP_SECURE` | `false` | `true` = TLS direto (465); `false` = STARTTLS (587) |
| `SMTP_USER` / `SMTP_PASS` | (vazio) | Login SMTP (no Gmail, a senha de app) |
| `MAIL_FROM` | `Kora <nao-responda@korapag.com>` | Remetente |

Na VPS, a API e o worker leem o mesmo `infra/docker/.env`, então o `SMTP_*` continua no mesmo lugar: só quem usa mudou.

## Próximos tipos de job
- `deliver_webhook`: avisos assinados para as lojas.
