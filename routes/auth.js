const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const User = require('../models/User');
const Message = require('../models/Message');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const avatarStorage = new CloudinaryStorage({
    cloudinary,
    params: {
        resource_type: 'image',
        folder: 'chat-avatars',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [{ width: 300, height: 300, crop: 'fill', gravity: 'face' }]
    }
});
const avatarUpload = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

const authMiddleware = (req, res, next) => {
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

const SECURITY_QUESTIONS = [
    'Номи ҳайвони аввалини ту?',
    'Номи шаҳри таваллудгоҳи ту?',
    'Номи беҳтарин дӯсти кӯдакии ту?',
    'Номи мактаби аввалини ту?',
    'Хӯроки дӯстдоштаи ту?'
];

router.get('/security-questions', (req, res) => {
    res.json(SECURITY_QUESTIONS);
});

// Регистрация
router.post('/register', async (req, res) => {
    try {
        const { username, password, securityQuestion, securityAnswer } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Ҳамаи майдонҳоро пур кунед!' });
        if (username.trim().length < 3) return res.status(400).json({ message: 'Ном камаш 3 ҳарф бошад!' });
        if (password.length < 6) return res.status(400).json({ message: 'Парол камаш 6 аломат бошад!' });
        if (!securityQuestion || !securityAnswer) return res.status(400).json({ message: 'Савол ва ҷавобро пур кунед!' });

        const existing = await User.findOne({ username: username.trim() });
        if (existing) return res.status(400).json({ message: 'Ин ном аллакай гирифта шудааст!' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const hashedAnswer = await bcrypt.hash(securityAnswer.trim().toLowerCase(), salt);

        const user = new User({
            username: username.trim(),
            password: hashedPassword,
            securityQuestion,
            securityAnswer: hashedAnswer
        });
        await user.save();

        const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
        try { const { io } = require('../server'); io.emit('newUserRegistered', { username: user.username }); } catch(e) {}
        res.json({ token, username: user.username });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Войти
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Ҳамаи майдонҳоро пур кунед!' });
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ message: 'Корбар ёфт нашуд!' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Парол нодуруст!' });
        const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, username, avatar: user.avatar || '', role: user.role || 'user' });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Баркарорсозии парол — қадами 1: Ёфтани корбар ва савол
router.post('/forgot-password/question', async (req, res) => {
    try {
        const { username } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: 'Корбар ёфт нашуд!' });
        if (!user.securityQuestion) return res.status(400).json({ message: 'Савол насозондааст!' });
        res.json({ question: user.securityQuestion });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Баркарорсозии парол — қадами 2: Санҷидани ҷавоб
router.post('/forgot-password/verify', async (req, res) => {
    try {
        const { username, answer } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: 'Корбар ёфт нашуд!' });
        const isMatch = await bcrypt.compare(answer.trim().toLowerCase(), user.securityAnswer);
        if (!isMatch) return res.status(400).json({ message: 'Ҷавоб нодуруст!' });
        const resetToken = jwt.sign({ username, type: 'reset' }, process.env.JWT_SECRET, { expiresIn: '15m' });
        res.json({ resetToken });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Баркарорсозии парол — қадами 3: Гузоштани пароли нав
router.post('/forgot-password/reset', async (req, res) => {
    try {
        const { resetToken, newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) return res.status(400).json({ message: 'Парол камаш 6 аломат бошад!' });
        const decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
        if (decoded.type !== 'reset') return res.status(400).json({ message: 'Токен нодуруст!' });
        const salt = await bcrypt.genSalt(10);
        const hashed = await bcrypt.hash(newPassword, salt);
        await User.updateOne({ username: decoded.username }, { password: hashed });
        res.json({ success: true, message: 'Парол бо муваффақият иваз шуд!' });
    } catch (err) {
        if (err.name === 'TokenExpiredError') return res.status(400).json({ message: 'Муҳлати токен гузашт (15 дақиқа). Аз нав кӯшиш кунед!' });
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Ҳамаи корбарон
router.get('/users', authMiddleware, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.username });
        const blocked = user?.blockedUsers || [];
        const users = await User.find(
            { username: { $ne: req.username, $nin: blocked } },
            { password: 0, securityAnswer: 0 }
        ).lean();
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Блок кардан
router.post('/block/:target', authMiddleware, async (req, res) => {
    try {
        const { target } = req.params;
        if (target === req.username) return res.status(400).json({ message: 'Худатро блок карда наметавонед!' });
        await User.updateOne({ username: req.username }, { $addToSet: { blockedUsers: target } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Блок бардоштан
router.post('/unblock/:target', authMiddleware, async (req, res) => {
    try {
        const { target } = req.params;
        await User.updateOne({ username: req.username }, { $pull: { blockedUsers: target } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Рӯйхати блокшудагон
router.get('/blocked', authMiddleware, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.username }, { blockedUsers: 1 });
        res.json(user?.blockedUsers || []);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Аватар боркунӣ
router.post('/upload-avatar', authMiddleware, avatarUpload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'Файл интихоб нашудааст!' });
        const avatarUrl = req.file.path || req.file.secure_url;
        await User.updateOne({ username: req.username }, { avatar: avatarUrl });
        res.json({ avatar: avatarUrl });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Танзимоти онлайн
router.put('/online-visibility', authMiddleware, async (req, res) => {
    try {
        const { visibility, visibleTo } = req.body;
        const valid = ['everyone', 'nobody', 'selected'];
        if (!valid.includes(visibility)) return res.status(400).json({ message: 'Нодуруст!' });
        await User.updateOne({ username: req.username }, {
            onlineVisibility: visibility,
            onlineVisibleTo: Array.isArray(visibleTo) ? visibleTo : []
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Иваз кардани ном
router.put('/change-username', authMiddleware, async (req, res) => {
    try {
        const { newUsername } = req.body;
        const oldUsername = req.username;
        if (!newUsername || newUsername.trim().length < 3) return res.status(400).json({ message: 'Ном камаш 3 ҳарф бошад!' });
        const trimmed = newUsername.trim();
        const existing = await User.findOne({ username: trimmed });
        if (existing) return res.status(400).json({ message: 'Ин ном аллакай гирифта шудааст!' });
        await User.updateOne({ username: oldUsername }, { username: trimmed });
        await Message.updateMany({ sender: oldUsername }, { sender: trimmed });
        await Message.updateMany({ receiver: oldUsername }, { receiver: trimmed });
        await Message.updateMany({ 'replyTo.sender': oldUsername }, { 'replyTo.sender': trimmed });
        const newToken = jwt.sign({ username: trimmed }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({ token: newToken, username: trimmed, oldUsername });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Токен санҷидан
router.get('/verify', authMiddleware, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.username }, { password: 0, securityAnswer: 0 });
        if (!user) return res.status(404).json({ message: 'Корбар ёфт нашуд!' });
        res.json({ username: req.username, avatar: user.avatar || '', onlineVisibility: user.onlineVisibility || 'everyone', role: user.role || 'user' });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

module.exports = router;
