// =====================================================
// SOLODS KUDUMCALLER - FIXED WebRTC
// =====================================================

const CONFIG = {
    SERVER_URL: window.location.hostname === 'localhost' 
        ? 'http://localhost:5000' 
        : 'https://kudumcaller.onrender.com',
    MAX_RETRIES: 3,
    ICE_SERVERS: {
        iceServers: [
            // Cloudflare STUN
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:stun.cloudflare.com:53' },
            // Cloudflare TURN
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
            // Google STUN
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            // Metered TURN (Free fallback)
            {
                urls: ['turn:openrelay.metered.ca:80'],
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ]
    }
};

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
    pendingCandidates: [],
    isRinging: false,
    platform: 'desktop'
};

// ===== DOM REFS =====
const $ = (id) => document.getElementById(id);
const dom = {
    loading: $('loading-screen'),
    app: $('app'),
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
    installBtn: $('install-app-btn'),
    installContainer: $('install-btn-container')
};

// ===== PLATFORM DETECTION =====
function detectPlatform() {
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(navigator.userAgent);
    state.platform = isMobile ? 'mobile' : 'desktop';
    console.log('Platform:', state.platform);
    return state.platform;
}

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

// ===== WEBRTC SETUP WITH ICE DEBUGGING =====
async function setupWebRTC() {
    try {
        state.localStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        
        state.peerConnection = new RTCPeerConnection(CONFIG.ICE_SERVERS);
        
        // ===== ICE CONNECTION STATE =====
        state.peerConnection.oniceconnectionstatechange = () => {
            const s = state.peerConnection.iceConnectionState;
            console.log('ICE Connection State:', s);
            if (s === 'failed') {
                showToast('Network issue! Try using a different network.', 'error');
                endCall();
            } else if (s === 'connected') {
                console.log('ICE Connected! Audio should work.');
            }
        };
        
        // ===== ICE CANDIDATE LOGGING =====
        state.peerConnection.onicecandidate = (event) => {
            if (event.candidate && state.socket && state.roomId) {
                console.log('ICE Candidate:', event.candidate.type);
                state.socket.emit('signal', {
                    roomId: state.roomId,
                    signal: { candidate: event.candidate }
                });
            }
        };
        
        state.localStream.getTracks().forEach(track => {
            state.peerConnection.addTrack(track, state.localStream);
        });
        
        state.peerConnection.ontrack = (event) => {
            console.log('✅ Remote audio track received!');
            const remoteAudio = new Audio();
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.play().catch(err => console.warn('Autoplay:', err));
            dom.statusText.textContent = 'Connected - Talk now! 🎤';
            state.isConnected = true;
            updateCallStatus('connected');
            showToast('Call connected!', 'success');
            dom.incomingCall.classList.add('hidden');
            stopRinging();
        };
        
        state.peerConnection.onconnectionstatechange = () => {
            const s = state.peerConnection.connectionState;
            console.log('Connection State:', s);
            if (s === 'connected') {
                dom.statusText.textContent = 'Connected - Talk now! 🎤';
                updateCallStatus('connected');
                dom.incomingCall.classList.add('hidden');
                stopRinging();
            } else if (s === 'disconnected' || s === 'failed') {
                dom.statusText.textContent = 'Disconnected';
                updateCallStatus('disconnected');
                showToast('Call disconnected', 'error');
            }
        };
        
        return true;
    } catch (error) {
        console.error('WebRTC error:', error);
        showToast('Microphone access denied', 'error');
        throw error;
    }
}

// ===== RINGTONE =====
let ringInterval = null;
let ringtoneAudio = null;

function playRingtone() {
    if (!window.userInteracted) return;
    try {
        if (!ringtoneAudio) {
            ringtoneAudio = new Audio('data:audio/wav;base64,UklGRnoAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoAAACBhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqF');
            ringtoneAudio.volume = 0.5;
            ringtoneAudio.loop = true;
        }
        ringtoneAudio.play().catch(() => {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') ctx.resume();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 800;
            osc.type = 'square';
            gain.gain.value = 0.2;
            osc.start();
            setTimeout(() => osc.stop(), 300);
        });
    } catch (e) { console.warn('Ringtone:', e); }
}

function startRinging() {
    stopRinging();
    state.isRinging = true;
    ringInterval = setInterval(playRingtone, 2000);
}

function stopRinging() {
    state.isRinging = false;
    if (ringInterval) { clearInterval(ringInterval); ringInterval = null; }
    if (ringtoneAudio) { ringtoneAudio.pause(); ringtoneAudio.currentTime = 0; }
}

// ===== CALL EVENTS =====
function handleIncomingCall(data) {
    console.log('Incoming call from:', data.from);
    if (state.isReceiver) {
        dom.incomingCall.classList.remove('hidden');
        dom.participantStatus.textContent = 'Incoming call... 📞';
        dom.statusText.textContent = 'Tap Accept to answer';
        if (window.userInteracted) startRinging();
        showToast('Incoming call!', 'info');
    }
}

function handleCallConnected(data) {
    console.log('Call connected:', data);
    dom.statusText.textContent = 'Connected - Talk now! 🎤';
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
            console.log('📨 Received offer');
            state.pendingOffer = signal.offer;
            
            if (state.isReceiver) {
                dom.incomingCall.classList.remove('hidden');
                dom.participantStatus.textContent = 'Incoming call... 📞';
                dom.statusText.textContent = 'Tap Accept to answer';
                if (window.userInteracted) startRinging();
                showToast('Incoming call!', 'info');
            }
            
        } else if (signal.answer) {
            console.log('📨 Received answer');
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.answer));
            dom.incomingCall.classList.add('hidden');
            stopRinging();
            dom.statusText.textContent = 'Connected - Talk now! 🎤';
            updateCallStatus('connected');
            state.isConnected = true;
            showToast('Call connected!', 'success');
            
        } else if (signal.candidate) {
            console.log('📨 Received candidate');
            if (state.peerConnection.remoteDescription) {
                await state.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } else {
                if (!state.pendingCandidates) state.pendingCandidates = [];
                state.pendingCandidates.push(signal.candidate);
            }
        }
    } catch (error) {
        console.error('Signal error:', error);
    }
}

// ===== USER EVENTS =====
function handleUserJoined(data) {
    console.log('User joined:', data);
    if (state.isCaller) {
        dom.participantStatus.textContent = 'Calling... 📞';
        dom.statusText.textContent = 'Ringing...';
        state.peerConnection.createOffer()
            .then(offer => state.peerConnection.setLocalDescription(offer))
            .then(() => {
                state.socket.emit('signal', {
                    roomId: state.roomId,
                    signal: { offer: state.peerConnection.localDescription }
                });
            })
            .catch(console.error);
        if (window.userInteracted) startRinging();
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
    state.pendingCandidates = [];
    dom.incomingCall.classList.add('hidden');
    stopRinging();
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
    window.userInteracted = true;
    dom.incomingCall.classList.add('hidden');
    stopRinging();
    dom.statusText.textContent = 'Connecting...';
    updateCallStatus('connecting');
    dom.participantStatus.textContent = 'Connecting... 🔗';
    showToast('Call accepted!', 'success');
    
    if (state.pendingOffer) {
        state.peerConnection.setRemoteDescription(new RTCSessionDescription(state.pendingOffer))
            .then(() => {
                if (state.pendingCandidates && state.pendingCandidates.length > 0) {
                    state.pendingCandidates.forEach(candidate => {
                        state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                            .catch(console.error);
                    });
                    state.pendingCandidates = [];
                }
                return state.peerConnection.createAnswer();
            })
            .then(answer => state.peerConnection.setLocalDescription(answer))
            .then(() => {
                state.socket.emit('signal', {
                    roomId: state.roomId,
                    signal: { answer: state.peerConnection.localDescription }
                });
                state.pendingOffer = null;
                state.socket.emit('call-accepted', { roomId: state.roomId });
            })
            .catch(console.error);
    }
}

function declineCall() {
    dom.incomingCall.classList.add('hidden');
    stopRinging();
    state.pendingOffer = null;
    state.pendingCandidates = [];
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
    switch(status) {
        case 'connecting': indicator.classList.add('connecting'); text.textContent = 'Connecting...'; break;
        case 'connected': indicator.classList.add('connected'); text.textContent = 'Connected - Talk now! 🎤'; break;
        case 'disconnected': indicator.classList.add('disconnected'); text.textContent = 'Disconnected'; break;
        default: text.textContent = 'Ready';
    }
}

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

// ===== PWA INSTALL =====
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (dom.installContainer) {
        dom.installContainer.style.display = 'block';
    }
});

window.addEventListener('appinstalled', () => {
    console.log('PWA installed');
    if (dom.installContainer) dom.installContainer.style.display = 'none';
});

// ===== EVENT HANDLERS =====
async function handleCreateCall() {
    try {
        if (!window.userInteracted) {
            showToast('Tap the screen to enable audio', 'info');
        }
        await ensureSocket();
        await createRoom();
        dom.homeScreen.classList.add('hidden');
        dom.callScreen.classList.remove('hidden');
        dom.roomDisplay.textContent = state.roomId;
        dom.participantStatus.textContent = 'Waiting for someone to join... 🔄';
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
        await ensureSocket();
        await joinRoom(roomId);
        dom.homeScreen.classList.add('hidden');
        dom.callScreen.classList.remove('hidden');
        dom.roomDisplay.textContent = roomId;
        dom.participantStatus.textContent = 'Joining call... 📞';
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
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.value = 0.001;
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
        window.audioContext = ctx;
    } catch (e) { console.warn('Audio unlock:', e); }
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

if (dom.installBtn) {
    dom.installBtn.addEventListener('click', () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === 'accepted') {
                    console.log('PWA installed');
                }
                deferredPrompt = null;
                if (dom.installContainer) dom.installContainer.style.display = 'none';
            });
        }
    });
}

document.addEventListener('click', enableAudioOnInteraction);
document.addEventListener('touchstart', enableAudioOnInteraction);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.isInCall) endCall();
    if (e.key === 'm' && state.isInCall) toggleMute();
});

// ===== INIT =====
async function init() {
    try {
        detectPlatform();
        await connectSocket();
        hideLoading();
        checkUrlForRoom();
        console.log('SoloDS KudumCaller initialized');
        console.log('Platform:', state.platform);
        console.log('Server:', CONFIG.SERVER_URL);
        console.log('ICE Servers:', CONFIG.ICE_SERVERS);
    } catch (error) {
        console.error('Init error:', error);
        hideLoading();
        showToast('Failed to connect to server. Please refresh.', 'error');
    }
}

init();
