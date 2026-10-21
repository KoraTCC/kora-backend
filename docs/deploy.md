# Deploy na VPS

A stack de produção fica em `infra/docker/docker-compose.prod.yml`:

| Serviço    | Papel                                                                         |
| ---------- | ----------------------------------------------------------------------------- |
| `nginx`    | Único serviço exposto (80/443). TLS, redirect HTTP→HTTPS e rate limit por IP. |
| `api`      | API NestJS. Sobe apenas depois que as migrations rodarem com sucesso.         |
| `migrate`  | Executa `typeorm migration:run` e termina.                                    |
| `postgres` | Banco em rede interna (`internal: true`), sem porta publicada.                |
| `certbot`  | Emissão/renovação de certificados (perfil `certbot`, não sobe por padrão).    |

## Primeira vez

Pré-requisitos: Docker e o plugin compose instalados, e o DNS do `API_DOMAIN` apontando para a VPS.

```bash
git clone https://github.com/KoraTCC/kora-backend.git && cd kora-backend
cp infra/docker/.env.example infra/docker/.env
# edite infra/docker/.env: API_DOMAIN, POSTGRES_PASSWORD (openssl rand -hex 32), FRONTEND_ORIGINS
```

Emita o certificado com o certbot em modo standalone (porta 80 livre, antes de subir o Nginx):

```bash
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env \
  run --rm -p 80:80 certbot certonly --standalone -d <API_DOMAIN> --agree-tos -m <email>
```

Suba tudo:

```bash
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env up -d --build
```

## Atualizações

```bash
git pull
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env up -d --build
```

O serviço `migrate` roda de novo a cada `up` e só aplica migrations pendentes.

## Renovação do certificado

Os certificados do Let's Encrypt valem 90 dias. Agende (cron) a renovação via webroot e o reload do Nginx:

```bash
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env \
  run --rm certbot renew --webroot -w /var/www/certbot
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env \
  exec nginx nginx -s reload
```

## Testar a stack de produção localmente

```bash
sh infra/scripts/self-signed-cert.sh localhost
cp infra/docker/.env.example infra/docker/.env   # API_DOMAIN=localhost
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env up -d --build --wait
curl -k https://localhost/health
```

## Backup do banco

```bash
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env \
  exec -T postgres pg_dump -U kora kora | gzip > backup-$(date +%F).sql.gz
```
