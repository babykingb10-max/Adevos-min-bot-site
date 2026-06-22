/**
 * server.js - Website Backend API
 * Adevos Min-Bot
 *
 * Changes from previous version:
 * - Removed: Firebase integration
 * - Removed: Server 1-5 SERVERS array
 * - Removed: Hardcoded credentials
 * - Added:   MongoDB for all data storage
 * - Added:   All config from process.env
 * - Added:   /api/admin/sessions endpoint (new)
 * - Added:   /api/admin/clean endpoint (new)
 * - Added:   /api/admin/analytics using MongoDB aggregation
 * - Kept:    All existing admin routes (block, unblock, users, etc.)
 * - Kept:    JWT authentication middleware
 */

'use strict';

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const jwt      = require('jsonwebtoken');
const mongoose = require('mongoose');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Config from Environment ──────────────────────────────────
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Adevos';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const JWT_SECRET     = process.env.JWT_SECRET     || 'adevos-x-secret-2026';
const MONGODB_URI    = process.env.MONGODB_URI;
const PORT           = process.env.PORT            || 3000;
const SERVER_NAME    = process.env.SERVER_NAME     || 'Main Server';
const TG_BOT_URL     = process.env.TG_BOT_URL      || 'https://t.me/adevosmin_bot';
const MAX_CONN       = parseInt(process.env.MAX_CONNECTIONS || '100');

// ─── Mongoose Schemas ─────────────────────────────────────────
// These mirror the schemas in db.js (bot side).
// Both share the same MongoDB database so data is always in sync.

const SessionSchema = new mongoose.Schema({
    sessionId:    { type: String, required: true, unique: true, index: true },
    isActive:     { type: Boolean, default: false },
    isRegistered: { type: Boolean, default: false },
    source:       { type: String, default: 'telegram' },
    lastSeen:     { type: Date, default: Date.now },
    createdAt:    { type: Date, default: Date.now },
    expiresAt:    { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
}, { strict: false });

const PairingSchema = new mongoose.Schema({
    number:    { type: String, required: true, unique: true, index: true },
    code:      { type: String, default: null },
    status:    { type: String, default: 'pending' },
    source:    { type: String, default: 'website' },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 60 * 60 * 1000) }
});

const RequestSchema = new mongoose.Schema({
    requestId: { type: String, required: true, unique: true, index: true },
    number:    { type: String, required: true, index: true },
    status:    { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    source:    { type: String, enum: ['telegram', 'website'], default: 'website' },
    timestamp: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
});

const UserSchema = new mongoose.Schema({
    number:        { type: String, required: true, unique: true, index: true },
    lastServer:    { type: String, default: 'Main Server' },
    lastPaired:    { type: Date,   default: Date.now },
    source:        { type: String, default: 'website' },
    totalPairings: { type: Number, default: 1 }
}, { timestamps: true });

const BlockedSchema = new mongoose.Schema({
    number:    { type: String, required: true, unique: true, index: true },
    reason:    { type: String, default: 'Blocked by admin' },
    blockedAt: { type: Date, default: Date.now }
});

const ServerStatsSchema = new mongoose.Schema({
    serverName:     { type: String, required: true, unique: true },
    totalPaired:    { type: Number, default: 0 },
    websitePaired:  { type: Number, default: 0 },
    telegramPaired: { type: Number, default: 0 },
    lastSeen:       { type: Date, default: Date.now }
});

// ─── Models ───────────────────────────────────────────────────
const Session     = mongoose.models.Session     || mongoose.model('Session',     SessionSchema);
const Pairing     = mongoose.models.Pairing     || mongoose.model('Pairing',     PairingSchema);
const Request     = mongoose.models.Request     || mongoose.model('Request',     RequestSchema);
const User        = mongoose.models.User        || mongoose.model('User',        UserSchema);
const Blocked     = mongoose.models.Blocked     || mongoose.model('Blocked',     BlockedSchema);
const ServerStats = mongoose.models.ServerStats || mongoose.model('ServerStats', ServerStatsSchema);

// ─── MongoDB Connection ────────────────────────────────────────
async function connectDB() {
    if (mongoose.connection.readyState === 1) return;
    if (!MONGODB_URI) throw new Error('MONGODB_URI is not set in environment variables');

    await mongoose.connect(MONGODB_URI, {
        maxPoolSize:              20,
        serverSelectionTimeoutMS: 10000,
        appName:                  'AdevosMinBot-Website'
    });

    // Create TTL indexes (idempotent - safe to call multiple times)
    await Promise.all([
        Request.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true }),
        Pairing.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true }),
        Session.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true })
    ]).catch(() => {}); // Indexes may already exist

    console.log('✅ MongoDB connected (website)');
}

// ─── JWT Middleware ───────────────────────────────────────────
function verifyToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'Token required' });
    try {
        req.admin = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.json({ success: false, message: 'Invalid or expired token' });
    }
}

// ─── Helper ───────────────────────────────────────────────────
function isServerOnline(lastSeen) {
    if (!lastSeen) return false;
    return (Date.now() - new Date(lastSeen).getTime()) < 5 * 60 * 1000; // 5 minutes
}

// ─── PUBLIC ROUTES ────────────────────────────────────────────

/**
 * GET /api/public/stats
 * Returns server statistics for the website homepage.
 * No authentication required - visible to all users.
 *
 * Returns single server stats instead of the old Server 1-5 array.
 */
app.get('/api/public/stats', async (req, res) => {
    try {
        await connectDB();

        const [statsDoc, totalSessions, activeSessions, registeredSessions, totalUsers] = await Promise.all([
            ServerStats.findOne({ serverName: SERVER_NAME }).lean(),
            Session.countDocuments(),
            Session.countDocuments({ isActive: true }),
            Session.countDocuments({ isRegistered: true }),
            User.countDocuments()
        ]);

        const online = isServerOnline(statsDoc?.lastSeen);

        res.json({
            success: true,
            server: {
                name:               SERVER_NAME,
                tgBot:              TG_BOT_URL,
                status:             online ? 'online' : 'offline',
                lastSeen:           statsDoc?.lastSeen || null,
                totalPaired:        statsDoc?.totalPaired   || registeredSessions,
                websitePaired:      statsDoc?.websitePaired  || 0,
                telegramPaired:     statsDoc?.telegramPaired || 0,
                activeSessions,
                registeredSessions,
                totalUsers,
                maxCapacity:        MAX_CONN,
                capacityPercent:    Math.round((registeredSessions / MAX_CONN) * 100)
            }
        });

    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

/**
 * POST /api/request-pair
 * Accepts a pairing request from the website.
 * Validates the number, checks blocks and capacity, then triggers the bot.
 */
app.post('/api/request-pair', async (req, res) => {
    const { number } = req.body;
    if (!number) return res.json({ success: false, message: 'Number is required' });

    const cleanNumber = number.replace(/[^0-9]/g, '');
    if (cleanNumber.length < 7) return res.json({ success: false, message: 'Invalid number' });

    try {
        await connectDB();

        // Check if number is blocked
        const blocked = await Blocked.findOne({ number: cleanNumber }).lean();
        if (blocked) return res.json({ success: false, message: 'This number is blocked. Contact admin.' });

        // Check server capacity
        const registeredCount = await Session.countDocuments({ isRegistered: true });
        if (registeredCount >= MAX_CONN) {
            return res.json({ success: false, message: `Server is full (${registeredCount}/${MAX_CONN}). Try again later.` });
        }

        // Clear any old pairing code for this number
        await Pairing.deleteOne({ number: cleanNumber });

        // Create request record
        const requestId = uuidv4();
        await Request.create({ requestId, number: cleanNumber, status: 'pending', source: 'website' });

        // Upsert user record
        await User.findOneAndUpdate(
            { number: cleanNumber },
            { $set: { lastPaired: new Date(), source: 'website', lastServer: SERVER_NAME }, $inc: { totalPairings: 1 } },
            { upsert: true }
        );

        // Update server stats
        await ServerStats.findOneAndUpdate(
            { serverName: SERVER_NAME },
            { $inc: { totalPaired: 1, websitePaired: 1 }, $set: { lastSeen: new Date() } },
            { upsert: true }
        );

        // Trigger pairing on bot side
        _triggerBotPairing(cleanNumber).catch(err => console.error(`Trigger error: ${err.message}`));

        res.json({ success: true, message: 'Request sent. Wait up to 15 seconds...', requestId });

    } catch (err) {
        console.error(`request-pair error: ${err.message}`);
        res.json({ success: false, message: 'An error occurred. Please try again.' });
    }
});

/**
 * GET /api/get-pair-code
 * Polled by the website frontend every 3 seconds after submitting a pairing request.
 */
app.get('/api/get-pair-code', async (req, res) => {
    const cleanNumber = (req.query.number || '').replace(/[^0-9]/g, '');
    if (!cleanNumber) return res.json({ success: false, message: 'Number is required' });

    try {
        await connectDB();
        const pairing = await Pairing.findOne({ number: cleanNumber }).lean();

        if (pairing?.code) {
            res.json({ success: true, code: pairing.code });
        } else {
            res.json({ success: false, code: null, message: 'Code not ready yet' });
        }
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

/**
 * GET /api/request-status
 * Check the processing status of a pairing request.
 */
app.get('/api/request-status', async (req, res) => {
    const { requestId } = req.query;
    if (!requestId) return res.json({ success: false, message: 'requestId is required' });

    try {
        await connectDB();
        const request = await Request.findOne({ requestId }).lean();
        if (request) res.json({ success: true, status: request.status });
        else res.json({ success: false, message: 'Request not found' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// ─── ADMIN LOGIN ──────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ success: true, token });
    } else {
        res.json({ success: false, message: 'Invalid username or password' });
    }
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────

/**
 * GET /api/admin/stats
 * Full dashboard statistics for the admin panel.
 */
app.get('/api/admin/stats', verifyToken, async (req, res) => {
    try {
        await connectDB();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [
            totalUsers,
            totalRequests,
            todayRequests,
            recentList,
            statsDoc,
            totalSessions,
            activeSessions,
            registeredSessions
        ] = await Promise.all([
            User.countDocuments(),
            Request.countDocuments(),
            Request.countDocuments({ timestamp: { $gte: today } }),
            Request.find().sort({ timestamp: -1 }).limit(10).lean(),
            ServerStats.findOne({ serverName: SERVER_NAME }).lean(),
            Session.countDocuments(),
            Session.countDocuments({ isActive: true }),
            Session.countDocuments({ isRegistered: true })
        ]);

        const online = isServerOnline(statsDoc?.lastSeen);

        res.json({
            success: true,
            totalUsers,
            totalRequests,
            todayRequests,
            onlineServers:   online ? 1 : 0,
            totalSessions,
            activeSessions,
            registeredSessions,
            recentList,
            serverStats: { [SERVER_NAME]: totalRequests },
            serversOverview: [{
                name:           SERVER_NAME,
                status:         online ? 'online' : 'offline',
                totalPaired:    statsDoc?.totalPaired    || registeredSessions,
                websitePaired:  statsDoc?.websitePaired  || 0,
                telegramPaired: statsDoc?.telegramPaired || 0,
                activeSessions,
                maxCapacity:    MAX_CONN,
                lastSeen:       statsDoc?.lastSeen || null
            }]
        });

    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

/**
 * GET /api/admin/sessions
 * List all WhatsApp sessions with their status.
 * New endpoint - was not available in the Firebase version.
 */
app.get('/api/admin/sessions', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const sessions = await Session.find(
            {},
            { sessionId: 1, isActive: 1, isRegistered: 1, source: 1, lastSeen: 1, createdAt: 1, _id: 0 }
        ).sort({ lastSeen: -1 }).lean();

        res.json({ success: true, sessions, total: sessions.length });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

/**
 * DELETE /api/admin/sessions/:sessionId
 * Delete a single session by its JID.
 */
app.delete('/api/admin/sessions/:sessionId', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const sessionId = decodeURIComponent(req.params.sessionId);
        await Session.deleteOne({ sessionId });
        res.json({ success: true, message: `Session ${sessionId} deleted` });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

/**
 * POST /api/admin/clean
 * Delete inactive and logged-out sessions to free up space.
 * Equivalent of /clean Telegram command but accessible from the admin panel.
 */
app.post('/api/admin/clean', verifyToken, async (req, res) => {
    try {
        await connectDB();

        const daysInactive = parseInt(req.body.days || '7');
        const cutoff       = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000);

        const [inactive, loggedOut] = await Promise.all([
            Session.deleteMany({ isActive: false, lastSeen: { $lt: cutoff } }),
            Session.deleteMany({
                isActive:     false,
                isRegistered: false,
                createdAt:    { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            })
        ]);

        const remaining = await Session.countDocuments();

        res.json({
            success: true,
            message: 'Cleanup complete',
            deleted: {
                inactive:  inactive.deletedCount,
                loggedOut: loggedOut.deletedCount,
                total:     inactive.deletedCount + loggedOut.deletedCount
            },
            remaining
        });

    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

/**
 * GET /api/admin/users
 */
app.get('/api/admin/users', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const users = await User.find().sort({ lastPaired: -1 }).lean();
        res.json({ success: true, users });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

/**
 * POST /api/admin/block
 */
app.post('/api/admin/block', verifyToken, async (req, res) => {
    const { number, reason } = req.body;
    if (!number) return res.json({ success: false, message: 'Number is required' });
    try {
        await connectDB();
        await Blocked.findOneAndUpdate(
            { number },
            { $set: { reason: reason || 'Blocked by admin', blockedAt: new Date() } },
            { upsert: true }
        );
        res.json({ success: true, message: `${number} blocked` });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

/**
 * POST /api/admin/unblock
 */
app.post('/api/admin/unblock', verifyToken, async (req, res) => {
    const { number } = req.body;
    if (!number) return res.json({ success: false, message: 'Number is required' });
    try {
        await connectDB();
        await Blocked.deleteOne({ number });
        res.json({ success: true, message: `${number} unblocked` });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

/**
 * GET /api/admin/blocked
 */
app.get('/api/admin/blocked', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const blocked = await Blocked.find().sort({ blockedAt: -1 }).lean();
        res.json({ success: true, blocked });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

/**
 * POST /api/admin/delete-user
 * Deletes a user record, their pairing code, and their session.
 */
app.post('/api/admin/delete-user', verifyToken, async (req, res) => {
    const { number } = req.body;
    if (!number) return res.json({ success: false, message: 'Number is required' });
    try {
        await connectDB();
        await Promise.all([
            User.deleteOne({ number }),
            Pairing.deleteOne({ number }),
            Session.deleteOne({ sessionId: number + '@s.whatsapp.net' })
        ]);
        res.json({ success: true, message: `${number} deleted completely` });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

/**
 * GET /api/admin/analytics
 * Pairing counts per day for the last 7 days (bar chart data).
 */
app.get('/api/admin/analytics', verifyToken, async (req, res) => {
    try {
        await connectDB();

        const days = {};
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days[d.toISOString().split('T')[0]] = 0;
        }

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const results = await Request.aggregate([
            { $match: { timestamp: { $gte: sevenDaysAgo } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, count: { $sum: 1 } } }
        ]);

        results.forEach(r => { if (days[r._id] !== undefined) days[r._id] = r.count; });

        res.json({ success: true, analytics: days });

    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// ─── Health Check ─────────────────────────────────────────────

app.get('/health', async (req, res) => {
    const dbState = mongoose.connection.readyState;
    res.json({
        status:  'ok',
        db:      dbState === 1 ? 'connected' : 'disconnected',
        server:  SERVER_NAME,
        uptime:  process.uptime()
    });
});

// ─── Trigger Bot Pairing ──────────────────────────────────────

/**
 * If the website and bot run on the same Render service,
 * we can call pair.js directly.
 *
 * If they are separate services, set BOT_WEBHOOK_URL in env
 * and the website will call the bot via HTTP.
 */
async function _triggerBotPairing(number) {
    const BOT_WEBHOOK = process.env.BOT_WEBHOOK_URL;

    if (BOT_WEBHOOK) {
        const axios = require('axios');
        await axios.post(`${BOT_WEBHOOK}/internal/pair`, {
            number,
            secret: process.env.INTERNAL_SECRET || 'adevos-internal'
        }, { timeout: 5000 });
    } else {
        try {
            const startpairing = require('./pair');
            startpairing(number + '@s.whatsapp.net').catch(() => {});
        } catch {
            // pair.js not present in website-only repo - silently ignored
        }
    }
}

// Internal webhook endpoint (for bot-side triggering from website)
app.post('/internal/pair', async (req, res) => {
    const { number, secret } = req.body;
    const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'adevos-internal';

    if (secret !== INTERNAL_SECRET) return res.json({ success: false, message: 'Unauthorized' });

    try {
        const startpairing = require('./pair');
        startpairing(number + '@s.whatsapp.net').catch(() => {});
        res.json({ success: true });
    } catch {
        res.json({ success: false, message: 'pair.js not available' });
    }
});

// ─── Serve Static Files ───────────────────────────────────────
app.use(express.static(__dirname));
app.get('/',      (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ─── Start Server ─────────────────────────────────────────────
(async () => {
    try {
        await connectDB();
        app.listen(PORT, () => console.log(`✅ Website server running on port ${PORT}`));
    } catch (err) {
        console.error(`❌ Server start failed: ${err.message}`);
        process.exit(1);
    }
})();
