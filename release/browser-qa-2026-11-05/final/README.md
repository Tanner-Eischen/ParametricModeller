# Four-board frame browser acceptance

Tested on November 6, 2026 against the version 0.2.1 production Vite build,
served locally over HTTP in Chromium with real WebGL rendering. The parent
directory names the run that began November 5. These are final, post-fix receipts.

The visible workflow passed: load the Frame example, change length 18 -> 20 in,
use the pointer Undo and Redo buttons, reject length 6 without adding history,
download scene JSON, create an empty document, import the actual downloaded
file, reload, and explicitly restore it through Recent files. Feature history,
four instance IDs and manufacturing metadata survive the roundtrip. Selecting
a board reports 20 x 3 x 0.75 in; Escape clears selection. Rebuild, named camera
views, orbit, reset and fit retain the frame.

Real UI downloads are preserved here. Rebuilding `edited20-scene.json` through
the production engine independently confirms four physical boards, outer
26 x 20 x 0.75 in, opening 20 x 14 in and 180 cubic inches of material.
`edited20-cut-list.csv` has all four board names, quantity 4, finished
20 x 3 x 0.75 in and stock 20.5 x 3.25 x 0.875 in. Actual SVG, decoded PDF content
streams and DXF text contain the 26, 20 and 0.75 in dimension labels. DXF declares
inch units (`$INSUNITS=1`). These checks inspect file contents, not extensions.

`ui-checks.json` records observed states. `artifact-verification.json` binds raw
download/screenshot hashes and LF-canonicalized application-source hashes to the
verified numerical results. `frame20-final.png` shows the rendered result and
length controls. `top-view.png`, `orbit-view.png` and `narrow-900.png` preserve
view checks. The 900 x 700 editor had no document-width overflow and both length
controls fit the viewport; the main acceptance used 1280 x 720.

Three browser findings were fixed and regression-tested: stale disabled Undo
after a frame edit, loss of per-instance names/part numbers in the UI cut list,
and missing immediate recovery snapshots for portable imports. Malformed JSON
reports an import error while preserving the current frame; the intentional
serializer error is not a renderer failure.

Local final core validation passed 1,171 tests in 143 files, lint, typecheck and
production build. Vitest 5 coverage was 52.8% branches, 64.51% functions,
63.45% statements and 64.64% lines, above the documented same-source floors.
The focused Playwright regression runs in primary CI. Its CI result must be
checked separately from this interactive acceptance; the broad legacy browser
suite was not run for this signoff.

Limits: reload begins with an empty editor; Recent files recovery requires
available browser local storage. Downloaded JSON remains the durable copy.
This validates the authored frame's coordinated length edit, not a general
constraint solver. Independent instance metadata overrides and arbitrary
instance transforms are outside the acceptance. Mobile and unrelated CAD tools
remain unverified. No structural or manufacturing certification is implied.
