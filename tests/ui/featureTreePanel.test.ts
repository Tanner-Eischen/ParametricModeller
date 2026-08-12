/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '../../src/core';
import { FeatureTreePanel } from '../../src/ui/FeatureTreePanel';

describe('FeatureTreePanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('emits a clear event when the feature selection is cleared', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const panel = new FeatureTreePanel({ container });
    const clearSpy = vi.fn();
    const unsubscribe = eventBus.on('ui:property-inspector:clear', clearSpy);

    panel.selectFeature(null);

    expect(clearSpy).toHaveBeenCalledTimes(1);

    unsubscribe();
    panel.dispose();
  });

  it('preserves the selected feature across feature list refreshes', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const panel = new FeatureTreePanel({ container });
    const feature = {
      id: 'feature-1',
      type: 'moveVertex',
      name: 'Move Vertex 1',
      parameters: { translation: [0, 0, 0] },
      refsIn: [],
      refsOut: [],
      suppressed: false,
    };
    const inspectorSpy = vi.fn();
    const unsubscribe = eventBus.on('ui:property-inspector', inspectorSpy);

    panel.setFeatures([feature]);
    panel.selectFeature(feature.id);
    panel.setFeatures([{ ...feature, name: 'Move Vertex 1 (updated)' }]);

    expect(panel.getSelectedFeature()?.id).toBe(feature.id);
    expect(inspectorSpy).toHaveBeenCalled();

    unsubscribe();
    panel.dispose();
  });
});
