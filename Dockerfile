# Dockerfile
FROM node:20-alpine

WORKDIR /usr/src/app

# O Node 20 já vem com Corepack; usamos isso para fixar a versão do Yarn
RUN corepack enable && corepack prepare yarn@1.22.22 --activate

# Prisma pode rodar `generate` no postinstall do @prisma/client durante o `yarn install`.
# Definimos um DATABASE_URL padrão (não conecta, só valida schema/env).
ENV DATABASE_URL=postgresql://user:pass@postgres:5432/cinema

# Dependências nativas necessárias para o Prisma e OpenSSL
RUN apk add --no-cache openssl libc6-compat

# Copia manifests primeiro para aproveitar cache do Docker
COPY package.json yarn.lock ./

# Instala dependências (inclui devDependencies pro Nest CLI funcionar)
RUN yarn install --frozen-lockfile

# Copia o resto do código
COPY . .

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

CMD ["yarn", "start:dev"]