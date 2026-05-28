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
        socket.username = decoded.username; // Номи тасдиқшуда аз Токен
        next();
    } catch (err) {
        return next(new Error('Токен нодуруст аст!'));
    }
});

io.on('connection', (socket) => {
    const username = socket.username;
    console.log('👤 Пайваст шуд:', username);

    // Ба хонаи шахсӣ даромадан
    socket.join(username);
    onlineUsers.set(username, socket.id);

    // Ба ҳама хабар деҳ, ки онлайн шуд
    io.emit('userOnline', { username });

    // Рӯйхати онлайнҳоро ба худи корбар фиристед
    socket.emit('onlineList', Array.from(onlineUsers.keys()));

    // Фиристодани паём (Амният ислоҳ шуд)
    socket.on('sendMessage', (data) => {
        try {
            // Номи фиристандаро аз сокети тасдиқшуда мегирем, на аз маълумоти клиент
            const verifiedSender = socket.username; 
            
            io.to(data.receiver).emit('newMessage', {
                ...data,
                sender: verifiedSender
            });
            io.to(verifiedSender).emit('newMessage', {
                ...data,
                sender: verifiedSender
            });
        } catch (err) {}
    });

    // Реаксия (Амният ислоҳ шуд)
    socket.on('reaction', (data) => {
        try {
            const verifiedSender = socket.username;

            io.to(data.msgReceiver).emit('messageReaction', {
                ...data,
                sender: verifiedSender // Амният: фиристандаи аслӣ
            });
            io.to(data.msgSender).emit('messageReaction', {
                ...data,
                sender: verifiedSender // Амният: фиристандаи аслӣ
            });
        } catch (err) {}
    });

    // Нест кардани паём (Амният ислоҳ шуд)
    socket.on('deleteMessage', (data) => {
        try {
            const verifiedSender = socket.username;

            io.to(data.receiver).emit('messageDeleted', {
                ...data,
                deletedBy: verifiedSender // Амният
            });
            io.to(verifiedSender).emit('messageDeleted', {
                ...data,
                deletedBy: verifiedSender // Амният
            });
        } catch (err) {}
    });

    // Навишта истодааст (Амният ислоҳ шуд)
    socket.on('typing', (data) => {
        try {
            io.to(data.receiver).emit('userTyping', { sender: socket.username });
        } catch (err) {}
    });

    // Навиштанро бас кард (Амният ислоҳ шуд)
    socket.on('stopTyping', (data) => {
        try {
            io.to(data.receiver).emit('userStopTyping', { sender: socket.username });
        } catch (err) {}
    });

    // Дида шудани паём
    socket.on('messageSeen', (data) => {
        try {
            io.to(data.sender).emit('messageSeenUpdate', { msgId: data.msgId });
        } catch (err) {}
    });

    // Иваз кардани номи корбарӣ
    socket.on('changeUsername', (data) => {
        try {
            const { oldUsername, newUsername } = data;
            // Танҳо худи корбар метавонад номи худро иваз кунад
            if (socket.username !== oldUsername) return;

            socket.leave(oldUsername);
            socket.join(newUsername);
            socket.username = newUsername;
            
            onlineUsers.delete(oldUsername);
            onlineUsers.set(newUsername, socket.id);
            
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
    console.log(`🚀 Сервер дар порти ${PORT} кор карда истодааст...`);
});
