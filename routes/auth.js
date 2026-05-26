const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Message = require('../models/Message');

// Auth Middleware
const authMiddleware = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Токен нест!' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.username = decoded.username;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Токен нодуруст ё муддаташ гузаштааст!' });
    }
};

// Регистрация
router.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: 'Ҳамаи майдонҳоро пур кунед!' });
        }
        if (username.length < 3) {
            return res.status(400).json({ message: 'Ном камаш 3 ҳарф бошад!' });
        }
        if (password.length < 6) {
            return res.status(400).json({ message: 'Парол камаш 6 аломат бошад!' });
        }
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Ин ном аллакай гирифта шудааст!' });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const user = new User({ username, password: hashedPassword });
        await user.save();
        const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, username });
    } catch (err) {
        console.log('Register error:', err.message);
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Войти
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: 'Ҳамаи майдонҳоро пур кунед!' });
        }
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ message: 'Корбар ёфт нашуд!' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Парол нодуруст!' });
        const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, username });
    } catch (err) {
        console.log('Login error:', err.message);
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Ҳамаи корбарон
router.get('/users', authMiddleware, async (req, res) => {
    try {
        const users = await User.find(
            { username: { $ne: req.username } },
            { password: 0 }
        ).lean();
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Иваз кардани ном
router.put('/change-username', authMiddleware, async (req, res) => {
    try {
        const { newUsername } = req.body;
        const oldUsername = req.username;

        if (!newUsername || newUsername.trim().length < 3) {
            return res.status(400).json({ message: 'Ном камаш 3 ҳарф бошад!' });
        }

        const trimmed = newUsername.trim();

        const existing = await User.findOne({ username: trimmed });
        if (existing) {
            return res.status(400).json({ message: 'Ин ном аллакай гирифта шудааст!' });
        }

        // User-ро навсозӣ кун
        await User.updateOne({ username: oldUsername }, { username: trimmed });

        // Паёмҳоро навсозӣ кун
        await Message.updateMany({ sender: oldUsername }, { sender: trimmed });
        await Message.updateMany({ receiver: oldUsername }, { receiver: trimmed });
        await Message.updateMany(
            { 'replyTo.sender': oldUsername },
            { 'replyTo.sender': trimmed }
        );

        const newToken = jwt.sign({ username: trimmed }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({ token: newToken, username: trimmed, oldUsername });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Токенро санҷидан
router.get('/verify', authMiddleware, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.username }, { password: 0 });
        if (!user) return res.status(404).json({ message: 'Корбар ёфт нашуд!' });
        res.json({ username: req.username });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

module.exports = router;