const express = require('express');
const router = express.Router();
const Group = require('../models/Group'); // Агар моделут бо номи Group.js бошад

// Мисол барои гирифтани гурӯҳҳо ё сохтани гурӯҳ
router.get('/', async (req, res) => {
    try {
        const groups = await Group.find();
        res.json(groups);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/create', async (req, res) => {
    try {
        const { name, members } = req.body;
        const newGroup = new Group({ name, members });
        await newGroup.save();
        res.status(201).json(newGroup);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
