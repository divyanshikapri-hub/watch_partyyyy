import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import Fuse from 'fuse.js';
import { Users, MessageSquare, Send, Activity, ShieldCheck, Film } from 'lucide-react';
import { SyncManager } from './syncManager';

const BACKEND_URL = `http://${window.location.hostname}:4000`;

interface User {
  id: string;
  name: string;
}

interface ChatMessage {
  id: string;
  username: string;
  message: string;
  timestamp: number;
}

interface PlaylistItem {
  id: string;
  title: string;
  url: string;
}

interface FloatingEmoji {
  id: number;
  emoji: string;
  left: number;
}

const DEFAULT_PLAYLIST: PlaylistItem[] = [
  {
    id: '1',
    title: 'Oceans (Wildlife Documentary)',
    url: 'https://vjs.zencdn.net/v/oceans.mp4',
  },
  {
    id: '2',
    title: 'Big Buck Bunny (Animation)',
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  },
  {
    id: '3',
    title: 'Elephants Dream (Sci-Fi CGI)',
    url: 'https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4',
  },
  {
    id: '4',
    title: 'Sintel Trailer (Fantasy)',
    url: 'https://archive.org/download/Sintel/sintel-2048-surround_512kb.mp4',
  },
];

const EMOJI_LIST = ['🔥', '😂', '🍿', '🎉', '❤️', '👏', '👍', '😮', '😭', '👎'];

export default function App() {
  const [roomId, setRoomId] = useState('room-1');
  const [username, setUsername] = useState('');
  const [joined, setJoined] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>(DEFAULT_PLAYLIST);
  const [currentVideoUrl, setCurrentVideoUrl] = useState(DEFAULT_PLAYLIST[0].url);
  const [isPlaying, setIsPlaying] = useState(false);

  // Sync & Latency HUD states
  const [rtt, setRtt] = useState(0);
  const [drift, setDrift] = useState(0);
  const [propagationLag, setPropagationLag] = useState(0);

  // Chat & Floating Reactions
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const socketRef = useRef<Socket | null>(null);
  const syncManagerRef = useRef<SyncManager | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isLocalActionRef = useRef<boolean>(false);

  useEffect(() => {
    const socket = io(BACKEND_URL);
    socketRef.current = socket;
    syncManagerRef.current = new SyncManager(socket);

    socket.on('room:state', (state) => {
      if (state.currentVideoUrl) setCurrentVideoUrl(state.currentVideoUrl);
      setIsHost(socket.id === state.hostId);
      setUsers(state.users || []);
      if (state.playlist && state.playlist.length > 0) setPlaylist(state.playlist);
      setIsPlaying(state.isPlaying);

      if (videoRef.current) {
        videoRef.current.currentTime = state.playbackPosition || 0;
        if (state.isPlaying) {
          videoRef.current.play().catch(() => {});
        }
      }
    });

    socket.on('room:stream_changed', ({ videoUrl }: { videoUrl: string }) => {
      setCurrentVideoUrl(videoUrl);
      if (videoRef.current) {
        videoRef.current.src = videoUrl;
        videoRef.current.load();
        videoRef.current.currentTime = 0;
      }
    });

    socket.on('room:users_updated', (updatedUsers: User[]) => {
      setUsers(updatedUsers);
    });

    socket.on('room:host_changed', ({ hostId: newHost }) => {
      setIsHost(socket.id === newHost);
    });

    socket.on('playback:sync', ({ action, position, scheduledExecutionServerTime, serverTime }) => {
      const now = Date.now();
      setPropagationLag(now - serverTime);

      if (!videoRef.current) return;

      const delayMs = Math.max(0, scheduledExecutionServerTime - now);
      setTimeout(() => {
        if (!videoRef.current) return;
        isLocalActionRef.current = true;

        if (action === 'PLAY') {
          videoRef.current.currentTime = position;
          videoRef.current.play().catch(() => {});
          setIsPlaying(true);
        } else if (action === 'PAUSE') {
          videoRef.current.pause();
          videoRef.current.currentTime = position;
          setIsPlaying(false);
        } else if (action === 'SEEK') {
          videoRef.current.currentTime = position;
        }

        setTimeout(() => {
          isLocalActionRef.current = false;
        }, 120);
      }, delayMs);
    });

    socket.on('chat:message', (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('reaction:broadcast', ({ emoji }: { emoji: string }) => {
      triggerFloatingEmoji(emoji);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (syncManagerRef.current) {
        setRtt(syncManagerRef.current.getRTT());
      }
      if (videoRef.current && isPlaying && syncManagerRef.current) {
        const measuredDrift = syncManagerRef.current.evaluateDrift(
          videoRef.current.currentTime,
          videoRef.current.currentTime,
          videoRef.current
        );
        setDrift(measuredDrift);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const triggerFloatingEmoji = (emoji: string) => {
    const id = Date.now() + Math.random();
    const left = Math.floor(Math.random() * 70) + 15;
    setFloatingEmojis((prev) => [...prev, { id, emoji, left }]);

    setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((item) => item.id !== id));
    }, 2000);
  };

  const joinRoom = () => {
    if (!username.trim() || !socketRef.current) return;
    socketRef.current.emit('room:join', { roomId, username });
    setJoined(true);

    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.muted = false;
        videoRef.current.volume = 0.8;
      }
    }, 200);
  };

  const emitPlaybackAction = (action: 'PLAY' | 'PAUSE' | 'SEEK', position: number) => {
    if (isLocalActionRef.current || !socketRef.current) return;
    socketRef.current.emit('playback:action', {
      roomId,
      action,
      position,
      clientLocalTime: Date.now(),
    });
  };

  const handlePlay = () => {
    if (videoRef.current) {
      emitPlaybackAction('PLAY', videoRef.current.currentTime);
      setIsPlaying(true);
    }
  };

  const handlePause = () => {
    if (videoRef.current) {
      emitPlaybackAction('PAUSE', videoRef.current.currentTime);
      setIsPlaying(false);
    }
  };

  const selectVideo = (item: PlaylistItem) => {
    setCurrentVideoUrl(item.url);
    if (videoRef.current) {
      videoRef.current.src = item.url;
      videoRef.current.load();
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
    if (socketRef.current) {
      socketRef.current.emit('room:change_stream', { roomId, videoUrl: item.url });
    }
    emitPlaybackAction('SEEK', 0);
  };

  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !socketRef.current) return;
    socketRef.current.emit('chat:message', { roomId, message: inputMessage, username });
    setInputMessage('');
  };

  const sendReaction = (emoji: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('reaction:send', { roomId, emoji });
    triggerFloatingEmoji(emoji);
  };

  const fuse = new Fuse(playlist, { keys: ['title'], threshold: 0.4 });
  const filteredPlaylist = searchQuery.trim()
    ? fuse.search(searchQuery).map((res) => res.item)
    : playlist;

  if (!joined) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 max-w-md w-full shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
              Watch Party
            </h1>
            <p className="text-slate-400 text-sm">Synchronized real-time playback & chat</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 uppercase font-semibold">Your Name</label>
              <input
                type="text"
                placeholder="e.g. Aman"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full mt-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-white text-left"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase font-semibold">Room Code</label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full mt-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-white text-left"
              />
            </div>
            <button
              onClick={joinRoom}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold cursor-pointer transition shadow-lg shadow-blue-600/30"
            >
              Enter Watch Room
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-slate-900/60 px-6 py-4 flex items-center justify-between backdrop-blur">
        <div className="flex items-center gap-3">
          <Film className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold">Watch Party</h1>
          <span className="px-2.5 py-0.5 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-full font-mono">
            Room: {roomId}
          </span>
          {isHost && (
            <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded border border-amber-500/30 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Host
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs font-mono bg-slate-950 px-4 py-1.5 rounded-lg border border-slate-800">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>RTT: <strong className="text-emerald-400">{rtt} ms</strong></span>
          </div>
          <div className="h-3 w-px bg-slate-800" />
          <div>
            Drift: <strong className={Math.abs(drift) > 200 ? 'text-amber-400' : 'text-emerald-400'}>{drift} ms</strong>
          </div>
          <div className="h-3 w-px bg-slate-800" />
          <div>
            p95 Lag: <strong className="text-blue-400">{propagationLag} ms</strong>
          </div>
        </div>
      </header>

      {/* Main Grid View */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 p-6 gap-6">
        {/* Left Side: Video Player & Controls */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          {/* Video Player Frame */}
          <div className="relative bg-black rounded-xl overflow-hidden border border-slate-800 shadow-2xl aspect-video flex items-center justify-center">
            <video
              ref={videoRef}
              src={currentVideoUrl}
              className="w-full h-full object-contain relative z-0"
              onPlay={handlePlay}
              onPause={handlePause}
              controls
              playsInline
              preload="auto"
            />

            {/* Floating Reactions Overlay (stops before the native control bar) */}
            <div className="absolute top-0 left-0 right-0 bottom-16 z-10 pointer-events-none overflow-hidden">
              {floatingEmojis.map((item) => (
                <span
                  key={item.id}
                  style={{ left: `${item.left}%` }}
                  className="absolute bottom-2 text-4xl animate-float-up select-none transition-all pointer-events-none"
                >
                  {item.emoji}
                </span>
              ))}
            </div>
          </div>

          {/* Quick Reaction Bar */}
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-semibold uppercase">Reactions:</span>
              {EMOJI_LIST.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => sendReaction(emoji)}
                  className="hover:scale-125 transition text-2xl cursor-pointer p-1 active:scale-95 select-none"
                  title="React"
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Users className="w-4 h-4 text-blue-400" />
              <span>{users.length} viewing</span>
            </div>
          </div>

          {/* Movie Discovery & Playlist */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Movie Discovery & Playlist</h2>
              <input
                type="text"
                placeholder="Fuzzy search titles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="text-xs bg-slate-800 border border-slate-700 rounded px-3 py-1 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {filteredPlaylist.map((movie) => (
                <div
                  key={movie.id}
                  onClick={() => selectVideo(movie)}
                  className={`border rounded-lg p-3 cursor-pointer transition flex flex-col gap-2 ${
                    currentVideoUrl === movie.url
                      ? 'bg-blue-900/30 border-blue-500'
                      : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/50'
                  }`}
                >
                  <div className="font-semibold text-xs truncate">{movie.title}</div>
                  <span className="text-[10px] text-blue-400 uppercase font-mono">
                    {currentVideoUrl === movie.url ? '● Currently Playing' : 'Select Stream'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Side: Room Chat Sidebar */}
        <div className="flex flex-col gap-4 bg-slate-900 border border-slate-800 rounded-xl p-4 h-[calc(100vh-140px)]">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
            <MessageSquare className="w-4 h-4 text-blue-400" />
            <h2 className="font-semibold text-sm">Room Chat</h2>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
            {messages.map((m) => (
              <div key={m.id} className="bg-slate-800/50 p-2.5 rounded-lg border border-slate-800 text-left">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-blue-400">{m.username}</span>
                  <span className="text-[10px] text-slate-500">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-slate-200 text-left break-words">{m.message}</p>
              </div>
            ))}
          </div>

          <form onSubmit={sendChatMessage} className="flex items-center gap-2 pt-2 border-t border-slate-800">
            <input
              type="text"
              placeholder="Type message..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 text-left"
            />
            <button
              type="submit"
              className="shrink-0 flex items-center justify-center w-8 h-8 bg-blue-600 hover:bg-blue-500 rounded-lg cursor-pointer transition text-white"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}