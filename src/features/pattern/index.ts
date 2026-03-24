/**
 * Pattern Features - Linear Pattern, Mirror, and Duplicate
 * Milestone 05: Patterning
 */

// Linear Pattern
export {
  type LinearPatternParams,
  defaultLinearPatternParams,
  LINEAR_PATTERN_FEATURE_TYPE,
  validateLinearPatternParams,
  rebuildLinearPattern,
  createLinearPatternFeature,
  updateLinearPatternCount,
  updateLinearPatternSpacing,
  updateLinearPatternDirection,
  updateLinearPatternSymmetric,
  getLinearPatternParams,
} from './LinearPatternFeature';

// Mirror
export {
  type MirrorParams,
  defaultMirrorParams,
  MIRROR_FEATURE_TYPE,
  validateMirrorParams,
  rebuildMirror,
  createMirrorFeature,
  updateMirrorPlaneRef,
  getMirrorParams,
} from './MirrorFeature';

// Duplicate
export {
  type DuplicateParams,
  defaultDuplicateParams,
  DUPLICATE_FEATURE_TYPE,
  validateDuplicateParams,
  rebuildDuplicate,
  createDuplicateFeature,
  updateDuplicateTranslation,
  getDuplicateParams,
} from './DuplicateFeature';

// Re-export from features index for convenience
export { createDuplicateFeature as createDuplicate } from './DuplicateFeature';
