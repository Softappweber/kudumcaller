const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// ===== PORT CONFIGURATION =====
const PORT = process.env.PORT || 5000;

// ===== CORS CONFIGURATION =====
const CLIENT_URL = process.env.CLIENT_URL || 'https://softappweber.github.io';

app.use(cors({
    origin: CLIENT_URL,
    credentials: true
}));

app.use(express.static('../client'));

const io = new Server(server, {
    cors: {
        origin: CLIENT_URL,
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// ===== STORE ACTIVE ROOMS =====
const rooms = new Map();

// Stats tracking
const stats = {
    totalCalls: 0,
    activeCalls: 0,
    totalUsers: 0
};

// ===== SOCKET.IO EVENTS =====
io.on('connection', (socket) => {
    console.log(`🟢 User connected: ${socket.id}`);
    stats.totalUsers++;

    // ===== CREATE ROOM =====
    socket.on('create-room', (callback) => {
        const roomId = uuidv4().substring(0, 8);
        rooms.set(roomId, {
            host: socket.id,
            participants: [socket.id],
            caller: socket.id,        // Track who created the call
            receiver: null,           // Will be set when someone joins
            createdAt: Date.now(),
            status: 'waiting'         // waiting, ringing, connected, ended
        });
        
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.isHost = true;
        socket.data.role = 'caller';   // Mark as caller
        
        console.log(`📁 Room created: ${roomId} by ${socket.id}`);
        stats.activeCalls++;
        stats.totalCalls++;
        
        if (callback) callback({ roomId, success: true });
    });

    // ===== JOIN ROOM =====
    socket.on('join-room', (roomId, callback) => {
        if (!rooms.has(roomId)) {
            if (callback) callback({ success: false, error: 'Room not found' });
            return;
        }
        
        const room = rooms.get(roomId);
        
        // Check if room is full (max 2 for now)
        if (room.participants.length >= 2) {
            if (callback) callback({ success: false, error: 'Room is full' });
            return;
        }
        
        // Add participant
        room.participants.push(socket.id);
        room.receiver = socket.id;     // Set as receiver
        room.status = 'ringing';       // Change status to ringing
        
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.isHost = false;
        socket.data.role = 'receiver'; // Mark as receiver
        
        console.log(`👤 User ${socket.id} joined room ${roomId} as RECEIVER`);
        stats.activeCalls++;
        
        // ===== NOTIFY CALLER THAT SOMEONE JOINED =====
        io.to(roomId).emit('user-joined', {
            userId: socket.id,
            role: 'receiver',
            timestamp: Date.now()
        });
        
        // ===== NOTIFY RECEIVER ABOUT INCOMING CALL =====
        // Send a specific event to the receiver only
        socket.emit('incoming-call', {
            from: room.caller,
            roomId: roomId,
            timestamp: Date.now()
        });
        
        if (callback) callback({ success: true, roomId, role: 'receiver' });
    });

    // ===== WEBRTC SIGNALING =====
    socket.on('signal', ({ roomId, signal }) => {
        // Broadcast signal to other participants in the room
        socket.to(roomId).emit('signal', {
            from: socket.id,
            signal
        });
    });

    // ===== CALL ACCEPTED =====
    socket.on('call-accepted', ({ roomId }) => {
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.status = 'connected';
            console.log(`📞 Call connected in room ${roomId}`);
            io.to(roomId).emit('call-connected', {
                roomId: roomId,
                timestamp: Date.now()
            });
        }
    });

    // ===== CALL DECLINED =====
    socket.on('call-declined', ({ roomId }) => {
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.status = 'ended';
            console.log(`📞 Call declined in room ${roomId}`);
            io.to(roomId).emit('call-ended', {
                reason: 'declined',
                timestamp: Date.now()
            });
            // Clean up room
            rooms.delete(roomId);
            stats.activeCalls--;
        }
    });

    // ===== RINGING STATUS =====
    socket.on('ringing', ({ roomId }) => {
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.status = 'ringing';
            socket.to(roomId).emit('user-ringing', {
                userId: socket.id,
                timestamp: Date.now()
            });
        }
    });

    // ===== GET ROOM INFO =====
    socket.on('get-room-info', (roomId, callback) => {
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            callback({
                exists: true,
                participants: room.participants.length,
                isHost: socket.data.roomId === roomId && socket.data.isHost,
                role: socket.data.role || 'unknown',
                status: room.status
            });
        } else {
            callback({ exists: false });
        }
    });

    // ===== TOGGLE MUTE =====
    socket.on('toggle-mute', ({ roomId, muted }) => {
        socket.to(roomId).emit('user-muted', {
            userId: socket.id,
            muted
        });
    });

    // ===== DISCONNECT =====
    socket.on('disconnect', () => {
        console.log(`🔴 User disconnected: ${socket.id}`);
        stats.totalUsers--;
        
        const roomId = socket.data.roomId;
        if (roomId && rooms.has(roomId)) {
            const room = rooms.get(roomId);
            
            // Remove user from room
            room.participants = room.participants.filter(id => id !== socket.id);
            
            // If room is empty, delete it
            if (room.participants.length === 0) {
                rooms.delete(roomId);
                stats.activeCalls--;
                console.log(`🗑️ Room ${roomId} deleted (empty)`);
            } else {
                // Notify remaining participants
                socket.to(roomId).emit('user-left', {
                    userId: socket.id,
                    timestamp: Date.now()
                });
                
                // If host/caller left, assign new host
                if (socket.data.isHost || socket.data.role === 'caller') {
                    const newHost = room.participants[0];
                    room.host = newHost;
                    room.caller = newHost;
                    io.to(roomId).emit('new-host', { userId: newHost });
                    console.log(`👑 New host for room ${roomId}: ${newHost}`);
                }
            }
        }
    });
});

// ===== HEALTH CHECK ENDPOINT =====
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        activeRooms: rooms.size,
        activeCalls: stats.activeCalls,
        totalCalls: stats.totalCalls,
        connectedUsers: stats.totalUsers
    });
});

// ===== ROOM STATS ENDPOINT =====
app.get('/stats', (req, res) => {
    const roomStats = Array.from(rooms.entries()).map(([id, room]) => ({
        roomId: id,
        participants: room.participants.length,
        caller: room.caller,
        receiver: room.receiver,
        status: room.status,
        createdAt: room.createdAt,
        age: Date.now() - room.createdAt
    }));
    
    res.json({
        totalRooms: rooms.size,
        activeCalls: stats.activeCalls,
        totalCalls: stats.totalCalls,
        rooms: roomStats
    });
});

// ===== START SERVER =====
server.listen(PORT, () => {
    console.log(`🎯 SoloDS KudumCaller Server running on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Stats: http://localhost:${PORT}/stats`);
    console.log(`🔗 CORS allowed: ${CLIENT_URL}`);
});
