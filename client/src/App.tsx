import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import Fuse from 'fuse.js';
import {
  Users,
  MessageSquare,
  Send,
  Activity,
  ShieldCheck,
  Film,
  Play,
  Shuffle,
  Lock,
  UserCheck,
  Download,
  CheckCircle,
  Crown
} from 'lucide-react';
import { SyncManager } from './syncManager';

const getBackendUrl = (): string => {
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL;
  }
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const hostname = window.location.hostname || 'localhost';
    return `${protocol}//${hostname}:4000`;
  }
  return 'http://localhost:4000';
};

const BACKEND_URL = getBackendUrl();

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

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DEFAULT_PLAYLIST: PlaylistItem[] = [
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
    title: 'Big Buck Bunny (Direct Stream)',
    url: 'https://www.w3schools.com/html/mov_bbb.mp4',
  },
  {
    id: '4',
    title: 'Sintel Trailer (Direct MP4)',
    url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
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
  const [, setIsPlaying] = useState(false);

  // Sync telemetry
  const [rtt, setRtt] = useState(0);
  const [drift, setDrift] = useState(0);
  const [propagationLag, setPropagationLag] = useState(0);

  // Chat & Floating Reactions
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Landing page mode
  const [lobbyTab, setLobbyTab] = useState<'join' | 'create'>('join');

  // PWA Install state
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
  );

  const socketRef = useRef<Socket | null>(null);
  const syncManagerRef = useRef<SyncManager | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isLocalActionRef = useRef<boolean>(false);
  const lockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Authoritative room playback anchor for peer drift compensation
  const playbackAnchorRef = useRef<{
    position: number;
    serverTime: number;
    isPlaying: boolean;
  }>({
    position: 0,
    serverTime: 0,
    isPlaying: false,
  });

  const triggerFloatingEmoji = useCallback((emoji: string) => {
    const id = Date.now() + Math.random();
    const left = Math.floor(Math.random() * 70) + 15;
    setFloatingEmojis((prev) => [...prev, { id, emoji, left }]);

    setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((item) => item.id !== id));
    }, 2000);
  }, []);

  // Listen for PWA installation events
  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstallable(false);
      }
      setDeferredPrompt(null);
    } else {
      alert("To install Watch Party Live:\n\n• On Chrome / Edge desktop: Click the Install button in the browser address bar.\n• On iOS Safari: Tap the Share button, then 'Add to Home Screen'.\n• On Android Chrome: Tap the top menu (⋮) -> 'Install App'.");
    }
  };

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;
    syncManagerRef.current = new SyncManager(socket);

    socket.on('room:state', (state) => {
      if (state.currentVideoUrl) setCurrentVideoUrl(state.currentVideoUrl);
      const isUserHost = socket.id === state.hostId;
      setIsHost(isUserHost);
      setUsers(state.users || []);
      if (state.playlist && state.playlist.length > 0) setPlaylist(state.playlist);
      setIsPlaying(state.isPlaying);

      playbackAnchorRef.current = {
        position: state.playbackPosition || 0,
        serverTime: state.serverTimestamp || Date.now(),
        isPlaying: state.isPlaying,
      };

      if (videoRef.current) {
        videoRef.current.currentTime = state.playbackPosition || 0;
        if (state.isPlaying) {
          videoRef.current.play().catch(() => { });
        }
      }
    });

    socket.on('room:stream_changed', ({ videoUrl }: { videoUrl: string }) => {
      setCurrentVideoUrl(videoUrl);
      playbackAnchorRef.current = {
        position: 0,
        serverTime: Date.now(),
        isPlaying: false,
      };
      if (videoRef.current) {
        videoRef.current.src = videoUrl;
        videoRef.current.load();
        videoRef.current.currentTime = 0;
      }
    });

    socket.on('room:users_updated', (updatedUsers: User[]) => {
      setUsers(updatedUsers);
    });

    socket.on('room:host_changed', ({ hostId: newHost }: { hostId: string }) => {
      setIsHost(socket.id === newHost);
    });

    socket.on('playback:sync', ({ action, position, scheduledExecutionServerTime, serverTime }) => {
      const now = Date.now();
      setPropagationLag(now - serverTime);

      playbackAnchorRef.current = {
        position,
        serverTime: scheduledExecutionServerTime || serverTime || now,
        isPlaying: action === 'PLAY',
      };

      if (!videoRef.current) return;

      const delayMs = Math.max(0, scheduledExecutionServerTime - now);
      setTimeout(() => {
        if (!videoRef.current) return;

        // Set lock window to stop programmatic adjustments from triggering recursive native onSeeked/onPlay events
        isLocalActionRef.current = true;
        if (lockTimeoutRef.current) {
          clearTimeout(lockTimeoutRef.current);
        }

        if (action === 'PLAY') {
          videoRef.current.currentTime = position;
          videoRef.current.play().catch(() => { });
          setIsPlaying(true);
        } else if (action === 'PAUSE') {
          videoRef.current.pause();
          videoRef.current.currentTime = position;
          setIsPlaying(false);
        } else if (action === 'SEEK') {
          videoRef.current.currentTime = position;
        }

        // 400ms lock window after applying remote seek/sync
        lockTimeoutRef.current = setTimeout(() => {
          isLocalActionRef.current = false;
        }, 400);
      }, delayMs);
    });

    // Chat messages are added exclusively via socket event with deduplication to prevent double rendering
    socket.on('chat:message', (msg: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) {
          return prev;
        }
        return [...prev, msg];
      });
    });

    socket.on('reaction:broadcast', ({ emoji }: { emoji: string }) => {
      triggerFloatingEmoji(emoji);
    });

    return () => {
      if (lockTimeoutRef.current) {
        clearTimeout(lockTimeoutRef.current);
      }
      socket.disconnect();
    };
  }, [triggerFloatingEmoji]);

  // Real-time synchronization loop: peers compute drift against authoritative server anchor
  useEffect(() => {
    const interval = setInterval(() => {
      if (syncManagerRef.current) {
        setRtt(syncManagerRef.current.getRTT());
      }

      if (isHost) {
        // Host is master clock - no drift adjustments
        setDrift(0);
        if (videoRef.current && videoRef.current.playbackRate !== 1.0) {
          videoRef.current.playbackRate = 1.0;
        }
      } else if (videoRef.current && syncManagerRef.current) {
        const anchor = playbackAnchorRef.current;
        let expectedServerTime = anchor.position;
        if (anchor.isPlaying) {
          const currentServerNow = syncManagerRef.current.getServerNow();
          const elapsed = Math.max(0, (currentServerNow - anchor.serverTime) / 1000);
          expectedServerTime = anchor.position + elapsed;
        }

        const measuredDrift = syncManagerRef.current.evaluateDrift(
          videoRef.current.currentTime,
          expectedServerTime,
          videoRef.current
        );
        setDrift(measuredDrift);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isHost]);

  const generateRandomRoom = () => {
    const adjectives = ['lively', 'cosmic', 'swift', 'cinema', 'stream', 'pulse'];
    const noun = ['lounge', 'squad', 'stage', 'hub', 'party'];
    const random = Math.floor(100 + Math.random() * 900);
    const code = `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${noun[Math.floor(Math.random() * noun.length)]}-${random}`;
    setRoomId(code);
  };

  const joinRoom = () => {
    if (!username.trim()) return;

    if (socketRef.current) {
      if (!socketRef.current.connected) {
        socketRef.current.connect();
      }
      socketRef.current.emit('room:join', { roomId, username: username.trim() });
    }

    setJoined(true);

    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.muted = false;
        videoRef.current.volume = 0.8;
      }
    }, 200);
  };

  // Only the room host is allowed to broadcast playback actions
  const emitPlaybackAction = useCallback((action: 'PLAY' | 'PAUSE' | 'SEEK', position: number) => {
    if (!isHost || isLocalActionRef.current || !socketRef.current) return;

    socketRef.current.emit('playback:action', {
      roomId,
      action,
      position,
      clientLocalTime: Date.now(),
    });
  }, [isHost, roomId]);

  // Peer clients discard native playback events
  const handlePlay = () => {
    if (!isHost || isLocalActionRef.current || !videoRef.current) return;
    emitPlaybackAction('PLAY', videoRef.current.currentTime);
    setIsPlaying(true);
  };

  const handlePause = () => {
    if (!isHost || isLocalActionRef.current || !videoRef.current) return;
    emitPlaybackAction('PAUSE', videoRef.current.currentTime);
    setIsPlaying(false);
  };

  const handleSeeked = () => {
    if (!isHost || isLocalActionRef.current || !videoRef.current) return;
    emitPlaybackAction('SEEK', videoRef.current.currentTime);
  };

  const selectVideo = (item: PlaylistItem) => {
    if (!isHost) return;
    setCurrentVideoUrl(item.url);

    // Force the video element to fetch and render the new source immediately
    if (videoRef.current) {
      videoRef.current.src = item.url;
      videoRef.current.load();
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => { });
    }

    if (socketRef.current?.connected) {
      socketRef.current.emit('room:change_stream', { roomId, videoUrl: item.url });
      emitPlaybackAction('SEEK', 0);
    }
  };

  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    const messageText = inputMessage.trim();
    const senderName = username || 'Anonymous';

    // Broadcast only via socket - do NOT optimistically append to avoid double rendering
    if (socketRef.current?.connected) {
      socketRef.current.emit('chat:message', {
        roomId,
        message: messageText,
        username: senderName,
      });
    } else {
      console.warn('Socket not connected. Backend server might be offline.');
    }

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

  // ==========================================
  // STREAMLINED CENTERED HERO LANDING PAGE
  // ==========================================
  if (!joined) {
    return (
      <div className="relative min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 bg-grid-pattern overflow-hidden">
        {/* Soft Background Radial Glows */}
        <div className="absolute -top-32 left-1/3 w-[500px] h-[500px] bg-indigo-600/15 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute -bottom-32 right-1/3 w-[500px] h-[500px] bg-blue-600/15 rounded-full blur-[140px] pointer-events-none" />

        <div className="relative z-10 w-full max-w-xl">
          <div className="bg-slate-900/80 border border-slate-800/90 backdrop-blur-2xl rounded-3xl p-8 sm:p-10 shadow-2xl shadow-black/80 space-y-7">

            {/* Header Brand */}
            <div className="space-y-2 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-1">
                <Film className="w-3.5 h-3.5" />
                <span>Synchronized Cinema Experience</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                Watch Party Live
              </h1>
              <p className="text-slate-400 text-sm leading-relaxed max-w-md mx-auto">
                Watch videos together in real time with synchronized playback, live emoji reactions, and instant party chat.
              </p>
            </div>

            {/* Mode Switcher */}
            <div className="flex bg-slate-950/80 p-1 rounded-xl border border-slate-800/80 mx-auto max-w-xs">
              <button
                type="button"
                onClick={() => setLobbyTab('join')}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${lobbyTab === 'join'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
                  }`}
              >
                Join Existing Room
              </button>
              <button
                type="button"
                onClick={() => {
                  setLobbyTab('create');
                  generateRandomRoom();
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${lobbyTab === 'create'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
                  }`}
              >
                Create New Party
              </button>
            </div>

            {/* Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                joinRoom();
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5 text-left">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Your Display Name
                </label>
                <div className="relative">
                  <UserCheck className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Enter your nickname..."
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-3 bg-slate-950/70 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-left"
                  />
                </div>
              </div>

              <div className="space-y-1.5 text-left">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    {lobbyTab === 'create' ? 'Generated Room Code' : 'Party Room ID'}
                  </label>
                  {lobbyTab === 'create' && (
                    <button
                      type="button"
                      onClick={generateRandomRoom}
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium cursor-pointer"
                    >
                      <Shuffle className="w-3 h-3" /> Roll new ID
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-3 bg-slate-950/70 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-left"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-600/30 hover:shadow-indigo-600/45 cursor-pointer active:scale-[0.99] transition-all flex items-center justify-center gap-2.5 text-sm"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>{lobbyTab === 'create' ? 'Host & Start Party' : 'Enter Party Room'}</span>
              </button>
            </form>

            {/* PWA Install Button on Landing */}
            {!isInstalled && (
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-center">
                <button
                  type="button"
                  onClick={handleInstallApp}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium cursor-pointer transition shadow-sm active:scale-95"
                >
                  <Download className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{isInstallable ? 'Install Watch Party App' : 'Add App to Desktop / Mobile'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // MAIN WATCH ROOM
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-slate-900/60 px-6 py-4 flex flex-wrap items-center justify-between gap-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Film className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold tracking-tight">Watch Party Live</h1>
          <span className="px-2.5 py-0.5 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-full font-mono">
            Room: {roomId}
          </span>
          {isHost ? (
            <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded-md border border-amber-500/30 flex items-center gap-1 font-medium">
              <Crown className="w-3 h-3 text-amber-400" /> Room Host (Controller)
            </span>
          ) : (
            <span className="px-2 py-0.5 text-xs bg-slate-800 text-slate-400 rounded-md border border-slate-700 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Viewer (Synced)
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* PWA Install Button */}
          {!isInstalled ? (
            <button
              type="button"
              onClick={handleInstallApp}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 text-xs font-medium cursor-pointer transition"
              title="Install progressive web app"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span>Install App</span>
            </button>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
              <CheckCircle className="w-3 h-3" /> App Installed
            </span>
          )}

          {/* Sync Telemetry */}
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
              onSeeked={handleSeeked}
              controls={isHost} /* Peer browsers get clean synced playback without native pause/scrub */
              playsInline
              preload="auto"
            />

            {/* Non-host Overlay Banner: Synced with Host (Host controls playback) */}
            {!isHost && (
              <div className="absolute top-3.5 left-3.5 z-10 pointer-events-none">
                <span className="px-3 py-1.5 text-xs font-medium bg-slate-950/85 backdrop-blur-md text-slate-200 border border-slate-700/80 rounded-full flex items-center gap-2 shadow-xl">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Synced with Host (Host controls playback)
                </span>
              </div>
            )}

            {/* Floating Reactions Overlay */}
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
                  type="button"
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
              <div>
                <h2 className="font-semibold text-sm">Movie Discovery & Playlist</h2>
                {!isHost && (
                  <p className="text-[11px] text-slate-400">Only the host can change streams for the room</p>
                )}
              </div>
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
                  className={`border rounded-lg p-3 transition flex flex-col gap-2 ${!isHost ? 'opacity-80 cursor-default' : 'cursor-pointer hover:border-slate-600'
                    } ${currentVideoUrl === movie.url
                      ? 'bg-blue-900/30 border-blue-500'
                      : 'bg-slate-800/60 border-slate-700/50'
                    }`}
                >
                  <div className="font-semibold text-xs truncate">{movie.title}</div>
                  <span className="text-[10px] text-blue-400 uppercase font-mono">
                    {currentVideoUrl === movie.url ? '● Currently Playing' : (isHost ? 'Select Stream' : 'Available Stream')}
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
            {messages.length === 0 ? (
              <div className="text-slate-500 text-center py-8">
                No messages yet. Say hello to the party!
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="bg-slate-800/50 p-2.5 rounded-lg border border-slate-800 text-left">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-blue-400">{m.username}</span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-slate-200 text-left break-words">{m.message}</p>
                </div>
              ))
            )}
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