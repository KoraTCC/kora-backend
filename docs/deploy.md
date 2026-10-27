# Deploy na VPS

## Quem faz o quê

```
Internet ─▶ Nginx da VPS (80/443, TLS) ─▶ 127.0.0.1:3000 ─▶ container api ─▶ container postgres
            configurado na máquina          este repositório (docker-compose.prod.yml)
```

| Parte                      | Onde fica                            | Responsabilidade                                                       |
| -------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| Nginx + certbot            | Instalados na VPS, fora deste repo   | TLS, redirect HTTP→HTTPS, rotear `app.` e `api.`, repassar o IP real   |
| `api`                      | `infra/docker/docker-compose.prod.yml` | A aplicação, publicada **só** em `127.0.0.1:${API_PORT}`             |
| `migrate`                  | idem                                 | Roda `typeorm migration:run` e termina; a API só sobe se ele passar    |
| `postgres`                 | idem                                 | Banco publicado **só** em `127.0.0.1:${POSTGRES_PORT}`, acessível por túnel SSH |

O mesmo Nginx serve o frontend e a API. Por isso ele é configuração da máquina, e não deste repositório.

## Pré-requisitos

- VPS preparada: usuário sem root, SSH só por chave, UFW liberando 22/80/443, Docker instalado.
- DNS: `api.korapag.com` e `app.korapag.com` apontando para o IP da VPS (proxy da Cloudflare desligado).

## 1. Subir a API

```bash
git clone https://github.com/KoraTCC/kora-backend.git && cd kora-backend
git checkout main
cp infra/docker/.env.example infra/docker/.env
```

Edite `infra/docker/.env`. Gere cada segredo com `openssl rand -hex 32`:

```
POSTGRES_PASSWORD=<segredo>
JWT_ACCESS_SECRET=<segredo>
PASSWORD_PEPPER=<segredo>     # guarde fora da VPS: se perder, nenhuma senha funciona
FRONTEND_ORIGINS=https://app.korapag.com
TRUST_PROXY=1
COOKIE_SECURE=true
```

```bash
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env up -d --build --wait
curl http://127.0.0.1:3000/health
```

## 2. Nginx da máquina

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Crie `/etc/nginx/sites-available/api.korapag.com`:

```nginx
server {
    listen 80;
    server_name api.korapag.com;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # SOBRESCREVE (não concatena): o cliente não consegue forjar o próprio IP.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/api.korapag.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.korapag.com
```

O certbot adiciona o HTTPS e o redirect, e o pacote já agenda a renovação automática. Os headers de segurança (HSTS, CSP, nosniff) vêm da própria API (`helmet`), então não precisam ser repetidos no Nginx.

### Dois cuidados que a segurança da API depende

1. **A API só pode ser publicada em `127.0.0.1`.** O Docker escreve as próprias regras de iptables e **ignora o UFW**. Com `ports: '3000:3000'`, a API ficaria aberta na internet, sem TLS e sem passar pelo Nginx.
2. **Use `X-Forwarded-For $remote_addr`, nunca `$proxy_add_x_forwarded_for`.** A API usa esse header (com `TRUST_PROXY=1`) para o rate limit, o bloqueio de login e a auditoria. Concatenando, o cliente envia um IP falso a cada tentativa e escapa do rate limit.

Para conferir o primeiro ponto, rode de **outra máquina**. Deve falhar:

```bash
curl --max-time 5 http://IP_DA_VPS:3000/health
```

## Atualizações

```bash
git pull
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env up -d --build --wait
```

O `migrate` roda de novo a cada `up` e só aplica as migrations pendentes.

## Acessar o banco (DBeaver, pgAdmin...)

O Postgres só escuta em `127.0.0.1` da VPS. Para acessar de fora, use um **túnel SSH**:

| Aba no DBeaver | Campo             | Valor                                         |
| -------------- | ----------------- | --------------------------------------------- |
| Main           | Host              | `localhost`                                   |
| Main           | Port              | `5432` (o `POSTGRES_PORT`)                    |
| Main           | Database / Username | `kora` / `kora`                             |
| Main           | Password          | o `POSTGRES_PASSWORD` do `.env` da VPS        |
| SSH            | Use SSH Tunnel    | marcado                                       |
| SSH            | Host / Port       | IP da VPS / `22`                              |
| SSH            | User              | o seu usuário pessoal da VPS                  |
| SSH            | Authentication    | Public Key, apontando para a sua chave privada |

## Backup do banco

```bash
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env \
  exec -T postgres pg_dump -U kora kora | gzip > backup-$(date +%F).sql.gz
```

Copie os backups para fora da VPS: uma VPS única é um ponto de falha.
