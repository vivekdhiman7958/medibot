import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";

export interface Medicine {
  id: string;
  brand: string;
  manufacturer: string;
  composition: string;
  normalized_composition: string;
  mrp: number;
  restricted: number;
  pack_size?: string;
  rating_count?: string;
  rating?: number | null;
  data_source?: string;
  source_price?: number | null;
  source_mrp?: number | null;
}

export interface Price {
  pharmacy: string;
  price: number;
  eta_days: number | null;
  in_stock: number | null;
  source_type: string;
}

const demoMedicines: Omit<Medicine, "restricted">[] = [
  {
    id: "dolo-650",
    brand: "Dolo 650",
    manufacturer: "Micro Labs",
    composition: "Paracetamol 650 mg",
    normalized_composition: "paracetamol|650mg",
    mrp: 30,
  },
  {
    id: "calpol-650",
    brand: "Calpol 650",
    manufacturer: "GSK",
    composition: "Paracetamol 650 mg",
    normalized_composition: "paracetamol|650mg",
    mrp: 32,
  },
  {
    id: "cetirizine-generic",
    brand: "Cetirizine 10 mg (generic)",
    manufacturer: "Demo Generic",
    composition: "Cetirizine 10 mg",
    normalized_composition: "cetirizine|10mg",
    mrp: 12,
  },
  {
    id: "cetzine-10",
    brand: "Cetzine 10",
    manufacturer: "GSK",
    composition: "Cetirizine 10 mg",
    normalized_composition: "cetirizine|10mg",
    mrp: 18,
  },
];

const demoPrices: Array<{ medicineId: string; pharmacy: string; price: number; eta: number }> = [
  { medicineId: "dolo-650", pharmacy: "Demo Pharmacy A", price: 25, eta: 1 },
  { medicineId: "dolo-650", pharmacy: "Demo Pharmacy B", price: 28, eta: 2 },
  { medicineId: "calpol-650", pharmacy: "Demo Pharmacy A", price: 27, eta: 1 },
  { medicineId: "calpol-650", pharmacy: "Demo Pharmacy B", price: 29, eta: 2 },
  { medicineId: "cetirizine-generic", pharmacy: "Demo Pharmacy A", price: 8, eta: 1 },
  { medicineId: "cetirizine-generic", pharmacy: "Demo Pharmacy B", price: 10, eta: 2 },
  { medicineId: "cetzine-10", pharmacy: "Demo Pharmacy A", price: 14, eta: 1 },
  { medicineId: "cetzine-10", pharmacy: "Demo Pharmacy B", price: 16, eta: 2 },
];

const dbPath = resolve(process.env.DB_PATH ?? "./data/medibot.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new Database(dbPath, { create: true });

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS medicines (
    id TEXT PRIMARY KEY,
    brand TEXT NOT NULL,
    manufacturer TEXT NOT NULL,
    composition TEXT NOT NULL,
    normalized_composition TEXT NOT NULL,
    mrp REAL NOT NULL CHECK (mrp >= 0),
    restricted INTEGER NOT NULL DEFAULT 0 CHECK (restricted IN (0, 1)),
    pack_size TEXT NOT NULL DEFAULT '',
    rating_count TEXT NOT NULL DEFAULT '',
    rating REAL,
    data_source TEXT NOT NULL DEFAULT 'demo',
    source_price REAL,
    source_mrp REAL
  );
  CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY,
    medicine_id TEXT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    pharmacy TEXT NOT NULL,
    price REAL NOT NULL CHECK (price >= 0),
    eta_days INTEGER NOT NULL CHECK (eta_days >= 0),
    in_stock INTEGER NOT NULL DEFAULT 1 CHECK (in_stock IN (0, 1)),
    source_type TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS health_info (
    medicine_id TEXT PRIMARY KEY REFERENCES medicines(id) ON DELETE CASCADE,
    side_effects TEXT NOT NULL,
    interactions TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS restricted_terms (
    term TEXT PRIMARY KEY,
    ingredient TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    disclaimer_acknowledged_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const medicineCount = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM medicines").get()!.count;
if (medicineCount === 0) {
  const insertMedicine = db.query(
    `INSERT INTO medicines (id, brand, manufacturer, composition, normalized_composition, mrp, restricted)
     VALUES ($id, $brand, $manufacturer, $composition, $normalized_composition, $mrp, 0)`,
  );
  const insertPrice = db.query(
    `INSERT INTO prices (medicine_id, pharmacy, price, eta_days, in_stock, source_type)
     VALUES ($medicine_id, $pharmacy, $price, $eta_days, 1, 'simulated')`,
  );

  const seed = db.transaction(() => {
    for (const medicine of demoMedicines) {
      insertMedicine.run({
        $id: medicine.id,
        $brand: medicine.brand,
        $manufacturer: medicine.manufacturer,
        $composition: medicine.composition,
        $normalized_composition: medicine.normalized_composition,
        $mrp: medicine.mrp,
      });
    }
    for (const price of demoPrices) {
      insertPrice.run({
        $medicine_id: price.medicineId,
        $pharmacy: price.pharmacy,
        $price: price.price,
        $eta_days: price.eta,
      });
    }
    db.query(
      `INSERT INTO health_info (medicine_id, side_effects, interactions) VALUES
       ('dolo-650', 'Possible nausea or rash. Seek professional advice for concerns.', 'Ask a pharmacist about other paracetamol-containing products.'),
       ('calpol-650', 'Possible nausea or rash. Seek professional advice for concerns.', 'Ask a pharmacist about other paracetamol-containing products.'),
       ('cetirizine-generic', 'May cause drowsiness or dry mouth.', 'Ask a pharmacist about alcohol or other medicines that cause drowsiness.'),
       ('cetzine-10', 'May cause drowsiness or dry mouth.', 'Ask a pharmacist about alcohol or other medicines that cause drowsiness.')`,
    ).run();
    db.query(
      `INSERT INTO restricted_terms (term, ingredient) VALUES
       ('alprazolam', 'alprazolam'), ('xanax', 'alprazolam'),
       ('diazepam', 'diazepam'), ('valium', 'diazepam'),
       ('amoxicillin', 'amoxicillin'), ('azithromycin', 'azithromycin'),
       ('tramadol', 'tramadol'), ('codeine', 'codeine')`,
    ).run();
  });
  seed();
}

export function allRestrictedTerms(): string[] {
  return db.query<{ term: string }, []>("SELECT term FROM restricted_terms").all().map((row) => row.term);
}

export function findMedicine(search: string): Medicine | undefined {
  const normalized = search.trim();
  if (!normalized) return undefined;
  return db.query<Medicine, [string, string, string]>(
    `SELECT * FROM medicines
     WHERE lower(brand) = lower(?)
        OR lower(brand) LIKE '%' || lower(?) || '%'
     ORDER BY CASE WHEN lower(brand) = lower(?) THEN 0 ELSE 1 END, brand
     LIMIT 1`,
  ).get(normalized, normalized, normalized) ?? undefined;
}

export function findMentionedMedicine(message: string): Medicine | undefined {
  return db.query<Medicine, [string]>(
    `SELECT * FROM medicines
     WHERE instr(lower(?), lower(brand)) > 0
     ORDER BY length(brand) DESC
     LIMIT 1`,
  ).get(message) ?? undefined;
}

export function medicinesWithSameComposition(medicine: Medicine): Medicine[] {
  return db.query<Medicine, [string, string]>(
    `SELECT * FROM medicines
     WHERE normalized_composition = ? AND id != ? AND restricted = 0
     ORDER BY mrp ASC`,
  ).all(medicine.normalized_composition, medicine.id);
}

export function pricesFor(medicineId: string): Price[] {
  return db.query<Price, [string]>(
    `SELECT pharmacy, price,
            CASE WHEN source_type = 'kaggle_1mg_snapshot' THEN NULL ELSE eta_days END AS eta_days,
            CASE WHEN source_type = 'kaggle_1mg_snapshot' THEN NULL ELSE in_stock END AS in_stock,
            source_type
     FROM prices
     WHERE medicine_id = ? AND (in_stock = 1 OR source_type = 'kaggle_1mg_snapshot')
     ORDER BY price ASC`,
  ).all(medicineId);
}

export function healthInfoFor(medicineId: string): { side_effects: string; interactions: string } | undefined {
  return db.query<{ side_effects: string; interactions: string }, [string]>(
    "SELECT side_effects, interactions FROM health_info WHERE medicine_id = ?",
  ).get(medicineId) ?? undefined;
}

export function createAcknowledgedSession(id: string): void {
  const now = new Date().toISOString();
  db.query(
    "INSERT INTO sessions (id, disclaimer_acknowledged_at, created_at) VALUES (?, ?, ?)",
  ).run(id, now, now);
}

export function isAcknowledgedSession(id: string): boolean {
  return Boolean(db.query<{ id: string }, [string]>("SELECT id FROM sessions WHERE id = ?").get(id));
}
