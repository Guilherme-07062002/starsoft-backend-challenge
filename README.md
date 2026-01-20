# 🎟️ Starsoft Backend Challenge - Atomic Seat Reservation

Sistema de vendas de ingressos de alta concorrência focado em integridade de dados e sistemas distribuídos.

Este projeto resolve o problema de **Race Conditions** (venda duplicada) em cenários de alto tráfego utilizando **Distributed Locks** com Redis e processamento assíncrono.

## 🚀 Tecnologias & Arquitetura

* **Linguagem:** TypeScript / Node.js
* **Framework:** NestJS (Modular e Escalável)
* **Banco de Dados:** PostgreSQL (Persistência ACID)
* **ORM:** Prisma (Type-safety e Produtividade)
* **Concurrency Control:** Redis (Atomic Locks `SET NX`)
* **Mensageria:** RabbitMQ (Desacoplamento de notificações)
* **Agendamento:** NestJS Schedule (Limpeza de reservas expiradas)

## 🧠 Decisões de Arquitetura (Diferenciais)

### 1. Solução para Concorrência (The "Double-Booking" Problem)
Em vez de utilizar *Pessimistic Locking* no banco de dados (que seguraria conexões e gargalaria o Postgres), optei pelo padrão **Redlock Simplificado (Mutex)**.
* Cada tentativa de reserva cria uma chave `lock:seat:{id}` no Redis com `SET NX` (Not Exists).
* Como o Redis é single-threaded para comandos, a atomicidade é garantida.
* **Resultado:** Performance de milissegundos na verificação de disponibilidade e zero vendas duplicadas.

### 2. Estratégia de "Garbage Collection"
Reservas não pagas precisam expirar. Implementei uma estratégia híbrida:
* **TTL no Redis:** O bloqueio cai automaticamente após 30s.
* **Cron Job:** Um worker roda a cada 5s procurando reservas `PENDING` expiradas no Postgres e atualiza para `CANCELLED`, disparando eventos de analytics.

### 3. Arquitetura Orientada a Eventos
O fluxo de confirmação de pagamento não bloqueia a resposta ao usuário. Após a transação no banco, um evento é publicado no **RabbitMQ** para que serviços secundários (Email, Analytics) processem a informação de forma assíncrona.

## 🛠️ Como Executar

### Pré-requisitos
* Docker & Docker Compose

### Passo a Passo
1.  Clone o repositório:
    ```bash
    git clone [https://github.com/SEU_USUARIO/atomic-seat.git](https://github.com/SEU_USUARIO/atomic-seat.git)
    ```
2.  Suba o ambiente (API + Postgres + Redis + RabbitMQ):
    ```bash
    docker compose up --build
    ```
3.  Acesse a Documentação da API (Swagger):
    * Abra `http://localhost:3000/api` no navegador.

## 🧪 Testes

O projeto possui testes unitários cobrindo a lógica crítica de concorrência:

```bash
# Executar testes unitários
npm test
```

## 📚 Endpoints Principais
POST /sessions - Cria uma sessão e gera assentos automaticamente (Batch Insert).

POST /reservations - Tenta reservar um assento (Protegido por Redis Lock).

POST /reservations/{id}/pay - Confirma pagamento e emite evento.