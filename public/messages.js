const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
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

// Настройки Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Настройка хранилища в Облаке вместо локального диска
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'voice_messages',
        resource_type: 'video', // Для аудиозаписей .webm нужен тип video
        format: 'webm'
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // Максимум 10MB
});

// Роут барои гирифтани паёмҳо бо пагинация
router.get('/:receiver', authMiddleware, async (req, res) => {
    try {
        const { receiver } = req.params;
        const { limit = 20, before } = req.query;

        let query = {
            $or: [
                { sender: req.username, receiver: receiver, deletedBySender: false },
                { sender: receiver, receiver: req.username, deletedByReceiver: false }
            ]
        };

        if (before) {
            query.createdAt = { $lt: new Date(before) };
        }

        const messages = await Message.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit));

        res.json(messages.reverse());
    } catch (err) {
        res.status(500).json({ message: 'Хатогии сервер: ' + err.message });
    }
});

// Роут барои фиристодани голосовой ба Cloudinary
router.post('/voice', authMiddleware, upload.single('voice'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Файли аудио ёфт нашуд!' });
        }

        const { receiver, replyToId } = req.body;
        
        // Маҳз secure_url-и Cloudinary-ро мегирем
        const voiceUrl = req.file.path; 

        let replyToData = null;
        if (replyToId) {
            const parent = await Message.findById(replyToId);
            if (parent) {
                replyToData = {
                    messageId: parent._id,
                    sender: parent.sender,
                    type: parent.type,
                    body: parent.body
                };
            }
        }

        const newMsg = new Message({
            sender: req.username,
            receiver,
            type: 'voice',
            voiceUrl,
            replyTo: replyToData
        });

        await newMsg.save();
        res.status(201).json(newMsg);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ ҳангоми боркунӣ ба облако: ' + err.message });
    }
});

// Роут барои нест кардани паём
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { deleteFor } = req.body; // 'me' или 'all'
        const message = await Message.findById(req.params.id);

        if (!message) {
            return res.status(404).json({ message: 'Паём ёфт нашуд!' });
        }

        const isSender = message.sender === req.username;
        const isReceiver = message.receiver === req.username;

        if (!isSender && !isReceiver) {
            return res.status(403).json({ message: 'Ҳуқуқ надоред!' });
        }

        if (deleteFor === 'all' && isSender) {
            // Агар файл дар Cloudinary бошад, онро аз облако ҳам нест мекунем
            if (message.voiceUrl && message.voiceUrl.includes('cloudinary')) {
                try {
                    const publicId = 'voice_messages/' + message.voiceUrl.split('/').pop().split('.')[0];
                    await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
                } catch (cErr) {
                    console.log('Хатогии несткунии файл аз Cloudinary:', cErr);
                }
            }
            await Message.findByIdAndDelete(req.params.id);
            return res.json({ success: true, deletedFor: 'all' });
        }

        if (isSender) {
            message.deletedBySender = true;
        } else {
            message.deletedByReceiver = true;
        }

        if (message.deletedBySender && message.deletedByReceiver) {
            if (message.voiceUrl && message.voiceUrl.includes('cloudinary')) {
                try {
                    const publicId = 'voice_messages/' + message.voiceUrl.split('/').pop().split('.')[0];
                    await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
                } catch (cErr) {}
            }
            await Message.findByIdAndDelete(req.params.id);
            return res.json({ success: true, deletedFor: 'both' });
        }

        await message.save();
        res.json({ success: true, deletedFor: 'me' });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ ҳангоми несткунӣ: ' + err.message });
    }
});

module.exports = router;