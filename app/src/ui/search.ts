import { placeLabel, type Gazetteer, type Place } from "../data/gazetteer";
import { formatLatLon, parseLatLon } from "../lib/geo";
import { $, h } from "./dom";

interface Result {
  label: string;
  note: string;
  lat: number;
  lon: number;
}

/** Search box: bundled gazetteer plus direct "lat, lon" input, as an accessible combobox. */
export function setupSearch(getGazetteer: () => Gazetteer | null, onChoose: (lat: number, lon: number) => void) {
  const input = $("search-input") as HTMLInputElement;
  const list = $("search-results") as HTMLUListElement;
  let results: Result[] = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  const choose = (r: Result) => {
    input.value = r.label;
    close();
    input.blur();
    onChoose(r.lat, r.lon);
  };

  const render = () => {
    if (!results.length) return close();
    list.replaceChildren(
      ...results.map((r, i) => {
        const li = h(
          "li",
          { id: `search-opt-${i}`, role: "option", "aria-selected": String(i === active) },
          h("span", null, r.label),
          h("small", null, r.note),
        );
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          choose(r);
        });
        return li;
      }),
    );
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", `search-opt-${active}`);
    else input.removeAttribute("aria-activedescendant");
  };

  const update = () => {
    const q = input.value;
    const ll = parseLatLon(q);
    results = [];
    if (ll) results.push({ label: formatLatLon(ll.lat, ll.lon), note: "coordinates", ...ll });
    const gaz = getGazetteer();
    if (gaz) {
      results.push(
        ...gaz.search(q, 8).map((p: Place) => ({
          label: placeLabel(p),
          note: p.pop >= 1e6 ? `${(p.pop / 1e6).toFixed(1)}M people` : p.pop ? `${Math.round(p.pop / 1000)}k people` : "",
          lat: p.lat,
          lon: p.lon,
        })),
      );
    }
    active = results.length ? 0 : -1;
    render();
  };

  input.addEventListener("input", update);
  input.addEventListener("focus", () => input.value && update());
  input.addEventListener("blur", () => setTimeout(close, 100));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && results.length) {
      active = (active + 1) % results.length;
      render();
      e.preventDefault();
    } else if (e.key === "ArrowUp" && results.length) {
      active = (active - 1 + results.length) % results.length;
      render();
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (active >= 0 && results[active]) choose(results[active]);
      e.preventDefault();
    } else if (e.key === "Escape") {
      close();
      input.blur();
    }
  });
}
