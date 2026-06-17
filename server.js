const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const jwt = require('jsonwebtoken');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

// ========== RATE LIMITER (бе npm, дар хотира) ==========
function createRateLimiter(windowMs, maxRequests, message) {
    const map = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [key, data] of map.entries()) {
            if (now - data.start > windowMs) map.delete(key);
        }
    }, windowMs);
    return (req, res, next) => {
        const key = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        if (!map.has(key)) { map.set(key, { count: 1, start: now }); return next(); }
        const data = map.get(key);
        if (now - data.start > windowMs) { map.set(key, { count: 1, start: now }); return next(); }
        if (data.count >= maxRequests) return res.status(429).json({ message });
        data.count++;
        next();
    };
}

const apiLimiter = createRateLimiter(15 * 60 * 1000, 200, 'Хеле зиёд дархост! Лутфан 15 дақиқа интизор шавед.');
const msgLimiter = createRateLimiter(60 * 1000, 40, 'Хеле зиёд паём! Лутфан 1 дақиқа интизор шавед.');
const authLimiter = createRateLimiter(15 * 60 * 1000, 10, 'Хеле зиёд кӯшишҳо! Лутфан 15 дақиқа интизор шавед.');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const adminRoutes = require('./routes/admin');

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth', apiLimiter, authRoutes);
app.use('/api/messages', msgLimiter, messageRoutes);
app.use('/api/admin', adminRoutes);

// Admin panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB пайваст шуд!'))
    .catch(err => console.log('❌ Хатогӣ:', err));

const onlineUsers = new Map();
const User = require('./models/User');

async function canSeeOnline(viewer, target) {
    try {
        const t = await User.findOne({ username: target }, { onlineVisibility: 1, onlineVisibleTo: 1 }).lean();
        if (!t) return false;
        if (t.onlineVisibility === 'everyone') return true;
        if (t.onlineVisibility === 'nobody') return false;
        return (t.onlineVisibleTo || []).includes(viewer);
    } catch(e) { return true; }
}

io.use((socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Токен нест!'));
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.username = decoded.username;
        next();
    } catch (err) {
        next(new Error('Токен нодуруст!'));
    }
});

io.on('connection', async (socket) => {
    const username = socket.username;
    console.log('👤 Пайваст:', username);

    socket.join(username);
    onlineUsers.set(username, socket.id);

    // Online notification
    const allSockets = await io.fetchSockets();
    for (const s of allSockets) {
        if (s.username && s.username !== username) {
            const canSee = await canSeeOnline(s.username, username);
            if (canSee) s.emit('userOnline', { username });
        }
    }
    const onlineList = [];
    for (const [u] of onlineUsers) {
        if (u !== username) {
            const canSee = await canSeeOnline(username, u);
            if (canSee) onlineList.push(u);
        }
    }
    socket.emit('onlineList', onlineList);

    socket.on('sendMessage', (data) => {
        try {
            io.to(data.receiver).emit('newMessage', data);
            io.to(data.sender).emit('newMessage', data);
        } catch(e) {}
    });

    socket.on('reaction', (data) => {
        try {
            io.to(data.receiver).emit('reactionUpdate', data);
            io.to(data.sender).emit('reactionUpdate', data);
        } catch(e) {}
    });

    socket.on('deleteMessage', (data) => {
        try {
            io.to(data.receiver).emit('messageDeleted', data);
            io.to(data.sender).emit('messageDeleted', data);
        } catch(e) {}
    });

    // Иваз кардани паём
    socket.on('editMessage', (data) => {
        try {
            io.to(data.receiver).emit('messageEdited', data);
            io.to(data.sender).emit('messageEdited', data);
        } catch(e) {}
    });

    // Сабт кардани паём
    socket.on('pinMessage', (data) => {
        try {
            io.to(data.receiver).emit('messagePinned', data);
            io.to(data.sender).emit('messagePinned', data);
        } catch(e) {}
    });

    socket.on('typing', (data) => {
        try { io.to(data.receiver).emit('userTyping', { sender: data.sender }); } catch(e) {}
    });
    socket.on('stopTyping', (data) => {
        try { io.to(data.receiver).emit('userStopTyping', { sender: data.sender }); } catch(e) {}
    });

    socket.on('voiceRecording', (data) => {
        try { io.to(data.receiver).emit('userVoiceRecording', { sender: data.sender }); } catch(e) {}
    });
    socket.on('stopVoiceRecording', (data) => {
        try { io.to(data.receiver).emit('userStopVoiceRecording', { sender: data.sender }); } catch(e) {}
    });

    socket.on('messageSeen', (data) => {
        try { io.to(data.sender).emit('messageSeenUpdate', { msgId: data.msgId }); } catch(e) {}
    });

    socket.on('mediaUploading', (data) => {
        try { io.to(data.receiver).emit('mediaUploading', { sender: data.sender, isVideo: data.isVideo }); } catch(e) {}
    });

    socket.on('avatarChanged', (data) => {
        try { socket.broadcast.emit('userAvatarChanged', { username: data.username, avatar: data.avatar }); } catch(e) {}
    });

    socket.on('updateVisibility', async (data) => {
        try {
            const allS = await io.fetchSockets();
            for (const s of allS) {
                if (s.username && s.username !== username) {
                    const canSee = await canSeeOnline(s.username, username);
                    if (canSee) s.emit('userOnline', { username });
                    else s.emit('userOffline', { username });
                }
            }
        } catch(e) {}
    });

    socket.on('changeUsername', (data) => {
        try {
            const { oldUsername, newUsername } = data;
            socket.leave(oldUsername);
            socket.join(newUsername);
            socket.username = newUsername;
            onlineUsers.delete(oldUsername);
            onlineUsers.set(newUsername, socket.id);
            io.emit('userOffline', { username: oldUsername });
            io.emit('userOnline', { username: newUsername });
            io.emit('usernameChanged', { oldUsername, newUsername });
        } catch(e) {}
    });

    socket.on('disconnect', () => {
        console.log('👤 Рафт:', username);
        onlineUsers.delete(username);
        io.emit('userOffline', { username });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер: http://localhost:${PORT}`));

module.exports = { io };
