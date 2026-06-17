const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');

// Admin middleware
const adminMiddleware = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Токен нест!' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.username = decoded.username;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Токен нодуруст!' });
    }
};

const checkAdmin = async (req, res, next) => {
    const user = await User.findOne({ username: req.username });
    if (!user || user.role !== 'admin') return res.status(403).json({ message: 'Дастрасӣ нест!' });
    next();
};

// Омор
router.get('/stats', adminMiddleware, checkAdmin, async (req, res) => {
    try {
        const [totalUsers, totalMessages, onlineCount] = await Promise.all([
            User.countDocuments(),
            Message.countDocuments(),
            User.countDocuments()
        ]);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todayMessages = await Message.countDocuments({ timestamp: { $gte: today } });
        const newUsers = await User.countDocuments({ createdAt: { $gte: today } });
        res.json({ totalUsers, totalMessages, todayMessages, newUsers });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Рӯйхати корбарон
router.get('/users', adminMiddleware, checkAdmin, async (req, res) => {
    try {
        const users = await User.find({}, { password: 0, securityAnswer: 0 })
            .sort({ createdAt: -1 }).lean();
        const withStats = await Promise.all(users.map(async u => {
            const msgCount = await Message.countDocuments({
                $or: [{ sender: u.username }, { receiver: u.username }]
            });
            return { ...u, msgCount };
        }));
        res.json(withStats);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Ҳазфи корбар
router.delete('/users/:username', adminMiddleware, checkAdmin, async (req, res) => {
    try {
        const { username } = req.params;
        if (username === req.username) return res.status(400).json({ message: 'Худатро ҳазф карда наметавонед!' });
        await User.deleteOne({ username });
        await Message.deleteMany({ $or: [{ sender: username }, { receiver: username }] });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Admin/user роли иваз кардан
router.put('/users/:username/role', adminMiddleware, checkAdmin, async (req, res) => {
    try {
        const { role } = req.body;
        if (!['user', 'admin'].includes(role)) return res.status(400).json({ message: 'Роли нодуруст!' });
        await User.updateOne({ username: req.params.username }, { role });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Ҳазфи паёмҳои корбар
router.delete('/messages/:username', adminMiddleware, checkAdmin, async (req, res) => {
    try {
        await Message.deleteMany({ sender: req.params.username });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

module.exports = router;
