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
            // Cloudflare STUN over UDP
            {
                urls: [
                    'stun:stun.cloudflare.com:3478',
                    'stun:stun.cloudflare.com:53'
                ]
            },
            // Cloudflare TURN over UDP
            {
                urls: [
                    'turn:turn.cloudflare.com:3478?transport=udp',
                    'turn:turn.cloudflare.com:53?transport=udp'
                ],
                username: 'any-username',
                credential: 'any-credential'
            },
            // Cloudflare TURN over TCP
            {
                urls: [
                    'turn:turn.cloudflare.com:3478?transport=tcp',
                    'turn:turn.cloudflare.com:80?transport=tcp'
                ],
                username: 'any-username',
                credential: 'any-credential'
            },
            // Cloudflare TURN over TLS (secure)
            {
                urls: [
                    'turns:turn.cloudflare.com:5349',
                    'turns:turn.cloudflare.com:443'
                ],
                username: 'any-username',
                credential: 'any-credential'
            },
            // Google STUN fallback
            {
                urls: [
                    'stun:stun.l.google.com:19302',
                    'stun:stun1.l.google.com:19302'
                ]
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
    isRinging: false,
    remoteUserId: null,
    callCount: 0,
    waitingForAnswer: false
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
    callCount: $('call-count')
};

// ===== TOAST NOTIFICATIONS =====
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
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
                reject(new Error('Socket.io library not loaded.'));
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
            socket.on('incoming-call', handleIncomingCall);
            
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
                    showToast('Room created: ' + response.roomId, 'success');
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
        showToast('Joining room ' + roomId + '...', 'info');
        const socket = await ensureSocket();
        
        return new Promise((resolve, reject) => {
            socket.emit('join-room', roomId, (response) => {
                if (response && response.success) {
                    state.roomId = roomId;
                    state.isHost = false;
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
            hideIncomingCall();
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
                hideIncomingCall();
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

// ===== RINGTONE (Mobile-Friendly) =====
let ringInterval = null;
let ringtoneAudio = null;

function playRingtone() {
    // Only play if user has interacted with the page
    if (!window.userInteracted) {
        console.log('⏳ Waiting for user interaction before playing ringtone');
        return;
    }
    
    try {
        // Try using HTML5 Audio first (more reliable on mobile)
        if (!ringtoneAudio) {
            ringtoneAudio = new Audio('data:audio/wav;base64,UklGRnoAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoAAACBhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqFhYqF');
            ringtoneAudio.volume = 0.5;
            ringtoneAudio.loop = true;
        }
        
        ringtoneAudio.play().catch(() => {
            // Fallback: Use Web Audio API oscillator
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') {
                ctx.resume();
            }
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
    } catch (e) {
        console.warn('Ringtone error:', e);
    }
}

function startRinging() {
    stopRinging();
    if (!window.userInteracted) {
        console.log('⏳ Waiting for user interaction to start ringing');
        // Try to play once anyway (some browsers allow it)
        playRingtone();
    }
    state.isRinging = true;
    ringInterval = setInterval(playRingtone, 2000);
}

function stopRinging() {
    state.isRinging = false;
    if (ringInterval) {
        clearInterval(ringInterval);
        ringInterval = null;
    }
    if (ringtoneAudio) {
        ringtoneAudio.pause();
        ringtoneAudio.currentTime = 0;
    }
}

// ===== INCOMING CALL UI =====
function showIncomingCall() {
    dom.incomingCall.classList.remove('hidden');
    // Try to play ringtone immediately if user has interacted
    if (window.userInteracted) {
        playRingtone();
    }
}

function hideIncomingCall() {
    dom.incomingCall.classList.add('hidden');
    stopRinging();
}

function handleIncomingCall(data) {
    console.log('📞 Incoming call from:', data.from);
    showIncomingCall();
    dom.participantStatus.textContent = 'Incoming call... 📞';
    dom.statusText.textContent = 'Tap Accept to answer';
    showToast('Incoming call!', 'info');
}

// ===== SIGNALING =====
async function handleSignal(data) {
    if (!state.peerConnection) return;
    
    try {
        const { from, signal } = data;
        
        if (signal.offer) {
            // Show incoming call UI
            showIncomingCall();
            dom.participantStatus.textContent = 'Incoming call... 📞';
            dom.statusText.textContent = 'Tap Accept to answer';
            
            // Store the offer for later use (when user taps Accept)
            state.pendingOffer = signal.offer;
            
            // Don't auto-answer - wait for user to tap Accept
            
        } else if (signal.answer) {
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.answer));
            hideIncomingCall();
            stopRinging();
            dom.statusText.textContent = 'Connected - Talk now! 🎤';
            updateCallStatus('connected');
            state.isConnected = true;
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
    console.log('👤 Someone joined:', data);
    
    // Show incoming call UI
    dom.incomingCall.classList.remove('hidden');
    dom.participantStatus.textContent = 'Incoming call... 📞';
    dom.statusText.textContent = 'Tap Accept to answer';
    
    // Try to play ringtone if user has interacted
    if (window.userInteracted) {
        startRinging();
    } else {
        // Show a message to tap the screen
        showToast('Tap the screen to enable audio', 'info');
    }
    
    // Notify the other user that we're ringing
    if (state.socket && state.roomId) {
        state.socket.emit('ringing', {
            roomId: state.roomId
        });
    }
}

function handleUserLeft(data) {
    console.log('👋 User left:', data);
    dom.participantStatus.textContent = 'User left the call';
    dom.statusText.textContent = 'Waiting for someone...';
    showToast('Other user left the call', 'info');
    state.isConnected = false;
    updateCallStatus('connecting');
    hideIncomingCall();
    stopRinging();
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
    
    if (state.socket && state.roomId) {
        state.socket.emit('toggle-mute', {
            roomId: state.roomId,
            muted: state.isMuted
        });
    }
}

function endCall() {
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
    state.pendingOffer = null;
    hideIncomingCall();
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
    
    showToast('Call ended', 'info');
}

function acceptCall() {
    // Resume audio context on user interaction
    if (window.audioContext && window.audioContext.state === 'suspended') {
        window.audioContext.resume();
    }
    
    window.userInteracted = true;
    
    dom.incomingCall.classList.add('hidden');
    stopRinging();
    
    dom.statusText.textContent = 'Connecting...';
    updateCallStatus('connecting');
    dom.participantStatus.textContent = 'Connecting... 🔗';
    
    showToast('Call accepted!', 'success');
    
    // If we have a pending offer, answer it
    if (state.pendingOffer) {
        state.peerConnection.setRemoteDescription(new RTCSessionDescription(state.pendingOffer))
            .then(() => {
                return state.peerConnection.createAnswer();
            })
            .then(answer => {
                return state.peerConnection.setLocalDescription(answer);
            })
            .then(() => {
                state.socket.emit('signal', {
                    roomId: state.roomId,
                    signal: { answer: state.peerConnection.localDescription }
                });
                state.pendingOffer = null;
            })
            .catch(console.error);
    } else if (state.peerConnection && state.peerConnection.remoteDescription) {
        // Fallback: try to create answer anyway
        state.peerConnection.createAnswer()
            .then(answer => state.peerConnection.setLocalDescription(answer))
            .then(() => {
                state.socket.emit('signal', {
                    roomId: state.roomId,
                    signal: { answer: state.peerConnection.localDescription }
                });
            })
            .catch(console.error);
    } else {
        // If no offer, maybe we're the host
        if (state.isHost) {
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
}

function declineCall() {
    hideIncomingCall();
    stopRinging();
    state.pendingOffer = null;
    showToast('Call declined', 'info');
    // Notify the other user
    if (state.socket && state.roomId) {
        state.socket.emit('call-declined', {
            roomId: state.roomId
        });
    }
    endCall();
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
function getRoomLink() {
    if (!state.roomId) return '';
    const baseUrl = window.location.origin + '/kudumcaller/client';
    return baseUrl + '?room=' + state.roomId;
}

function copyRoomLink() {
    const link = getRoomLink();
    if (!link) return;
    
    navigator.clipboard.writeText(link).then(() => {
        showToast('Room link copied! 📋', 'success');
    }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = link;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        showToast('Room link copied! 📋', 'success');
    });
}

function updateLinkDisplay() {
    const link = getRoomLink();
    if (dom.roomLinkDisplay) {
        dom.roomLinkDisplay.value = link;
    }
}

// ===== SHARE VIA WHATSAPP (Opens in new tab) =====
function shareViaWhatsApp() {
    const link = getRoomLink();
    if (!link) return;
    
    const message = 'Join my SoloDS KudumCaller call: ' + link;
    const whatsappUrl = 'https://wa.me/?text=' + encodeURIComponent(message);
    window.open(whatsappUrl, '_blank');
}

// ===== SHARE VIA SMS (Mobile only) =====
function shareViaSMS() {
    const link = getRoomLink();
    if (!link) return;
    
    const message = 'Join my SoloDS KudumCaller call: ' + link;
    const smsUrl = 'sms:?body=' + encodeURIComponent(message);
    window.open(smsUrl, '_blank');
}

// ===== SHARE VIA EMAIL (Opens in new tab) =====
function shareViaEmail() {
    const link = getRoomLink();
    if (!link) return;
    
    const subject = 'Join my SoloDS KudumCaller call';
    const body = 'Hi,\n\nJoin my voice call using this link:\n' + link + '\n\nIt works on any browser, no app needed!\n\n- SoloDS KudumCaller';
    const emailUrl = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    window.open(emailUrl, '_blank');
}

// ===== AUTO-JOIN FROM URL =====
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
        // Ensure user interaction for audio
        if (!window.userInteracted) {
            showToast('Tap the screen to enable audio', 'info');
            // Try to resume audio context
            if (window.audioContext && window.audioContext.state === 'suspended') {
                window.audioContext.resume();
            }
        }
        
        await ensureSocket();
        await createRoom();
        
        dom.homeScreen.classList.add('hidden');
        dom.callScreen.classList.remove('hidden');
        dom.roomDisplay.textContent = state.roomId;
        dom.participantStatus.textContent = 'Waiting for someone to join... 🔄';
        
        state.isInCall = true;
        await initiateCall();
        
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
        showToast('Please enter a room code', 'error');
        return;
    }
    
    try {
        // Ensure user interaction for audio
        if (!window.userInteracted) {
            showToast('Tap the screen to enable audio', 'info');
            if (window.audioContext && window.audioContext.state === 'suspended') {
                window.audioContext.resume();
            }
        }
        
        await ensureSocket();
        await joinRoom(roomId);
        
        dom.homeScreen.classList.add('hidden');
        dom.callScreen.classList.remove('hidden');
        dom.roomDisplay.textContent = roomId;
        dom.participantStatus.textContent = 'Joining call... 📞';
        
        state.isInCall = true;
        await initiateCall();
        
        updateLinkDisplay();
        
    } catch (error) {
        console.error('Join room error:', error);
        showToast(error.message || 'Failed to join room', 'error');
    }
}

// ===== ENABLE AUDIO ON USER INTERACTION =====
function enableAudioOnInteraction() {
    if (window.userInteracted) return;
    
    window.userInteracted = true;
    console.log('🎤 Audio enabled by user interaction');
    
    // Resume audio context
    if (window.audioContext && window.audioContext.state === 'suspended') {
        window.audioContext.resume();
    }
    
    // Try to play a silent sound to unlock audio
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
    } catch (e) {
        console.warn('Audio unlock failed:', e);
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
dom.acceptCallBtn.addEventListener('click', acceptCall);
dom.declineCallBtn.addEventListener('click', declineCall);
dom.copyRoomBtn.addEventListener('click', copyRoomLink);
dom.copyLinkBtn.addEventListener('click', copyRoomLink);

dom.shareWhatsappBtn.addEventListener('click', shareViaWhatsApp);
dom.shareSmsBtn.addEventListener('click', shareViaSMS);
dom.shareEmailBtn.addEventListener('click', shareViaEmail);
dom.shareCopyBtn.addEventListener('click', copyRoomLink);

// ===== ENABLE AUDIO ON ANY CLICK OR TOUCH =====
document.addEventListener('click', enableAudioOnInteraction, { once: false });
document.addEventListener('touchstart', enableAudioOnInteraction, { once: false });

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
        await connectSocket();
        hideLoading();
        checkUrlForRoom();
        
        console.log('🎯 SoloDS KudumCaller initialized');
        console.log('📱 Share a URL to start a voice call!');
        console.log('🔗 Server URL:', CONFIG.SERVER_URL);
        console.log('🔄 Cloudflare TURN/STUN servers configured');
        console.log('📱 Tap the screen to enable audio on mobile');
        
    } catch (error) {
        console.error('Init error:', error);
        hideLoading();
        showToast('Failed to connect to server. Please refresh.', 'error');
    }
}

init();
