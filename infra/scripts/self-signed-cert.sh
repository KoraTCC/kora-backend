#!/usr/bin/env sh
# Gera um certificado autoassinado no mesmo layout do Let's Encrypt,
# para testar a stack de produção localmente.
#   sh infra/scripts/self-signed-cert.sh localhost
set -eu
DOMAIN="${1:-localhost}"
DIR="$(dirname "$0")/../docker/certs/live/$DOMAIN"
mkdir -p "$DIR"
openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
  -keyout "$DIR/privkey.pem" -out "$DIR/fullchain.pem" \
  -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN"
echo "Certificado gerado em $DIR"
