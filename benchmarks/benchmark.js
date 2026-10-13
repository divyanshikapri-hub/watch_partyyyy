import { io } from 'socket.io-client';

const BACKEND_URL = 'http://localhost:4000';
const ROOM_ID = 'benchmark-stress-room';
const NUM_CLIENTS = 12; // Meets and exceeds the >= 10 concurrent clients requirement

const clients = [];
const latencies = [];

console.log(`Starting benchmark with ${NUM_CLIENTS} concurrent users...`);

// Connect clients
for (let i = 0; i < NUM_CLIENTS; i++) {
  const socket = io(BACKEND_URL);
  
  socket.on('connect', () => {
    socket.emit('room:join', { roomId: ROOM_ID, username: `Bot_${i + 1}` });
  });

  socket.on('playback:sync', (data) => {
    const receivedTime = Date.now();
    const propagationDelay = receivedTime - data.serverTime;
    latencies.push(propagationDelay);
  });

  clients.push(socket);
}

// Allow clients 2 seconds to connect, then trigger actions
setTimeout(() => {
  console.log('All clients connected. Emitting sync actions...');
  const host = clients[0];

  let emits = 0;
  const interval = setInterval(() => {
    host.emit('playback:action', {
      roomId: ROOM_ID,
      action: 'PLAY',
      position: 10 + emits * 5,
      clientLocalTime: Date.now(),
    });
    emits++;

    if (emits >= 10) {
      clearInterval(interval);
      setTimeout(printResults, 2000);
    }
  }, 300);
}, 2000);

function printResults() {
  if (latencies.length === 0) {
    console.log('No latency measurements captured.');
    process.exit(1);
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95Index = Math.floor(latencies.length * 0.95);
  const p95 = latencies[p95Index];
  const max = latencies[latencies.length - 1];

  console.log('\n================ BENCHMARK RESULTS ================');
  console.log(`Total sample size: ${latencies.length} messages`);
  console.log(`Concurrent Connected Clients: ${NUM_CLIENTS}`);
  console.log(`p50 Propagation Latency: ${p50} ms`);
  console.log(`p95 Propagation Latency: ${p95} ms (Constraint <= 250ms)`);
  console.log(`Max Propagation Latency: ${max} ms`);
  console.log('===================================================\n');

  clients.forEach((c) => c.disconnect());
  process.exit(0);
}