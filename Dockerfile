# Dockerfile
FROM node:18-alpine

WORKDIR /usr/src/app

# Copia package.json primeiro para aproveitar cache do Docker
COPY package*.json ./

# Instala todas as dependências (incluindo devDependencies para o Nest CLI funcionar)
RUN npm install

# Copia o resto do código
COPY . .

# Gera o Prisma Client (Segurança extra)
RUN npx prisma generate

# Expõe a porta
EXPOSE 3000