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

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB пайваст шуд!'))
    .catch(err => console.log('❌ Хатогӣ:', err));

const onlineUsers = new Map(); // username -> socketId

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

// №13 — Санҷидани онлайн visibility
const User = require('./models/User');

async function canSeeOnline(viewerUsername, targetUsername) {
    try {
        const target = await User.findOne({ username: targetUsername }, { onlineVisibility: 1, onlineVisibleTo: 1 }).lean();
        if (!target) return false;
        if (target.onlineVisibility === 'everyone') return true;
        if (target.onlineVisibility === 'nobody') return false;
        if (target.onlineVisibility === 'selected') {
            return (target.onlineVisibleTo || []).includes(viewerUsername);
        }
        return true;
    } catch(e) { return true; }
}

io.on('connection', async (socket) => {
    const username = socket.username;
    console.log('👤 Пайваст шуд:', username);

    socket.join(username);
    onlineUsers.set(username, socket.id);

    // Ба ҳама хабар деҳ (visibility санҷида мешавад)
    const allSockets = await io.fetchSockets();
    for (const s of allSockets) {
        if (s.username && s.username !== username) {
            const canSee = await canSeeOnline(s.username, username);
            if (canSee) s.emit('userOnline', { username });
        }
    }

    // Рӯйхати онлайнҳо — танҳо онҳое ки иҷозат доранд
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
        } catch (err) {}
    });

    socket.on('reaction', (data) => {
        try {
            io.to(data.receiver).emit('reactionUpdate', data);
            io.to(data.sender).emit('reactionUpdate', data);
        } catch (err) {}
    });

    socket.on('deleteMessage', (data) => {
        try {
            io.to(data.receiver).emit('messageDeleted', data);
            io.to(data.sender).emit('messageDeleted', data);
        } catch (err) {}
    });

    socket.on('typing', (data) => {
        try {
            io.to(data.receiver).emit('userTyping', { sender: data.sender });
        } catch (err) {}
    });

    socket.on('stopTyping', (data) => {
        try {
            io.to(data.receiver).emit('userStopTyping', { sender: data.sender });
        } catch (err) {}
    });

    // №8 — Голосовой карда истодааст
    socket.on('voiceRecording', (data) => {
        try {
            io.to(data.receiver).emit('userVoiceRecording', { sender: data.sender });
        } catch (err) {}
    });

    socket.on('stopVoiceRecording', (data) => {
        try {
            io.to(data.receiver).emit('userStopVoiceRecording', { sender: data.sender });
        } catch (err) {}
    });

    // №3 — Real-time аватар навсозӣ
    socket.on('avatarChanged', (data) => {
        try {
            socket.broadcast.emit('userAvatarChanged', { username: data.username, avatar: data.avatar });
        } catch(e) {}
    });

    socket.on('messageSeen', (data) => {
        try {
            io.to(data.sender).emit('messageSeenUpdate', { msgId: data.msgId });
        } catch (err) {}
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
        } catch (err) {}
    });

    // №13 — Visibility навсозӣ
    socket.on('updateVisibility', async (data) => {
        try {
            // Ба ҳама онлайн статусро навсозӣ кун
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

    socket.on('disconnect', () => {
        console.log('👤 Рафт:', username);
        onlineUsers.delete(username);
        io.emit('userOffline', { username });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер дар http://localhost:${PORT} кор мекунад`);
});

module.exports = { io };
