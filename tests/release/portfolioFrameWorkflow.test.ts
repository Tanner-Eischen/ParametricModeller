import { describe, expect, it } from 'vitest';
import { createUndoRedoStack } from '../../src/core';
import { createBoxFeature } from '../../src/features/primitives/BoxFeature';
import { createPortfolioFrameDocument, PORTFOLIO_FRAME_IDS } from '../../src/examples/portfolioFrame';
import { inspectPortfolioFrame, resizePortfolioFrame } from '../../src/app/PortfolioFrameWorkflow';
import { createDefaultDocument, type Document } from '../../src/types';

describe('the bounded frame editing workflow', () => {
  it('measures four physical boards and edits length, placements and stable identities together', () => {
    const original = createPortfolioFrameDocument();
    const before = JSON.stringify(original);
    expect(inspectPortfolioFrame(original)).toMatchObject({ length: 18, bodyCount: 4, bounds: [24, 18, 0.75], error: null });
    const edited = resizePortfolioFrame(original, 20);
    expect(inspectPortfolioFrame(edited)).toMatchObject({ length: 20, bodyCount: 4, bounds: [26, 20, 0.75], error: null });
    expect(edited.componentInstances.map(i => i.id)).toEqual(original.componentInstances.map(i => i.id));
    expect(edited.features.map(f => f.id)).toEqual(original.features.map(f => f.id));
    expect(edited.componentInstances.find(i => i.id === PORTFOLIO_FRAME_IDS.right)?.transform[12]).toBe(26);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('round-trips the complete edit through the production history stack', () => {
    const original = createPortfolioFrameDocument();
    const history = createUndoRedoStack<Document>();
    history.seed(original, 'Frame loaded');
    history.markClean();
    history.commit(resizePortfolioFrame(original, 20), 'Resize frame example');
    expect(history.isDirty()).toBe(true);
    expect(inspectPortfolioFrame(history.undo()!.snapshot)?.bounds).toEqual([24, 18, 0.75]);
    expect(history.isDirty()).toBe(false);
    expect(inspectPortfolioFrame(history.redo()!.snapshot)?.bounds).toEqual([26, 20, 0.75]);
    expect(history.isDirty()).toBe(true);
  });

  it.each([6, 0, -1, NaN, Infinity])('rejects invalid length %s without touching the original', length => {
    const original = createPortfolioFrameDocument();
    const before = JSON.stringify(original);
    expect(() => resizePortfolioFrame(original, length)).toThrow(/greater than 6/);
    expect(JSON.stringify(original)).toBe(before);
  });

  it.each(['extra-feature', 'missing-instance', 'duplicate-instance', 'wrong-component', 'wrong-body', 'constraints', 'cross-section'])(
    'does not infer a general constraint solution for modified example: %s', kind => {
      const doc = createPortfolioFrameDocument();
      if (kind === 'extra-feature') doc.features.push({ ...createBoxFeature(), type: 'box' });
      if (kind === 'missing-instance') doc.componentInstances.pop();
      if (kind === 'duplicate-instance') doc.componentInstances[1]!.id = doc.componentInstances[0]!.id;
      if (kind === 'wrong-component') doc.componentInstances[0]!.componentId = 'unrelated';
      if (kind === 'wrong-body') doc.components[0]!.bodyIds = ['other-body'];
      if (kind === 'constraints') doc.constraints = [{} as Document['constraints'][number]];
      if (kind === 'cross-section') doc.features[0]!.parameters.depth = 4;
      const before = JSON.stringify(doc);
      expect(inspectPortfolioFrame(doc)?.error).toBeTruthy();
      expect(() => resizePortfolioFrame(doc, 20)).toThrow();
      expect(JSON.stringify(doc)).toBe(before);
    },
  );

  it('does not identify unrelated documents as the frame', () => {
    expect(inspectPortfolioFrame(createDefaultDocument())).toBeNull();
  });
});
