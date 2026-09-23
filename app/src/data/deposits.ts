import { haversineKm } from "../lib/geo";

export interface DepositSource {
  id: string;
  name: string;
  licence?: string;
  url?: string;
  legacy?: boolean;
}

export interface DepositsFile {
  fields: string[];
  statusValues: string[];
  rows: [number, number, string, string, number, number, string][];
  sources: DepositSource[];
}

export interface Deposit {
  index: number;
  lon: number;
  lat: number;
  name: string;
  commodities: string[];
  status: string;
  statusIndex: number;
  source: DepositSource;
  sourceId: string;
  group: CommodityGroup;
}

export interface CommodityGroup {
  key: string;
  label: string;
  colour: string;
}

// Colour by primary commodity group. Tokens cover MRDS codes and common spelled-out names.
export const COMMODITY_GROUPS: (CommodityGroup & { match: string[] })[] = [
  { key: "precious", label: "Gold, silver, PGM", colour: "#f5c542", match: ["AU", "AG", "PT", "PD", "PGE", "PGM", "GOLD", "SILVER", "PLATINUM", "PALLADIUM", "RH", "IR", "OS", "RU"] },
  { key: "base", label: "Copper, lead, zinc, nickel", colour: "#e07a5f", match: ["CU", "PB", "ZN", "NI", "COPPER", "LEAD", "ZINC", "NICKEL", "SN", "TIN", "CD", "HG", "SB", "BI", "AS"] },
  { key: "iron", label: "Iron and alloy metals", colour: "#b56576", match: ["FE", "MN", "CR", "TI", "V", "CO", "MO", "W", "IRON", "MANGANESE", "CHROMIUM", "TITANIUM", "VANADIUM", "COBALT", "MOLYBDENUM", "TUNGSTEN", "NB", "TA"] },
  { key: "battery", label: "Lithium, graphite, REE", colour: "#56cfe1", match: ["LI", "GRAPHITE", "REE", "RE", "LITHIUM", "BE", "CS", "Y", "LA", "CE", "ND", "RARE"] },
  { key: "energy", label: "Uranium and coal", colour: "#80ed99", match: ["U", "TH", "URANIUM", "COAL", "THORIUM"] },
  { key: "industrial", label: "Industrial minerals", colour: "#c9b8ff", match: [] },
];

function groupFor(commodities: string[]): CommodityGroup {
  const first = commodities[0]?.toUpperCase().replace(/[^A-Z]/g, "") ?? "";
  for (const g of COMMODITY_GROUPS) {
    if (g.match.some((m) => first === m || (m.length > 3 && first.startsWith(m)))) return g;
  }
  return COMMODITY_GROUPS[COMMODITY_GROUPS.length - 1];
}

/** 1-degree bucket index for fast radius queries. */
export class DepositIndex {
  deposits: Deposit[];
  private buckets = new Map<number, number[]>();

  constructor(file: DepositsFile) {
    this.deposits = file.rows.map((r, index) => {
      const commodities = (r[3] || "").split(";").map((c) => c.trim()).filter(Boolean);
      return {
        index,
        lon: r[0],
        lat: r[1],
        name: r[2] || "Unnamed site",
        commodities,
        statusIndex: r[4],
        status: file.statusValues[r[4]] ?? "unknown",
        source: file.sources[r[5]] ?? { id: "unknown", name: "Unknown source" },
        sourceId: r[6],
        group: groupFor(commodities),
      };
    });
    for (const d of this.deposits) {
      const key = this.key(Math.floor(d.lon), Math.floor(d.lat));
      let list = this.buckets.get(key);
      if (!list) this.buckets.set(key, (list = []));
      list.push(d.index);
    }
  }

  private key(ix: number, iy: number): number {
    return (((ix % 360) + 360) % 360) * 1000 + (iy + 90);
  }

  near(lon: number, lat: number, radiusKm: number, limit: number): { deposit: Deposit; distanceKm: number }[] {
    const dLat = Math.ceil(radiusKm / 111) + 1;
    const cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const dLon = Math.min(180, Math.ceil(radiusKm / (111 * cos)) + 1);
    const found: { deposit: Deposit; distanceKm: number }[] = [];
    const ix0 = Math.floor(lon);
    const iy0 = Math.floor(lat);
    for (let iy = Math.max(-90, iy0 - dLat); iy <= Math.min(89, iy0 + dLat); iy++) {
      for (let ix = ix0 - dLon; ix <= ix0 + dLon; ix++) {
        const list = this.buckets.get(this.key(ix, iy));
        if (!list) continue;
        for (const i of list) {
          const d = this.deposits[i];
          const dist = haversineKm(lat, lon, d.lat, d.lon);
          if (dist <= radiusKm) found.push({ deposit: d, distanceKm: dist });
        }
      }
    }
    // Producers first when distances are similar, then by distance.
    found.sort((a, b) => a.distanceKm - b.distanceKm);
    return found.slice(0, limit);
  }
}

export function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
