// Extrude Feature module (Milestone 02)

export {
  EXTRUDE_FEATURE_TYPE,
  defaultExtrudeParams,
  validateExtrudeParams,
  rebuildExtrude,
  createExtrudeFeature,
  updateExtrudeDistance,
  updateExtrudeFlip,
  getExtrudeParams,
  type ExtrudeParams,
} from './ExtrudeFeature';

export {
  buildPrism,
  validatePrismParams,
  buildRectangularPrism,
  type PrismParams,
} from './PrismBuilder';
