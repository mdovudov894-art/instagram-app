const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    sender: { type: String, required: true, index: true },
    receiver: { type: String, required: true, index: true },
    type: {
        type: String,
        enum: ['text', 'voice', 'image', 'video'],
        default: 'text'
    },
    body: { type: String, default: '' },
    voiceUrl: { type: String, default: '' },
    mediaUrl: { type: String, default: '' },
    thumbUrl: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    replyTo: {
        _id: { type: String, default: '' },
        sender: { type: String, default: '' },
        body: { type: String, default: '' },
        type: { type: String, default: 'text' }
    },
    reactionBySender: { type: String, default: '' },
    reactionByReceiver: { type: String, default: '' },
    seen: { type: Boolean, default: false },
    deletedBySender: { type: Boolean, default: false },
    deletedByReceiver: { type: Boolean, default: false },
    // Иваз кардан
    edited: { type: Boolean, default: false },
    editedAt: { type: Date },
    // Сабт кардан
    pinned: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now, index: true }
});

MessageSchema.index({ sender: 1, receiver: 1, timestamp: -1 });

module.exports = mongoose.model('Message', MessageSchema);
