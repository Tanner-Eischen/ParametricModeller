# Frame workflow acceptance

Scope: the prepared four-board example, its explicit length/layout edit, scene
persistence and real manufacturing exports. This is not signoff for every CAD
operation or a general assembly constraint solver.

Functional and visual checks use the same inventory. Interactions must use
visible application controls; downloaded artifacts supply independent numerical
checks. A test that injects application state does not establish this workflow.

| Check | Initial, changed and restored state | Evidence |
| --- | --- | --- |
| Start example | Empty editor -> Frame example -> four rendered boards | Real WebGL screenshot; visible part count and bounds |
| Select a board | Frame -> selection/properties -> cleared selection | Visible selection/feature controls |
| Edit frame length | 18 in -> 20 in, four parts retained; outer bounds 24x18 -> 26x20 in | Visible bounds; saved JSON and exports |
| Undo/redo | Edited20 -> default18 -> edited20 | Length/layout restored together |
| Rebuild and view | Edited frame -> fit/reset/orbit -> inspect frame | Actual rendered geometry, no renderer error |
| Save and reopen | Download scene JSON -> empty/new document -> import downloaded scene | Real file bytes; feature history, instances and IDs retained |
| Browser reload | Saved/reopened scene -> reload | Supported autosave/recovery state, with any limits stated |
| Cut list | Whole frame -> CSV | Four physical boards, correct length/units/material/allowances |
| Shop drawings | Whole frame -> SVG, PDF, DXF | Real downloaded files, independent dimensions and units |
| Invalid edit | Edited20 -> length <=6 or invalid value -> error, unchanged frame | No invalid geometry or accidental history entry |
| Bad import | Valid frame -> malformed JSON -> error, unchanged frame | Failed load cannot replace good document |
| Viewport fit | Desktop and supported narrow editor width | Primary controls and status reachable; no clipped fixed shell |

After the intended workflow, explore normal controls briefly for stale selection,
export scope, panel visibility and failure recovery. Add any discovered state to
the recorded acceptance evidence before signoff.

Existing evidence packets remain immutable. New source-bound exports and browser
receipts use fresh run-owned directories. Publication must distinguish the
headless geometry checks, actual browser interactions and remaining unsupported
operations.
