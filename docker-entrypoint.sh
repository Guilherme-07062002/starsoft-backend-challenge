#!/bin/sh
set -e

# Quando usamos bind mount do código, o volume de node_modules pode vir vazio.
# Garante que as dependências existam antes de subir o Nest em modo watch.
if [ ! -d "node_modules" ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
  echo "[entrypoint] node_modules vazio; instalando dependências..."
  npm ci
fi

exec "$@"
