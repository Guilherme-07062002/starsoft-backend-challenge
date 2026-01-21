/* eslint-disable no-console */

const API_URL = process.env.API_URL || 'http://localhost:3000';

async function http(method, path, body, headers = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }

  return { status: res.status, body: json };
}

async function main() {
  console.log('API_URL =', API_URL);

  // 1) Cria uma sessão com >= 16 assentos
  const sessionRes = await http('POST', '/sessions', {
    movieId: 'movie-x',
    room: 'Sala 1',
    startsAt: new Date(Date.now() + 60000).toISOString(),
    price: 25.0,
    rowsCount: 4,
    seatsPerRow: 4,
  });

  if (sessionRes.status >= 400) {
    console.error('Falha ao criar sessão:', sessionRes);
    process.exit(1);
  }

  const sessionId = sessionRes.body.id;
  console.log('Sessão criada:', sessionId);

  // 2) Busca a sessão e escolhe um assento
  const sessionGet = await http('GET', `/sessions/${sessionId}`);
  const seatId = sessionGet.body.seats[0].id;
  console.log('Assento escolhido:', seatId);

  // 3) Dispara duas reservas concorrentes para o mesmo assento
  console.log('\n--- Simulando Race Condition (2 usuários / 1 assento) ---');
  const [r1, r2] = await Promise.all([
    http('POST', '/reservations', { userId: 'user-a', seatIds: [seatId] }),
    http('POST', '/reservations', { userId: 'user-b', seatIds: [seatId] }),
  ]);

  console.log('Reserva 1:', r1);
  console.log('Reserva 2:', r2);

  // 4) Demonstra idempotência (mesma chave, mesmo usuário, mesma resposta)
  console.log('\n--- Simulando Retry Idempotente ---');
  const idemKey = `demo-${Date.now()}`;

  const [i1, i2] = await Promise.all([
    http('POST', '/reservations', { userId: 'user-idem', seatIds: [seatId] }, { 'Idempotency-Key': idemKey }),
    http('POST', '/reservations', { userId: 'user-idem', seatIds: [seatId] }, { 'Idempotency-Key': idemKey }),
  ]);

  console.log('Idempotente 1:', i1);
  console.log('Idempotente 2:', i2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
