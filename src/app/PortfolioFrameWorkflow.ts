import type { Document } from '../types';
import { getBodyBoundingBox, type Body } from '../geometry';
import {
  PORTFOLIO_FRAME_IDS,
  editPortfolioFrameLength,
  rebuildPortfolioFrameDocument,
} from '../examples/portfolioFrame';

export interface PortfolioFrameState {
  length: number;
  bodyCount: number;
  bounds: [number, number, number];
  error: string | null;
}

/** Identify this authored example, without treating arbitrary assemblies as it. */
export function hasPortfolioFrameSource(document: Document): boolean {
  return document.features.some(feature => feature.id === PORTFOLIO_FRAME_IDS.sourceFeature);
}

function validateFrameHistory(document: Document): void {
  const expectedInstances = new Set<string>([
    PORTFOLIO_FRAME_IDS.bottom, PORTFOLIO_FRAME_IDS.top,
    PORTFOLIO_FRAME_IDS.left, PORTFOLIO_FRAME_IDS.right,
  ]);
  const component = document.components[0];
  if (
    document.features.length !== 1
    || document.features[0]?.id !== PORTFOLIO_FRAME_IDS.sourceFeature
    || document.components.length !== 1
    || component?.id !== PORTFOLIO_FRAME_IDS.component
    || component.featureIds.length !== 1
    || component.featureIds[0] !== PORTFOLIO_FRAME_IDS.sourceFeature
    || component.bodyIds.length !== 1
    || component.bodyIds[0] !== PORTFOLIO_FRAME_IDS.sourceBody
    || document.componentInstances.length !== 4
    || document.componentInstances.some(instance =>
      !expectedInstances.delete(instance.id) || instance.componentId !== PORTFOLIO_FRAME_IDS.component)
    || expectedInstances.size !== 0
    || document.constraints.length !== 0
  ) {
    throw new Error('Frame length controls require the original four-board example history. Load the frame example to reset it.');
  }
}

export function inspectPortfolioFrame(
  document: Document,
  displayedBodies?: readonly Body[],
): PortfolioFrameState | null {
  if (!hasPortfolioFrameSource(document)) return null;
  const length = document.features.find(feature => feature.id === PORTFOLIO_FRAME_IDS.sourceFeature)?.parameters.width;
  try {
    validateFrameHistory(document);
    const result = rebuildPortfolioFrameDocument(document);
    if (!result.ok) throw new Error(result.error ?? 'Frame rebuild failed');
    const bodies = displayedBodies ?? result.bodies;
    if (bodies.length !== 4) throw new Error('The frame must rebuild to four physical boards.');
    const boxes = bodies.map(getBodyBoundingBox);
    const bounds = [0, 1, 2].map(axis =>
      Math.max(...boxes.map(box => box.max[axis]!)) - Math.min(...boxes.map(box => box.min[axis]!))) as [number, number, number];
    if (!bounds.every(Number.isFinite)) throw new Error('Frame bounds are unavailable.');
    return { length: length as number, bodyCount: bodies.length, bounds, error: null };
  } catch (error) {
    return {
      length: typeof length === 'number' ? length : 0,
      bodyCount: displayedBodies?.length ?? 0,
      bounds: [0, 0, 0],
      error: error instanceof Error ? error.message : 'Frame controls are unavailable.',
    };
  }
}

/** This bounded edit derives the example's placements; it is not a general solver. */
export function resizePortfolioFrame(document: Document, length: number): Document {
  validateFrameHistory(document);
  return editPortfolioFrameLength(document, length);
}
