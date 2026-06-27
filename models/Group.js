const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    avatar: { type: String, default: '' },
    description: { type: String, default: '' },
    creator: { type: String, required: true, index: true },
    // Аъзоён — рӯйхати usernames
    members: { type: [String], default: [], index: true },
    // Админҳои гурӯҳ (creator ҳамеша admin аст)
    admins: { type: [String], default: [] },
    // Invite link — код барои ҳамроҳ шудан
    inviteCode: { type: String, default: '', unique: true, sparse: true },
    // Танзимот: кӣ метавонад паём фиристад ('everyone' | 'admins')
    sendPermission: { type: String, enum: ['everyone', 'admins'], default: 'everyone' },
    // Танзимот: кӣ метавонад маълумоти гурӯҳро иваз кунад
    editPermission: { type: String, enum: ['everyone', 'admins'], default: 'admins' },
    createdAt: { type: Date, default: Date.now }
});

GroupSchema.index({ members: 1 });

module.exports = mongoose.model('Group', GroupSchema);