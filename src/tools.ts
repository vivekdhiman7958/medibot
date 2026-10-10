import {
  findMedicine,
  healthInfoFor,
  medicinesWithSameComposition,
  pricesFor,
  type Medicine,
} from "./db";
import { findRestrictedMatch, REQUIRED_RESTRICTED_MESSAGE } from "./safety";
import { allRestrictedTerms } from "./db";

export type ToolName = "get_composition" | "find_alternatives" | "compare_prices" | "get_drug_info";

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

const lookupMedicine = (search: string): Medicine | string => {
  const restricted = findRestrictedMatch(search, allRestrictedTerms());
  if (restricted) return REQUIRED_RESTRICTED_MESSAGE;
  const medicine = findMedicine(search);
  if (!medicine) return `I couldn't find "${search}" in the local medicine catalogue.`;
  if (medicine.restricted) return REQUIRED_RESTRICTED_MESSAGE;
  return medicine;
};

export function runTool(name: ToolName, args: Record<string, unknown>): { result: string; blocked: boolean } {
  const search = typeof args.medicine_name === "string" ? args.medicine_name.trim() : "";
  if (!search || search.length > 100) return { result: "A valid medicine name is required.", blocked: false };
  const lookup = lookupMedicine(search);
  if (typeof lookup === "string") {
    return { result: lookup, blocked: lookup === REQUIRED_RESTRICTED_MESSAGE };
  }
  const medicine = lookup;

  if (name === "get_composition") {
    return {
      result: JSON.stringify({
        brand: medicine.brand,
        composition: medicine.composition,
        manufacturer: medicine.manufacturer,
        pack_size: medicine.pack_size || null,
        note: medicine.data_source === "kaggle_1mg_snapshot"
          ? "The Kaggle CSV does not provide a verified active composition or manufacturer."
          : null,
      }),
      blocked: false,
    };
  }

  if (name === "find_alternatives") {
    const alternatives = medicine.normalized_composition.startsWith("unverified:")
      ? []
      : medicinesWithSameComposition(medicine).map((alternative) => {
          const prices = pricesFor(alternative.id);
          return {
            brand: alternative.brand,
            composition: alternative.composition,
            mrp: alternative.mrp,
            lowest_demo_price: prices[0]?.price ?? null,
          };
        });
    return {
      result: JSON.stringify({
        source_note: medicine.normalized_composition.startsWith("unverified:")
          ? "The source data does not provide verified compositions, so exact-composition alternatives cannot be confirmed."
          : "Alternatives are included only when the stored active composition and strength match exactly.",
        doctor_or_pharmacist_note: "Confirm any substitution with a doctor or pharmacist.",
        alternatives,
      }),
      blocked: false,
    };
  }

  if (name === "compare_prices") {
    return {
      result: JSON.stringify({
        brand: medicine.brand,
        pack_size: medicine.pack_size || null,
        prices: pricesFor(medicine.id),
        source_note: medicine.data_source === "kaggle_1mg_snapshot"
          ? "Price values are from the downloaded 1mg Kaggle CSV snapshot. They are not live offers; stock and delivery ETA were not provided. Source price/MRP labels have not been independently verified."
          : "Simulated demonstration prices; not live pharmacy offers.",
      }),
      blocked: false,
    };
  }

  const info = healthInfoFor(medicine.id);
  return {
    result: JSON.stringify({
      brand: medicine.brand,
      information: info ?? null,
      note: "General information only; not a diagnosis or treatment recommendation. Consult a healthcare professional.",
    }),
    blocked: false,
  };
}
