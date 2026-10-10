export const REQUIRED_RESTRICTED_MESSAGE =
  "This medication requires a valid prescription. Please consult your doctor.";

const normalize = (value: string): string =>
  value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function findRestrictedMatch(message: string, restrictedTerms: string[]): string | undefined {
  const normalizedMessage = normalize(message);
  const messageWords = normalizedMessage.split(" ");
  for (const term of restrictedTerms) {
    const normalizedTerm = normalize(term);
    if (!normalizedTerm) continue;
    if (` ${normalizedMessage} `.includes(` ${normalizedTerm} `)) return term;

    const termWords = normalizedTerm.split(" ");
    if (termWords.length !== 1 || termWords[0].length < 6) continue;
    const maxDistance = termWords[0].length >= 9 ? 2 : 1;
    if (messageWords.some((word) => word.length >= 5 && editDistance(word, termWords[0]) <= maxDistance)) {
      return term;
    }
  }
  return undefined;
}

export function isIndirectRestrictedReference(message: string): boolean {
  const medicine = String.raw`(?:tablet|medicine|pill|drug)`;
  const clinician = String.raw`(?:doctor|prescrib\w+)`;
  const risk = String.raw`(?:anxiety|panic attacks?|sleep|insomnia|seizures?|adhd|infection|severe pain)`;
  return new RegExp(
    String.raw`\b${medicine}\b.{0,100}\b${clinician}\b.{0,80}\b${risk}\b|\b${clinician}\b.{0,100}\b${medicine}\b.{0,80}\b${risk}\b`,
    "i",
  ).test(message);
}

export type OutputViolation = "restricted_medication" | "diagnosis";

export function findOutputViolation(text: string, restrictedTerms: string[]): OutputViolation | undefined {
  if (findRestrictedMatch(text, restrictedTerms)) return "restricted_medication";
  if (/\b(you (?:have|likely have|probably have)|you are suffering from|my diagnosis is|diagnosed with)\b/i.test(text)) {
    return "diagnosis";
  }
  return undefined;
}
