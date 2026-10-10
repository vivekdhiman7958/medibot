import { randomUUID } from "node:crypto";
import { isAcknowledgedSession, createAcknowledgedSession, allRestrictedTerms, findMentionedMedicine } from "./db";
import { answerWithGroq } from "./agent";
import { findRestrictedMatch, isIndirectRestrictedReference, REQUIRED_RESTRICTED_MESSAGE } from "./safety";
import { runTool, type ToolName } from "./tools";

interface ChatRequest {
  sessionId?: string;
  message?: string;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

const conversations = new Map<string, ConversationMessage[]>();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const groqKey = process.env.GROQ_API_KEY;
const groqModel = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
const tavilyKey = process.env.TAVILY_API_KEY;
const disclaimer = "MediBot provides general medicine information, not medical advice. It cannot diagnose or prescribe. Always consult a doctor or pharmacist.";
const publicRoot = new URL("../public/", import.meta.url);

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Request body must be a JSON object." }, 400);
    return body as Record<string, unknown>;
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }
}

function demoAnswer(message: string): string {
  const medicine = findMentionedMedicine(message);
  if (!medicine) {
    return "I couldn't find that product in the current medicine catalogue. Try the product name as it appears in the catalogue.";
  }
  const query = message.toLowerCase();
  const tool: ToolName = /alternative|substitute|cheaper|same composition/.test(query)
    ? "find_alternatives"
    : /side effect|interaction|information|about/.test(query)
      ? "get_drug_info"
      : /composition|ingredient|contain/.test(query)
        ? "get_composition"
        : "compare_prices";
  const result = runTool(tool, { medicine_name: medicine.brand });
  if (result.blocked) return REQUIRED_RESTRICTED_MESSAGE;
  if (tool === "compare_prices") {
    const parsed = JSON.parse(result.result) as {
      prices: Array<{ pharmacy: string; price: number; eta_days: number | null; in_stock: number | null; source_type: string }>;
      source_note: string;
      pack_size: string | null;
    };
    const lines = parsed.prices.map((price) =>
      price.source_type === "kaggle_1mg_snapshot"
        ? `${price.pharmacy}: ₹${price.price} (stock and delivery ETA not provided)`
        : `${price.pharmacy}: ₹${price.price}${price.eta_days === null ? "" : ` (about ${price.eta_days} day${price.eta_days === 1 ? "" : "s"})`}`,
    );
    const pack = parsed.pack_size ? `; ${parsed.pack_size}` : "";
    return `Price snapshot for ${medicine.brand}${pack}\n${lines.length ? lines.join("\n") : "No price entries are available."}\n${parsed.source_note}`;
  }
  if (tool === "find_alternatives") {
    const parsed = JSON.parse(result.result) as {
      alternatives: Array<{ brand: string; composition: string; lowest_demo_price: number | null }>;
      source_note: string;
    };
    const lines = parsed.alternatives.map((alternative) => `${alternative.brand} — ${alternative.composition}${alternative.lowest_demo_price === null ? "" : `; demo lowest price ₹${alternative.lowest_demo_price}`}`);
    return `Exact-composition matches for ${medicine.brand}:\n${lines.length ? lines.join("\n") : "No verified matches are available."}\n${parsed.source_note}\nConfirm any substitution with a doctor or pharmacist.`;
  }
  if (tool === "get_composition") return `${medicine.brand}: ${medicine.composition}.`;
  const parsed = JSON.parse(result.result) as { information: { side_effects: string; interactions: string } | null };
  if (!parsed.information) return "No general information is available in this demo catalogue. Please consult a doctor or pharmacist.";
  return `${medicine.brand} — general catalogue information only:\nPossible effects: ${parsed.information.side_effects}\nInteractions: ${parsed.information.interactions}\n${disclaimer}`;
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ status: "ok", groqConfigured: Boolean(groqKey), webSearchConfigured: Boolean(tavilyKey), disclaimer });
    }

    if (request.method === "POST" && url.pathname === "/api/session") {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      if (body.acknowledged !== true) return json({ error: "Please acknowledge the medical disclaimer before continuing." }, 400);
      const sessionId = randomUUID();
      createAcknowledgedSession(sessionId);
      conversations.set(sessionId, []);
      return json({ sessionId, disclaimer });
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      const chat = body as ChatRequest;
      if (typeof chat.sessionId !== "string" || !isAcknowledgedSession(chat.sessionId)) {
        return json({ error: "Start a session and acknowledge the disclaimer first." }, 401);
      }
      if (typeof chat.message !== "string" || !chat.message.trim() || chat.message.length > 2000) {
        return json({ error: "Message must contain 1–2000 characters." }, 400);
      }
      const message = chat.message.trim();
      if (findRestrictedMatch(message, allRestrictedTerms()) || isIndirectRestrictedReference(message)) {
        return json({ answer: REQUIRED_RESTRICTED_MESSAGE, blocked: true });
      }

      let history = conversations.get(chat.sessionId);
      if (!history) {
        history = [];
        conversations.set(chat.sessionId, history);
      }
      const updatedHistory: ConversationMessage[] = [...history, { role: "user" as const, content: message }].slice(-12);
      let answer: string;
      let sources: Array<{ title: string; url: string }> = [];
      if (groqKey) {
        try {
          const result = await answerWithGroq(updatedHistory, groqKey, groqModel, tavilyKey);
          answer = result.answer;
          sources = result.sources;
        } catch (error) {
          const detail = error instanceof Error ? error.message : "The Groq request could not be completed.";
          console.error("MediBot Groq request failed:", detail);
          return json({ error: detail }, 502);
        }
        if (answer === REQUIRED_RESTRICTED_MESSAGE) return json({ answer, blocked: true });
      } else {
        answer = demoAnswer(message);
      }
      conversations.set(chat.sessionId, [...updatedHistory, { role: "assistant" as const, content: answer }].slice(-12));
      return json({
        answer,
        sources,
        sourceNotice: sources.length
          ? "I found this general information on the internet. It is not a diagnosis or treatment advice; confirm medicine-related decisions with a doctor or pharmacist."
          : null,
        blocked: false,
        disclaimer,
      });
    }

    if (request.method === "GET" && url.pathname === "/") return new Response(Bun.file(new URL("index.html", publicRoot)));
    if (request.method === "GET" && url.pathname === "/app.js") return new Response(Bun.file(new URL("app.js", publicRoot)));
    if (request.method === "GET" && url.pathname === "/styles.css") return new Response(Bun.file(new URL("styles.css", publicRoot)));
    return json({ error: "Not found." }, 404);
  },
});

console.log(`MediBot running at http://localhost:${server.port}`);
