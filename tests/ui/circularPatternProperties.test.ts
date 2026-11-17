/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PropertyInspector } from '../../src/ui/PropertyInspector';
import { createCircularPatternFeature } from '../../src/features/pattern/CircularPatternFeature';
import { eventBus } from '../../src/core';

let inspector: PropertyInspector | null = null;
afterEach(() => { inspector?.dispose(); inspector = null; eventBus.clear(); document.body.innerHTML = ''; });

function fixture(units: 'inch' | 'mm') {
  const container = document.createElement('div'); document.body.append(container);
  inspector = new PropertyInspector({ container, units });
  const feature = createCircularPatternFeature({ sourceBodyRef: { featureId: 'source', bodyId: 'selected-body' }, center: [1, 2, 3] });
  inspector.setFeature(feature);
  const onUpdate = vi.fn(); eventBus.on('feature:update', onUpdate);
  const input = (label: string) => {
    const found = container.querySelector<HTMLInputElement>(`input[data-numeric-label="${label}"]`);
    if (!found) throw new Error(`Missing ${label}`);
    return found;
  };
  const edit = (label: string, value: string) => {
    const field = input(label); field.value = value; field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return { container, feature, onUpdate, input, edit };
}

describe('circular pattern properties', () => {
  it('accumulates edits on all center axes before emitting one staged update', () => {
    const f = fixture('inch');
    f.edit('Center X', '4'); f.edit('Center Y', '5'); f.edit('Center Z', '6');
    expect(f.onUpdate).not.toHaveBeenCalled();
    expect(f.feature.parameters.center).toEqual([1, 2, 3]);
    expect(inspector!.applyPendingChanges()).toBe(true);
    expect(f.onUpdate).toHaveBeenCalledOnce();
    expect(f.onUpdate.mock.calls[0]![0]).toMatchObject({
      featureId: f.feature.id,
      parameters: { center: [4, 5, 6], sourceBodyRef: { featureId: 'source', bodyId: 'selected-body' } },
    });
  });

  it('displays mm centers and converts edited distances while count and angle stay dimensionless', () => {
    const f = fixture('mm');
    expect(f.input('Center X').value).toBe('25.4');
    expect(f.input('Center Y').value).toBe('50.8');
    expect(f.input('Center Z').value).toBe('76.2');
    f.edit('Center X', '50.8'); f.edit('Center Y', '76.2 mm'); f.edit('Center Z', '101.6');
    f.edit('Occurrences', '4'); f.edit('Total angle (degrees)', '180');
    inspector!.applyPendingChanges();
    const params = f.onUpdate.mock.calls[0]![0].parameters;
    params.center.forEach((coordinate: number, index: number) => expect(coordinate).toBeCloseTo(index + 2, 12));
    expect(params.count).toBe(4); expect(params.angle).toBe(180);
  });
});
