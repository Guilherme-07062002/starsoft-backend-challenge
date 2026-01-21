# 🎟️ Starsoft Backend Challenge - Atomic Seat Reservation

Sistema de vendas de ingressos com foco em **alta concorrência**, consistência e arquitetura distribuída.

O objetivo principal é garantir que **nenhum assento seja vendido duas vezes**, mesmo com múltiplas instâncias da API e requisições simultâneas.

## ✅ Visão Geral

Fluxo resumido:

1. Cliente cria uma sessão (filme, horário, sala, preço) e assentos são gerados automaticamente
2. Cliente reserva um ou mais assentos (TTL de 30s)
3. Cliente confirma pagamento de uma reserva (assento vira SOLD)
4. Eventos são publicados no RabbitMQ para processamento assíncrono

Documentação Swagger: `http://localhost:3000/api-docs`

## 🚀 Tecnologias Escolhidas (e por quê)

- **NestJS (Node.js/TypeScript):** modularidade, DI e organização por módulos
- **PostgreSQL:** persistência ACID e integridade como “source of truth”
- **Prisma:** produtividade + type-safety
- **Redis:** coordenação distribuída e locks atômicos (`SET NX PX`) para evitar double-booking
- **RabbitMQ:** mensageria e desacoplamento de consumidores (notificações/analytics)

## 🧰 Como Executar (Docker)

Pré-requisitos:

- Docker + Docker Compose

Subir tudo com um comando (API + Postgres + Redis + RabbitMQ):

```bash
docker compose up --build
```

Serviços:

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/api-docs`
- RabbitMQ Management: `http://localhost:15672` (user/pass: `user` / `pass`)

### Como Popular Dados Iniciais

Não há seed fixa: o fluxo esperado é criar uma sessão via API (isso já gera os assentos).

Exemplo (cria sessão com 4x4 = 16 assentos):

```bash
curl -X POST http://localhost:3000/sessions \
    -H "Content-Type: application/json" \
    -d '{
        "movieId": "movie-x",
        "room": "Sala 1",
        "startsAt": "2026-01-20T19:00:00.000Z",
        "price": 25,
        "rowsCount": 4,
        "seatsPerRow": 4
    }'
```

## 🧪 Testes

```bash
yarn test
```

Dica: se quiser serializar no mesmo processo:

```bash
yarn test --runInBand
```

## 🧠 Estratégias Implementadas

### 1) Race Conditions (double-booking)

- Ao reservar assentos, a API tenta adquirir um lock distribuído no Redis para cada assento.
    - Chave: `lock:seat:{seatId}`
    - Comando: `SET key value NX PX 30000` (operação atômica)
- A flag `NX` garante que a chave só seja criada se não existir, prevenindo que duas requisições obtenham o lock para o mesmo assento simultaneamente.
- Se qualquer lock falhar durante a reserva de múltiplos assentos, a operação é abortada e os locks já adquiridos são liberados (rollback), garantindo consistência.

### 2) Coordenação entre múltiplas instâncias

- A coordenação é feita inteiramente via Redis. Como o Redis é um serviço centralizado, o mecanismo de lock distribuído funciona de forma consistente mesmo com múltiplas réplicas da API rodando em paralelo.

### 3) Prevenção de Deadlocks

- Ao reservar múltiplos assentos (ex: `[seat-3, seat-1]`), os IDs são **ordenados** (`[seat-1, seat-3]`) antes de o sistema tentar adquirir os locks.
- Isso garante que todas as transações tentem adquirir locks na mesma ordem, evitando o cenário clássico de deadlock onde a Transação A trava o recurso 1 e espera pelo 2, enquanto a Transação B trava o 2 e espera pelo 1.

### 4) Idempotência (retries do cliente)

- O endpoint `POST /reservations` aceita o header opcional `Idempotency-Key`.
- Se uma requisição com a mesma chave é recebida de um mesmo usuário, a API retorna a **mesma resposta** que foi gerada na primeira vez (armazenada em cache no Redis), sem processar a reserva novamente. Isso previne a criação de reservas duplicadas em caso de timeouts de rede ou retries do cliente.

### 5) Expiração e Liberação de Assentos

- Os locks no Redis expiram automaticamente (TTL de 30s), prevenindo que um assento fique travado indefinidamente se a aplicação falhar.
- Um job agendado (`@Cron`) roda a cada 5 segundos para limpar o sistema:
    - Ele busca por reservas no estado `PENDING` que já expiraram.
    - Atualiza o status dessas reservas para `CANCELLED` no banco de dados.
    - Publica eventos (`reservation.expired`) para que outros serviços possam reagir, como liberar o assento.

## 📚 Endpoints da API (com exemplos)

A documentação completa e interativa está disponível via Swagger em `http://localhost:3000/api-docs`.

### Sessões

- `POST /sessions`: Cria uma nova sessão e gera seus assentos automaticamente.
- `GET /sessions`: Lista todas as sessões.
- `GET /sessions/:id`: Retorna os detalhes de uma sessão, incluindo a disponibilidade de assentos em tempo real.

### Reservas

- `POST /reservations`: Cria uma ou mais reservas temporárias (válidas por 30 segundos).

```bash
curl -X POST http://localhost:3000/reservations \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: <chave-unica-por-tentativa>" \
    -d '{ "userId": "user-123", "seatIds": ["<seat-id-1>", "<seat-id-2>"] }'
```

- `POST /reservations/:id/pay`: Converte uma reserva `PENDING` em uma venda definitiva.

```bash
curl -X POST http://localhost:3000/reservations/<reservation-id>/pay
```

- `GET /reservations/:id`: Obtém os detalhes de uma reserva específica.
- `GET /reservations/user/:userId`: Lista todas as reservas de um usuário.

### Vendas

- `GET /sales/history/:userId`: Retorna o histórico de compras confirmadas de um usuário.

## 🧾 Logging

- A aplicação utiliza logging estruturado em JSON (via Pino) com níveis `DEBUG`, `INFO`, `WARN`, `ERROR`.
- O nível de log pode ser ajustado através da variável de ambiente `LOG_LEVEL` no `docker-compose.yaml`.

## 🧩 Decisões Técnicas

- **Lock Distribuído no Redis vs. Lock Pessimista no Banco:** A escolha pelo Redis reduz a contenção no banco de dados e oferece menor latência para operações de lock, sendo mais escalável para cenários de alta concorrência.
- **Eventos via RabbitMQ:** A publicação de eventos desacopla os componentes do sistema. Por exemplo, a confirmação de um pagamento (`payment.confirmed`) pode ser consumida por serviços de notificação, analytics ou faturamento sem que o serviço de reservas precise conhecê-los.
- **Fonte da Verdade (Source of Truth):** O banco de dados PostgreSQL é a fonte final da verdade para o estado de um assento (`AVAILABLE`, `SOLD`). O Redis é usado para o estado transitório (`LOCKED`).

## ⚠️ Limitações Conhecidas

- **Autenticação/Autorização:** Não há um sistema de autenticação real. O `userId` é simplesmente informado no payload da requisição, o que não seria seguro em um ambiente de produção.
- **Garantia de Entrega de Eventos:** A implementação atual não utiliza padrões como Outbox/Inbox. Isso significa que, em um caso raro onde o banco de dados commita a transação mas a aplicação falha antes de publicar o evento no RabbitMQ, o evento pode ser perdido.

## 🛣️ Melhorias Futuras

- **Padrão Outbox:** Implementar o padrão Outbox para garantir a publicação atômica de eventos, eliminando a chance de perdê-los.
- **Testes de Concorrência:** Desenvolver um conjunto de testes de integração mais robusto para simular alta concorrência (com ferramentas como k6 ou Artillery) e validar a eficácia do sistema de locking sob estresse.
- **Autenticação:** Integrar um sistema de autenticação e autorização completo (ex: JWT).