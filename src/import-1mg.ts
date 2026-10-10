import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "./db";
import { parseCsv } from "./csv";

interface KaggleProduct {
  id: string;
  brand: string;
  packSize: string;
  ratingCount: string;
  rating: number | null;
  sourcePrice: number | null;
  sourceMrp: number | null;
}

const sourcePath = resolve(import.meta.dir, "../data/raw/1mgData.csv");
const sourceLabel = "kaggle_1mg_snapshot";

function parseAmount(value: string | undefined): number | null {
  if (!value || /^(?:nan|n\/a|na|-)$/i.test(value.trim())) return null;
  const numeric = value.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(numeric)) return null;
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRating(value: string | undefined): number | null {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const rating = Number(value);
  return rating >= 0 && rating <= 5 ? rating : null;
}

function loadProducts(): {
  products: KaggleProduct[];
  duplicateRows: number;
  emptyNameRows: number;
  invalidPriceRows: number;
  invalidMrpRows: number;
} {
  const rows = parseCsv(readFileSync(sourcePath, "utf8"));
  const header = rows.shift()?.map((value) => value.trim().replace(/^\uFEFF/, "").toLowerCase());
  if (!header?.length) throw new Error(`CSV is empty: ${sourcePath}`);

  const required = ["name", "pack_size", "rating_count", "rating", "price", "mrp"];
  const missing = required.filter((column) => !header.includes(column));
  if (missing.length) throw new Error(`CSV is missing required columns: ${missing.join(", ")}`);

  const columnIndex = new Map(header.map((name, index) => [name, index]));
  const seen = new Set<string>();
  const products: KaggleProduct[] = [];
  let duplicateRows = 0;
  let emptyNameRows = 0;
  let invalidPriceRows = 0;
  let invalidMrpRows = 0;

  for (const row of rows) {
    if (row.every((cell) => !cell.trim())) continue;
    const value = (name: string): string => row[columnIndex.get(name)!]?.trim() ?? "";
    const brand = value("name");
    if (!brand) {
      emptyNameRows += 1;
      continue;
    }

    const packSize = value("pack_size");
    const ratingCount = value("rating_count");
    const rating = parseRating(value("rating"));
    const sourcePrice = parseAmount(value("price"));
    const sourceMrp = parseAmount(value("mrp"));
    if (sourcePrice === null) invalidPriceRows += 1;
    if (sourceMrp === null) invalidMrpRows += 1;

    const key = [brand, packSize, ratingCount, value("rating"), value("price"), value("mrp")].join("\u001f");
    const fingerprint = createHash("sha256").update(key.toLocaleLowerCase("en")).digest("hex");
    if (seen.has(fingerprint)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(fingerprint);
    products.push({
      id: `1mg-${fingerprint.slice(0, 32)}`,
      brand,
      packSize,
      ratingCount,
      rating,
      sourcePrice,
      sourceMrp,
    });
  }

  return { products, duplicateRows, emptyNameRows, invalidPriceRows, invalidMrpRows };
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const report = loadProducts();
const eligiblePriceRows = report.products.filter((product) => product.sourcePrice !== null);
const priceMismatchRows = report.products.filter(
  (product) => product.sourcePrice !== null && product.sourceMrp !== null && product.sourcePrice > product.sourceMrp,
).length;
const apply = Bun.argv.includes("--apply");

console.log(`Source file: ${sourcePath}`);
console.log(`Products ready: ${report.products.length}`);
console.log(`Exact duplicate rows skipped: ${report.duplicateRows}`);
console.log(`Rows with empty product name skipped: ${report.emptyNameRows}`);
console.log(`Rows without a parseable price: ${report.invalidPriceRows}`);
console.log(`Rows without a parseable MRP: ${report.invalidMrpRows}`);
console.log(`Rows where source "price" is higher than source "mrp": ${priceMismatchRows}`);
console.log("Composition, manufacturer, pharmacy stock, and delivery ETA are not present in this CSV.");

if (!apply) {
  console.log("Dry run only. Review the report, then run `bun run import:1mg` to replace the current medicine catalogue.");
  process.exit(0);
}

addColumnIfMissing("medicines", "pack_size", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("medicines", "rating_count", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("medicines", "rating", "REAL");
addColumnIfMissing("medicines", "data_source", "TEXT NOT NULL DEFAULT 'demo'");
addColumnIfMissing("medicines", "source_price", "REAL");
addColumnIfMissing("medicines", "source_mrp", "REAL");

const insertMedicine = db.query(
  `INSERT INTO medicines
   (id, brand, manufacturer, composition, normalized_composition, mrp, restricted, pack_size, rating_count, rating, data_source, source_price, source_mrp)
   VALUES ($id, $brand, $manufacturer, $composition, $normalized_composition, $mrp, 0, $pack_size, $rating_count, $rating, $data_source, $source_price, $source_mrp)`,
);
const insertPrice = db.query(
  `INSERT INTO prices (medicine_id, pharmacy, price, eta_days, in_stock, source_type)
   VALUES ($medicine_id, '1mg (Kaggle dataset snapshot)', $price, 0, 0, 'kaggle_1mg_snapshot')`,
);

const importProducts = db.transaction(() => {
  db.query("DELETE FROM medicines").run();
  for (const product of report.products) {
    insertMedicine.run({
      $id: product.id,
      $brand: product.brand,
      $manufacturer: "Not provided by source",
      $composition: "Not provided by source",
      $normalized_composition: `unverified:${product.id}`,
      $mrp: product.sourceMrp ?? 0,
      $pack_size: product.packSize,
      $rating_count: product.ratingCount,
      $rating: product.rating,
      $data_source: sourceLabel,
      $source_price: product.sourcePrice,
      $source_mrp: product.sourceMrp,
    });
    if (product.sourcePrice !== null) {
      insertPrice.run({
        $medicine_id: product.id,
        $price: product.sourcePrice,
      });
    }
  }
});

importProducts();
console.log(`Imported ${report.products.length} catalogue products and ${eligiblePriceRows.length} source price entries.`);
console.log("Imported price and MRP values retain the CSV column labels; verify their semantics before relying on price-vs-MRP comparisons.");
