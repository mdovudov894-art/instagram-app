const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Регистрация
router.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: 'Ҳамаи майдонҳоро пур кунед!' });
        }
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Ин ном аллакай гирифта шудааст!' });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const user = new User({ username, password: hashedPassword });
        await user.save();
        const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '7d' });
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
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ message: 'Корбар ёфт нашуд!' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Парол нодуруст!' });
        const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, username });
    } catch (err) {
        console.log('Login error:', err.message);
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Ҳамаи корбарон
router.get('/users', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Токен нест!' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const users = await User.find(
            { username: { $ne: decoded.username } },
            { password: 0 }
        ).lean();
        res.json(users);
    } catch (err) {
        console.log('Users error:', err.message);
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

module.exports = router;