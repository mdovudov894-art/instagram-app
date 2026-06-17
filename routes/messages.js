const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const Message = require('../models/Message');
const User = require('../models/User');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const voiceStorage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => ({
        resource_type: 'video',
        folder: 'chat-voice-messages',
        format: 'webm',
        public_id: `voice_${Date.now()}_${Math.round(Math.random() * 1e9)}`
    })
});

// ============================
// ТАҒЙИР ДОДАН — ин ҷоро иваз кун барои сифати видео:
const VIDEO_QUALITY = {
    height: 480,         // ← 240 | 360 | 480 | 720
    crop: 'scale',
    quality: 'auto:low', // ← 'auto:eco' | 'auto:low' | 'auto:good'
    format: 'mp4'
};
// ============================

const mediaStorage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
        const isVideo = file.mimetype && file.mimetype.startsWith('video/');
        return {
            resource_type: isVideo ? 'video' : 'image',
            folder: 'chat-media',
            public_id: `media_${Date.now()}_${Math.round(Math.random() * 1e9)}`,
            ...(isVideo ? { chunk_size: 6000000 } : {})
        };
    }
});

const upload = multer({ storage: voiceStorage, limits: { fileSize: 10 * 1024 * 1024 } });
const mediaUpload = multer({ storage: mediaStorage, limits: { fileSize: 100 * 1024 * 1024 } });

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
        const messages = await Message.find(query).sort({ timestamp: -1 }).limit(PAGE_SIZE).lean();
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
        if (!receiver || !body) return res.status(400).json({ message: 'Маълумот нопурра!' });

        // Блок санҷидан
        const receiverUser = await User.findOne({ username: receiver });
        if (receiverUser && receiverUser.blockedUsers.includes(req.username)) {
            return res.status(403).json({ message: 'Ин корбар шуморо блок кардааст!' });
        }

        let replyData = null;
        if (replyToId && !replyToId.startsWith('temp_')) {
            const replyMsg = await Message.findById(replyToId).catch(() => null);
            if (replyMsg) {
                replyData = {
                    _id: replyMsg._id.toString(), sender: replyMsg.sender,
                    body: replyMsg.type === 'voice' ? '' : (replyMsg.body || ''), type: replyMsg.type
                };
            }
        }
        const message = new Message({ sender: req.username, receiver, type: 'text', body: body.substring(0, 4000), replyTo: replyData });
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
                    _id: replyMsg._id.toString(), sender: replyMsg.sender,
                    body: replyMsg.type === 'voice' ? '' : (replyMsg.body || ''), type: replyMsg.type
                };
            }
        }
        const voiceUrl = file.path || file.secure_url;
        const message = new Message({
            sender: req.username, receiver, type: 'voice', voiceUrl,
            duration: Math.min(parseInt(duration) || 0, 300), replyTo: replyData
        });
        await message.save();
        res.json(message);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Медиа (сурат/видео)
router.post('/media', authMiddleware, mediaUpload.single('media'), async (req, res) => {
    try {
        const { receiver, replyToId } = req.body;
        if (!req.file) return res.status(400).json({ message: 'Файл нест!' });
        if (!receiver) return res.status(400).json({ message: 'Гиранда нест!' });
        const rawUrl = req.file.path || req.file.secure_url;
        const isVideo = req.file.mimetype && req.file.mimetype.startsWith('video/');
        let mediaUrl = rawUrl;
        let thumbUrl = '';
        if (isVideo && rawUrl) {
            const q = `h_${VIDEO_QUALITY.height},c_${VIDEO_QUALITY.crop},q_${VIDEO_QUALITY.quality},f_${VIDEO_QUALITY.format}`;
            mediaUrl = rawUrl.replace('/upload/', `/upload/${q}/`);
            thumbUrl = rawUrl.replace('/upload/', '/upload/so_0,f_jpg/').replace(/\.[^/.]+$/, '.jpg');
        }
        let replyData = null;
        if (replyToId && !replyToId.startsWith('temp_')) {
            const replyMsg = await Message.findById(replyToId).catch(() => null);
            if (replyMsg) {
                replyData = {
                    _id: replyMsg._id.toString(), sender: replyMsg.sender,
                    body: replyMsg.type === 'voice' ? '' : (replyMsg.body || ''), type: replyMsg.type
                };
            }
        }
        const message = new Message({
            sender: req.username, receiver, type: isVideo ? 'video' : 'image',
            mediaUrl, thumbUrl, replyTo: replyData
        });
        await message.save();
        res.json(message);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Иваз кардани паём
router.put('/edit/:id', authMiddleware, async (req, res) => {
    try {
        const { body } = req.body;
        if (!body || !body.trim()) return res.status(400).json({ message: 'Матн холӣ аст!' });
        const message = await Message.findById(req.params.id);
        if (!message) return res.status(404).json({ message: 'Паём ёфт нашуд!' });
        if (message.sender !== req.username) return res.status(403).json({ message: 'Ҳуқуқ надоред!' });
        if (message.type !== 'text') return res.status(400).json({ message: 'Танҳо матнро иваз кардан мумкин!' });
        message.body = body.trim().substring(0, 4000);
        message.edited = true;
        message.editedAt = new Date();
        await message.save();
        res.json(message);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Сабт кардани паём
router.put('/pin/:id', authMiddleware, async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);
        if (!message) return res.status(404).json({ message: 'Паём ёфт нашуд!' });
        if (message.sender !== req.username && message.receiver !== req.username) {
            return res.status(403).json({ message: 'Ҳуқуқ надоред!' });
        }
        // Аввал ҳамаи паёмҳои ин чатро unspin кун
        const otherUser = message.sender === req.username ? message.receiver : message.sender;
        await Message.updateMany({
            $or: [
                { sender: req.username, receiver: otherUser },
                { sender: otherUser, receiver: req.username }
            ]
        }, { pinned: false });
        // Ин паёмро pin кун (toggle)
        const wasPinned = message.pinned;
        if (!wasPinned) {
            message.pinned = true;
            await message.save();
        }
        res.json({ pinned: !wasPinned, message });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Паёми сабтшуда
router.get('/pinned/:with', authMiddleware, async (req, res) => {
    try {
        const msg = await Message.findOne({
            $or: [
                { sender: req.username, receiver: req.params.with, pinned: true },
                { sender: req.params.with, receiver: req.username, pinned: true }
            ]
        });
        res.json(msg || null);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Ҷустуҷӯи паёмҳо
router.get('/search/:with', authMiddleware, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 2) return res.json([]);
        const messages = await Message.find({
            $or: [
                { sender: req.username, receiver: req.params.with },
                { sender: req.params.with, receiver: req.username }
            ],
            type: 'text',
            body: { $regex: q.trim(), $options: 'i' },
            deletedBySender: { $ne: true },
            deletedByReceiver: { $ne: true }
        }).sort({ timestamp: -1 }).limit(20).lean();
        res.json(messages);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Содиркунии чат (export)
router.get('/export/:with', authMiddleware, async (req, res) => {
    try {
        const allMsgs = await Message.find({
            $or: [
                { sender: req.username, receiver: req.params.with },
                { sender: req.params.with, receiver: req.username }
            ]
        }).sort({ timestamp: 1 }).lean();

        let text = `Чати ${req.username} ва ${req.params.with}\n`;
        text += `Содиркунӣ: ${new Date().toLocaleString('tg')}\n`;
        text += '='.repeat(40) + '\n\n';

        allMsgs.forEach(msg => {
            const time = new Date(msg.timestamp).toLocaleString('ru');
            const body = msg.type === 'voice' ? '[Голосовой паём]'
                : msg.type === 'image' ? '[Сурат]'
                : msg.type === 'video' ? '[Видео]'
                : msg.body;
            text += `[${time}] ${msg.sender}: ${body}\n`;
        });

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="chat_${req.params.with}.txt"`);
        res.send(text);
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
        if (message.sender !== req.username && message.receiver !== req.username) return res.status(403).json({ message: 'Ҳуқуқ надоред!' });
        const update = {};
        if (side === 'sender') update.reactionBySender = message.reactionBySender === reaction ? '' : reaction;
        else update.reactionByReceiver = message.reactionByReceiver === reaction ? '' : reaction;
        const updated = await Message.findByIdAndUpdate(req.params.id, update, { new: true });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Seen
router.put('/seen/:id', authMiddleware, async (req, res) => {
    try {
        const message = await Message.findByIdAndUpdate(req.params.id, { seen: true }, { new: true });
        res.json(message);
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Ҳазфи якта
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { deleteFor } = req.body;
        const message = await Message.findById(req.params.id);
        if (!message) return res.status(404).json({ message: 'Паём ёфт нашуд!' });
        const isSender = message.sender === req.username;
        const isReceiver = message.receiver === req.username;
        if (!isSender && !isReceiver) return res.status(403).json({ message: 'Ҳуқуқ надоред!' });

        const destroy = async (url, type = 'video') => {
            if (!url) return;
            try {
                const parts = url.split('/');
                const file = parts[parts.length - 1];
                const folder = type === 'image' ? 'chat-media' : type === 'video' ? 'chat-media' : 'chat-voice-messages';
                await cloudinary.uploader.destroy(folder + '/' + file.split('.')[0], { resource_type: type === 'image' ? 'image' : 'video' });
            } catch(e) {}
        };

        if (deleteFor === 'all' && isSender) {
            if (message.type === 'voice') await destroy(message.voiceUrl, 'video');
            if (message.type === 'image') await destroy(message.mediaUrl, 'image');
            if (message.type === 'video') await destroy(message.mediaUrl, 'video');
            await Message.findByIdAndDelete(req.params.id);
            return res.json({ success: true, deletedFor: 'all' });
        }

        if (isSender) message.deletedBySender = true;
        else message.deletedByReceiver = true;

        if (message.deletedBySender && message.deletedByReceiver) {
            if (message.type === 'voice') await destroy(message.voiceUrl, 'video');
            if (message.type === 'image') await destroy(message.mediaUrl, 'image');
            if (message.type === 'video') await destroy(message.mediaUrl, 'video');
            await Message.findByIdAndDelete(req.params.id);
            return res.json({ success: true, deletedFor: 'both' });
        }
        await message.save();
        return res.json({ success: true, deletedFor: 'me' });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

// Ҳазфи якчанд паём (bulk)
router.post('/bulk-delete', authMiddleware, async (req, res) => {
    try {
        const { ids, deleteFor } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: 'Паёмҳо интихоб нашуданд!' });

        const destroy = async (url, type = 'video') => {
            if (!url) return;
            try {
                const parts = url.split('/');
                const file = parts[parts.length - 1];
                const folder = type === 'image' ? 'chat-media' : type === 'video' ? 'chat-media' : 'chat-voice-messages';
                await cloudinary.uploader.destroy(folder + '/' + file.split('.')[0], { resource_type: type === 'image' ? 'image' : 'video' });
            } catch(e) {}
        };

        const results = [];
        for (const id of ids) {
            const msg = await Message.findById(id);
            if (!msg) continue;
            const isSender = msg.sender === req.username;
            const isReceiver = msg.receiver === req.username;
            if (!isSender && !isReceiver) continue;

            if (deleteFor === 'all' && isSender) {
                if (msg.type === 'voice') await destroy(msg.voiceUrl, 'video');
                if (msg.type === 'image') await destroy(msg.mediaUrl, 'image');
                if (msg.type === 'video') await destroy(msg.mediaUrl, 'video');
                await Message.findByIdAndDelete(id);
                results.push({ id, deletedFor: 'all' });
                continue;
            }
            if (isSender) msg.deletedBySender = true;
            else msg.deletedByReceiver = true;
            if (msg.deletedBySender && msg.deletedByReceiver) {
                if (msg.type === 'voice') await destroy(msg.voiceUrl, 'video');
                if (msg.type === 'image') await destroy(msg.mediaUrl, 'image');
                if (msg.type === 'video') await destroy(msg.mediaUrl, 'video');
                await Message.findByIdAndDelete(id);
                results.push({ id, deletedFor: 'both' });
                continue;
            }
            await msg.save();
            results.push({ id, deletedFor: 'me' });
        }
        res.json({ success: true, results });
    } catch (err) {
        res.status(500).json({ message: 'Хатогӣ: ' + err.message });
    }
});

module.exports = router;
