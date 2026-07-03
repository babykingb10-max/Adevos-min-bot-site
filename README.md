# 🌐 Adevos Min-Bot — Website & Admin Panel

Official website and admin dashboard for **Adevos Min-Bot** — a WhatsApp + Telegram automation bot powered by MongoDB Atlas.

---

## 🔗 Links

| Resource | URL |
|----------|-----|
| 🤖 Telegram Bot | [@adevosmin_bot](https://t.me/adevosmin_bot) |
| 📢 Channel | [@adevosXch1](https://t.me/adevosXch1) |
| 👥 Group | [@adevosxtech](https://t.me/adevosxtech) |
| 👨‍💻 Developer | [@Adevos_X](https://t.me/Adevos_X) |

---

## 📁 Project Structure

```
adevosminbot/              ← This repo (website)
├── server.js              ← Express backend API
├── index.html             ← Public website (pairing page)
├── admin.html             ← Admin dashboard
├── package.json           ← Dependencies
├── Procfile               ← Heroku/Render deploy config
└── .env.example           ← Environment variables template
```

---

## ✨ Features

### Public Website (`index.html`)
- 🟢 Live server status (online/offline)
- 📊 Real-time stats — active sessions, total paired, capacity %
- 📱 WhatsApp pairing form — enter number, get pairing code instantly
- 🤖 Telegram bot quick-connect button
- 📢 Official channels and group links
- 🎨 Fully responsive dark theme UI

### Admin Panel (`admin.html`)
| Tab | Features |
|-----|----------|
| **Dashboard** | Total users, today's pairings, active sessions, session capacity bar |
| **Server Overview** | Server health, website vs Telegram pairing breakdown |
| **Sessions** | List all WhatsApp sessions, delete individual sessions, clean dead ones |
| **Users** | Search users, block, delete |
| **Blocked Numbers** | Add/remove blocked phone numbers |
| **Analytics** | 7-day pairing chart |

---

## 🚀 Deploy

### Option 1 — Render (Free)

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. Add environment variables (see below)

### Option 2 — Heroku

```bash
heroku create adevos-min-bot-site
git push heroku main
heroku config:set MONGODB_URI=mongodb+srv://...
```

---

## ⚙️ Environment Variables

Create a `.env` file from `.env.example`:

```env
# MongoDB — same URI as the bot service
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/adevosminbot

# Admin panel login
ADMIN_USERNAME=Adevos
ADMIN_PASSWORD=your_strong_password_here

# JWT secret — must match the bot service
JWT_SECRET=your_random_32_char_secret_here

# Server identity
SERVER_NAME=Main Server
MAX_CONNECTIONS=100

# Telegram bot link (shown on website)
TG_BOT_URL=https://t.me/your_bot_username

# Cross-service webhook (only needed if website and bot are separate services)
BOT_WEBHOOK_URL=https://your-bot-service.onrender.com
INTERNAL_SECRET=your_internal_secret_here

PORT=3000
```

> ⚠️ **Never commit `.env` to GitHub** — it is listed in `.gitignore`

---

## 🔌 API Endpoints

### Public (no auth required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/public/stats` | Server stats for homepage |
| POST | `/api/request-pair` | Submit pairing request |
| GET | `/api/get-pair-code?number=255...` | Poll for generated code |
| GET | `/api/request-status?requestId=...` | Check request status |
| GET | `/health` | Service health check |

### Admin (JWT required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/login` | Login and get JWT token |
| GET | `/api/admin/stats` | Full dashboard statistics |
| GET | `/api/admin/sessions` | List all WhatsApp sessions |
| DELETE | `/api/admin/sessions/:id` | Delete one session |
| POST | `/api/admin/clean` | Remove dead/inactive sessions |
| GET | `/api/admin/users` | List all users |
| POST | `/api/admin/block` | Block a number |
| POST | `/api/admin/unblock` | Unblock a number |
| GET | `/api/admin/blocked` | List blocked numbers |
| POST | `/api/admin/delete-user` | Delete a user completely |
| GET | `/api/admin/analytics` | 7-day pairing chart data |
| GET | `/api/admin/logs` | Bot logs from MongoDB |
| DELETE | `/api/admin/logs` | Clear all logs |
| GET | `/api/admin/debug` | System debug info + recent errors |

---

## 🗄️ Database

This service shares a **MongoDB Atlas** database with the bot service. Both use the same `MONGODB_URI` connection string.

Collections used:

| Collection | Purpose | Auto-deleted |
|-----------|---------|-------------|
| `sessions` | WhatsApp session data | After 30 days inactive |
| `pairings` | Temporary pairing codes | After 1 hour |
| `requests` | Pairing requests | After 7 days |
| `users` | User records | Manual |
| `blocked` | Blocked numbers | Manual |
| `serverstats` | Server health data | Manual |
| `logs` | Bot event logs | After 3 days |

---

## 🔄 How Pairing Works (Website Flow)

```
User enters number on website
        ↓
POST /api/request-pair
        ↓
Website calls BOT_WEBHOOK_URL/internal/pair (HTTP)
        ↓
Bot generates WhatsApp pairing code
        ↓
Code saved to MongoDB → pairings collection
        ↓
Website polls /api/get-pair-code every 3 seconds
        ↓
Code displayed to user → user enters in WhatsApp
        ↓
WhatsApp confirms → session active in MongoDB
```

---

## 🔧 Local Development

```bash
# Clone repo
git clone https://github.com/babykingb10-max/adevosminbot.git
cd adevosminbot

# Install dependencies
npm install

# Copy env template
cp .env.example .env
# Edit .env with your values

# Start server
npm start

# Visit http://localhost:3000
```

---

## 🆘 Troubleshooting

**Website shows "Server Offline"**
- Check that the bot service is running and `BOT_WEBHOOK_URL` is correct
- The bot updates `serverstats` every 5 minutes — wait up to 8 minutes after bot starts

**Pairing code stuck on "pending"**
- Verify `BOT_WEBHOOK_URL` is set in website env vars
- Verify `INTERNAL_SECRET` matches on both website and bot services
- Check bot service logs for `📨 Webhook pairing trigger received`

**Admin panel login fails**
- Check `ADMIN_USERNAME` and `ADMIN_PASSWORD` env vars
- `JWT_SECRET` must be the same on both website and bot services

**Capacity showing wrong number**
- The capacity bar uses `registeredSessions` (actual active sessions) not the attempt counter
- Run **Sessions → Clean Dead** to remove stale sessions

---

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server |
| `mongoose` | MongoDB ODM |
| `jsonwebtoken` | Admin JWT auth |
| `cors` | Cross-origin requests |
| `axios` | Webhook HTTP calls to bot |
| `uuid` | Unique request IDs |
| `dotenv` | Environment variables |

---

## 👨‍💻 Developer

**Adevos** — Creator & CEO of Adevos-X Tech

- Telegram: [@Adevos_X](https://t.me/Adevos_X)
- WhatsApp: [+255 663 402 315](https://wa.me/255663402315)

---

© 2026 **Adevos-X Tech** · All Rights Reserved
