const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    sender: {
        type: String,
        required: true,
        index: true
    },
    receiver: {
        type: String,
        required: true,
        index: true
    },
    // №17 — image ва video илова шуд
    type: {
        type: String,
        enum: ['text', 'voice', 'image', 'video'],
        default: 'text'
    },
    body: {
        type: String,
        default: ''
    },
    voiceUrl: {
        type: String,
        default: ''
    },
    // №17 — URL барои сурат/видео
    mediaUrl: {
        type: String,
        default: ''
    },
    // Thumbnail (poster) барои видео
    thumbUrl: {
        type: String,
        default: ''
    },
    duration: {
        type: Number,
        default: 0
    },
    replyTo: {
        _id: { type: String, default: '' },
        sender: { type: String, default: '' },
        body: { type: String, default: '' },
        type: { type: String, default: 'text' }
    },
    reactionBySender: {
        type: String,
        default: ''
    },
    reactionByReceiver: {
        type: String,
        default: ''
    },
    seen: {
        type: Boolean,
        default: false
    },
    deletedBySender: {
        type: Boolean,
        default: false
    },
    deletedByReceiver: {
        type: Boolean,
        default: false
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
});

MessageSchema.index({ sender: 1, receiver: 1, timestamp: -1 });

module.exports = mongoose.model('Message', MessageSchema);
