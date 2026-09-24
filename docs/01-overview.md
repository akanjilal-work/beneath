# 01. Overview and scope

## One-line pitch

Rotate the Earth, peel back the surface, and see what is underneath any point on the planet.

## Why this exists

Public geophysical data (magnetic, gravity, geology, deposits) is excellent but locked in GIS formats and portals built for specialists. Beneath makes it explorable by anyone in a browser, with no login and no install.

## Target users

- Curious general public (primary traffic driver)
- Geoscience and mining students
- Exploration professionals wanting a fast visual overview
- Educators who want shareable links to specific views

## In scope (v1)

- 3D globe with 2D map toggle
- Magnetic anomaly layer (global)
- Gravity anomaly layer (global)
- Mineral deposit points (Canada first, global legacy data second)
- Tectonic plate boundaries
- Earthquakes at their true depth (see-beneath mode) and cross-sections
- Click card: plain-language summary of any point
- Full view state in the URL for sharing

## Later (v2+)

- Live geomagnetic conditions layer
- Deep-time slider with plate reconstructions
- Optional AI narration of the click card
- Additional regions with rich deposit data

## Out of scope

- Any use as a professional exploration or investment tool. The site is educational and says so.
- User accounts, uploads or saved workspaces
- Server-side compute at runtime

## Success criteria for v1

- Loads to an interactive globe in under 4 seconds on a mid-range laptop
- Click card responds in under 300 ms with no backend call
- Works on mobile in landscape and portrait
- Every layer has visible attribution and licence
