const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: {
        type: String, required: true, unique: true, trim: true, index: true
    },
    password: { type: String, required: true },
    avatar: { type: String, default: '' },
    onlineVisibility: {
        type: String, enum: ['everyone', 'nobody', 'selected'], default: 'everyone'
    },
    onlineVisibleTo: { type: [String], default: [] },
    // Блок кардани корбарон
    blockedUsers: { type: [String], default: [] },
    // Роли корбар (admin / user)
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    // Баркарорсозии парол
    securityQuestion: { type: String, default: '' },
    securityAnswer: { type: String, default: '' }, // bcrypt hash
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
