// =====================================================
// KUDUMCALLER - Complete WebRTC Voice Calling App
// =====================================================

// ===== CONFIGURATION =====
const CONFIG = {
    // ✅ FIXED: Use Render URL for production
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
    connectionAttempts: 0
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
    participantStatus: $('participant-status'),
    statusText: $('status-text'),
    connectionIndicator: $('connection-indicator'),
    muteBtn: $('mute-btn'),
    endCallBtn: $('end-call-btn'),
    copyRoomBtn: $('copy-room-btn'),
    copyLinkBtn: $('copy-link-btn'),
    toastContainer: $('toast-container')
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
            // ✅ FIXED: Load Socket.io from CDN (since we're not using Node modules)
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
            
            // WebRTC signaling
            socket.on('signal', handleSignal);
            
            // Room events
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
        // Get local audio stream
        state.localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // Create peer connection
        state.peerConnection = new RTCPeerConnection(CONFIG.ICE_SERVERS);
        
        // Add local tracks
        state.localStream.getTracks().forEach(track => {
            state.peerConnection.addTrack(track, state.localStream);
        });
        
        // Handle remote stream
        state.peerConnection.ontrack = (event) => {
            const remoteAudio = new Audio();
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.play().catch(err => console.warn('Autoplay prevented:', err));
            dom.statusText.textContent = 'Connected - Talk now! 🎤';
            state.isConnected = true;
            updateCallStatus('connected');
            showToast('Call connected!', 'success');
        };
        
        // Handle ICE candidates
        state.peerConnection.onicecandidate = (event) => {
            if (event.candidate && state.socket && state.roomId) {
                state.socket.emit('signal', {
                    roomId: state.roomId,
                    signal: { candidate: event.candidate }
                });
            }
        };
        
        // Handle connection state changes
        state.peerConnection.onconnectionstatechange = () => {
            const state_change = state.peerConnection.connectionState;
            console.log('Connection state:', state_change);
            
            if (state_change === 'connected') {
                dom.statusText.textContent = 'Connected - Talk now! 🎤';
                updateCallStatus('connected');
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
            // Host creates offer
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
    showToast('Someone joined the room!', 'success');
    
    // Start call if we're the host
    if (state.isHost && !state.isConnected) {
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
    }
}

function handleUserLeft(data) {
    console.log('👋 User left:', data);
    dom.participantStatus.textContent = 'User left the call';
    dom.statusText.textContent = 'Waiting for someone...';
    showToast('Other user left the call', 'info');
    state.isConnected = false;
    updateCallStatus('connecting');
}

function handleUserMuted(data) {
    if (data.userId !== state.socket.id) {
        showToast(data.muted ? 'Other user muted 🎤🔇' : 'Other user unmuted 🎤', 'info');
    }
}

function handleNewHost(data) {
    showToast('You are now the host', 'info');
}

// ===== CALL CONTROLS =====
function toggleMute() {
    if (!state.localStream) return;
    state.isMuted = !state.isMuted;
    state.localStream.getAudioTracks().forEach(track => {
        track.enabled = !state.isMuted;
    });
    
    dom.muteBtn.classList.toggle('muted', state.isMuted);
    const icon = dom.muteBtn.querySelector('.control-icon');
    icon.textContent = state.isMuted ? '🔇' : '🎤';
    dom.muteBtn.querySelector('.control-label').textContent = state.isMuted ? 'Unmute' : 'Mute';
    
    // Notify others
    if (state.socket && state.roomId) {
        state.socket.emit('toggle-mute', {
            roomId: state.roomId,
            muted: state.isMuted
        });
    }
}

function endCall() {
    // Clean up WebRTC
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }
    
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => track.stop());
        state.localStream = null;
    }
    
    state.isConnected = false;
    state.isInCall = false;
    state.remoteUserId = null;
    
    // Reset UI
    dom.callScreen.classList.add('hidden');
    dom.homeScreen.classList.remove('hidden');
    dom.statusText.textContent = 'Ready';
    dom.participantStatus.textContent = '';
    dom.muteBtn.classList.remove('muted');
    dom.muteBtn.querySelector('.control-icon').textContent = '🎤';
    dom.muteBtn.querySelector('.control-label').textContent = 'Mute';
    updateCallStatus('idle');
    
    // Leave room
    if (state.socket && state.roomId) {
        state.socket.disconnect();
        state.socket = null;
    }
    
    state.roomId = null;
    state.isHost = false;
    
    showToast('Call ended', 'info');
}

function updateCallStatus(status) {
    const indicator = dom.connectionIndicator;
    const text = dom.statusText;
    
    indicator.className = 'status-indicator';
    
    switch(status) {
        case 'connecting':
            indicator.classList.add('connecting');
            text.textContent = 'Connecting...';
            break;
        case 'connected':
            indicator.classList.add('connected');
            text.textContent = 'Connected - Talk now! 🎤';
            break;
        case 'disconnected':
            indicator.classList.add('disconnected');
            text.textContent = 'Disconnected';
            break;
        default:
            text.textContent = 'Ready';
    }
}

// ===== SHARE FUNCTIONALITY =====
function copyRoomLink() {
    if (!state.roomId) return;
    
    // ✅ FIXED: Use the correct base URL for GitHub Pages
    const baseUrl = window.location.origin + '/kudumcaller';
    const link = `${baseUrl}?room=${state.roomId}`;
    
    navigator.clipboard.writeText(link).then(() => {
        showToast('Room link copied! 📋 Share it with anyone.', 'success');
    }).catch(() => {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = link;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        showToast('Room link copied! 📋', 'success');
    });
}

// ===== AUTO-JOIN FROM URL =====
function checkUrlForRoom() {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');
    if (roomId) {
        // Clear URL param to prevent rejoin on refresh
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(() => handleJoinRoom(roomId), 500);
    }
}

// ===== EVENT HANDLERS =====
async function handleCreateCall() {
    try {
        await ensureSocket();
        await createRoom();
        
        dom.homeScreen.classList.add('hidden');
        dom.callScreen.classList.remove('hidden');
        dom.roomDisplay.textContent = state.roomId;
        dom.participantStatus.textContent = 'Waiting for someone to join... 🔄';
        
        state.isInCall = true;
        await initiateCall();
        
        // Auto-copy link after creation
        setTimeout(copyRoomLink, 1000);
        
    } catch (error) {
        console.error('Create call error:', error);
        showToast('Failed to create call', 'error');
    }
}

async function handleJoinRoom(roomId) {
    // If no roomId provided, get from input
    if (!roomId) {
        roomId = dom.roomInput.value.trim();
    }
    
    if (!roomId) {
        showToast('Please enter a room code', 'error');
        return;
    }
    
    try {
        await ensureSocket();
        await joinRoom(roomId);
        
        dom.homeScreen.classList.add('hidden');
        dom.callScreen.classList.remove('hidden');
        dom.roomDisplay.textContent = roomId;
        dom.participantStatus.textContent = 'Joining call... 📞';
        
        state.isInCall = true;
        await initiateCall();
        
    } catch (error) {
        console.error('Join room error:', error);
        showToast(error.message || 'Failed to join room', 'error');
    }
}

// ===== EVENT LISTENERS =====
dom.createCallBtn.addEventListener('click', handleCreateCall);
dom.joinCallBtn.addEventListener('click', () => handleJoinRoom());
dom.roomInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
});
dom.endCallBtn.addEventListener('click', endCall);
dom.muteBtn.addEventListener('click', toggleMute);
dom.copyRoomBtn.addEventListener('click', copyRoomLink);
dom.copyLinkBtn.addEventListener('click', copyRoomLink);

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.isInCall) {
        endCall();
    }
    if (e.key === 'm' && state.isInCall) {
        toggleMute();
    }
});

// ===== INIT =====
async function init() {
    try {
        // Connect to socket
        await connectSocket();
        hideLoading();
        
        // Check for auto-join
        checkUrlForRoom();
        
        console.log('🎯 KudumCaller initialized');
        console.log('📱 Share a URL to start a voice call!');
        console.log('🔗 Server URL:', CONFIG.SERVER_URL);
        
    } catch (error) {
        console.error('Init error:', error);
        hideLoading();
        showToast('Failed to connect to server. Please refresh.', 'error');
    }
}

// Start the app
init();
