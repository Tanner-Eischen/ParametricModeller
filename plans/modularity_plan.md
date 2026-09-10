# App.ts Modularity Plan

## Status Update

**Phase 1 COMPLETE:** WoodworkingController extracted (~120 lines)
- `resolveWoodworkingMetadata()` - metadata inheritance through component instances
- `transformWoodworkingAxes()` - axis transformations for rotate/mirror features
- `getCutListParts()` - parts collection for export
- `formatLengthInput()` / `getUnit()` - unit formatting helpers
- `getMeasurementResultFields()` - measurement panel field formatting
- `formatPinnedMeasurement()` - status message formatting

**New file:** `src/app/WoodworkingController.ts`

---

## Remaining Clusters

### Phase 2: Context Task & Preview Hub (Complex - Deferred)

**Location:** App.ts ~2547-3438 + 5440-5665 (~1,200 lines)

**Complexity:** High - preview lifecycle (commitFeaturePreview, finalizeIndependentCopy, cancelFeaturePreview) directly manipulates many shared App fields:
- `this.features[]`
- `this.featurePreviewTransaction`
- `this.rebuiltBodiesByFeature`
- `this.bodyPresentations`
- `this.woodJointDraft`
- `this.measurementSession`, `this.measurementState`

This requires ~20+ callback injections for reads/writes. The preview code also coordinates with gizmos, eventBus, and woodworking metadata.

**Recommendation:** Defer until tool flows are simplified or extract only the context-task panel rendering portion (~2540-2640).

**Location:** App.ts ~1149-1493 (~344 lines)

**Responsibilities:**
- `registerCommandActions()` - command toolbar bindings
- `registerKeyboardBindings()` - key-to-command mapping  
- `evaluateCommandAvailability()` - toolbar button enable/disable logic

**Key shared reads (via callbacks):**
- `selection.activeId: string`
- `selectedEdgeRef / selectedFace / selectedVertexRef`
- `features: FeatureRecord[]`
- `sketchModeController.isActive: boolean`
- `getStableOwnerIdForBody()`, `getExplicitBodyTarget()`

**Note:** Mechanical extraction with read-only dependencies. Good next step.

---

### Phase 3: Context Task & Preview Session Hub (After A1 copy-independence)

**Location:** App.ts ~2547-3438 + 5440-5665 (~1,200 lines)

**Responsibilities:**
- `contextTaskPanel.refreshState()` - dynamic panel rendering
- Preview session lifecycle (move-copy, rotate, push-pull, placement, mate)
- `commitFeaturePreview()`, `cancelFeaturePreview()`

**Note:** Touches most shared state. Extract after tool flows are verified.

---

## Verification

After each phase:
- `npm run check` (lint + typecheck + build + unit tests)
- `npm run test:e2e` after tool-related phases

---

## Progress

| Phase | Concern | Lines Extracted | Status |
|-------|---------|-----------------|--------|
| - | PanelChrome | ✅ | Previously done |
| - | GizmoManager | ✅ | Previously done |
| - | ModelBrowserController | ✅ | Previously done |
| 1 | Woodworking Metadata | ~120 | ✅ **Done** |
| 2 | Command/Keyboard | ~344 | Ready |
| 3 | Context/Preview Hub | ~1,200 | Pending |

**Total progress:** ~235 lines (pre) + ~120 lines = ~355 lines (~4% of 9,285)

---

## Next Step Recommendation

Proceed with **Phase 2: Command/Keyboard Registry** - it's mechanical, read-only, and doesn't require waiting for other changes.
