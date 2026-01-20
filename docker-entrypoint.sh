#!/bin/sh
set -e

# Quando usamos bind mount do código, o volume de node_modules pode vir vazio.
# Garante que as dependências existam antes de subir o Nest em modo watch.
if [ ! -d "node_modules" ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
  echo "[entrypoint] node_modules vazio; instalando dependências..."
  yarn install --frozen-lockfile
fi

# Se o Prisma Client não foi gerado (comum quando o schema não estava presente no install)
# gera antes de iniciar o app, para evitar erros de tipos/exports.
if [ ! -f "node_modules/.prisma/client/index.js" ]; then
  echo "[entrypoint] Prisma Client não encontrado; gerando..."
  yarn prisma generate
fi

# Garante que as tabelas existem: aplica migrations de forma idempotente.
# Importante: `docker compose down -v` apaga o volume do Postgres (dados somem),
# mas com isso aqui o schema volta a ser criado automaticamente.
if [ -d "prisma/migrations" ]; then
  echo "[entrypoint] Aplicando migrations (prisma migrate deploy)..."
  i=0
  until yarn prisma migrate deploy; do
    i=$((i + 1))
    if [ "$i" -ge 30 ]; then
      echo "[entrypoint] Falha ao aplicar migrations após $i tentativas."
      exit 1
    fi
    echo "[entrypoint] Banco ainda indisponível; retry $i/30 em 2s..."
    sleep 2
  done
else
  echo "[entrypoint] Aviso: prisma/migrations não encontrado; pulando migrate deploy."
fi

exec "$@"
