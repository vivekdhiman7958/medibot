import { describe, expect, spyOn, test } from "bun:test";
import { searchMedicalWeb } from "../src/web-search";

describe("medical web search", () => {
  test("searches with trusted source domains and returns clickable HTTPS citations", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        results: [
          { title: "Vitamin D", url: "https://medlineplus.gov/vitamind.html", content: "General reference information." },
          { title: "Unsafe protocol", url: "http://example.org/info", content: "Ignored." },
          { title: "Restricted mention", url: "https://nhs.uk/page", content: "Information about alprazolam." },
        ],
      }), { status: 200 }),
    );

    const result = await searchMedicalWeb("vitamin D general information", "test-key", ["alprazolam"]);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { include_domains: string[] };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(request.include_domains).toContain("medlineplus.gov");
    expect(result.excerpts).toHaveLength(1);
    expect(result.sources).toEqual([{ title: "Vitamin D", url: "https://medlineplus.gov/vitamind.html" }]);
    fetchMock.mockRestore();
  });

  test("does not send personal-detail queries to the search provider", async () => {
    const fetchMock = spyOn(globalThis, "fetch");
    const result = await searchMedicalWeb("My symptoms after taking a medicine", "test-key", []);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ excerpts: [], sources: [] });
    fetchMock.mockRestore();
  });
});
