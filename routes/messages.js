const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Message = require('../models/Message');

// Папкаи uploads месозем
const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer танзимот
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const unique = Date.now() + '_' + Math.round(Math.random() * 1e9);
        cb(null, unique + '.webm');
    }
});
const upload = multer({ storage });

const authMiddleware = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Токен нест!' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.username = decoded.username;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Токен нодуруст!' });
    }
};

// Паёмҳоро гирифтан
router.get('/:receiver', authMiddleware, async (req, res) => {
    try {
        const messages = await Message.find({
            $or: [
                { sender: req.username, receiver: req.params.receiver },
                { sender: req.params.receiver, receiver: req.username }
            ]
        }).sort({ timestamp: 1 });
        res.json(messages);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Матни паём фиристодан
router.post('/send', authMiddleware, async (req, res) => {
    try {
        const { receiver, body } = req.body;
        const message = new Message({
            sender: req.username,
            receiver,
            type: 'text',
            body: body || ''
        });
        await message.save();
        res.json(message);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Голосовой паём фиристодан
router.post('/voice', authMiddleware, upload.single('audio'), async (req, res) => {
    try {
        const { receiver, duration } = req.body;
        if (!req.file) return res.status(400).json({ message: 'Файл нест!' });

        const voiceUrl = '/uploads/' + req.file.filename;
        const message = new Message({
            sender: req.username,
            receiver,
            type: 'voice',
            voiceUrl,
            duration: parseInt(duration) || 0
        });
        await message.save();
        res.json(message);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Реаксия гузоштан
router.put('/reaction/:id', authMiddleware, async (req, res) => {
    try {
        const { reaction, side } = req.body;
        const update = {};
        if (side === 'sender') update.reactionBySender = reaction;
        else update.reactionByReceiver = reaction;

        const message = await Message.findByIdAndUpdate(
            req.params.id,
            update,
            { new: true }
        );
        res.json(message);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Паёмро ҳазф кардан
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);
        if (!message) return res.status(404).json({ message: 'Паём ёфт нашуд!' });

        if (message.sender === req.username) {
            // Агар голосовой бошад, файлро ҳам ҳазф кун
            if (message.voiceUrl) {
                const filePath = path.join(__dirname, '../public', message.voiceUrl);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
            await Message.findByIdAndUpdate(req.params.id, {
                deletedBySender: true,
                body: '',
                voiceUrl: ''
            });
        } else if (message.receiver === req.username) {
            await Message.findByIdAndUpdate(req.params.id, {
                deletedByReceiver: true
            });
        } else {
            return res.status(403).json({ message: 'Ҳуқуқ надоред!' });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

module.exports = router;