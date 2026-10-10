import { findRestrictedMatch } from "./safety";

export interface WebSource {
  title: string;
  url: string;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
  message?: string;
}

export interface WebSearchResult {
  excerpts: Array<{ title: string; url: string; excerpt: string }>;
  sources: WebSource[];
}

const trustedDomains = [
  "medlineplus.gov",
  "nhs.uk",
  "dailymed.nlm.nih.gov",
  "fda.gov",
  "cdsco.gov.in",
  "who.int",
  "nccih.nih.gov",
];

export async function searchMedicalWeb(
  query: string,
  apiKey: string,
  restrictedTerms: string[],
): Promise<WebSearchResult> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 3 || normalizedQuery.length > 200) {
    throw new Error("Web search query must contain 3–200 characters.");
  }
  if (findRestrictedMatch(normalizedQuery, restrictedTerms)) {
    return { excerpts: [], sources: [] };
  }
  if (/\b(?:i|me|my|we|our|age\s+\d{1,3}|phone|email|address|medical history|my child)\b/i.test(normalizedQuery)) {
    return { excerpts: [], sources: [] };
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: `${normalizedQuery} medicine general information`,
      topic: "general",
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      include_domains: trustedDomains,
    }),
  });

  const responseText = await response.text();
  let payload: TavilyResponse;
  try {
    payload = JSON.parse(responseText) as TavilyResponse;
  } catch {
    throw new Error(`Web search returned an invalid response (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(`Tavily search failed (${response.status}): ${payload.message ?? "Check TAVILY_API_KEY and your Tavily account."}`);
  }

  const excerpts: WebSearchResult["excerpts"] = [];
  const seenUrls = new Set<string>();
  for (const result of payload.results ?? []) {
    if (typeof result.title !== "string" || typeof result.url !== "string" || typeof result.content !== "string") continue;
    let sourceUrl: URL;
    try {
      sourceUrl = new URL(result.url);
    } catch {
      continue;
    }
    if (sourceUrl.protocol !== "https:" || seenUrls.has(sourceUrl.href)) continue;
    const excerpt = `${result.title} ${result.content}`;
    if (findRestrictedMatch(excerpt, restrictedTerms)) continue;
    seenUrls.add(sourceUrl.href);
    excerpts.push({
      title: result.title.slice(0, 180),
      url: sourceUrl.href,
      excerpt: result.content.slice(0, 1600),
    });
  }

  return {
    excerpts,
    sources: excerpts.map(({ title, url }) => ({ title, url })),
  };
}
