import { describe, expect, test } from "bun:test";
import { findOutputViolation, findRestrictedMatch, isIndirectRestrictedReference, REQUIRED_RESTRICTED_MESSAGE } from "../src/safety";

const restricted = ["alprazolam", "xanax", "amoxicillin"];

describe("restricted medicine guard", () => {
  test("matches restricted ingredients and known brand names regardless of case", () => {
    expect(findRestrictedMatch("Can you tell me about ALPRAZOLAM?", restricted)).toBe("alprazolam");
    expect(findRestrictedMatch("Is Xanax safe?", restricted)).toBe("xanax");
  });

  test("catches a simple misspelling", () => {
    expect(findRestrictedMatch("alprazolm", restricted)).toBe("alprazolam");
  });

  test("does not block unrelated terms by substring", () => {
    expect(findRestrictedMatch("I have a question about paracetamol", restricted)).toBeUndefined();
  });

  test("blocks a high-signal indirect reference to a prescribed medicine", () => {
    expect(isIndirectRestrictedReference("the tablet my doctor gave me for anxiety")).toBe(true);
    expect(isIndirectRestrictedReference("What is the composition of Dolo 650?")).toBe(false);
  });

  test("detects diagnosis language in generated content", () => {
    expect(findOutputViolation("You likely have an infection.", restricted)).toBe("diagnosis");
  });

  test("keeps the required block text exact", () => {
    expect(REQUIRED_RESTRICTED_MESSAGE).toBe(
      "This medication requires a valid prescription. Please consult your doctor.",
    );
  });
});
