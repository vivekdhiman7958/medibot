# MediBot

**A safety-first medicine information assistant: search a local catalogue, view source-labelled price snapshots, and get general health information from trusted medical references.**

Built with **Bun**, **TypeScript**, and **SQLite**.

> **Prototype only. Not for medical decisions.**
> MediBot cannot diagnose or prescribe. Its restricted-medicine list is incomplete demo data, imported prices are not live, and the catalogue does not contain verified active compositions. Always consult a qualified healthcare professional.

---

## Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Requirements](#-requirements)
- [Quick Start](#-quick-start)
- [Data and Importer](#-data-and-importer)
- [Kaggle Data Limitations](#-kaggle-data-limitations)
- [Optional Web Search](#-optional-web-search-fallback)
- [Safety and Known Limitations](#-safety-and-known-limitations)
- [API Reference](#-api-reference)
- [Development](#-development)
- [Repository Layout](#-repository-layout)
- [License and Data Attribution](#-license-and-data-attribution)

---

## Features

- **Chat interface** served by a Bun HTTP server, with a lightweight HTML, CSS, and vanilla JavaScript UI.
- **Local SQLite database** for the medicine catalogue, prices, health information, restricted terms, and disclaimer sessions.
- **CSV importer** for the downloaded 1mg Kaggle snapshot.
- **Optional Groq tool-calling agent** (default model: `openai/gpt-oss-120b`).
- **Optional Tavily web search** limited to trusted medical-reference domains, with clickable source links.
- **Layered safety checks** on user input, tool input, and generated answers.
- **Safe browser rendering** for headings, lists, emphasis, tables, and source links.
- **Automated tests** for CSV parsing, safety checks, and web-source filtering.

---

## Architecture

### High-level flow

```text
┌──────────────────────────────┐
│   Browser (Chat UI)          │
│   public/index.html          │
│   public/app.js              │
└──────────────┬───────────────┘
               │  HTTP (JSON)
               ▼
┌──────────────────────────────┐
│   Bun HTTP Server            │
│   src/server.ts              │
│   • /api/health              │
│   • /api/session             │
│   • /api/chat                │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│   Safety Layer (input)       │
│   src/safety.ts              │
│   Restricted-term checks     │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│   Agent                      │
│   src/agent.ts               │
│   Groq LLM + tool calling    │
│   (local fallback if no key) │
└──────┬───────────────┬───────┘
       │               │
       ▼               ▼
┌─────────────┐  ┌────────────────────┐
│ Catalogue   │  │ Web Search (opt.)  │
│ Tools       │  │ src/web-search.ts  │
│ src/tools.ts│  │ Tavily → trusted   │
│      │      │  │ medical domains    │
│      ▼      │  └────────────────────┘
│ SQLite      │
│ src/db.ts   │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────┐
│   Safety Layer (output)      │
│   Generated-answer check     │
└──────────────┬───────────────┘
               │
               ▼
        Response to user
```

### Request lifecycle

1. **Disclaimer acknowledgement.** The user accepts the disclaimer, and the server creates a session (`POST /api/session`).
2. **Message sent.** The browser posts the message to `POST /api/chat` (1–2,000 characters).
3. **Input safety check.** The message is screened for restricted medicine terms and sensitive patterns.
4. **Agent decides what to do.** The Groq agent picks guarded tools: catalogue lookup, price lookup, or optional web search. Without a Groq key, a limited local fallback is used.
5. **Tools run.** Catalogue tools query SQLite. Web search (if enabled) queries Tavily, restricted to approved domains.
6. **Output safety check.** The generated answer is checked for restricted names and diagnosis-style phrases.
7. **Response rendered.** The UI safely renders markdown-style formatting, tables, and source links.

### Design principles

- **Deterministic code decides safety.** Restriction checks use the bundled database vocabulary. The LLM and web search never decide whether a medicine is restricted.
- **Honest data labelling.** Prices are shown as a *Kaggle snapshot*, never as live offers.
- **No invented facts.** The model is instructed not to diagnose, prescribe, or make claims the data does not support.
- **Privacy by default.** Chat messages are held in memory only. SQLite stores session IDs and acknowledgement timestamps, not conversations.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript |
| Database | SQLite |
| LLM (optional) | [Groq](https://groq.com), default `openai/gpt-oss-120b` |
| Web search (optional) | [Tavily](https://tavily.com) |
| Frontend | HTML, CSS, vanilla JavaScript |
| Testing | `bun test` |

---

## Requirements

- [Bun](https://bun.sh) installed
- A **Groq API key** for the LLM-powered chat. The app starts without it but uses a limited local fallback.
- A **Tavily API key** (optional) to enable web-search fallback

---

## Quick Start

**1. Install dependencies**

```bash
bun install
```

**2. Configure environment variables**

Copy `.env.example` to `.env` and add your credentials:

```env
GROQ_API_KEY=your_groq_key
GROQ_MODEL=openai/gpt-oss-120b
TAVILY_API_KEY=your_tavily_key
PORT=3000
```

> `TAVILY_API_KEY` is optional. Keep `.env` private. Never commit API keys or paste them into issue reports.

**3. Start the app**

```bash
bun run dev
```

Open **http://localhost:3000**.

- If port 3000 is already in use, stop the existing MediBot server first.
- The dev script uses Bun watch mode and reloads on source changes.
- Restart the server after changing `.env`.

**4. Verify configuration (no secrets exposed)**

```bash
curl http://localhost:3000/api/health
```

The response includes booleans such as `groqConfigured` and `webSearchConfigured`. It never returns API keys.

---

## Data and Importer

The app reads product records from `data/medibot.sqlite`. On a new database, a small demo catalogue is seeded automatically.

> This repository does not guarantee that downloaded datasets are included. Check the dataset license and repository size before publishing them.

**Expected CSV location:**

```text
data/raw/1mgData.csv
```

**Preview without changing the database:**

```bash
bun run import:1mg:check
```

**Run the import:**

```bash
bun run import:1mg
```

**What the importer does**

- Validates required CSV headers
- Parses numeric fields
- Skips blank product names
- Removes exact duplicate records
- Replaces existing medicine catalogue rows (and cascades deletion to related prices and health-information records)
- Preserves session acknowledgements and restricted terms

> **Back up `data/medibot.sqlite` first** if you need to keep its current data.

In the dataset inspected during development, the importer produced **15,948 products** and **11,648 parseable price entries**. These counts depend on the input file and may change with a different dataset version.

---

## Kaggle Data Limitations

The downloaded CSV contains: product name, pack size, rating count, rating, price, and mrp.

It does **not** contain: verified active ingredients/composition, manufacturer, stock status, delivery time, or a dependable capture timestamp. As a result:

- Prices are presented as a **Kaggle snapshot**, not live pharmacy offers.
- The original `price` and `mrp` values are kept as-is, without guessing their meaning. Many records have `price` greater than `mrp`, so review the dataset documentation before calculating savings.
- **No exact-composition alternatives** are generated, because ingredient data is absent.
- Product identifiers are **inferred from row content**, not supplied by the dataset.
- The downloaded MID Excel workbooks are **not imported** by the current application.

Keep source files unchanged in `data/raw/`. Before distributing the data or derived files, record the dataset URL, version/download date, license, attribution, and any transformations.

---

## Optional Web Search Fallback

Set `TAVILY_API_KEY` in `.env` and restart MediBot to enable the `search_medical_web` tool. When the agent selects it, a general-information query is sent to Tavily, which is limited to these domains:

| Source | Focus |
|--------|-------|
| MedlinePlus | Consumer health information |
| NHS | UK health guidance |
| DailyMed | Drug labels |
| FDA | US regulatory information |
| CDSCO | Indian drug regulator |
| WHO | Global health information |
| NCCIH | Complementary health |

Results are returned as HTTPS source links and labelled as **general internet information, not a diagnosis or treatment advice**.

**Not intended for:** restricted-drug classification, prescribing, exact-substitution claims, or live pharmacy prices. MediBot does not scrape pharmacy websites.

**Privacy note:** Search queries are sent to Tavily. A small pattern blocks some queries that look personal, but it is not a complete privacy detector. Do not enter names, contact details, personal medical history, or other sensitive information. Review Tavily's current terms and privacy policy for your use case.

---

## Safety and Known Limitations

- The restricted-term/brand list is a **small demonstration sample**, not a complete or authoritative Schedule H list. Fuzzy matching and indirect-reference checks are limited and cannot guarantee detection of every medicine or phrasing.
- The generated-answer check looks for a limited set of restricted names and diagnosis phrases. It is **not a clinical classifier**.
- Groq is instructed not to diagnose, prescribe, or invent facts, but **the model may still make mistakes**.
- Restriction checks use the bundled database vocabulary. Tavily and the LLM do not determine whether a medicine is restricted.
- Web sources may be incomplete, outdated, or unsuitable for a particular person. Verify sources and consult a healthcare professional.
- Chat context lives in server memory and is **lost on restart**.
- The prototype has **no** user accounts, production authentication, rate limiting, deployment hardening, live pharmacy integrations, or clinical validation.

> Do not deploy this prototype for public medical use without authoritative data, licensing review, security and privacy work, and qualified clinical and compliance review.

---

## 🔌 API Reference

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/health` | Returns service state and whether Groq/Tavily are configured |
| `POST` | `/api/session` | Creates a session after disclaimer acknowledgement |
| `POST` | `/api/chat` | Sends a chat message |

**Create a session**

```http
POST /api/session
Content-Type: application/json

{ "acknowledged": true }
```

**Send a message**

```http
POST /api/chat
Content-Type: application/json

{ "sessionId": "your-session-id", "message": "Price of paracetamol 500mg" }
```

The chat endpoint requires an acknowledged session and accepts messages of **1–2,000 characters**.

---

## Development

```bash
bun test            # run the test suite
bun run typecheck   # TypeScript type checking
```

Tests cover CSV parsing, safety checks, and web-source filtering.

---

## Repository Layout

```text
medibot/
├── src/
│   ├── agent.ts          # Groq agent, tool orchestration, output checks
│   ├── csv.ts            # CSV parser
│   ├── db.ts             # SQLite schema, seed data, queries
│   ├── import-1mg.ts     # Kaggle CSV validation and import
│   ├── safety.ts         # Restricted-term and output checks
│   ├── server.ts         # HTTP API and static asset server
│   ├── tools.ts          # Guarded catalogue tools
│   └── web-search.ts     # Optional Tavily search and source filtering
├── public/
│   ├── index.html        # Chat UI markup
│   ├── styles.css        # UI styles
│   └── app.js            # Browser chat, formatting, and citations
├── tests/
│   ├── csv.test.ts
│   ├── safety.test.ts
│   └── web-search.test.ts
└── data/
    ├── raw/              # Downloaded source data (check license before sharing)
    └── medibot.sqlite    # Local generated database (ignored by Git)
```

---

## 📄 License and Data Attribution

No project license or dataset license has been verified in this repository. Add a `LICENSE` file and record dataset attribution before distributing.
