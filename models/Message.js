const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    sender: { type: String, required: true, index: true },
    // Барои чати шахсӣ — receiver холӣ нест. Барои чати гурӯҳӣ — groupId холӣ нест.
    receiver: { type: String, default: '', index: true },
    groupId: { type: String, default: '', index: true },
    type: {
        type: String,
        enum: ['text', 'voice', 'image', 'video', 'document', 'system'],
        default: 'text'
    },
    body: { type: String, default: '' },
    // Caption — матн зери сурат/видео
    caption: { type: String, default: '' },
    voiceUrl: { type: String, default: '' },
    mediaUrl: { type: String, default: '' },
    thumbUrl: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    // Барои документ
    fileName: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    fileExt: { type: String, default: '' },
    replyTo: {
        _id: { type: String, default: '' },
        sender: { type: String, default: '' },
        body: { type: String, default: '' },
        type: { type: String, default: 'text' }
    },
    // Forward
    forwardedFrom: { type: String, default: '' },
    isForwarded: { type: Boolean, default: false },
    reactionBySender: { type: String, default: '' },
    reactionByReceiver: { type: String, default: '' },
    groupReactions: { type: Map, of: String, default: {} },
    // Статуси паём (чати шахсӣ): sent -> delivered -> seen
    delivered: { type: Boolean, default: false },
    seen: { type: Boolean, default: false },
    // Барои гурӯҳ: рӯйхати корбарони ки гирифтанд / хонданд бо вакт
    seenBy: { type: [String], default: [] },
    seenByDetail: { type: Map, of: Date, default: {} },
    deletedBySender: { type: Boolean, default: false },
    deletedByReceiver: { type: Boolean, default: false },
    deletedFor: { type: [String], default: [] },
    starredBy: { type: [String], default: [] },
    edited: { type: Boolean, default: false },
    editedAt: { type: Date },
    pinned: { type: Boolean, default: false },
    // Паёми нопадидшаванда
    expiresAt: { type: Date, default: null, index: { expires: 0 } },
    timestamp: { type: Date, default: Date.now, index: true }
});

MessageSchema.index({ sender: 1, receiver: 1, timestamp: -1 });
MessageSchema.index({ groupId: 1, timestamp: -1 });
MessageSchema.index({ starredBy: 1 });

module.exports = mongoose.model('Message', MessageSchema);
