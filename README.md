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

- Ao reservar assentos, a API tenta adquirir um lock distribuído no Redis por assento:
    - Chave: `lock:seat:{seatId}`
    - Comando: `SET key value NX PX 30000`
- Se qualquer lock falhar, a operação é abortada e os locks já adquiridos são liberados.

### 2) Coordenação entre múltiplas instâncias

- A coordenação é feita via Redis (lock distribuído), funcionando mesmo com múltiplas réplicas da API.

### 3) Prevenção de Deadlocks

- Ao reservar múltiplos assentos, os IDs são **ordenados** antes de tentar adquirir locks.
- Isso evita o cenário clássico: Usuário A tenta [1,3] e Usuário B tenta [3,1].

### 4) Idempotência (retries do cliente)

- O endpoint `POST /reservations` aceita header opcional `Idempotency-Key`.
- Com a mesma chave e mesmo usuário, a API retorna a **mesma resposta** (cache no Redis) sem duplicar reservas.

### 5) Expiração e Liberação de Assentos

- Locks expiram automaticamente via TTL de 30s.
- Um job (Nest Schedule) roda a cada 5s e marca reservas PENDING vencidas como CANCELLED.
- Eventos publicados no RabbitMQ:
    - `reservation.created`
    - `payment.confirmed`
    - `reservation.expired`
    - `seat.released`

## 📚 Endpoints da API (com exemplos)

### Sessões

- `POST /sessions` cria sessão e gera assentos automaticamente
- `GET /sessions` lista sessões
- `GET /sessions/:id` retorna sessão com disponibilidade em “tempo real” (considerando locks no Redis)

### Reservas

- `POST /reservations` cria reserva(s) temporária(s)

```bash
curl -X POST http://localhost:3000/reservations \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: abc-123" \
    -d '{ "userId": "user-1", "seatIds": ["<seat-id>"] }'
```

- `POST /reservations/:id/pay` confirma pagamento

```bash
curl -X POST http://localhost:3000/reservations/<reservation-id>/pay
```

- `GET /reservations/history/:userId` histórico de compras (CONFIRMED)

## 🧾 Logging

- Logging em JSON com níveis `DEBUG`, `INFO`, `WARN`, `ERROR`.
- Ajuste o nível com `LOG_LEVEL` (ex.: `debug`, `info`, `warn`, `error`).

## ▶️ Exemplo de Fluxo para Testar (inclui concorrência)

Existe um script que cria sessão e simula 2 usuários concorrendo pelo mesmo assento:

```bash
node scripts/simulate-race.js
```

## 🧩 Decisões Técnicas

- **Lock no Redis** em vez de lock pessimista no banco: reduz contenção de conexões e melhora latência.
- **Eventos via RabbitMQ**: desacopla consumidores (ex.: email/analytics) do request/response.
- **Status no Postgres**: assento vendido é persistido como SOLD e não volta a AVAILABLE.

## ⚠️ Limitações Conhecidas

- Não há autenticação real (userId é informado no payload).
- “Venda” não é uma tabela separada (é representada por `ReservationStatus.CONFIRMED`).
- Não há Outbox/Inbox (garantia forte de entrega/exatamente-uma-vez); foi mantido simples para o desafio.

## 🛣️ Melhorias Futuras

- Model `Sale` separado e trilha completa de pagamentos.
- Outbox pattern para publicação confiável de eventos.
- DLQ + retries com backoff para consumidores.
- Testes de integração/concorrência mais robustos (k6/Artillery).