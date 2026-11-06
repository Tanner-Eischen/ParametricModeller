# Parametric Modeler

A browser-based woodworking CAD editor with planar B-Rep geometry and editable
feature history. The verified release packages a deterministic frame example,
saved scene, cut lists and actual SVG/PDF/DXF shop drawings.

## Supported scope

Flat faces and sharp-edged prismatic solids are the supported geometry. Sketches,
extrudes/cuts, resizes, patterns, mirrors, transforms, planar booleans and existing
woodworking joints build on that model. Unsupported or nonplanar operations fail
with diagnostics. Triangles are a display representation; feature history and
component data remain the rebuild source of truth.

The release verifies core geometry, persistence, measurements and exports through
production APIs. The four-board browser workflow also has a recorded WebGL
acceptance pass: length editing, pointer Undo/Redo, scene download/import,
explicit recovery after reload, cut lists and SVG/PDF/DXF downloads. See the
[browser receipt](release/browser-qa-2026-11-05/final/README.md) for its scope.

## Install and verify

Node.js 22 is the tested profile. Use the lockfile:

```bash
npm ci
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

The Vitest 5 reporter uses the documented same-source non-regression floors:
51.8% branches, 63.5% functions, 63.6% lines and 62.5% statements. See the
[coverage migration](release/COVERAGE_MIGRATION.md) for the unchanged-source
comparison with the historical reporter. Primary CI runs the full core checks
and focused real-control frame browser regression. The broad legacy Playwright
suite remains a separate manual workflow and is not part of this acceptance.

To reproduce the focused browser check:

```bash
npx playwright install chromium
npx playwright test tests/e2e/frame-example-workflow.spec.ts
```

## Editable representative assembly

```bash
npm run export:portfolio-frame -- --out release/artifacts/my-frame-run
```

The thin sample CLI calls the production feature engine, component rebuilder,
serializer, measurements, cut-list and drawing exporters. It writes two labeled
states with fixed metadata dates:

- default18: four 18 x 3 x 0.75 in white-oak boards, outer 24 x 18 in, opening 18 x 12 in,
  total material volume 162 in3.
- edited20: source board length 20 in with derived instance placements updated;
  outer 26 x 20 in, opening 20 x 14 in, total material volume 180 in3.

The source definition is not an extra manufactured board. Both states contain
four physical instances, one cut-list group of quantity 4, stable IDs and editable
feature history. The bounded sample edit helper updates the board feature and its
placements together; it does not add a general assembly constraint solver.

Each state has frame.json, cut-list JSON/CSV, and drawing JSON/SVG/PDF/DXF in inches
and millimetres. Finished default board dimensions are 457.2 x 76.2 x 19.05 mm. Declared
stock allowances add 0.5/0.25/0.125 in to length/width/thickness, yielding
18.5x3.25x0.875in stock. The material/grain directions and actual exported numbers
are verified against independent expected dimensions, not file signatures alone.

`examples/white-oak-frame.scene.json` is the saved default scene. Rebuild it after
save/load to inspect the same four bodies. Source geometry comes from the feature
record rather than saved display meshes.

In the editor, choose **Frame example** from the welcome screen or File/Commands.
Change **Frame board length (in)** to 20 and click **Apply frame length**. Use
**Download scene JSON** for a portable copy and **Import scene JSON** to reopen it.
The imported copy is available through **Recent files** after a browser reload
while local storage is available. Reload starts an empty editor; recovery is an
explicit action. Keep the downloaded file as the durable copy.

The helper derives the example's placements and manufacturing tags together.
Independent per-instance material overrides and arbitrary instance rotations
are outside this verified workflow. Historical export packets are immutable;
choose a fresh output directory when source or evidence has changed.

## Versioned static web release

```bash
npm run release:web
```

This builds dist, preserves actual production-dependency notices, then produces
the existing versioned ZIP, manifest and SHA256 checksum in release/artifacts.
The package is a static web distribution, not a native installer. Fixed source
inputs are checked for deterministic packaging. No hosting or deployment is run.

Optional editor development remains `npm run dev`. Browser evidence covers this
bounded frame workflow on the tested desktop viewports, not every CAD operation
or mobile interaction.

## Deliberate limits and licensing metadata

Curved CAD, automatic geometry repair and broader CAD expansion are deferred.
The sample demonstrates one bounded woodworking workflow. Geometry measurements
and stock quantities are software calculations, not a structural certification.
The repository currently declares no project license; this release does not
invent one. Actual installed third-party license/notice texts are preserved in
the static artifact and owner bundle without granting a license for project code.

See release/README.md for archive details and plans/README_INDEX.md for the broader
historical roadmap. Browser receipts and core test results are recorded separately.
