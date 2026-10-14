import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

interface RoomState {
  roomId: string;
  hostId: string;
  currentVideoUrl: string;
  isPlaying: boolean;
  playbackPosition: number; // in seconds
  lastUpdatedServerTime: number; // in milliseconds (Date.now())
  users: Map<string, { id: string; name: string }>;
  playlist: Array<{ id: string; title: string; url: string; poster?: string }>;
}

const rooms = new Map<string, RoomState>();

// Helper to calculate exact current playback position considering elapsed time
function getCurrentPlaybackTime(room: RoomState): number {
  if (!room.isPlaying) {
    return room.playbackPosition;
  }
  const elapsedSeconds = (Date.now() - room.lastUpdatedServerTime) / 1000;
  return room.playbackPosition + elapsedSeconds;
}

io.on('connection', (socket: Socket) => {
  // 1. NTP-style Clock Synchronization
  // Client sends its local timestamp `t0`. Server returns `t0` and server's `t1`.
  // Stream Selection Sync
  socket.on('room:change_stream', ({ roomId, videoUrl }: { roomId: string; videoUrl: string }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.currentVideoUrl = videoUrl;
      room.playbackPosition = 0;
      room.isPlaying = false;
      room.lastUpdatedServerTime = Date.now();
      io.to(roomId).emit('room:stream_changed', { videoUrl });
    }
  });
  socket.on('sync:ping', (clientSendTime: number) => {
    socket.emit('sync:pong', {
      clientSendTime,
      serverTime: Date.now(),
    });
  });

  // 2. Room Creation / Joining
  socket.on('room:join', ({ roomId, username }: { roomId: string; username: string }) => {
    socket.join(roomId);

    let room = rooms.get(roomId);
    if (!room) {
      // First user becomes host
      // First user becomes host
      room = {
        roomId,
        hostId: socket.id,
        currentVideoUrl: 'https://vjs.zencdn.net/v/oceans.mp4',
        isPlaying: false,
        playbackPosition: 0,
        lastUpdatedServerTime: Date.now(),
        users: new Map(),
        playlist: [
          {
            id: '1',
            title: 'Oceans (Wildlife Doc)',
            url: 'https://vjs.zencdn.net/v/oceans.mp4',
          },
          {
            id: '2',
            title: 'Flower Bloom (Mozilla CC0)',
            url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
          },
          {
            id: '3',
            title: 'We Are Going On Bullrun (Direct HD)',
            url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
          },
          {
            id: '4',
            title: 'Sintel Trailer (Direct MP4)',
            url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
          },
        ],
      };
      rooms.set(roomId, room);
    }

    room.users.set(socket.id, { id: socket.id, name: username || `User_${socket.id.slice(0, 4)}` });

    // Send complete current room state to joining client (handles late joins)
    socket.emit('room:state', {
      roomId: room.roomId,
      hostId: room.hostId,
      currentVideoUrl: room.currentVideoUrl,
      isPlaying: room.isPlaying,
      playbackPosition: getCurrentPlaybackTime(room),
      serverTimestamp: Date.now(),
      users: Array.from(room.users.values()),
      playlist: room.playlist,
    });

    // Notify room of updated users
    io.to(roomId).emit('room:users_updated', Array.from(room.users.values()));
  });

  // 3. Playback Controls (Play, Pause, Seek) with Scheduled Action Times
  socket.on('playback:action', ({
    roomId,
    action, // 'PLAY' | 'PAUSE' | 'SEEK'
    position,
    clientLocalTime,
  }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const now = Date.now();
    const scheduledExecutionServerTime = now + 150; // Schedule execution 150ms into the future to ensure sync

    if (action === 'PLAY') {
      room.isPlaying = true;
      room.playbackPosition = position;
      room.lastUpdatedServerTime = scheduledExecutionServerTime;
    } else if (action === 'PAUSE') {
      room.isPlaying = false;
      room.playbackPosition = position;
      room.lastUpdatedServerTime = now;
    } else if (action === 'SEEK') {
      room.playbackPosition = position;
      room.lastUpdatedServerTime = room.isPlaying ? scheduledExecutionServerTime : now;
    }

    // Broadcast action to all room participants
    io.to(roomId).emit('playback:sync', {
      action,
      position,
      scheduledExecutionServerTime,
      serverTime: now,
      sentBy: socket.id,
    });
  });

  // 4. Live Chat & Emoji Reactions
  socket.on('chat:message', ({ roomId, message, username }) => {
    io.to(roomId).emit('chat:message', {
      id: Math.random().toString(36).substring(2, 9),
      username,
      message,
      timestamp: Date.now(),
    });
  });

  socket.on('reaction:send', ({ roomId, emoji }) => {
    io.to(roomId).emit('reaction:broadcast', {
      emoji,
      senderId: socket.id,
    });
  });

  // 5. Host Transfer
  socket.on('room:transfer_host', ({ roomId, newHostId }) => {
    const room = rooms.get(roomId);
    if (room && room.hostId === socket.id && room.users.has(newHostId)) {
      room.hostId = newHostId;
      io.to(roomId).emit('room:host_changed', { hostId: newHostId });
    }
  });

  // 6. Handle Disconnects
  socket.on('disconnect', () => {
    rooms.forEach((room, roomId) => {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);

        // If host leaves, assign next available user
        if (room.hostId === socket.id && room.users.size > 0) {
          const nextHost = room.users.keys().next().value;
          if (nextHost) {
            room.hostId = nextHost;
            io.to(roomId).emit('room:host_changed', { hostId: nextHost });
          }
        }

        io.to(roomId).emit('room:users_updated', Array.from(room.users.values()));

        // Delete room if empty
        if (room.users.size === 0) {
          rooms.delete(roomId);
        }
      }
    });
  });
});
// Serve built static client files
const clientDistPath = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));

// Express 5 compatible catch-all fallback
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Watch Party backend running on port ${PORT}`);
});