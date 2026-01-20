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

exec "$@"
