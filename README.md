# ✂️ LinkSnip — AI-Powered URL Shortener & Analytics Platform

> **Production-Ready · Node.js · Glassmorphism UI · Real-Time Analytics · AI Engine**

LinkSnip is a next-generation URL shortening service with real-time click analytics, AI-powered alias suggestions, phishing detection, QR code generation, user authentication, REST API, and a stunning dark glassmorphism dashboard.

---

## 🌐 Live Demo

| Environment | URL |
|---|---|
| 🚀 **Production (Railway)** | _[See deployment section below]_ |
| 💻 **Local** | `http://localhost:3000` |
| 📖 **API Docs** | `http://localhost:3000/api-docs` |

---

## ✨ Features

### Core
- ⚡ **Ultra-Fast URL Shortening** — Base62 6-character codes, <50ms redirect latency
- 🔗 **Custom Branded Aliases** — 3-30 character custom short codes
- 🔄 **Configurable Redirect Type** — Choose 301 (Permanent/SEO) or 302 (Temporary/Analytics)
- 🔒 **Password-Protected Links** — Secure sensitive links with a passcode
- ⏰ **Link Expiration** — Set expiry date or max click count
- 🏷️ **Tags & Folders** — Organize links in your dashboard

### AI Engine
- 🤖 **AI Smart Alias Generator** — Context-aware alias suggestions based on target URL
- 🛡️ **AI Phishing & Safety Scanner** — Real-time malicious URL detection with safety scores
- 📊 **AI Traffic Insights** — Automated marketing recommendations from your click data

### Analytics
- 📈 **Real-Time Click Dashboard** — Interactive Chart.js visualizations
- 🌍 **Geo-Location Tracking** — Click origin by country
- 📱 **Device & Browser Breakdown** — Desktop / Mobile / Tablet
- 🔗 **Referrer Tracking** — Traffic source analysis
- 📥 **CSV Analytics Export** — Download full click data reports

### User Management
- 👤 **Registration & Login** — Secure bcrypt + JWT authentication
- 🔑 **API Key Manager** — Generate/revoke personal REST API tokens
- ⭐ **Free & Pro Tiers** — Free tier: 15 links max; Pro: Unlimited

### Developer Features
- 📡 **Full REST API** — Create, read, update, delete links programmatically
- 📖 **Swagger / OpenAPI Docs** — Interactive API documentation at `/api-docs`
- 🚦 **Rate Limiting** — 200 req/15min per IP (configurable)
- 📋 **Bulk CSV Shortening** — Shorten hundreds of URLs at once via CSV paste
- 🎨 **Branded QR Codes** — Custom foreground/background color QR generation
- ⚡ **In-Memory Cache** — Read-through link cache for sub-10ms redirect resolution
- 🔄 **Async Click Ingestion Queue** — Batch click buffering for high-throughput analytics

---

## 🏗️ Architecture

```
[ Glassmorphism Dark UI — HTML5 / Vanilla JS / Chart.js ]
                        │
                        ▼
         [ Express.js REST API — server.js ]
    ┌───────────────────┼────────────────────┐
    ▼                   ▼                    ▼
[ In-Memory       [ JSON Datastore     [ AI Engine
  Redis-Style       database.js ]        aiEngine.js ]
  Cache Layer ]
    │
    ▼
[ Async Click Ingestion Queue → Batch Flush every 5s ]
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js 18+, Express.js |
| **Database** | JSON Flat-file DB (Railway-compatible, zero setup) |
| **Auth** | bcryptjs, jsonwebtoken, express-session |
| **Frontend** | HTML5, Vanilla CSS3 (Glassmorphism Dark Theme), Vanilla JS ES6+ |
| **Charts** | Chart.js |
| **QR Codes** | qrcode npm package |
| **API Docs** | swagger-ui-express |
| **Rate Limiting** | express-rate-limit |
| **Email** | nodemailer (Ethereal SMTP / configurable) |

---

## 🚀 Quick Start (Local)

### Prerequisites
- Node.js v18 or higher
- npm

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/akashkumar32/LinkSnip.git
cd LinkSnip

# 2. Install dependencies
npm install

# 3. Start the server
npm run start

# 4. Open browser
open http://localhost:3000
```

### Environment Variables (Optional)

Create a `.env` file for production secrets:

```env
PORT=3000
JWT_SECRET=your-super-secret-jwt-key-here
SESSION_SECRET=your-super-secret-session-key-here
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
```

---

## 🌐 Deploy to Railway (Free)

1. Go to **[railway.app](https://railway.app)** → Login with GitHub
2. Click **New Project** → **Deploy from GitHub repo**
3. Select **`akashkumar32/LinkSnip`**
4. Add Environment Variables in Railway Dashboard:

| Variable | Value |
|---|---|
| `PORT` | `3000` |
| `JWT_SECRET` | `your-secret-key` |
| `SESSION_SECRET` | `your-session-key` |

5. Click **Settings** → **Networking** → **Generate Domain**
6. Done! Your live URL: `https://linksnip-production.up.railway.app`

---

## 🔌 REST API Reference

### Authentication

All protected endpoints require a Bearer token in the `Authorization` header:
```
Authorization: Bearer <your_jwt_token>
```
Or an API Key in the `X-API-Key` header:
```
X-API-Key: ls_your_api_key_here
```

---

### Auth Endpoints

#### `POST /api/auth/register`
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```
**Response:** `201 Created`
```json
{ "message": "Registration successful! You can now log in." }
```

#### `POST /api/auth/login`
```json
{ "email": "user@example.com", "password": "SecurePass123!" }
```
**Response:** `200 OK`
```json
{ "message": "Login successful!", "token": "eyJ...", "user": { "id": 1, "email": "...", "tier": "free" } }
```

#### `GET /api/auth/me`
Returns the currently authenticated user.

#### `POST /api/auth/logout`
Destroys the session and logs out.

#### `POST /api/auth/forgot-password`
```json
{ "email": "user@example.com" }
```

#### `POST /api/auth/reset-password`
```json
{ "token": "RESETCODE", "password": "NewPassword123!" }
```

---

### Link Endpoints

#### `POST /api/shorten` ⭐ *Core Endpoint*
```json
{
  "target_url": "https://example.com/very/long/url",
  "custom_alias": "my-promo",
  "title": "Black Friday Campaign",
  "redirect_type": 302,
  "expire_at": "2026-12-31T23:59:59Z",
  "max_clicks": 1000,
  "password": "optional-passcode",
  "tags": "marketing,sale"
}
```
**Response:** `201 Created`
```json
{
  "link": {
    "id": 42,
    "short_code": "my-promo",
    "short_url": "https://your-domain.com/my-promo",
    "target_url": "https://example.com/very/long/url",
    "redirect_type": 302,
    "qr_code": "data:image/png;base64,...",
    "safety_report": { "safetyScore": 98, "riskLevel": "SAFE" }
  }
}
```

#### `GET /api/links`
Get all links for authenticated user. Supports:
- `?search=keyword` — Full-text search
- `?tag=marketing` — Filter by tag
- `?sort=clicks|newest|oldest` — Sort order

#### `PUT /api/links/:id`
```json
{
  "target_url": "https://new-destination.com",
  "title": "Updated Title",
  "redirect_type": 301,
  "expire_at": "2027-01-01T00:00:00Z",
  "max_clicks": 500,
  "tags": "new-tag",
  "is_enabled": true
}
```

#### `DELETE /api/links/:id`
Archives the link (soft delete).

#### `POST /api/links/bulk-delete`
```json
{ "ids": [1, 2, 3, 4] }
```

---

### Bulk Operations

#### `POST /api/bulk-shorten`
**Option 1: CSV string**
```json
{
  "csv": "https://www.google.com, google-search, Google Search, tools\nhttps://www.github.com, gh-code, GitHub, dev"
}
```
**Option 2: Array of objects**
```json
{
  "urls": [
    { "target_url": "https://example.com", "custom_alias": "ex", "title": "Example", "tags": "demo" }
  ]
}
```

---

### Analytics Endpoints

#### `GET /api/analytics/:id`
Returns full analytics for a link:
```json
{
  "total_clicks": 247,
  "clicks_over_time": { "2026-08-20": 45, "2026-08-21": 87 },
  "referrers": { "Direct": 120, "Twitter": 80 },
  "devices": { "Desktop": 160, "Mobile": 87 },
  "countries": { "India": 140, "USA": 60 }
}
```

#### `GET /api/export/:id`
Downloads a CSV file with every individual click record.

---

### AI Endpoints

#### `POST /api/ai/suggest-alias`
```json
{ "target_url": "https://shop.com/headphones-sale", "title": "Wireless Headphones" }
```
**Response:**
```json
{ "suggestions": ["wless-hp", "headphones-deal", "audio-sale", "hp-promo", "sound-shop"] }
```

#### `POST /api/ai/analyze-safety`
```json
{ "target_url": "https://some-website.com/path" }
```
**Response:**
```json
{
  "safetyScore": 92,
  "riskLevel": "SAFE",
  "summary": "The URL appears to be legitimate.",
  "flags": []
}
```

#### `GET /api/ai/insights/:id`
Returns AI-generated marketing recommendations for a link's traffic data.

---

### API Key & Plan Management

#### `POST /api/auth/api-key` — Generate a new API key
#### `DELETE /api/auth/api-key` — Revoke current API key
#### `POST /api/auth/upgrade` — Upgrade account to Pro tier

---

### Utility Endpoints

#### `GET /api/qr?url=...&dark=%23000000&light=%23ffffff`
Returns a PNG image of a branded QR code.

#### `GET /api/cache/stats`
Returns cache hit/miss performance stats.

#### `POST /api/verify-password`
```json
{ "code": "my-alias", "password": "passcode" }
```

#### `GET /api-docs`
Interactive Swagger UI documentation.

---

## 📋 Bulk CSV Format

Paste into the **Bulk Shorten** tab. Format:
```
target_url, custom_alias, title, tags
https://www.google.com, g-search, Google Search Engine, tools
https://www.github.com, gh-code, GitHub Repository, dev
https://www.youtube.com, , YouTube (auto-alias), entertainment
```

> Custom alias and title are optional — leave blank with a comma.

---

## 🧪 Running Tests

```bash
# Run the full API test suite
powershell -ExecutionPolicy Bypass -File test_api.ps1
```

Covers: Auth, Shortening, Redirection, Custom Aliases, Duplicate rejection, Expiration, Password links, Malicious URL blocking, Bulk operations, Analytics, AI endpoints, API Keys, QR generation, Rate limiting, Swagger docs.

---

## 📁 Project Structure

```
LinkSnip/
├── server.js              # Express.js main server (routes, auth, redirect)
├── database.js            # In-memory + JSON persistence DB engine
├── package.json
├── test_api.ps1           # Comprehensive API test suite
├── public/
│   ├── index.html         # Single-page App (Glassmorphism UI)
│   ├── styles.css         # Dark glassmorphism CSS
│   └── app.js             # Frontend JavaScript (auth, dashboard, charts)
└── utils/
    ├── base62.js          # Base62 encoding + alias validation
    ├── aiEngine.js        # AI alias suggestions, safety scanner, insights
    ├── geoDeviceParser.js # User-agent & geo-location parser
    └── email.js           # Nodemailer email helper (Ethereal SMTP)
```

---

## 🔒 Security Features

- **bcryptjs** password hashing (10 rounds)
- **JWT** signed tokens with 7-day expiry
- **Rate Limiting** — 200 API requests per 15 minutes
- **Malicious URL Scanner** — AI-based phishing & spam detection
- **Password-Protected Links** — AES-style link passcodes
- **Session Management** — Secure HTTP-only session cookies
- **CORS** protection enabled

---

## 📄 License

MIT License. Created for Product Assessment 2026.

**Author:** Akash Kumar Barik  
**GitHub:** [akashkumar32/LinkSnip](https://github.com/akashkumar32/LinkSnip)
