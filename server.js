require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend files (index.html, style.css, script.js, etc.)
const path = require('path');
app.use(express.static(__dirname));

// Fallback to index.html for root if needed
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- SCHEMAS & MODELS ---

const PlayerStatSchema = new mongoose.Schema({
    playerName: { type: String, required: true, unique: true },
    gamesPlayed: { type: Number, default: 0 },
    gamesWon: { type: Number, default: 0 }
});
const PlayerStat = mongoose.model('PlayerStat', PlayerStatSchema);

const MatchRecordSchema = new mongoose.Schema({
    roomCode: String,
    winner: String, // 'INVESTIGATORS' or 'THEFTS'
    eliminatedPlayer: String,
    date: { type: Date, default: Date.now }
});
const MatchRecord = mongoose.model('MatchRecord', MatchRecordSchema);

// --- API ROUTES ---

// Get player stats
app.get('/api/stats/:name', async (req, res) => {
    try {
        let stat = await PlayerStat.findOne({ playerName: req.params.name });
        if (!stat) {
            stat = new PlayerStat({ playerName: req.params.name });
            await stat.save();
        }
        res.json(stat);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save match result and update stats
app.post('/api/match/result', async (req, res) => {
    try {
        const { roomCode, winner, elimName, players, winningTeam } = req.body;
        
        // Save the match record
        const record = new MatchRecord({ roomCode, winner, eliminatedPlayer: elimName });
        await record.save();

        // Update each player's stats
        for (let p of players) {
            let stat = await PlayerStat.findOne({ playerName: p.name });
            if (!stat) stat = new PlayerStat({ playerName: p.name });
            
            stat.gamesPlayed += 1;
            
            // Check if player won
            if (winningTeam === 'INVESTIGATORS' && p.role !== 'THEFT') {
                stat.gamesWon += 1;
            } else if (winningTeam === 'THEFTS' && p.role === 'THEFT') {
                stat.gamesWon += 1;
            }
            
            await stat.save();
        }

        res.json({ message: 'Match saved successfully!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 THEFTFIND API running on http://localhost:${PORT}`));
