// =====================================================
// SOLODS KUDUMCALLER - Complete WebRTC Voice Calling App
// Platform-aware: desktop gets keyboard shortcuts + network
// diagnostics, mobile gets install/ringtone/vibration/wake-lock.
// =====================================================

// ===== CONFIGURATION =====
const CONFIG = {
    SERVER_URL: window.location.hostname === 'localhost'
        ? 'http://localhost:5000'
        : 'https://kudumcaller.onrender.com',
    MAX_RETRIES: 3,
    ICE_SERVERS: {
        iceServers: [
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:stun.cloudflare.com:53' },
            {
                urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
                username: 'any-username',
                credential: 'any-credential'
            },
            {
                urls: ['turns:turn.cloudflare.com:5349'],
                username: 'any-username',
                credential: 'any-credential'
            },
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    }
};

// ===== PLATFORM DETECTION =====
// Capability-based, not just screen width - a touch laptop should still
// get desktop treatment (keyboard shortcuts, network diagnostics), while
// an iPad (which reports as "Mac" in its UA since iPadOS 13) should get
// mobile treatment (ringtone, wake lock, vibration).
function detectIsMobile() {
    const ua = navigator.userAgent || '';
    const isMobileUA = /Android|iPhone|iPod|Mobile|Windows Phone/i.test(ua);
    const isIPad = /iPad/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    const isCoarsePointerSmallScreen = window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 900;
    return isMobileUA || isIPad || isCoarsePointerSmallScreen;
}

function isStandaloneDisplay() {
    return window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.navigator.standalone === true; // legacy iOS Safari flag
}

const isMobile = detectIsMobile();

function applyPlatformClasses() {
    const html = document.documentElement;
    html.classList.toggle('platform-mobile', isMobile);
    html.classList.toggle('platform-desktop', !isMobile);
    html.classList.toggle('standalone', isStandaloneDisplay());
}
applyPlatformClasses();

// ===== STATE =====
const state = {
    socket: null,
    localStream: null,
    peerConnection: null,
    roomId: null,
    isHost: false,
    isConnected: false,
    isMuted: false,
    isInCall: false,
    callCount: 0,
    isCaller: false,
    isReceiver: false,
    pendingOffer: null,
    isRinging: false,
    wakeLock: null
};

let swRegistration = null;
let deferredInstallPrompt = null;
let statsIntervalId = null;

// ===== DOM REFS =====
const $ = (id) => document.getElementById(id);
const dom = {
    loading: $('loading-screen'),
    app: $('app'),
    rotateOverlay: $('rotate-overlay'),
    homeScreen: $('home-screen'),
    callScreen: $('call-screen'),
    incomingCall: $('incoming-call'),
    connectionStatus: $('connection-status'),
    createCallBtn: $('create-call-btn'),
    joinCallBtn: $('join-call-btn'),
    roomInput: $('room-input'),
    roomDisplay: $('room-display'),
    roomLinkDisplay: $('room-link-display'),
    participantStatus: $('participant-status'),
    statusText: $('status-text'),
    connectionIndicator: $('connection-indicator'),
    muteBtn: $('mute-btn'),
    endCallBtn: $('end-call-btn'),
    acceptCallBtn: $('accept-call-btn'),
    declineCallBtn: $('decline-call-btn'),
    copyRoomBtn: $('copy-room-btn'),
    copyLinkBtn: $('copy-link-btn'),
    shareWhatsappBtn: $('share-whatsapp-btn'),
    shareSmsBtn: $('share-sms-btn'),
    shareEmailBtn: $('share-email-btn'),
    shareCopyBtn: $('share-copy-btn'),
    toastContainer: $('toast-container'),
    callCount: $('call-count'),
    installBanner: $('install-banner'),
    installBtn: $('install-btn'),
    dismissInstallBtn: $('dismiss-install-btn'),
    updateBanner: $('update-banner'),
    updateBtn: $('update-btn'),
    networkInfo: $('network-info'),
    toggleNetworkInfoBtn: $('toggle-network-info-btn'),
    netCandidateType: $('net-candidate-type'),
    netRtt: $('net-rtt'),
    netCodec: $('net-codec'),
    netPacketLoss: $('net-packet-loss')
};

// ===== TOAST =====
function showToast(msg, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = msg;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ===== LOADING =====
function hideLoading() {
    dom.loading.style.opacity = '0';
    setTimeout(() => {
        dom.loading.style.display = 'none';
        dom.app.classList.remove('hidden');
        dom.app.style.opacity = '1';
    }, 500);
}

// ===== SOCKET =====
function connectSocket() {
    return new Promise((resolve, reject) => {
        try {
            if (typeof io === 'undefined') {
                reject(new Error('Socket.io not loaded'));
                return;
            }
            const socket = io(CONFIG.SERVER_URL, {
                transports: ['websocket', 'polling'],
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                timeout: 10000
            });
            socket.on('connect', () => {
                console.log('Socket connected');
                state.socket = socket;
                updateConnectionStatus(true);
                resolve(socket);
            });
            socket.on('connect_error', (error) => {
                console.error('Socket error:', error);
                updateConnectionStatus(false);
                reject(error);
            });
            socket.on('disconnect', () => {
                console.log('Disconnected');
                updateConnectionStatus(false);
                if (state.isInCall) endCall();
            });
            socket.on('signal', handleSignal);
            socket.on('user-joined', handleUserJoined);
            socket.on('user-left', handleUserLeft);
            socket.on('user-muted', handleUserMuted);
            socket.on('new-host', handleNewHost);
            socket.on('incoming-call', handleIncomingCall);
            socket.on('call-connected', handleCallConnected);
            socket.on('call-ended', handleCallEnded);
        } catch (error) {
            reject(error);
        }
    });
}

function updateConnectionStatus(connected) {
    const badge = dom.connectionStatus;
    if (connected) {
        badge.textContent = '● Connected';
        badge.className = 'status-badge';
    } else {
        badge.textContent = '● Disconnected';
        badge.className = 'status-badge disconnected';
    }
}

// ===== ROOM FUNCTIONS =====
async function createRoom() {
    try {
        showToast('Creating room...', 'info');
        const socket = await ensureSocket();
        return new Promise((resolve, reject) => {
            socket.emit('create-room', (response) => {
                if (response && response.success) {
                    state.roomId = response.roomId;
                    state.isHost = true;
                    state.isCaller = true;
                    state.isReceiver = false;
                    state.callCount++;
                    dom.callCount.textContent = state.callCount;
                    showToast('Room created: ' + response.roomId, 'success');
                    resolve(response.roomId);
                } else {
                    reject(new Error('Failed to create room'));
                }
            });
        });
    } catch (error) {
        showToast(error.message, 'error');
        throw error;
    }
}

async function joinRoom(roomId) {
    try {
        showToast('Joining room ' + roomId + '...', 'info');
        const socket = await ensureSocket();
        return new Promise((resolve, reject) => {
            socket.emit('join-room', roomId, (response) => {
                if (response && response.success) {
                    state.roomId = roomId;
                    state.isHost = false;
                    state.isCaller = false;
                    state.isReceiver = true;
                    showToast('Joined room ' + roomId, 'success');
                    resolve(roomId);
                } else {
                    reject(new Error(response?.error || 'Failed to join room'));
                }
            });
        });
    } catch (error) {
        showToast(error.message, 'error');
        throw error;
    }
}

async function ensureSocket() {
    if (state.socket && state.socket.connected) return state.socket;
    return await connectSocket();
}

// ===== WEBRTC =====
async function setupWebRTC() {
    try {
        state.localStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        state.peerConnection = new RTCPeerConnection(CONFIG.ICE_SERVERS);
        state.localStream.getTracks().forEach(track => {
            state.peerConnection.addTrack(track, state.localStream);
        });
        state.peerConnection.ontrack = (event) => {
            const remoteAudio = new Audio();
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.play().catch(err => console.warn('Autoplay:', err));
            dom.statusText.textContent = 'Connected - Talk now!';
            state.isConnected = true;
            updateCallStatus('connected');
            showToast('Call connected!', 'success');
            dom.incomingCall.classList.add('hidden');
            stopRinging();
            acquireWakeLock();
            startNetworkStats();
        };
        state.peerConnection.onicecandidate = (event) => {
            if (event.candidate && state.socket && state.roomId) {
                state.socket.emit('signal', {
                    roomId: state.roomId,
                    signal: { candidate: event.candidate }
                });
            }
        };
        state.peerConnection.onconnectionstatechange = () => {
            const s = state.peerConnection.connectionState;
            console.log('Connection state:', s);
            if (s === 'connected') {
                dom.statusText.textContent = 'Connected - Talk now!';
                updateCallStatus('connected');
                dom.incomingCall.classList.add('hidden');
                stopRinging();
                acquireWakeLock();
                startNetworkStats();
            } else if (s === 'disconnected' || s === 'failed') {
                dom.statusText.textContent = 'Disconnected';
                updateCallStatus('disconnected');
                showToast('Call disconnected', 'error');
                stopNetworkStats();
            }
        };
        return true;
    } catch (error) {
        console.error('WebRTC error:', error);
        showToast('Microphone access denied', 'error');
        throw error;
    }
}

// ===== RINGTONE (Web Audio API - classic two-tone ring cadence) =====
// Using Web Audio oscillators instead of a static audio file means the
// ringtone works offline, needs no asset to host/cache, and loops
// reliably (HTMLAudioElement looping short clips is a common source of
// mobile audio glitches). The 440Hz + 480Hz pair matches the classic
// North American ring tone; cadence is ~2s on / 4s off.
let vibrateIntervalId = null;

function getSharedAudioContext() {
    if (!window.audioContext) {
        try {
            window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('AudioContext unavailable:', e);
            return null;
        }
    }
    if (window.audioContext.state === 'suspended') {
        window.audioContext.resume().catch(() => {});
    }
    return window.audioContext;
}

function playRingBurst() {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    try {
        const now = ctx.currentTime;
        [440, 480].forEach((freq) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.linearRampToValueAtTime(0.22, now + 0.05);
            gain.gain.setValueAtTime(0.22, now + 1.9);
            gain.gain.linearRampToValueAtTime(0.0001, now + 2.0);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 2.05);
        });
    } catch (e) {
        console.warn('Ringtone burst failed:', e);
    }
}

function startRinging() {
    stopRinging();
    state.isRinging = true;
    playRingBurst();
    ringInterval = setInterval(playRingBurst, 4000);

    // Vibration is mobile-only per spec, and only supported on Android
    // (iOS Safari does not implement the Vibration API).
    if (isMobile && navigator.vibrate) {
        const pattern = [700, 500, 700, 500];
        navigator.vibrate(pattern);
        vibrateIntervalId = setInterval(() => navigator.vibrate(pattern), 4000);
    }
}
let ringInterval = null;

function stopRinging() {
    state.isRinging = false;
    if (ringInterval) { clearInterval(ringInterval); ringInterval = null; }
    if (vibrateIntervalId) { clearInterval(vibrateIntervalId); vibrateIntervalId = null; }
    if (navigator.vibrate) navigator.vibrate(0);
}

// ===== CALL EVENTS =====
function handleIncomingCall(data) {
    console.log('Incoming call from:', data.from);
    dom.incomingCall.classList.remove('hidden');
    dom.participantStatus.textContent = 'Incoming call...';
    dom.statusText.textContent = 'Tap Accept to answer';
    startRinging();
    notifyIncomingCallIfBackgrounded();
    showToast('Incoming call!', 'info');
}

function handleCallConnected(data) {
    console.log('Call connected:', data);
    dom.statusText.textContent = 'Connected - Talk now!';
    updateCallStatus('connected');
    dom.incomingCall.classList.add('hidden');
    stopRinging();
    showToast('Call connected!', 'success');
}

function handleCallEnded(data) {
    console.log('Call ended:', data);
    showToast('Call ended', 'info');
    endCall();
}

// ===== SIGNALING =====
async function handleSignal(data) {
    if (!state.peerConnection) return;
    try {
        const { signal } = data;
        if (signal.offer) {
            // RECEIVER: Show incoming call
            dom.incomingCall.classList.remove('hidden');
            dom.participantStatus.textContent = 'Incoming call...';
            dom.statusText.textContent = 'Tap Accept to answer';
            state.pendingOffer = signal.offer;
            startRinging();
            notifyIncomingCallIfBackgrounded();
        } else if (signal.answer) {
            // CALLER: Call is answered
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.answer));
            dom.incomingCall.classList.add('hidden');
            stopRinging();
            dom.statusText.textContent = 'Connected - Talk now!';
            updateCallStatus('connected');
            state.isConnected = true;
            showToast('Call connected!', 'success');
        } else if (signal.candidate) {
            await state.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
    } catch (error) {
        console.error('Signal error:', error);
    }
}

// ===== USER EVENTS =====
function handleUserJoined(data) {
    console.log('User joined:', data);
    // CALLER: Someone joined, show "Calling..."
    if (state.isCaller) {
        dom.participantStatus.textContent = 'Calling...';
        dom.statusText.textContent = 'Ringing...';
        // Send offer
        state.peerConnection.createOffer()
            .then(offer => state.peerConnection.setLocalDescription(offer))
            .then(() => {
                state.socket.emit('signal', {
                    roomId: state.roomId,
                    signal: { offer: state.peerConnection.localDescription }
                });
            })
            .catch(console.error);
        startRinging();
    }
}

function handleUserLeft(data) {
    console.log('User left:', data);
    dom.participantStatus.textContent = 'User left the call';
    dom.statusText.textContent = 'Waiting for someone...';
    showToast('Other user left', 'info');
    state.isConnected = false;
    updateCallStatus('connecting');
    dom.incomingCall.classList.add('hidden');
    stopRinging();
    stopNetworkStats();
}

function handleUserMuted(data) {
    if (data.userId !== state.socket.id) {
        showToast(data.muted ? 'Other user muted' : 'Other user unmuted', 'info');
    }
}

function handleNewHost(data) {
    showToast('You are now the host', 'info');
}

// ===== CALL CONTROLS =====
function toggleMute() {
    if (!state.localStream) return;
    state.isMuted = !state.isMuted;
    state.localStream.getAudioTracks().forEach(track => track.enabled = !state.isMuted);
    dom.muteBtn.classList.toggle('muted', state.isMuted);
    const icon = dom.muteBtn.querySelector('.control-icon');
    icon.textContent = state.isMuted ? '🔇' : '🎤';
    dom.muteBtn.querySelector('.control-label').textContent = state.isMuted ? 'Unmute' : 'Mute';
    if (state.socket && state.roomId) {
        state.socket.emit('toggle-mute', { roomId: state.roomId, muted: state.isMuted });
    }
}

function endCall() {
    if (state.peerConnection) { state.peerConnection.close(); state.peerConnection = null; }
    if (state.localStream) { state.localStream.getTracks().forEach(t => t.stop()); state.localStream = null; }
    state.isConnected = false;
    state.isInCall = false;
    state.pendingOffer = null;
    dom.incomingCall.classList.add('hidden');
    stopRinging();
    stopNetworkStats();
    releaseWakeLock();
    dom.callScreen.classList.add('hidden');
    dom.homeScreen.classList.remove('hidden');
    dom.statusText.textContent = 'Ready';
    dom.participantStatus.textContent = '';
    dom.muteBtn.classList.remove('muted');
    dom.muteBtn.querySelector('.control-icon').textContent = '🎤';
    dom.muteBtn.querySelector('.control-label').textContent = 'Mute';
    updateCallStatus('idle');
    if (state.socket && state.roomId) {
        state.socket.disconnect();
        state.socket = null;
    }
    state.roomId = null;
    state.isHost = false;
    state.isCaller = false;
    state.isReceiver = false;
    showToast('Call ended', 'info');
}

function acceptCall() {
    // RECEIVER: Accept the call
    window.userInteracted = true;
    dom.incomingCall.classList.add('hidden');
    stopRinging();
    dom.statusText.textContent = 'Connecting...';
    updateCallStatus('connecting');
    dom.participantStatus.textContent = 'Connecting...';
    showToast('Call accepted!', 'success');

    if (state.pendingOffer) {
        state.peerConnection.setRemoteDescription(new RTCSessionDescription(state.pendingOffer))
            .then(() => state.peerConnection.createAnswer())
            .then(answer => state.peerConnection.setLocalDescription(answer))
            .then(() => {
                state.socket.emit('signal', {
                    roomId: state.roomId,
                    signal: { answer: state.peerConnection.localDescription }
                });
                state.pendingOffer = null;
                // Notify server call was accepted
                state.socket.emit('call-accepted', { roomId: state.roomId });
            })
            .catch(console.error);
    }
}

function declineCall() {
    dom.incomingCall.classList.add('hidden');
    stopRinging();
    state.pendingOffer = null;
    if (state.socket && state.roomId) {
        state.socket.emit('call-declined', { roomId: state.roomId });
    }
    showToast('Call declined', 'info');
    endCall();
}

function updateCallStatus(status) {
    const indicator = dom.connectionIndicator;
    const text = dom.statusText;
    indicator.className = 'status-indicator';
    switch (status) {
        case 'connecting': indicator.classList.add('connecting'); text.textContent = 'Connecting...'; break;
        case 'connected': indicator.classList.add('connected'); text.textContent = 'Connected - Talk now!'; break;
        case 'disconnected': indicator.classList.add('disconnected'); text.textContent = 'Disconnected'; break;
        default: text.textContent = 'Ready';
    }
}

// ===== SCREEN WAKE LOCK (mobile only) =====
// Keeps the screen on during a call so the call doesn't drop when the
// phone auto-locks. Desktop machines don't sleep mid-call the same way,
// so this is gated to mobile per spec.
async function acquireWakeLock() {
    if (!isMobile || !('wakeLock' in navigator) || state.wakeLock) return;
    try {
        state.wakeLock = await navigator.wakeLock.request('screen');
        state.wakeLock.addEventListener('release', () => {
            console.log('Wake lock released');
        });
        console.log('Wake lock acquired');
    } catch (err) {
        console.warn('Wake lock request failed:', err);
    }
}

function releaseWakeLock() {
    if (state.wakeLock) {
        state.wakeLock.release().catch(() => {});
        state.wakeLock = null;
    }
}

// Wake locks are automatically released when a tab is backgrounded;
// re-acquire when the user returns to an active call.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.isInCall && isMobile) {
        acquireWakeLock();
    }
});

// ===== NETWORK DIAGNOSTICS (desktop only) =====
function startNetworkStats() {
    if (isMobile || !state.peerConnection || statsIntervalId) return;
    dom.toggleNetworkInfoBtn?.classList.remove('hidden');
    updateNetworkStats();
    statsIntervalId = setInterval(updateNetworkStats, 2000);
}

function stopNetworkStats() {
    if (statsIntervalId) { clearInterval(statsIntervalId); statsIntervalId = null; }
    dom.toggleNetworkInfoBtn?.classList.add('hidden');
    dom.networkInfo?.classList.add('hidden');
    if (dom.toggleNetworkInfoBtn) dom.toggleNetworkInfoBtn.textContent = 'Show network details';
}

async function updateNetworkStats() {
    if (!state.peerConnection) return;
    try {
        const reports = await state.peerConnection.getStats();
        let selectedPairId = null;
        let candidateType = '-', rtt = '-', codec = '-', packetsLost = '-';

        reports.forEach((report) => {
            if (report.type === 'transport' && report.selectedCandidatePairId) {
                selectedPairId = report.selectedCandidatePairId;
            }
            if (report.type === 'candidate-pair' && (report.selected || report.nominated) && !selectedPairId) {
                selectedPairId = report.id;
            }
            if (report.type === 'inbound-rtp' && report.kind === 'audio' && report.packetsLost !== undefined) {
                packetsLost = String(report.packetsLost);
            }
            if (report.type === 'codec' && report.mimeType && report.mimeType.startsWith('audio')) {
                codec = report.mimeType.replace('audio/', '');
            }
        });

        if (selectedPairId) {
            const pair = reports.get(selectedPairId);
            if (pair) {
                if (pair.currentRoundTripTime !== undefined) {
                    rtt = Math.round(pair.currentRoundTripTime * 1000) + ' ms';
                }
                const localCandidate = reports.get(pair.localCandidateId);
                if (localCandidate && localCandidate.candidateType) {
                    candidateType = localCandidate.candidateType === 'relay' ? 'relay (TURN)' : localCandidate.candidateType;
                }
            }
        }

        if (dom.netCandidateType) dom.netCandidateType.textContent = candidateType;
        if (dom.netRtt) dom.netRtt.textContent = rtt;
        if (dom.netCodec) dom.netCodec.textContent = codec;
        if (dom.netPacketLoss) dom.netPacketLoss.textContent = packetsLost;
    } catch (err) {
        console.warn('getStats failed:', err);
    }
}

dom.toggleNetworkInfoBtn?.addEventListener('click', () => {
    const willShow = dom.networkInfo.classList.contains('hidden');
    dom.networkInfo.classList.toggle('hidden', !willShow);
    dom.toggleNetworkInfoBtn.textContent = willShow ? 'Hide network details' : 'Show network details';
});

// ===== NOTIFICATIONS FOR BACKGROUNDED TAB (mobile only) =====
// This covers the case where the PWA tab is open but backgrounded (user
// switched apps). It relies on the socket connection staying alive, so
// it does NOT cover the fully-closed-app case - true "app is closed and
// still rings" behavior needs the Web Push protocol: VAPID keys, a
// subscription endpoint on the Render backend, and the `web-push` npm
// package to send payloads server-side. The service worker's 'push'
// handler is already wired up and ready for that; this function is the
// interim best-effort while the app/tab is merely backgrounded.
async function requestNotificationPermission() {
    if (!isMobile || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
    }
}

function notifyIncomingCallIfBackgrounded() {
    if (!isMobile) return;
    if (document.visibilityState !== 'hidden') return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!swRegistration) return;
    swRegistration.showNotification('📞 Incoming Call', {
        body: 'Someone is calling you on KudumCaller',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        vibrate: [300, 150, 300, 150, 300],
        tag: 'kudumcaller-incoming-call',
        renotify: true,
        requireInteraction: true
    }).catch((err) => console.warn('showNotification failed:', err));
}

// ===== SERVICE WORKER (install, offline cache, update flow) =====
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', async () => {
        try {
            swRegistration = await navigator.serviceWorker.register('service-worker.js');
            swRegistration.addEventListener('updatefound', () => {
                const newWorker = swRegistration.installing;
                if (!newWorker) return;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        dom.updateBanner?.classList.remove('hidden');
                    }
                });
            });
        } catch (err) {
            console.warn('Service worker registration failed:', err);
        }
    });

    let hasReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hasReloaded) return;
        hasReloaded = true;
        window.location.reload();
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'notification-action') {
            if (event.data.action === 'accept') acceptCall();
            else if (event.data.action === 'decline') declineCall();
        }
    });
}

dom.updateBtn?.addEventListener('click', () => {
    if (swRegistration && swRegistration.waiting) {
        swRegistration.waiting.postMessage('SKIP_WAITING');
    } else {
        window.location.reload();
    }
});

// ===== INSTALL PROMPT (mobile only, per spec - desktop is not installable) =====
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (isMobile && !isStandaloneDisplay() && !sessionStorage.getItem('kudumcaller-install-dismissed')) {
        dom.installBanner?.classList.remove('hidden');
    }
});

dom.installBtn?.addEventListener('click', async () => {
    dom.installBanner?.classList.add('hidden');
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
});

dom.dismissInstallBtn?.addEventListener('click', () => {
    dom.installBanner?.classList.add('hidden');
    sessionStorage.setItem('kudumcaller-install-dismissed', '1');
});

window.addEventListener('appinstalled', () => {
    dom.installBanner?.classList.add('hidden');
    showToast('KudumCaller installed!', 'success');
});

// ===== ORIENTATION (mobile only - portrait preferred) =====
async function lockPortraitOrientation() {
    if (!isMobile) return;
    try {
        if (screen.orientation && typeof screen.orientation.lock === 'function') {
            await screen.orientation.lock('portrait-primary');
        }
    } catch (err) {
        // Orientation lock only works in fullscreen/installed contexts on
        // most browsers - this is expected to fail in a regular browser
        // tab, so the rotate-overlay below is the real fallback.
        console.log('Orientation lock unavailable (expected outside installed PWA):', err.message);
    }
}

function checkOrientationOverlay() {
    if (!isMobile || !dom.rotateOverlay) return;
    const isLandscape = window.matchMedia('(orientation: landscape)').matches;
    dom.rotateOverlay.classList.toggle('hidden', !isLandscape);
}
window.addEventListener('resize', checkOrientationOverlay);
window.addEventListener('orientationchange', checkOrientationOverlay);

// ===== ONLINE / OFFLINE =====
window.addEventListener('online', () => showToast('Back online', 'success'));
window.addEventListener('offline', () => showToast('You\u2019re offline - calls may drop', 'error'));

// ===== SHARE =====
function getRoomLink() {
    if (!state.roomId) return '';
    const baseUrl = window.location.origin + '/kudumcaller/client';
    return baseUrl + '?room=' + state.roomId;
}

function copyRoomLink() {
    const link = getRoomLink();
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
        showToast('Link copied!', 'success');
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = link;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showToast('Link copied!', 'success');
    });
}

function updateLinkDisplay() {
    const link = getRoomLink();
    if (dom.roomLinkDisplay) dom.roomLinkDisplay.value = link;
}

function shareViaWhatsApp() {
    const link = getRoomLink();
    if (!link) return;
    window.open('https://wa.me/?text=' + encodeURIComponent('Join my SoloDS KudumCaller call: ' + link), '_blank');
}

function shareViaSMS() {
    const link = getRoomLink();
    if (!link) return;
    window.open('sms:?body=' + encodeURIComponent('Join my SoloDS KudumCaller call: ' + link), '_blank');
}

function shareViaEmail() {
    const link = getRoomLink();
    if (!link) return;
    window.open('mailto:?subject=' + encodeURIComponent('Join my SoloDS KudumCaller call') + '&body=' + encodeURIComponent('Hi,\n\nJoin my voice call using this link:\n' + link + '\n\n- SoloDS KudumCaller'), '_blank');
}

function checkUrlForRoom() {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    if (roomId) {
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(() => handleJoinRoom(roomId), 500);
    }
}

// ===== EVENT HANDLERS =====
async function handleCreateCall() {
    try {
        if (!window.userInteracted) {
            showToast('Tap the screen to enable audio', 'info');
        }
        requestNotificationPermission();
        await ensureSocket();
        await createRoom();
        dom.homeScreen.classList.add('hidden');
        dom.callScreen.classList.remove('hidden');
        dom.roomDisplay.textContent = state.roomId;
        dom.participantStatus.textContent = 'Waiting for someone to join...';
        state.isInCall = true;
        await setupWebRTC();
        updateLinkDisplay();
        setTimeout(copyRoomLink, 1000);
    } catch (error) {
        console.error('Create call error:', error);
        showToast('Failed to create call', 'error');
    }
}

async function handleJoinRoom(roomId) {
    if (!roomId) {
        roomId = dom.roomInput.value.trim();
    }
    if (!roomId) {
        showToast('Enter a room code', 'error');
        return;
    }
    try {
        if (!window.userInteracted) {
            showToast('Tap the screen to enable audio', 'info');
        }
        requestNotificationPermission();
        await ensureSocket();
        await joinRoom(roomId);
        dom.homeScreen.classList.add('hidden');
        dom.callScreen.classList.remove('hidden');
        dom.roomDisplay.textContent = roomId;
        dom.participantStatus.textContent = 'Joining call...';
        state.isInCall = true;
        await setupWebRTC();
        updateLinkDisplay();
    } catch (error) {
        console.error('Join error:', error);
        showToast(error.message || 'Failed to join room', 'error');
    }
}

function enableAudioOnInteraction() {
    if (window.userInteracted) return;
    window.userInteracted = true;
    console.log('Audio enabled');
    getSharedAudioContext();
}

// ===== EVENT LISTENERS =====
dom.createCallBtn.addEventListener('click', handleCreateCall);
dom.joinCallBtn.addEventListener('click', () => handleJoinRoom());
dom.roomInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleJoinRoom(); });
dom.endCallBtn.addEventListener('click', endCall);
dom.muteBtn.addEventListener('click', toggleMute);
dom.acceptCallBtn.addEventListener('click', acceptCall);
dom.declineCallBtn.addEventListener('click', declineCall);
dom.copyRoomBtn.addEventListener('click', copyRoomLink);
dom.copyLinkBtn.addEventListener('click', copyRoomLink);
dom.shareWhatsappBtn.addEventListener('click', shareViaWhatsApp);
dom.shareSmsBtn.addEventListener('click', shareViaSMS);
dom.shareEmailBtn.addEventListener('click', shareViaEmail);
dom.shareCopyBtn.addEventListener('click', copyRoomLink);

document.addEventListener('click', enableAudioOnInteraction);
document.addEventListener('touchstart', enableAudioOnInteraction);

// Keyboard shortcuts: desktop only, per platform spec (mobile browsers
// rarely have a physical keyboard attached, and binding these globally
// risks intercepting Enter/Escape from mobile virtual keyboards).
if (!isMobile) {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.isInCall) endCall();
        if ((e.key === 'm' || e.key === 'M') && state.isInCall) toggleMute();
    });
}

// ===== INIT =====
async function init() {
    registerServiceWorker();
    checkOrientationOverlay();
    lockPortraitOrientation();
    try {
        await connectSocket();
        hideLoading();
        checkUrlForRoom();
        console.log('SoloDS KudumCaller initialized');
        console.log('Platform:', isMobile ? 'mobile' : 'desktop');
        console.log('Server:', CONFIG.SERVER_URL);
        console.log('Tap screen to enable audio on mobile');
    } catch (error) {
        console.error('Init error:', error);
        hideLoading();
        showToast('Failed to connect to server. Please refresh.', 'error');
    }
}

init();
