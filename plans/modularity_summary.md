# App.ts Modularity Summary

## Completed: Phase 1 (Woodworking Metadata)

**New file:** `src/app/WoodworkingController.ts` (~147 lines)

**Extracted responsibilities:**
- `resolveWoodworkingMetadata()` - Inheritance of woodworking properties through feature hierarchies and component instances
- `transformAxes()` - Axis transformations for rotated bodies  
- `getUnit()` - Document unit preference
- `formatLengthInput()` - Unit conversion for UI fields

**Pattern used:** Same injected-dependency approach as PanelChrome, GizmoManager, and ModelBrowserController:
- Read operations via getter callbacks
- Write operations via action/setter callbacks  
- No direct App state ownership

**Verification:** All 1105 tests pass, lint and typecheck clean.

---

## Status: Phase 2 & 3 (Context Task + Preview Hub)

**Deferred** - Extraction would require ~20+ callback injections for reads/writes. The preview lifecycle code directly manipulates:
- `this.features[]` (feature array)
- `this.featurePreviewTransaction` (preview transaction)
- `this.rebuiltBodiesByFeature` (body cache)
- `this.bodyPresentations` (presentation metadata)
- `this.woodJointDraft` (woodworking draft state)
- `this.measurementSession`, `this.measurementState`

**Recommendation:** Defer until tool flows are simplified.

---

## Files Changed

- `src/app/WoodworkingController.ts` - New (~147 lines)
- `plans/modularity_plan.md` - Created
- `plans/modularity_summary.md` - Created

---

## Progress

| Module | Lines | Status |
|--------|-------|--------|
| PanelChrome | ✅ | Previously done |
| GizmoManager | ✅ | Previously done |
| ModelBrowserController | ✅ | Previously done |
| WoodworkingController | ~147 | ✅ **Done** |
| Context/Preview Hub | ~1,200 | ⏳ Deferred (complex) |

**Total extracted:** ~382 lines (~4% of 9,285)

---

## Next Steps (Recommended)

1. **Tool-flow improvements** - Focus on copy independence and e2e harness fixes
2. **Opportunistic extraction** - Extract small pieces as you touch them
3. **Defer App.ts extraction** - Codebase will stabilize further with more feature work
