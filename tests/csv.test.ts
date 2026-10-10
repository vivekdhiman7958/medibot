import { describe, expect, test } from "bun:test";
import { parseCsv } from "../src/csv";

describe("CSV parser", () => {
  test("parses quoted commas and CRLF line endings", () => {
    expect(parseCsv('Name,Pack\r\n"Vitamin C, Zinc",box of 10\r\n')).toEqual([
      ["Name", "Pack"],
      ["Vitamin C, Zinc", "box of 10"],
    ]);
  });

  test("handles escaped quotes and quoted newlines", () => {
    expect(parseCsv('Name,Details\n"Brand ""Plus""","line one\nline two"\n')).toEqual([
      ["Name", "Details"],
      ['Brand "Plus"', "line one\nline two"],
    ]);
  });

  test("removes a UTF-8 BOM", () => {
    expect(parseCsv("\uFEFFName,Price\nTablet,₹20")).toEqual([
      ["Name", "Price"],
      ["Tablet", "₹20"],
    ]);
  });

  test("rejects unclosed quoted fields", () => {
    expect(() => parseCsv('Name\n"unfinished')).toThrow("unclosed quoted field");
  });
});
