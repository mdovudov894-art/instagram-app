const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB пайваст шуд!'))
    .catch(err => console.log('❌ Хатогӣ:', err));

io.on('connection', (socket) => {
    console.log('👤 Корбар пайваст шуд:', socket.id);

    socket.on('join', (username) => {
        socket.username = username;
        socket.join(username);
    });

    socket.on('sendMessage', (data) => {
        io.to(data.receiver).emit('newMessage', data);
    });

    socket.on('reaction', (data) => {
        // Ба ҳарду тараф фиристед
        io.to(data.receiver).emit('reactionUpdate', data);
        io.to(data.sender).emit('reactionUpdate', data);
    });

    socket.on('deleteMessage', (data) => {
        io.to(data.receiver).emit('messageDeleted', data);
        io.to(data.sender).emit('messageDeleted', data);
    });

    socket.on('disconnect', () => {
        console.log('👤 Корбар рафт:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер дар http://localhost:${PORT} кор мекунад`);
});

module.exports = { io };