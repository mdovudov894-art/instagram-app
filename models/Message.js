const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    sender: {
        type: String,
        required: true
    },
    receiver: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['text', 'voice'],
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
    duration: {
        type: Number,
        default: 0
    },
    reactionBySender: {
        type: String,
        default: ''
    },
    reactionByReceiver: {
        type: String,
        default: ''
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
        default: Date.now
    }
});

module.exports = mongoose.model('Message', MessageSchema);