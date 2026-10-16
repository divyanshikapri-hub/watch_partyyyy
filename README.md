# 🎬 Watch Party Live

A real-time, synchronized video streaming and collaborative viewing application designed for seamless shared experiences across devices. Built as a Progressive Web App (PWA) using React, TypeScript, Node.js, and Socket.IO, Watch Party Live features millisecond-accurate playback synchronization, intelligent drift compensation, host-restricted access control, and low-latency interactive party features.

---

## 🌟 Key Features

### ⏱️ Adaptive Playback Synchronization
- **Clock Synchronization & RTT Estimation:** Calculates client-server Round-Trip Time (RTT) and propagation delays to coordinate scheduled playback timestamps.
- **Dynamic Drift Compensation:** Mitigates buffering stalls by avoiding abrupt hard-seeks for minor timing offsets. Automatically applies smooth playback-rate scaling ($0.95\times$ to $1.05\times$) for drifts between $150\text{ ms}$ and $500\text{ ms}$, restricting programmatic hard-seeks only to substantial discrepancies ($>500\text{ ms}$).
- **Recursive Event Suppression:** Uses a debounced lock window ($300\text{–}400\text{ ms}$) during sync-driven timeline adjustments to prevent native browser `onSeeked` and `onPlay` events from looping back to the server.

### 🛡️ Host Privilege & Control Architecture
- **Host Role Assignment:** The client who creates or first establishes the session is assigned room host privileges.
- **Restricted Playback Actions:** Server-side and client-side guards ensure that only the designated room host can play, pause, seek, or change stream URLs.
- **Clean Peer Experience:** Peer clients receive synchronized streams without interactive timeline disruptions, with dynamic badges showing current host status.

### 💬 Real-Time Interactivity
- **Instant Room Chat:** Lightweight, low-latency room chat powered by Socket.IO with single-source broadcast deduplication to prevent duplicate message rendering.
- **Live Floating Reactions:** Real-time emoji reaction triggers that render synchronized, animated floating overlays directly across the video stage for all connected viewers.

### 📱 Progressive Web App (PWA)
- Fully installable on desktop (Chrome, Edge) and mobile (Android, iOS).
- Runs in standalone window mode without browser URL bars, complete with dedicated app icons and offline asset caching via Workbox and `vite-plugin-pwa`.

### 🌐 High-Availability Streaming Playlist
- Preconfigured with reliable, CORS-unrestricted direct MP4 CDN endpoints (Video.js, W3C, Mozilla CC0, and W3Schools) to ensure barrier-free playback across institutional firewalls and mobile hotspots.
- Client-side fuzzy search powered by Fuse.js for rapid title discovery.

---

## 🛠️ Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, Lucide Icons, Fuse.js
- **PWA Tooling:** `vite-plugin-pwa`, Web App Manifest, Service Workers
- **Backend:** Node.js, Express, Socket.IO, TypeScript (`tsx`)
- **Networking Protocols:** WebSockets (WSS/WS), HTTP/1.1 Range Requests

---

## 📂 Project Architecture

```text
watch_partyyyy/
├── client/
│   ├── public/              # PWA manifest assets & icons
│   ├── src/
│   │   ├── App.tsx          # Main interactive interface & state manager
│   │   ├── syncManager.ts   # RTT tracking & drift compensation engine
│   │   ├── index.css        # Tailwind directives & floating animations
│   │   └── main.tsx         # Application entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts       # Vite configuration with VitePWA setup
├── server/
│   ├── src/
│   │   └── index.ts         # Express server & Socket.IO room coordination
│   ├── package.json
│   └── tsconfig.json
└── README.md