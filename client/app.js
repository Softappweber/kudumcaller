// =====================================================
// SOLODS KUDUMCALLER - Complete WebRTC Voice Calling App
// =====================================================

// ===== CONFIGURATION =====
const CONFIG = {
    SERVER_URL: window.location.hostname === 'localhost' 
        ? 'http://localhost:5000' 
        : 'https://kudumcaller.onrender.com',
    MAX_RETRIES: 3,
    ICE_SERVERS: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
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
    remoteUserId: null,
    callCount: 0
};

// ===== DOM REFS =====
const $ = (id) => document.getElementById(id);
const dom = {
    loading: $('loading-screen'),
    app: $('app'),
    homeScreen: $('home-screen'),
    callScreen: $('call-screen'),
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
    copyRoomBtn: $('copy-room-btn'),
    copyLinkBtn: $('copy-link-btn'),
    shareWhatsappBtn: $('share-whatsapp-btn'),
    shareSmsBtn: $('share-sms-btn'),
    shareEmailBtn: $('share-email-btn'),
    shareCopyBtn: $('share-copy-btn'),
    toastContainer: $('toast-container'),
    callCount: $('call-count')
};

// ===== TOAST NOTIFICATIONS =====
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ===== LOADING SCREEN =====
function hideLoading() {
    dom.loading.style.opacity = '0';
    setTimeout(() => {
        dom.loading.style.display = 'none';
        dom.app.classList.remove('hidden');
        dom.app.style.opacity = '1';
    }, 500);
}

// ===== SOCKET CONNECTION =====
function connectSocket() {
    return new Promise((resolve, reject) => {
        try {
            if (typeof io === 'undefined') {
                reject(new Error('Socket.io library not loaded. Please check your internet connection.'));
                return;
            }
            
            const socket = io(CONFIG.SERVER_URL, {
                transports: ['websocket', 'polling'],
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                timeout: 10000
            });
            
            socket.on('connect', () => {
                console.log('🔗 Socket connected');
                state.socket = socket;
                updateConnectionStatus(true);
                resolve(socket);
            });
            
            socket.on('connect_error', (error) => {
                console.error('Socket connection error:', error);
                updateConnectionStatus(false);
                reject(error);
            });
            
            socket.on('disconnect', () => {
                console.log('🔌 Socket disconnected');
                updateConnectionStatus(false);
                if (state.isInCall) {
                    showToast('Connection lost', 'error');
                    endCall();
                }
            });
            
            socket.on('signal', handleSignal);
            socket.on('user-joined', handleUserJoined);
            socket.on('user-left', handleUserLeft);
            socket.on('user-muted', handleUserMuted);
            socket.on('new-host', handleNewHost);
            
        } catch (error) {
            reject(error);
        }
    });
}

// ===== CONNECTION STATUS =====
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

// ===== CREATE ROOM =====
async function createRoom() {
    try {
        showToast('Creating room...', 'info');
        
        const socket = await ensureSocket();
        
        return new Promise((resolve, reject) => {
            socket.emit('create-room', (response) => {
                if (response && response.success) {
                    state.roomId = response.roomId;
                    state.isHost = true;
                    state.callCount++;
                    dom.callCount.textContent = state.callCount;
                    showToast(`Room created: ${response.roomId}`, 'success');
                    resolve(response.roomId);
                } else {
                    reject(new Error(response?.error || 'Failed to create room'));
                }
            });
        });
    } catch (error) {
        showToast(error.message, 'error');
        throw error;
    }
}

// ===== JOIN ROOM =====
async function joinRoom(roomId) {
    try {
        showToast(`Joining room ${roomId}...`, 'info');
        
        const socket = await ensureSocket();
        
        return new Promise((resolve, reject) => {
            socket.emit('join-room', roomId, (response) => {
                if (response && response.success) {
                    state.roomId = roomId;
                    state.isHost = false;
                    showToast(`Joined room ${roomId}`, 'success');
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

// ===== ENSURE SOCKET =====
async function ensureSocket() {
    if (state.socket && state.socket.connected) {
        return state.socket;
    }
    return await connectSocket();
}

// ===== WEBRTC SETUP =====
async function setupWebRTC() {
    try {
        state.localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        state.peerConnection = new RTCPeerConnection(CONFIG.ICE_SERVERS);
        
        state.localStream.getTracks().forEach(track => {
            state.peerConnection.addTrack(track, state.localStream);
        });
        
        state.peerConnection.ontrack = (event) => {
            const remoteAudio = new Audio();
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.play().catch(err => console.warn('Autoplay prevented:', err));
            dom.statusText.textContent = 'Connected - Talk now! 🎤';
            state.isConnected = true;
            updateCallStatus('connected');
            showToast('Call connected!', 'success');
            stopRinging();
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
            const state_change = state.peerConnection.connectionState;
            console.log('Connection state:', state_change);
            
            if (state_change === 'connected') {
                dom.statusText.textContent = 'Connected - Talk now! 🎤';
                updateCallStatus('connected');
                stopRinging();
            } else if (state_change === 'disconnected' || state_change === 'failed') {
                dom.statusText.textContent = 'Disconnected';
                updateCallStatus('disconnected');
                showToast('Call disconnected', 'error');
            } else if (state_change === 'connecting') {
                dom.statusText.textContent = 'Connecting...';
                updateCallStatus('connecting');
            }
        };
        
        return true;
    } catch (error) {
        console.error('WebRTC setup error:', error);
        if (error.name === 'NotAllowedError') {
            showToast('Microphone access denied. Please allow microphone access.', 'error');
        } else if (error.name === 'NotFoundError') {
            showToast('No microphone found. Please connect a microphone.', 'error');
        } else {
            showToast('Failed to access microphone', 'error');
        }
        throw error;
    }
}

// ===== RINGTONE =====
let ringInterval = null;

function playRingtone() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'square';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.4);
        
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.4);
        
        setTimeout(() => {
            const osc2 = audioContext.createOscillator();
            const gain2 = audioContext.createGain();
            osc2.connect(gain2);
            gain2.connect(audioContext.destination);
            osc2.frequency.value = 800;
            osc2.type = 'square';
            gain2.gain.setValueAtTime(0.3, audioContext.currentTime);
            gain2.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.4);
            osc2.start();
            osc2.stop(audioContext.currentTime + 0.4);
        }, 600);
        
    } catch (error) {
        console.warn('Ringtone error:', error);
    }
}

function startRinging() {
    stopRinging();
    ringInterval = setInterval(playRingtone, 2000);
}

function stopRinging() {
    if (ringInterval) {
        clearInterval(ringInterval);
        ringInterval = null;
    }
}

// ===== SIGNALING =====
async function handleSignal(data) {
    if (!state.peerConnection) return;
    
    try {
        const { from, signal } = data;
        
        if (signal.offer) {
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.offer));
            const answer = await state.peerConnection.createAnswer();
            await state.peerConnection.setLocalDescription(answer);
            
            state.socket.emit('signal', {
                roomId: state.roomId,
                signal: { answer: answer }
            });
        } else if (signal.answer) {
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.answer));
        } else if (signal.candidate) {
            await state.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
    } catch (error) {
        console.error('Signal handling error:', error);
    }
}

// ===== CALL STATE MANAGEMENT =====
async function initiateCall() {
    try {
        await setupWebRTC();
        
        if (state.isHost) {
            const offer = await state.peerConnection.createOffer();
            await state.peerConnection.setLocalDescription(offer);
            
            state.socket.emit('signal', {
                roomId: state.roomId,
                signal: { offer: offer }
            });
            
            dom.statusText.textContent = 'Waiting for someone to join...';
            updateCallStatus('connecting');
        }
        
        dom.participantStatus.textContent = state.isHost 
            ? 'Waiting for someone to join... 🔄' 
            : 'Joining call... 📞';
        
    } catch (error) {
        console.error('Initiate call error:', error);
        showToast('Failed to start call', 'error');
    }
}

function handleUserJoined(data) {
    console.log('👤 User joined:', data);
    dom.participantStatus.textContent = 'Someone joined! Connecting... 🔗';
    dom.statusText.textContent = 'Connecting...';
    showToast('Someone joined the room! 🔔', 'success');
    
    // Play ringtone
    startRinging();
    
    if (state.isHost && !state.isConnected) {
        state.peerConnection.createOffer()
            .then(offer => state.peerConnection.setLocalDescription(offer))
            .then(() => {
                state.socket.emit('signal', {
                    roomId: state.roomId,
                    signal: { offer: state.peerConnection.localDescription }
                });
            })
            .catch(console.error);
    }
}

function handleUserLeft(data) {
    console.log('👋 User left:', data);
    dom.participantStatus.textContent = 'User left the call';
    dom.statusText.textContent = 'Waiting for someone...';
    showToast('Other user left the call', 'info');
    state.isConnected = false;
    updateCallStatus('connecting');
    stopRinging();
}

function handleUserMuted(data) {
    if (data.userId !== state.socket.id) {
        showToast(data.muted ? 'Other user muted
