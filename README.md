# ✂️ LinkSnip - AI-Powered URL Shortener & Analytics Platform

LinkSnip is a next-generation URL shortening service built with Node.js, Express, SQLite, and Vanilla CSS Glassmorphism UI. It converts long URLs into fast short links while offering real-time click analytics, custom aliases, QR code generation, expiration controls, password protection, and built-in AI intelligence.

---

## 🌟 Key Features

- **⚡ Core URL Shortening**: Generates Base62 6-character short codes or accepts custom branded aliases (`3-30` chars).
- **🚀 Ultra-Low Latency Redirection**: Redirect service resolves links under 50ms latency using non-blocking asynchronous click logging.
- **🤖 Built-in AI Features**:
  1. **AI Smart Alias Generator**: Suggests context-aware, SEO-friendly custom aliases based on target URL domain and title.
  2. **AI Safe Link & Phishing Analyzer**: Scans destination URL structure, protocol, and domain attributes for spam/phishing risk (0-100% Safety Score).
  3. **AI Click Performance Insights**: Analyzes click trends, device breakdown, and referrers to generate strategic sharing recommendations.
- **📊 Real-Time Analytics & CSV Export**: Interactive charts powered by Chart.js tracking clicks over time, referrer sources, device/browser distribution, and geo-locations.
- **🔒 Link Security & Expiration**:
  - Expiration date & time limits.
  - Maximum click threshold limits.
  - Optional passcode protection for sensitive links.
- **📱 QR Code Generation**: Auto-generates high-res QR codes for physical and print campaigns.
- **🔌 REST API**: Full OpenAPI-style API endpoints for developers.

---

## 🏗️ Architecture & Tech Stack

```
[ Frontend: HTML5, Glassmorphism CSS, JS ES6+, Chart.js ]
                         │
                         ▼
           [ Express.js REST & Redirect Server ]
    ┌────────────────────┼────────────────────┐
    ▼                    ▼                    ▼
[ Base62 Shortener ] [ SQLite Analytics ] [ AI Service Engine ]
```

- **Backend**: Node.js, Express.js
- **Database**: SQLite3 (Embedded, Zero-configuration)
- **Frontend**: HTML5, Vanilla CSS3 (Glassmorphism Dark Theme), Vanilla JavaScript
- **Visualization**: Chart.js
- **QR Engine**: qrcode

---

## 🚀 Quick Start (Local Setup)

### Prerequisites
- Node.js (v16 or higher)
- npm

### Installation Steps

1. **Clone Repository**:
   ```bash
   git clone https://github.com/your-username/LinkSnip.git
   cd LinkSnip
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Start Development Server**:
   ```bash
   npm run start
   ```

4. **Access Web App**:
   Open browser at `http://localhost:3000`

---

## 🔌 API Endpoints Summary

### 1. Shorten URL
`POST /api/shorten`
```json
{
  "target_url": "https://example.com/long-page",
  "custom_alias": "my-promo",
  "expire_at": "2026-12-31T23:59:59Z",
  "max_clicks": 100,
  "password": "optionalpasscode",
  "tags": "marketing,sale"
}
```

### 2. AI Alias Suggestions
`POST /api/ai/suggest-alias`
```json
{
  "target_url": "https://example.com/products/headphones",
  "title": "Wireless Headphones Sale"
}
```

### 3. Get Link Analytics
`GET /api/analytics/:id`

### 4. Download CSV Report
`GET /api/export/:id`

---

## 🌐 Live Deployment Guide (Free Hosting)

### Deploying to Render.com (Recommended)
1. Push code to your GitHub repository.
2. Go to [Render.com](https://render.com) and create a **Web Service**.
3. Connect your GitHub repository.
4. Set Build Command: `npm install`
5. Set Start Command: `node server.js`
6. Click **Deploy**. Your live app link will be ready in 1-2 minutes!

---

## 📄 License
MIT License. Created for Product Assessment 2026.
