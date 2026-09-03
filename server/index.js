const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// CORS configuration
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true
}));

// Serve static files (for the client)
app.use(express.static('../client'));

// Socket.io with CORS
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Store active rooms
const rooms = new Map();
const users = new Map();

// Stats tracking
const stats = {
  totalCalls: 0,
  activeCalls: 0,
  totalUsers: 0
};

io.on('connection', (socket) => {
  console.log(`🟢 User connected: ${socket.id}`);
  stats.totalUsers++;

  // Create a new room
  socket.on('create-room', (callback) => {
    const roomId = uuidv4().substring(0, 8);
    rooms.set(roomId, {
      host: socket.id,
      participants: [socket.id],
      createdAt: Date.now()
    });
    
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.isHost = true;
    
    console.log(`📁 Room created: ${roomId} by ${socket.id}`);
    stats.activeCalls++;
    stats.totalCalls++;
    
    if (callback) callback({ roomId, success: true });
  });

  // Join an existing room
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
    
    room.participants.push(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.isHost = false;
    
    // Notify others in room
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      timestamp: Date.now()
    });
    
    console.log(`👤 User ${socket.id} joined room ${roomId}`);
    stats.activeCalls++;
    
    if (callback) callback({ success: true, roomId });
  });

  // WebRTC signaling
  socket.on('signal', ({ roomId, signal }) => {
    // Broadcast signal to other participants in the room
    socket.to(roomId).emit('signal', {
      from: socket.id,
      signal
    });
  });

  // Get room info
  socket.on('get-room-info', (roomId, callback) => {
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      callback({
        exists: true,
        participants: room.participants.length,
        isHost: socket.data.roomId === roomId && socket.data.isHost
      });
    } else {
      callback({ exists: false });
    }
  });

  // Toggle mute (notify others)
  socket.on('toggle-mute', ({ roomId, muted }) => {
    socket.to(roomId).emit('user-muted', {
      userId: socket.id,
      muted
    });
  });

  // Handle disconnect
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
        
        // If host left, assign new host
        if (socket.data.isHost) {
          const newHost = room.participants[0];
          io.to(roomId).emit('new-host', { userId: newHost });
          console.log(`👑 New host for room ${roomId}: ${newHost}`);
        }
      }
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    activeRooms: rooms.size,
    activeCalls: stats.activeCalls,
    totalCalls: stats.totalCalls,
    connectedUsers: stats.totalUsers
  });
});

// Get room stats
app.get('/stats', (req, res) => {
  const roomStats = Array.from(rooms.entries()).map(([id, room]) => ({
    roomId: id,
    participants: room.participants.length,
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

const PORT = process.env.PORT || 5000;  // ✅ Render = 10000, Local = 5000
// ... rest of code
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
