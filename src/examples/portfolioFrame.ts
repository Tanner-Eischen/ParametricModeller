/**
 * One bounded, editable square-butt frame example. Feature history is the source
 * of geometry; the component definition is not a fifth manufactured board.
 *
 * editPortfolioFrameLength explicitly updates this example's placements. This
 * is not a claim of automatic UI constraint propagation or a general solver.
 */
import {
  createComponent,
  createComponentInstance,
  createTranslationTransform,
} from '../assembly/AssemblyTypes';
import {
  rebuildWithComponents,
  type ComponentRebuildResult,
} from '../assembly/ComponentRebuilder';
import { createRebuildEngine } from '../features/RebuildEngine';
import { createBoxFeature, rebuildBox } from '../features/primitives/BoxFeature';
import { rebuildMoveVertex } from '../features/vertex/MoveVertexFeature';
import {
  createDefaultDocument,
  type BodyWoodworkingMetadata,
  type Document,
} from '../types';

export const PORTFOLIO_FRAME_TIMESTAMP = '2026-10-26T00:00:00.000Z';
export const PORTFOLIO_FRAME_IDS = {
  sourceFeature: 'portfolio-frame-board',
  sourceBody: 'portfolio-frame-board_body',
  component: 'portfolio-frame-board-definition',
  bottom: 'portfolio-frame-bottom',
  top: 'portfolio-frame-top',
  left: 'portfolio-frame-left',
  right: 'portfolio-frame-right',
} as const;

const WIDTH = 3;
const THICKNESS = 0.75;
const PARTS = ['bottom', 'top', 'left', 'right'] as const;

function assertLength(length: number): void {
  if (typeof length !== 'number' || !Number.isFinite(length) || length <= 2 * WIDTH) {
    throw new Error('Frame board length must be finite and greater than 6 inches');
  }
}

function sourceLength(document: Document): number {
  const source = document.features.find(feature => feature.id === PORTFOLIO_FRAME_IDS.sourceFeature);
  if (!source || source.type !== 'box' || source.suppressed) {
    throw new Error('Portfolio frame requires its unsuppressed source box history');
  }
  const length = source.parameters.width;
  if (typeof length !== 'number') throw new Error('Source board length is missing');
  assertLength(length);
  if (
    source.parameters.depth !== WIDTH || source.parameters.height !== THICKNESS
    || source.parameters.anchorMode !== 'corner'
    || JSON.stringify(source.parameters.origin) !== '[0,0,0]'
    || document.config.units !== 'inch'
  ) {
    throw new Error('This example supports a 3 by 0.75 inch corner-anchored source board');
  }
  return length;
}

function verticalTransform(x: number): number[] {
  // Exact quarter-turn around Z, then translation; column-major, no trig drift.
  return [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
}

function transforms(length: number): Record<typeof PARTS[number], number[]> {
  return {
    bottom: createTranslationTransform(WIDTH, 0, 0),
    top: createTranslationTransform(WIDTH, length - WIDTH, 0),
    left: verticalTransform(WIDTH),
    right: verticalTransform(length + 2 * WIDTH),
  };
}

function sourceMetadata(): BodyWoodworkingMetadata {
  return {
    sourceFeatureId: PORTFOLIO_FRAME_IDS.sourceFeature,
    isBoard: true,
    label: 'White oak board definition (not an extra manufactured part)',
    material: { id: 'white-oak', species: 'White oak' },
    grainAxis: [1, 0, 0],
    thicknessAxis: [0, 0, 1],
    grainPattern: 'straight',
    stockAllowance: { length: 0.5, width: 0.25, thickness: 0.125 },
    notes: 'Illustrative square-butt frame; fasteners, joinery and structural rating are not modeled.',
  };
}

/** Build the four physical boards through the actual registered feature engine. */
export function rebuildPortfolioFrameDocument(document: Document): ComponentRebuildResult {
  sourceLength(document);
  const engine = createRebuildEngine();
  engine.registerHandler('box', rebuildBox);
  engine.registerHandler('moveVertex', rebuildMoveVertex);
  const base = engine.rebuild(document.features);
  return rebuildWithComponents(
    base,
    document.components,
    document.componentInstances,
    new Map([[PORTFOLIO_FRAME_IDS.component, [PORTFOLIO_FRAME_IDS.sourceBody]]]),
  );
}

/** Authored board tags transformed into each physical instance's world axes. */
export function bodyMetadataForPortfolioFrame(
  document: Document,
  result: ComponentRebuildResult,
): Record<string, BodyWoodworkingMetadata> {
  if (!result.ok) throw new Error('Cannot create manufacturing metadata for a failed rebuild');
  const source = document.bodyMetadata?.[PORTFOLIO_FRAME_IDS.sourceBody];
  if (!source) throw new Error('Source board material/grain metadata is missing');
  const metadata: Record<string, BodyWoodworkingMetadata> = {};
  for (const instance of document.componentInstances) {
    const matrix = instance.transform;
    const direction = (axis: readonly [number, number, number]): [number, number, number] => [
      matrix[0]! * axis[0] + matrix[4]! * axis[1] + matrix[8]! * axis[2],
      matrix[1]! * axis[0] + matrix[5]! * axis[1] + matrix[9]! * axis[2],
      matrix[2]! * axis[0] + matrix[6]! * axis[1] + matrix[10]! * axis[2],
    ];
    const grainAxis = direction(source.grainAxis);
    const thicknessAxis = direction(source.thicknessAxis);
    for (const body of result.instanceBodies.get(instance.id) ?? []) {
      if (result.instanceBodySourceIds.get(body.id) !== PORTFOLIO_FRAME_IDS.sourceBody) {
        throw new Error('Unexpected component source body in the frame');
      }
      metadata[body.id] = {
        ...structuredClone(source),
        label: instance.name,
        partNumber: instance.id,
        grainAxis,
        thicknessAxis,
      };
    }
  }
  if (Object.keys(metadata).length !== 4 || result.bodies.length !== 4) {
    throw new Error('The portfolio frame must contain exactly four physical boards');
  }
  return metadata;
}

/** A deterministic scene containing one editable board definition and4instances. */
export function createPortfolioFrameDocument(length = 18): Document {
  assertLength(length);
  const document = createDefaultDocument('White oak square-butt frame');
  document.metadata.created = PORTFOLIO_FRAME_TIMESTAMP;
  document.metadata.modified = PORTFOLIO_FRAME_TIMESTAMP;
  document.features = [{
    ...createBoxFeature({ width: length, depth: WIDTH, height: THICKNESS, anchorMode: 'corner', origin: [0, 0, 0] }, 'Frame board: editable length'),
    id: PORTFOLIO_FRAME_IDS.sourceFeature,
    type: 'box',
  }];
  document.components = [{
    ...createComponent('Reusable white oak board', [PORTFOLIO_FRAME_IDS.sourceFeature], [PORTFOLIO_FRAME_IDS.sourceBody]),
    id: PORTFOLIO_FRAME_IDS.component,
  }];
  const placement = transforms(length);
  document.componentInstances = PARTS.map(part => ({
    ...createComponentInstance(PORTFOLIO_FRAME_IDS.component, `${part.charAt(0).toUpperCase()}${part.slice(1)} board`, placement[part]),
    id: PORTFOLIO_FRAME_IDS[part],
    grounded: part === 'bottom',
  }));
  document.manufacturingDefaults = {
    units: 'in', stockAllowance: { length: 0.5, width: 0.25, thickness: 0.125 },
  };
  document.bodyMetadata = { [PORTFOLIO_FRAME_IDS.sourceBody]: sourceMetadata() };
  const rebuilt = rebuildPortfolioFrameDocument(document);
  if (!rebuilt.ok) throw new Error(rebuilt.error ?? 'Frame could not rebuild');
  Object.assign(document.bodyMetadata, bodyMetadataForPortfolioFrame(document, rebuilt));
  return document;
}

/** Explicit example edit: change history and derive placements without changing IDs. */
export function editPortfolioFrameLength(document: Document, length: number): Document {
  sourceLength(document);
  assertLength(length);
  const edited = structuredClone(document);
  const feature = edited.features.find(candidate => candidate.id === PORTFOLIO_FRAME_IDS.sourceFeature)!;
  feature.parameters = { ...feature.parameters, width: length };
  const placement = transforms(length);
  for (const part of PARTS) {
    const instance = edited.componentInstances.find(candidate => candidate.id === PORTFOLIO_FRAME_IDS[part]);
    if (!instance || instance.componentId !== PORTFOLIO_FRAME_IDS.component) {
      throw new Error(`Frame ${part} instance is missing or has the wrong component`);
    }
    instance.transform = placement[part];
  }
  const rebuilt = rebuildPortfolioFrameDocument(edited);
  if (!rebuilt.ok) throw new Error(rebuilt.error ?? 'Edited frame could not rebuild');
  edited.bodyMetadata = {
    [PORTFOLIO_FRAME_IDS.sourceBody]: structuredClone(edited.bodyMetadata![PORTFOLIO_FRAME_IDS.sourceBody]!),
    ...bodyMetadataForPortfolioFrame(edited, rebuilt),
  };
  return edited;
}
