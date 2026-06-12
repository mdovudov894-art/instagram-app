const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },
    password: {
        type: String,
        required: true
    },
    // №4 — Сурати профил
    avatar: {
        type: String,
        default: ''
    },
    // №13 — Танзимоти онлайн
    onlineVisibility: {
        type: String,
        enum: ['everyone', 'nobody', 'selected'],
        default: 'everyone'
    },
    onlineVisibleTo: {
        type: [String],
        default: []
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('User', UserSchema);
