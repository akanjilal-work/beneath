import { LIVE_KP_URL, LIVE_POLL_MS, LIVE_PROXY_URL } from "../config";
import { fetchKp, summariseKp, type KpSeries } from "../data/live";
import { $, h } from "./dom";

// NOAA directly, then the Worker's validated copy (refreshed every 15 minutes) if NOAA is down.
const SOURCES = [LIVE_KP_URL, ...(LIVE_PROXY_URL ? [new URL("live/kp.json", LIVE_PROXY_URL.replace(/\/?$/, "/")).toString()] : [])].filter(
  (u, i, all) => all.indexOf(u) === i,
);

const LEVEL_COLOUR = (kp: number) => (kp < 3 ? "var(--quiet)" : kp < 4 ? "var(--unsettled)" : kp < 5 ? "var(--active)" : "var(--storm)");

/** "Survey conditions today" badge. Polls only while the live overlay is on. */
export function createKpBadge() {
  const badge = $("kp-badge") as HTMLButtonElement;
  const text = badge.querySelector(".kp-text") as HTMLElement;
  const dialog = $("kp-dialog") as HTMLDialogElement;
  let series: KpSeries | null = null;
  let timer = 0;
  let failed = false;
  let loading = false;

  const render = () => {
    const s = series ? summariseKp(series) : null;
    if (!s) {
      badge.dataset.level = "";
      text.textContent = failed ? "Live feed unavailable" : "Survey conditions…";
      badge.setAttribute("aria-label", text.textContent);
      return;
    }
    badge.dataset.level = s.level;
    badge.dataset.stale = String(s.stale);
    text.textContent = `${s.label} · Kp ${s.kp.toFixed(1)}${s.stale ? " (stale)" : ""}`;
    badge.setAttribute("aria-label", `Survey conditions: ${s.label}, Kp ${s.kp.toFixed(1)}${s.stale ? ", data is stale" : ""}`);
  };

  const renderDialog = () => {
    const body = $("kp-body");
    const s = series ? summariseKp(series) : null;
    if (!series || !s) {
      body.replaceChildren(
        h(
          "p",
          null,
          loading || !failed
            ? "Loading the latest geomagnetic readings…"
            : "The live geomagnetic feed could not be reached just now. It is retried every few minutes, and again when you open this window.",
        ),
      );
      return;
    }
    const recent = series.points.slice(-24);
    const time = new Date(s.time);
    const parts: (HTMLElement | null)[] = [
      h(
        "p",
        null,
        h("strong", null, `${s.label}, Kp ${s.kp.toFixed(1)}. `),
        s.advice,
      ),
      h(
        "div",
        { class: "kp-chart", role: "img", "aria-label": `Kp over the last ${recent.length * 3} hours, latest ${s.kp.toFixed(1)}` },
        recent.map((p) =>
          h("div", { style: `height:${Math.max(2, (p.kp / 9) * 100)}%;background:${LEVEL_COLOUR(p.kp)}`, title: `${p.time.slice(0, 16).replace("T", " ")} UTC · Kp ${p.kp.toFixed(1)}` }),
        ),
      ),
      h("p", { class: "muted" }, `Last ${recent.length * 3} hours in 3-hour steps. Latest reading ${time.toUTCString().replace(":00 GMT", " UTC")}.`),
      s.stale ? h("p", { class: "callout" }, "The feed has not updated recently, so this may not reflect current conditions.") : null,
      h(
        "p",
        null,
        "Kp runs from 0 (calm) to 9 (extreme storm) and measures how much Earth's magnetic field is being disturbed by the solar wind. Magnetic surveys, like the ones behind the magnetic layer, pause when Kp is high because the disturbance swamps the signal from the rocks.",
      ),
      h("p", { class: "muted" }, `Source: ${series.source}, planetary K-index.`),
    ];
    body.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
  };

  const poll = async () => {
    loading = true;
    try {
      series = await fetchKp(SOURCES);
      failed = false;
    } catch {
      failed = true;
    }
    loading = false;
    render();
    if (dialog.open) renderDialog();
  };

  badge.addEventListener("click", () => {
    // Nothing to show yet after a failure: try again now rather than waiting for the next poll.
    if (!series && !loading) void poll();
    renderDialog();
    dialog.showModal();
  });

  return {
    setActive(on: boolean) {
      badge.hidden = !on;
      window.clearInterval(timer);
      if (on) {
        render();
        void poll();
        timer = window.setInterval(() => {
          if (!document.hidden) void poll();
        }, LIVE_POLL_MS);
      }
    },
  };
}
