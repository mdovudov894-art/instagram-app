const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: {
        type: String, required: true, unique: true, trim: true, index: true
    },
    password: { type: String, required: true },
    avatar: { type: String, default: '' },
    // Display Name — номи намоишӣ (фарқ аз username барои вуруд)
    displayName: { type: String, default: '' },
    // About — маълумоти мухтасар
    about: { type: String, default: '' },
    onlineVisibility: {
        type: String, enum: ['everyone', 'nobody', 'selected'], default: 'everyone'
    },
    onlineVisibleTo: { type: [String], default: [] },
    // Махфияти алоҳида барои last seen ва расми профил
    lastSeenVisibility: { type: String, enum: ['everyone', 'nobody', 'selected'], default: 'everyone' },
    lastSeenVisibleTo: { type: [String], default: [] },
    avatarVisibility: { type: String, enum: ['everyone', 'nobody', 'selected'], default: 'everyone' },
    avatarVisibleTo: { type: [String], default: [] },
    lastSeenAt: { type: Date, default: Date.now },
    // Блок кардани корбарон
    blockedUsers: { type: [String], default: [] },
    // Роли корбар (admin / user)
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    // Баркарорсозии парол
    securityQuestion: { type: String, default: '' },
    securityAnswer: { type: String, default: '' }, // bcrypt hash
    // Чатҳои архившуда — рӯйхати "username" ё "group:<id>"
    archivedChats: { type: [String], default: [] },
    // Чатҳои сабтшуда дар боло (pinned) — рӯйхати "username" ё "group:<id>"
    pinnedChats: { type: [String], default: [] },
    // Чатҳои бесадо (mute) — { key: untilDate (null = доимӣ) }
    mutedChats: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Танзимоти огоҳинома — { sound: bool, vibrate: bool }
    notificationSettings: {
        sound: { type: Boolean, default: true },
        vibrate: { type: Boolean, default: true }
    },
    // Паёми нопадидшаванда — танзимоти пешфарз барои чатҳои нав { key: seconds }
    disappearingSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
