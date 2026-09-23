# 04. UI and interaction design

## Design intent

Calm, scientific, and immediately touchable. The globe is the interface. Controls stay out of the way until needed.

## Layout (desktop)

```
+--------------------------------------------------------------+
|  BENEATH        [ search place or lat,lon ]      [2D|3D] [?] |
+------+-------------------------------------------+-----------+
|      |                                           |           |
| L    |                                           |  CLICK    |
| A    |               GLOBE                       |  CARD     |
| Y    |                                           |  (opens   |
| E    |                                           |  on       |
| R    |                                           |  click)   |
| S    |                                           |           |
+------+-------------------------------------------+-----------+
|  SURFACE ---o------------------------------ MANTLE   legend  |
|  depth slider                                 + attribution  |
+--------------------------------------------------------------+
```

## Layout (mobile)

- Globe full screen
- Layers as a bottom sheet (collapsed to a pill)
- Depth slider pinned above the bottom sheet
- Click card as a bottom sheet that replaces the layers sheet while open

## Core interactions

### Depth slider

A metaphor over layer ordering, not true depth. Stops:

1. Surface (base imagery)
2. Magnetic
3. Gravity
4. Plates
5. Deep time (v2, reveals the time slider)

Between stops, the two adjacent layers cross-fade. At most two data layers are visible at once.

### Click card

Opens on click or tap. Contents, top to bottom:

1. Place name (reverse lookup from a bundled gazetteer, no external API) and coordinates
2. Headline sentence, for example "Strong positive magnetic anomaly. Often linked to iron-rich rocks."
3. Value rows: magnetic (nT), gravity (mGal), plate, nearest boundary type and distance
4. Nearby deposits (up to 5) with commodity chips
5. "Why this matters" expandable section
6. Copy link to this point

### Search

Place names from the bundled gazetteer plus direct lat,lon input. Flies the camera and opens the click card.

### Share

Every change updates the URL hash:

```
#lat=43.55&lon=-80.25&alt=900000&d=1&layers=deposits,boundaries,coastlines,live&ramp=diverging&pick=43.55,-80.25
```

`d` is the depth slider position (0 Surface, 1 Magnetic, 2 Gravity, 3 Plates; fractions cross-fade). `layers` lists the overlays. Optional: `relief=0`, `mode=2d`, `theme=light`. Links in the earlier form (`layers=mag`) still open on the matching depth stop.

## Visual language

- **Theme:** dark by default, light option. Near-black blue background, low-glare UI surfaces.
- **Typography:** one sans family for UI, tabular figures for values.
- **Colour ramps:** perceptually uniform only.
  - Magnetic anomaly: diverging ramp centred on 0 nT (blue negative, red positive)
  - Gravity anomaly: diverging ramp centred on 0 mGal, using a different hue pair from magnetic
  - Deposits: symbol by status, colour by primary commodity group
- **Legend:** always visible when a data layer is on. Shows units, range and source.
- **Motion:** slow auto-rotate on first load, stops on first interaction. Respects `prefers-reduced-motion`.

## Accessibility

- All controls keyboard reachable, with visible focus rings
- Colour ramps tested for common colour-vision deficiencies
- Click card content available to screen readers as text
- Minimum 44 px touch targets

## Tone of copy

Plain language first, units second. Honest about uncertainty and data age. Always states that the site is educational and not an exploration or investment tool.
