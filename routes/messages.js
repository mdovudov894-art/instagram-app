const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const Message = require('../models/Message');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Voice storage
const voiceStorage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => ({
        resource_type: 'video',
        folder: 'chat-voice-messages',
        format: 'webm',
        public_id: `voice_${Date.now()}_${Math.round(Math.random() * 1e9)}`
    })
});

// №17 — Media storage (сурат + видео)
const mediaStorage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
        const isVideo = file.mimetype && file.mimetype.startsWith('video/');
        return {
            resource_type: isVideo ? 'video' : 'image',
            folder: 'chat-media',
            public_id: `media_${Date.now()}_${Math.round(Math.random() * 1e9)}`
        };
    }
});

const upload = multer({ storage: voiceStorage, limits: { fileSize: 10 * 1024 * 1024 } });
const mediaUpload = multer({ storage: mediaStorage, limits: { fileSize: 50 * 1024 * 1024 } });

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

const PAGE_SIZE = 30;

// Паёмҳоро гирифтан
router.get('/:receiver', authMiddleware, async (req, res) => {
    try {
        const { before } = req.query;
        const query = {
            $or: [
                { sender: req.username, receiver: req.params.receiver },
                { sender: req.params.receiver, receiver: req.username }
            ]
        };
        if (before) query.timestamp = { $lt: new Date(before) };
        const messages = await Message.find(query)
            .sort({ timestamp: -1 })
            .limit(PAGE_SIZE)
            .lean();
        const filtered = messages.filter(msg => {
            if (msg.sender === req.username && msg.deletedBySender) return false;
            if (msg.receiver === req.username && msg.deletedByReceiver) return false;
            return true;
        });
        res.json(filtered.reverse());
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Матни паём
router.post('/send', authMiddleware, async (req, res) => {
    try {
        const { receiver, body, replyToId } = req.body;
        if (!receiver || !body)
            return res.status(400).json({ message: 'Маълумот нопурра!' });
        let replyData = null;
        if (replyToId && !replyToId.startsWith('temp_')) {
            const replyMsg = await Message.findById(replyToId).catch(() => null);
            if (replyMsg) {
                replyData = {
                    _id: replyMsg._id.toString(),
                    sender: replyMsg.sender,
                    body: replyMsg.type === 'voice' ? '' : (replyMsg.body || ''),
                    type: replyMsg.type
                };
            }
        }
        const message = new Message({
            sender: req.username,
            receiver,
            type: 'text',
            body: body.substring(0, 4000),
            replyTo: replyData
        });
        await message.save();
        res.json(message);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Голосовой паём
router.post('/voice', authMiddleware, upload.any(), async (req, res) => {
    try {
        const { receiver, duration, replyToId } = req.body;
        const file = req.files && req.files[0];
        if (!file) return res.status(400).json({ message: 'Файл ёфт нашуд!' });
        if (!receiver) return res.status(400).json({ message: 'Гиранда нест!' });
        let replyData = null;
        if (replyToId && !replyToId.startsWith('temp_')) {
            const replyMsg = await Message.findById(replyToId).catch(() => null);
            if (replyMsg) {
                replyData = {
                    _id: replyMsg._id.toString(),
                    sender: replyMsg.sender,
                    body: replyMsg.type === 'voice' ? '' : (replyMsg.body || ''),
                    type: replyMsg.type
                };
            }
        }
        const voiceUrl = file.path || file.secure_url;
        const message = new Message({
            sender: req.username,
            receiver,
            type: 'voice',
            voiceUrl,
            duration: Math.min(parseInt(duration) || 0, 300),
            replyTo: replyData
        });
        await message.save();
        res.json(message);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ ҳангоми боркунӣ: ' + err.message });
    }
});

// №17 — Сурат / Видео фиристодан
router.post('/media', authMiddleware, mediaUpload.single('media'), async (req, res) => {
    try {
        const { receiver, replyToId } = req.body;
        if (!req.file) return res.status(400).json({ message: 'Файл нест!' });
        if (!receiver) return res.status(400).json({ message: 'Гиранда нест!' });
        const mediaUrl = req.file.path || req.file.secure_url;
        const isVideo = req.file.mimetype && req.file.mimetype.startsWith('video/');
        let replyData = null;
        if (replyToId && !replyToId.startsWith('temp_')) {
            const replyMsg = await Message.findById(replyToId).catch(() => null);
            if (replyMsg) {
                replyData = {
                    _id: replyMsg._id.toString(),
                    sender: replyMsg.sender,
                    body: replyMsg.type === 'voice' ? '' : (replyMsg.body || ''),
                    type: replyMsg.type
                };
            }
        }
        const message = new Message({
            sender: req.username,
            receiver,
            type: isVideo ? 'video' : 'image',
            mediaUrl,
            replyTo: replyData
        });
        await message.save();
        res.json(message);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Реаксия
router.put('/reaction/:id', authMiddleware, async (req, res) => {
    try {
        const { reaction, side } = req.body;
        const message = await Message.findById(req.params.id);
        if (!message) return res.status(404).json({ message: 'Паём ёфт нашуд!' });
        if (message.sender !== req.username && message.receiver !== req.username)
            return res.status(403).json({ message: 'Ҳуқуқ надоред!' });
        const update = {};
        if (side === 'sender') {
            update.reactionBySender = message.reactionBySender === reaction ? '' : reaction;
        } else {
            update.reactionByReceiver = message.reactionByReceiver === reaction ? '' : reaction;
        }
        const updated = await Message.findByIdAndUpdate(req.params.id, update, { new: true });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Seen
router.put('/seen/:id', authMiddleware, async (req, res) => {
    try {
        const message = await Message.findByIdAndUpdate(
            req.params.id, { seen: true }, { new: true }
        );
        res.json(message);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Ҳазф
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { deleteFor } = req.body;
        const message = await Message.findById(req.params.id);
        if (!message) return res.status(404).json({ message: 'Паём ёфт нашуд!' });
        const isSender = message.sender === req.username;
        const isReceiver = message.receiver === req.username;
        if (!isSender && !isReceiver)
            return res.status(403).json({ message: 'Ҳуқуқ надоред!' });

        const deleteFromCloudinary = async (url, type = 'video') => {
            if (!url) return;
            try {
                const urlParts = url.split('/');
                const fileWithExt = urlParts[urlParts.length - 1];
                const folder = type === 'image' ? 'chat-media' : type === 'image_media' ? 'chat-media' : 'chat-voice-messages';
                const publicId = folder + '/' + fileWithExt.split('.')[0];
                await cloudinary.uploader.destroy(publicId, { resource_type: type === 'video' ? 'video' : 'image' });
            } catch (e) {}
        };

        if (deleteFor === 'all' && isSender) {
            if (message.type === 'voice') await deleteFromCloudinary(message.voiceUrl, 'video');
            if (message.type === 'image') await deleteFromCloudinary(message.mediaUrl, 'image');
            if (message.type === 'video') await deleteFromCloudinary(message.mediaUrl, 'video');
            await Message.findByIdAndDelete(req.params.id);
            return res.json({ success: true, deletedFor: 'all' });
        }

        if (isSender) message.deletedBySender = true;
        else message.deletedByReceiver = true;

        if (message.deletedBySender && message.deletedByReceiver) {
            if (message.type === 'voice') await deleteFromCloudinary(message.voiceUrl, 'video');
            if (message.type === 'image') await deleteFromCloudinary(message.mediaUrl, 'image');
            if (message.type === 'video') await deleteFromCloudinary(message.mediaUrl, 'video');
            await Message.findByIdAndDelete(req.params.id);
            return res.json({ success: true, deletedFor: 'both' });
        }

        await message.save();
        return res.json({ success: true, deletedFor: 'me' });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

module.exports = router;
