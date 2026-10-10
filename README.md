# MediBot

MediBot is a safety-first medicine information prototype built with Bun, TypeScript, and SQLite. It provides a chat interface for looking up products in a local catalogue, showing source-labelled price snapshots, and (optionally) finding general information from selected medical-reference websites.

> **Prototype only — not for medical decisions.** MediBot cannot diagnose or prescribe. Its restricted-medicine list is incomplete demo data, its imported prices are not live, and the catalogue does not contain verified active compositions. Always consult a qualified healthcare professional.

## Project documents

- [Project presentation (PDF)](./MediBot-Presentation.pdf)
- [Technical stack and architecture guide (PDF)](./MediBot-Technical-Architecture-Guide.pdf)
- [Original architecture and data sources (PDF)](./1791560046510_MediBot_Architecture_and_Data_Sources%20%281%29.pdf)

The technical guide describes the implementation and its current limitations; proposed or future features are not represented as completed.

## Features

- Bun HTTP server with a lightweight HTML, CSS, and browser-JavaScript chat UI.
- SQLite catalogue, price, health-information, restricted-term, and disclaimer-session tables.
- CSV importer for the downloaded 1mg Kaggle snapshot.
- Optional Groq tool-calling agent (default model: `openai/gpt-oss-120b`).
- Optional Tavily search for general information from a limited set of medical-reference domains, with clickable source links.
- Code-level input, tool-input, and generated-answer checks.
- Safe browser rendering for headings, lists, emphasis, tables, and source links.
- Tests for CSV parsing, safety checks, and web-source filtering.

## Requirements

- [Bun](https://bun.sh/) installed.
- A Groq API key to use the LLM-powered chat. The app can start without it, but then uses a limited local fallback.
- A Tavily API key is optional; it enables web-search fallback.

## Quick start

```sh
bun install
```

Copy `.env.example` to `.env`, then add your credentials:

```dotenv
GROQ_API_KEY=your_groq_key
GROQ_MODEL=openai/gpt-oss-120b
TAVILY_API_KEY=your_tavily_key
PORT=3000
```

`TAVILY_API_KEY` is optional. Keep `.env` private and never commit API keys or paste them into issue reports.

Start the app:

```sh
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). If port 3000 is already occupied, stop the existing MediBot server before starting another. The development script uses Bun watch mode and reloads source changes.

Check configuration without exposing secrets:

```sh
curl http://localhost:3000/api/health
```

The response includes booleans such as `groqConfigured` and `webSearchConfigured`; it does not return API keys. Restart the server after changing `.env`.

## Data and importer

The app reads product records from `data/medibot.sqlite`. On a new database, a small demo catalogue is seeded. This repository does not guarantee that downloaded datasets are included; check the dataset license and GitHub repository size before publishing them.

The importer expects the Kaggle CSV at:

```text
data/raw/1mgData.csv
```

Preview without changing the database:

```sh
bun run import:1mg:check
```

Import the CSV:

```sh
bun run import:1mg
```

The import **replaces existing medicine catalogue rows** and cascades deletion of their related prices and health-information records. It preserves session acknowledgements and restricted terms. Back up `data/medibot.sqlite` first if you need to retain its data.

The importer validates required CSV headers, parses numeric fields, skips blank product names, and removes exact duplicate records. In the dataset currently inspected, it imported 15,948 products and 11,648 parseable price entries. These counts depend on the input file and can change with a different dataset version.

### Kaggle data limitations

The downloaded CSV contains product name, pack size, rating count, rating, `price`, and `mrp`. It does **not** contain verified active ingredients/composition, manufacturer, stock status, delivery time, or a dependable capture timestamp. Accordingly:

- Price records are presented as a Kaggle snapshot, **not live pharmacy offers**.
- The original `price` and `mrp` values are retained without guessing their meaning. The source data showed many records where `price` exceeded `mrp`; investigate the dataset documentation before calculating savings or comparing those fields.
- No exact-composition alternatives are generated from this CSV because ingredient data is absent.
- The importer’s inferred product identifiers are based on row content, not identifiers supplied by the dataset.
- The downloaded MID Excel workbooks are not imported by the current application.

Keep downloaded source files unchanged in `data/raw/` and record the dataset URL, version/download date, license, attribution, and any transformations before distributing the data or derived files.

## Optional web-search fallback

Set `TAVILY_API_KEY` in `.env` and restart MediBot to enable the `search_medical_web` tool. When selected by the agent, the integration sends a general-information query to Tavily and requests results only from these domains:

- MedlinePlus
- NHS
- DailyMed
- FDA
- CDSCO
- WHO
- NCCIH

The app returns HTTPS source links in the chat and labels the answer as general internet information—not a diagnosis or treatment advice. Search is not intended for restricted-drug classification, prescribing, exact-substitution claims, or live pharmacy prices. MediBot does not scrape pharmacy websites.

Search queries are sent to Tavily. A small pattern blocks some queries that look personal, but it is not a complete privacy detector. Do not enter names, contact information, personal medical history, or other sensitive details. Review Tavily's current terms and privacy policy for your use case.

## Safety and known limitations

- The included restricted-term/brand list is a **small demonstration sample**, not a complete or authoritative Schedule H/restricted-drug list. Fuzzy matching and indirect-reference checks are limited and cannot guarantee detection of every medicine or phrasing.
- The generated-answer check looks for a limited set of restricted names and diagnosis phrases; it is not a clinical classifier and cannot guarantee that every unsafe statement is caught.
- Groq is instructed not to diagnose, prescribe, invent facts, or make decisions that belong to deterministic code/data. The model may still make mistakes.
- Restriction checks use the bundled database vocabulary; Tavily and the LLM do not determine whether a medicine is restricted.
- General web sources may be incomplete, outdated, or unsuitable for a particular person. Users should verify sources and consult healthcare professionals.
- Chat context is held in server memory and is lost when the server restarts. SQLite stores session identifiers and disclaimer-acknowledgement timestamps, not chat messages.
- This local prototype does not include user accounts, production authentication, rate limiting, deployment hardening, live pharmacy integrations, or clinical validation.

Do not deploy this prototype for public medical use without authoritative data, licensing review, security/privacy work, and qualified clinical/compliance review.

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Returns service state and whether Groq/Tavily are configured. |
| `POST` | `/api/session` | Creates a session after disclaimer acknowledgement (`{"acknowledged": true}`). |
| `POST` | `/api/chat` | Sends a chat message (`{"sessionId": "...", "message": "..."}`). |

The chat endpoint requires an acknowledged session and accepts messages of 1–2,000 characters.

## Development checks

```sh
bun test
bun run typecheck
```

## Repository layout

```text
src/
  agent.ts          Groq agent, tool orchestration, and output checks
  csv.ts            CSV parser
  db.ts             SQLite schema, seed data, and queries
  import-1mg.ts     Kaggle CSV validation and import
  safety.ts         Restricted-term and output checks
  server.ts         HTTP API and static asset server
  tools.ts          Guarded catalogue tools
  web-search.ts     Optional Tavily search and source filtering
public/
  index.html        Chat UI markup
  styles.css        UI styles
  app.js            Browser chat, formatting, and citations
tests/
  csv.test.ts
  safety.test.ts
  web-search.test.ts
data/
  raw/              Downloaded source data (check license before sharing)
  medibot.sqlite    Local generated database (ignored by Git)
```

## License and data attribution

No project license or dataset license has been verified in this repository. Before publishing or redistributing, choose and add a project license, confirm the Kaggle/MID dataset licenses and attribution requirements, and ensure downloaded datasets are permitted to be committed. Do not imply that the datasets are official, comprehensive, current, or clinically validated.
