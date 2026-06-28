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
const authLimiter = createRateLimiter(0 * 6 * 1,5, 'Хеле зиёд кӯшишҳо! Лутфан интизор шавед.');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const adminRoutes = require('./routes/admin');
const groupRoutes = require('./routes/groups');

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth', apiLimiter, authRoutes);
app.use('/api/messages', msgLimiter, messageRoutes);
app.use('/api/groups', msgLimiter, groupRoutes);
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
const Group = require('./models/Group');

async function canSeeOnline(viewer, target) {
    try {
        const t = await User.findOne({ username: target }, { onlineVisibility: 1, onlineVisibleTo: 1, blockedUsers: 1 }).lean();
        if (!t) return false;
        // Агар target шахси viewer-ро блок карда бошад — viewer набояд online/typing-и target-ро бубинад
        if ((t.blockedUsers || []).includes(viewer)) return false;
        if (t.onlineVisibility === 'everyone') return true;
        if (t.onlineVisibility === 'nobody') return false;
        return (t.onlineVisibleTo || []).includes(viewer);
    } catch (e) { return true; }
}

// Гирифтани ҳамаи socket-ҳои аъзоёни гурӯҳ
async function emitToGroup(groupId, event, data, excludeUsername = null) {
    try {
        const group = await Group.findById(groupId).lean();
        if (!group) return;
        for (const member of group.members) {
            if (excludeUsername && member === excludeUsername) continue;
            io.to(member).emit(event, data);
        }
    } catch (e) {}
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

    // ========== ЧАТИ ШАХСӢ ==========
    socket.on('sendMessage', (data) => {
        try {
            io.to(data.receiver).emit('newMessage', data);
            io.to(data.sender).emit('newMessage', data);
            // Агар гиранда онлайн бошад — delivered (ду тик)
            if (onlineUsers.has(data.receiver)) {
                io.to(data.sender).emit('messageDeliveredUpdate', { msgId: data._id });
            }
        } catch (e) {}
    });

    socket.on('reaction', (data) => {
        try {
            io.to(data.receiver).emit('reactionUpdate', data);
            io.to(data.sender).emit('reactionUpdate', data);
        } catch (e) {}
    });

    socket.on('deleteMessage', (data) => {
        try {
            io.to(data.receiver).emit('messageDeleted', data);
            io.to(data.sender).emit('messageDeleted', data);
        } catch (e) {}
    });

    socket.on('editMessage', (data) => {
        try {
            io.to(data.receiver).emit('messageEdited', data);
            io.to(data.sender).emit('messageEdited', data);
        } catch (e) {}
    });

    socket.on('pinMessage', (data) => {
        try {
            io.to(data.receiver).emit('messagePinned', data);
            io.to(data.sender).emit('messagePinned', data);
        } catch (e) {}
    });

    socket.on('typing', async (data) => {
        try {
            const canSee = await canSeeOnline(data.receiver, data.sender);
            if (canSee) io.to(data.receiver).emit('userTyping', { sender: data.sender });
        } catch (e) {}
    });
    socket.on('stopTyping', (data) => {
        try { io.to(data.receiver).emit('userStopTyping', { sender: data.sender }); } catch (e) {}
    });

    socket.on('voiceRecording', (data) => {
        try { io.to(data.receiver).emit('userVoiceRecording', { sender: data.sender }); } catch (e) {}
    });
    socket.on('stopVoiceRecording', (data) => {
        try { io.to(data.receiver).emit('userStopVoiceRecording', { sender: data.sender }); } catch (e) {}
    });

    socket.on('messageSeen', (data) => {
        try { io.to(data.sender).emit('messageSeenUpdate', { msgId: data.msgId }); } catch (e) {}
    });

    socket.on('mediaUploading', (data) => {
        try { io.to(data.receiver).emit('mediaUploading', { sender: data.sender, isVideo: data.isVideo }); } catch (e) {}
    });

    socket.on('avatarChanged', (data) => {
        try { socket.broadcast.emit('userAvatarChanged', { username: data.username, avatar: data.avatar }); } catch (e) {}
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
        } catch (e) {}
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
        } catch (e) {}
    });

    // ========== ЧАТИ ГУРӴ ==========

    // Фиристодани паёми гурӯҳ — ба ҳамаи аъзоён
    socket.on('sendGroupMessage', async (data) => {
        try {
            await emitToGroup(data.groupId, 'newGroupMessage', data);
        } catch (e) {}
    });

    socket.on('groupReaction', async (data) => {
        try {
            await emitToGroup(data.groupId, 'groupReactionUpdate', data);
        } catch (e) {}
    });

    socket.on('deleteGroupMessage', async (data) => {
        try {
            await emitToGroup(data.groupId, 'groupMessageDeleted', data);
        } catch (e) {}
    });

    socket.on('editGroupMessage', async (data) => {
        try {
            await emitToGroup(data.groupId, 'groupMessageEdited', data);
        } catch (e) {}
    });

    socket.on('pinGroupMessage', async (data) => {
        try {
            await emitToGroup(data.groupId, 'groupMessagePinned', data);
        } catch (e) {}
    });

    socket.on('groupTyping', async (data) => {
        try { await emitToGroup(data.groupId, 'groupUserTyping', { sender: data.sender, groupId: data.groupId }, data.sender); } catch (e) {}
    });
    socket.on('groupStopTyping', async (data) => {
        try { await emitToGroup(data.groupId, 'groupUserStopTyping', { sender: data.sender, groupId: data.groupId }, data.sender); } catch (e) {}
    });

    socket.on('groupMediaUploading', async (data) => {
        try { await emitToGroup(data.groupId, 'groupMediaUploading', { sender: data.sender, isVideo: data.isVideo, groupId: data.groupId }, data.sender); } catch (e) {}
    });

    socket.on('groupSeen', async (data) => {
        try { await emitToGroup(data.groupId, 'groupMessageSeenUpdate', { msgId: data.msgId, username: data.username, groupId: data.groupId }, data.username); } catch (e) {}
    });

    // Гурӯҳи нав сохта шуд — огоҳ кардани ҳамаи аъзоёни нав
    socket.on('groupCreated', async (data) => {
        try {
            const group = await Group.findById(data.groupId).lean();
            if (!group) return;
            for (const member of group.members) {
                if (member !== username) io.to(member).emit('addedToGroup', { groupId: data.groupId });
            }
        } catch (e) {}
    });

    socket.on('groupMembersChanged', async (data) => {
        try {
            await emitToGroup(data.groupId, 'groupMembersUpdated', { groupId: data.groupId });
            if (Array.isArray(data.newMembers)) {
                for (const m of data.newMembers) {
                    io.to(m).emit('addedToGroup', { groupId: data.groupId });
                }
            }
            if (data.removedMember) {
                io.to(data.removedMember).emit('removedFromGroup', { groupId: data.groupId });
            }
        } catch (e) {}
    });

    socket.on('groupUpdated', async (data) => {
        try { await emitToGroup(data.groupId, 'groupInfoUpdated', { groupId: data.groupId }); } catch (e) {}
    });

    socket.on('disconnect', async () => {
        console.log('👤 Рафт:', username);
        onlineUsers.delete(username);
        io.emit('userOffline', { username });
        try { await User.updateOne({ username }, { lastSeenAt: new Date() }); } catch (e) {}
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер: http://localhost:${PORT}`));

module.exports = { io };
