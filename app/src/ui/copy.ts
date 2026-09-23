// Plain-language text for the click card. Units come second; uncertainty is stated.

export interface Reading {
  headline: string;
  strength: number; // 0..1, how remarkable the reading is (used to pick the card headline)
  why: string;
}

export function describeMagnetic(nT: number): Reading {
  const a = Math.abs(nT);
  const why =
    "Magnetic anomalies come from rocks that carry more or less magnetite than their surroundings. Iron-rich rocks such as basalt, banded iron formations and some ore bodies stand out as highs. Near the magnetic equator the same rock can show up as a low, so the sign alone is not proof of rock type.";
  if (a < 25)
    return {
      headline: "Magnetically quiet. The rocks here have little magnetic contrast, often thick sediment or uniform crust.",
      strength: 0.1,
      why,
    };
  if (nT > 0) {
    if (a < 100)
      return {
        headline: "Moderate positive magnetic anomaly. Often linked to rocks with some magnetite, such as basalt or gneiss.",
        strength: 0.45,
        why,
      };
    if (a < 300)
      return { headline: "Strong positive magnetic anomaly. Often linked to iron-rich rocks.", strength: 0.75, why };
    return {
      headline: "Very strong positive magnetic anomaly. Typical of iron-rich rocks such as iron formations or large mafic intrusions.",
      strength: 0.95,
      why,
    };
  }
  if (a < 100)
    return {
      headline: "Moderate negative magnetic anomaly. Can mark weakly magnetic rocks, or rocks magnetised when Earth's field was reversed.",
      strength: 0.45,
      why,
    };
  return {
    headline: "Strong negative magnetic anomaly. Often the low side of a strong magnetic body, or rocks magnetised in a reversed field.",
    strength: 0.75,
    why,
  };
}

export function describeGravity(mGal: number): Reading {
  const a = Math.abs(mGal);
  const why =
    "Gravity anomalies show where there is more or less mass beneath the surface than a smooth Earth would have. Dense rock, mountain roots and cold sinking slabs pull a little harder; thick sediment, light crust and deep water pull less. These are free-air values, so high mountains and deep trenches dominate.";
  if (a < 30)
    return { headline: "Near-normal gravity. The mass beneath this point is close to balanced.", strength: 0.1, why };
  if (mGal > 0) {
    if (a < 100)
      return {
        headline: "Moderate positive gravity anomaly. There is extra mass below, such as dense rock or unbalanced topography.",
        strength: 0.4,
        why,
      };
    return {
      headline: "Strong positive gravity anomaly. Typical of high mountains, volcanic islands or very dense rock close to the surface.",
      strength: 0.8,
      why,
    };
  }
  if (a < 100)
    return {
      headline: "Moderate negative gravity anomaly. A mass deficit, often thick sediment or light crust.",
      strength: 0.4,
      why,
    };
  return {
    headline: "Strong negative gravity anomaly. Typical of deep ocean trenches, where one plate bends down beneath another.",
    strength: 0.85,
    why,
  };
}

export function describeBoundary(label: string, distanceKm: number): Reading | null {
  if (distanceKm > 150) return null;
  return {
    headline: `About ${Math.round(distanceKm)} km from a ${label.toLowerCase()}, one of the edges of Earth's tectonic plates.`,
    strength: distanceKm < 50 ? 0.7 : 0.5,
    why: "",
  };
}

export const PLATES_WHY =
  "Earth's outer shell is broken into about fifty rigid plates that move a few centimetres a year. Most earthquakes, volcanoes and mountain belts sit along their edges. Plate outlines here follow the PB2002 model (Bird, 2003).";

export const DEPOSITS_WHY =
  "Deposit points come from government inventories. Many records are decades old and the global dataset is no longer updated. A mapped deposit does not mean anything is economic to mine today.";

export function formatValue(v: number, units: string, digits = 0): string {
  if (!Number.isFinite(v)) return "No data";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(digits)} ${units}`;
}

export function formatDistance(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`;
}
