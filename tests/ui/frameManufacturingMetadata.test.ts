/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { WoodworkingController } from '../../src/app/WoodworkingController';
import {
  createPortfolioFrameDocument,
  PORTFOLIO_FRAME_IDS,
  rebuildPortfolioFrameDocument,
} from '../../src/examples/portfolioFrame';
import { deserialize, serialize } from '../../src/persistence/serializer';
import { buildCutListDocument, cutListDocumentToCsv } from '../../src/woodworking';
import { buildCutListPreviewModel } from '../../src/ui/CutListPreviewPanel';
import { createRebuildEngine } from '../../src/features/RebuildEngine';
import { rebuildBox } from '../../src/features/primitives/BoxFeature';
import type { BodyWoodworkingMetadata } from '../../src/types';
import type { Body } from '../../src/geometry';
import type { BoardMetadata } from '../../src/woodworking';

function reopenedFrame() {
  const saved = serialize(createPortfolioFrameDocument(20));
  if (!saved.ok) throw new Error(saved.error);
  const opened = deserialize(saved.json);
  if (!opened.ok) throw new Error(opened.error);
  const doc = opened.document;
  const rebuilt = rebuildPortfolioFrameDocument(doc);
  if (!rebuilt.ok) throw new Error(rebuilt.error);
  const app = Object.assign(Object.create(App.prototype), {
    documentManager: { getDocument: () => doc },
    features: doc.features,
    componentInstances: doc.componentInstances,
    instanceBodyIdsByInstance: new Map([...rebuilt.instanceBodies].map(([id, bodies]) => [id, bodies.map(b => b.id)])),
    instanceBodySourceIds: rebuilt.instanceBodySourceIds,
    rebuiltBodies: rebuilt.bodies,
  });
  // The production document loader applies these source-output references
  // after rebuilding; physical instance bodies intentionally have no feature.
  const engine = createRebuildEngine();
  engine.registerHandler('box', rebuildBox);
  const featureRebuild = engine.rebuild(doc.features);
  if (!featureRebuild.ok) throw new Error(featureRebuild.error);
  app.applyFeatureOutputRefs(featureRebuild.outputsByFeature);
  const controller = new WoodworkingController({
    getDocument: () => doc,
    getFeatureByBodyId: bodyId => app.getFeatureByBodyId(bodyId),
    getFeatureById: featureId => app.getFeatureById(featureId),
    getInstanceForBody: bodyId => app.getInstanceForBody(bodyId),
    instanceBodySourceIds: rebuilt.instanceBodySourceIds,
    rebuiltBodies: rebuilt.bodies,
    setBodyMetadata: vi.fn(),
    refreshUiChrome: vi.fn(),
  });
  return { doc, rebuilt, app, controller };
}

describe('reopened frame manufacturing metadata', () => {
  it('keeps four physical identities and world grain axes in both production resolvers', () => {
    const { doc, rebuilt, app, controller } = reopenedFrame();
    const labels = new Set<string>(); const partNumbers = new Set<string>();
    for (const body of rebuilt.bodies) {
      const authored = doc.bodyMetadata![body.id]!;
      expect(app.getFeatureByBodyId(body.id)).toBeNull();
      for (const resolved of [app.resolveWoodworkingMetadata(body.id), controller.resolveWoodworkingMetadata(body.id)] as BodyWoodworkingMetadata[]) {
        expect(resolved.label).toBe(authored.label);
        expect(resolved.partNumber).toBe(authored.partNumber);
        expect(resolved.grainAxis).toEqual(authored.grainAxis);
        expect(resolved.thicknessAxis).toEqual(authored.thicknessAxis);
        expect(resolved).not.toBe(authored);
        labels.add(resolved.label); partNumbers.add(resolved.partNumber!);
      }
    }
    expect([...labels].sort()).toEqual(['Bottom board', 'Left board', 'Right board', 'Top board']);
    expect([...partNumbers].sort()).toEqual([
      PORTFOLIO_FRAME_IDS.bottom, PORTFOLIO_FRAME_IDS.left,
      PORTFOLIO_FRAME_IDS.right, PORTFOLIO_FRAME_IDS.top,
    ].sort());
    const leftId = rebuilt.instanceBodies.get(PORTFOLIO_FRAME_IDS.left)![0]!.id;
    expect(app.resolveWoodworkingMetadata(leftId).grainAxis).toEqual([0, 1, 0]);
  });

  it('passes instance identities through the actual App cut-list parts and UI preview', () => {
    const { app } = reopenedFrame();
    const parts = app.getCutListParts() as Array<{ body: Body; metadata: BoardMetadata; name: string }>;
    const cutList = buildCutListDocument(parts, { unit: 'in', title: 'Reopened frame' });
    expect(cutList.rows).toHaveLength(1);
    expect(cutList.rows[0]!.quantity).toBe(4);
    expect(cutList.rows[0]!.partNames).toEqual(['Bottom board', 'Left board', 'Right board', 'Top board']);
    expect(cutList.rows[0]!.finishedDimensions).toEqual({ length: 20, width: 3, thickness: 0.75 });
    const preview = buildCutListPreviewModel(cutList, {
      partNumbersByBodyId: new Map(parts.map(({ body, metadata }) => [body.id, metadata.partNumber!])),
    });
    expect(preview.rows[0]!.partNumbers).toEqual([
      PORTFOLIO_FRAME_IDS.bottom, PORTFOLIO_FRAME_IDS.left,
      PORTFOLIO_FRAME_IDS.right, PORTFOLIO_FRAME_IDS.top,
    ].sort());
    const csv = cutListDocumentToCsv(cutList);
    for (const label of ['Bottom board', 'Left board', 'Right board', 'Top board']) expect(csv).toContain(label);
    expect(csv).not.toContain('definition (not an extra manufactured part)');
  });

  it.each(['missing', 'stale'])('inherits and transforms source axes once for %s exact metadata', kind => {
    const { doc, rebuilt, app, controller } = reopenedFrame();
    const leftId = rebuilt.instanceBodies.get(PORTFOLIO_FRAME_IDS.left)![0]!.id;
    if (kind === 'missing') delete doc.bodyMetadata![leftId];
    else doc.bodyMetadata![leftId]!.sourceFeatureId = 'obsolete-feature';
    for (const resolved of [app.resolveWoodworkingMetadata(leftId), controller.resolveWoodworkingMetadata(leftId)] as BodyWoodworkingMetadata[]) {
      expect(resolved.label).toBe('White oak board definition (not an extra manufactured part)');
      expect(resolved.grainAxis).toEqual([0, 1, 0]);
      expect(resolved.thicknessAxis).toEqual([0, 0, 1]);
    }
  });
});
