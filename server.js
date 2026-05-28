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
const io = socketIo(server, {
    cors: { origin: '*' }
});

// Лимити бехатар
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

// Онлайн корбарон
const onlineUsers = new Map(); // username -> socketId

// Socket.IO Middleware — JWT санҷидан
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

io.on('connection', (socket) => {
    const username = socket.username;
    console.log('👤 Пайваст шуд:', username);

    // Ба хонаи худаш дохил шав
    socket.join(username);
    onlineUsers.set(username, socket.id);

    // Ба ҳама хабар деҳ
    io.emit('userOnline', { username });
    // Рӯйхати онлайнҳо
    socket.emit('onlineList', Array.from(onlineUsers.keys()));

    socket.on('sendMessage', (data) => {
        try {
            // Ба гиранда фиристед
            io.to(data.receiver).emit('newMessage', data);
            // Ба фиристандаи дигар device ҳам фиристед
            io.to(data.sender).emit('newMessage', data);
        } catch (err) {
            console.log('sendMessage хатогӣ:', err);
        }
    });

    socket.on('reaction', (data) => {
        try {
            io.to(data.receiver).emit('reactionUpdate', data);
            io.to(data.sender).emit('reactionUpdate', data);
        } catch (err) {
            console.log('reaction хатогӣ:', err);
        }
    });

    socket.on('deleteMessage', (data) => {
        try {
            io.to(data.receiver).emit('messageDeleted', data);
            io.to(data.sender).emit('messageDeleted', data);
        } catch (err) {
            console.log('deleteMessage хатогӣ:', err);
        }
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

    socket.on('messageSeen', (data) => {
        try {
            io.to(data.sender).emit('messageSeenUpdate', { msgId: data.msgId });
        } catch (err) {}
    });

    socket.on('changeUsername', (data) => {
        try {
            const { oldUsername, newUsername } = data;
            // Хонаро иваз кун
            socket.leave(oldUsername);
            socket.join(newUsername);
            socket.username = newUsername;
            // onlineUsers навсозӣ
            onlineUsers.delete(oldUsername);
            onlineUsers.set(newUsername, socket.id);
            // Ба ҳама хабар деҳ
            io.emit('userOffline', { username: oldUsername });
            io.emit('userOnline', { username: newUsername });
            io.emit('usernameChanged', { oldUsername, newUsername });
        } catch (err) {
            console.log('changeUsername хатогӣ:', err);
        }
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
