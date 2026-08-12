/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ModelBrowserPanel,
  type ModelBrowserData,
} from '../../src/ui/ModelBrowserPanel';

const data: ModelBrowserData = {
  features: [
    {
      id: 'box-1', name: 'Base', type: 'box', suppressed: false,
      refsIn: [], refsOut: ['body-base'], outputBodyIds: ['body-base'],
    },
    {
      id: 'cut-1', name: 'Pocket', type: 'extrudeCut', suppressed: false,
      refsIn: ['box-1'], refsOut: ['body-cut'], outputBodyIds: ['body-cut'],
    },
    {
      id: 'pattern-1', name: 'Pattern', type: 'linearPattern', suppressed: true,
      refsIn: ['cut-1'], refsOut: ['body-pattern'], outputBodyIds: ['body-pattern'],
    },
  ],
  bodies: [
    { id: 'body-base', name: 'Base body', sourceFeatureId: 'box-1' },
    { id: 'body-cut', name: 'Pocket body', visible: false, locked: true },
  ],
  components: [
    { id: 'component-1', name: 'Side', featureIds: ['box-1'], bodyIds: ['body-base'] },
  ],
  instances: [
    { id: 'instance-1', name: 'Left side', componentId: 'component-1', grounded: true },
  ],
};

function setup(overrides: ConstructorParameters<typeof ModelBrowserPanel>[0] = {
  container: document.createElement('div'),
}): { container: HTMLElement; panel: ModelBrowserPanel } {
  const container = overrides.container;
  document.body.appendChild(container);
  const panel = new ModelBrowserPanel(overrides);
  panel.setData(data);
  return { container, panel };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ModelBrowserPanel', () => {
  it('renders objects, assemblies, and a collapsed edit history', () => {
    const { container, panel } = setup();

    expect(container.querySelector('[data-testid="model-browser-objects"] h3')?.textContent)
      .toBe('Objects (1)');
    expect(container.querySelector('[data-testid="model-browser-assemblies"] h3')?.textContent)
      .toBe('Assemblies (1)');
    // History is collapsed by default and sits last.
    expect(container.querySelector('[data-testid="model-browser-features"] h3')?.textContent)
      .toBe('▸ Edit history (3)');
    const instance = container.querySelector('[data-node-key="instance:instance-1"]');
    expect(instance?.getAttribute('aria-level')).toBe('2');
    expect(instance?.textContent).toContain('grounded');
    expect(container.querySelector<HTMLElement>('[data-node-key="feature:pattern-1"]')?.style.opacity)
      .toBe('0.55');

    panel.dispose();
  });

  it('lists bodies as objects or as assembly pieces without duplication', () => {
    const { container, panel } = setup();

    const featureRows = container.querySelectorAll('[data-node-kind="feature"]');
    const bodyRows = container.querySelectorAll('[data-node-kind="body"]');
    expect(featureRows).toHaveLength(3);
    expect(bodyRows).toHaveLength(2);
    // body-base belongs to the assembly, so it is shown as a piece under it
    // (not duplicated in the Objects list).
    expect(container.querySelector('[data-node-key="body:body-base"]')?.textContent)
      .toContain('piece');
    expect(container.querySelector('[data-node-key="body:body-base"]')?.textContent)
      .not.toContain('box-1');
    expect(container.querySelector('[data-node-key="body:body-cut"]')?.textContent)
      .toContain('independent piece');
    // Only the standalone body appears at the top level of Objects.
    expect(container.querySelectorAll('[data-testid="model-browser-objects"] [data-node-kind="body"]'))
      .toHaveLength(1);

    panel.dispose();
  });

  it('expands and collapses an assembly to reveal its pieces', () => {
    const { container, panel } = setup();
    // Assembly is open by default; the piece body is visible.
    expect(container.querySelector('[data-node-key="body:body-base"]')).not.toBeNull();
    container.querySelector<HTMLButtonElement>('[data-testid="model-browser-assembly-toggle-component-1"]')!.click();
    expect(container.querySelector('[data-node-key="body:body-base"]')).toBeNull();
    container.querySelector<HTMLButtonElement>('[data-testid="model-browser-assembly-toggle-component-1"]')!.click();
    expect(container.querySelector('[data-node-key="body:body-base"]')).not.toBeNull();
    panel.dispose();
  });

  it('selects with pointer and keyboard while preserving stable IDs across refreshes', () => {
    const onSelect = vi.fn();
    const container = document.createElement('div');
    const { panel } = setup({ container, onSelect });
    const bodyRow = container.querySelector<HTMLElement>('[data-node-key="body:body-base"]')!;

    bodyRow.click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'body', id: 'body-base' });
    expect(panel.getSelectedTarget()).toEqual({ kind: 'body', id: 'body-base' });
    panel.setData({ ...data, bodies: data.bodies.map((body) => ({ ...body, name: `${body.name}!` })) });
    expect(container.querySelector('[data-node-key="body:body-base"]')?.getAttribute('aria-selected'))
      .toBe('true');

    const featureRow = container.querySelector<HTMLElement>('[data-node-key="feature:box-1"]')!;
    featureRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'feature', id: 'box-1' });

    panel.dispose();
  });

  it('supports arrow, Home, and End focus navigation', () => {
    const { container, panel } = setup();
    // Expand Edit history so every row is visible and focusable.
    container.querySelector<HTMLElement>('[data-testid="model-browser-features"] h3')!.click();
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.model-browser-row'));
    rows[0]?.focus();
    rows[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows[1]);
    rows[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(rows.at(-1));
    rows.at(-1)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(rows[0]);
    panel.dispose();
  });

  it('emits rename only for a non-empty Enter commit and cancels on Escape', () => {
    const onRename = vi.fn();
    const container = document.createElement('div');
    const { panel } = setup({ container, onRename });
    const rename = container.querySelector<HTMLButtonElement>(
      '[data-node-key="body:body-base"] [data-action="rename"]',
    )!;
    rename.click();
    let input = container.querySelector<HTMLInputElement>('[data-testid="model-browser-rename-body:body-base"]')!;
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(onRename).not.toHaveBeenCalled();
    input.value = '  Cabinet side  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onRename).toHaveBeenCalledWith({
      target: { kind: 'body', id: 'body-base' },
      name: 'Cabinet side',
    });

    container.querySelector<HTMLButtonElement>(
      '[data-node-key="feature:box-1"] [data-action="rename"]',
    )!.click();
    input = container.querySelector<HTMLInputElement>('[data-testid="model-browser-rename-feature:box-1"]')!;
    input.value = 'Should not commit';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onRename).toHaveBeenCalledTimes(1);
    panel.dispose();
  });

  it('emits visibility, lock, and suppression changes without mutating its snapshot', () => {
    const onSetVisibility = vi.fn();
    const onSetLocked = vi.fn();
    const onSetSuppressed = vi.fn();
    const container = document.createElement('div');
    const { panel } = setup({ container, onSetVisibility, onSetLocked, onSetSuppressed });

    container.querySelector<HTMLButtonElement>(
      '[data-node-key="body:body-cut"] [data-action="visibility"]',
    )!.click();
    container.querySelector<HTMLButtonElement>(
      '[data-node-key="body:body-cut"] [data-action="lock"]',
    )!.click();
    container.querySelector<HTMLButtonElement>(
      '[data-node-key="feature:pattern-1"] [data-action="suppress"]',
    )!.click();

    expect(onSetVisibility).toHaveBeenCalledWith({
      target: { kind: 'body', id: 'body-cut' }, visible: true,
    });
    expect(onSetLocked).toHaveBeenCalledWith({
      target: { kind: 'body', id: 'body-cut' }, locked: false,
    });
    expect(onSetSuppressed).toHaveBeenCalledWith({ featureId: 'pattern-1', suppressed: false });
    expect(container.querySelector<HTMLButtonElement>(
      '[data-node-key="feature:pattern-1"] [data-action="suppress"]',
    )?.title).toBe('Resume');
    panel.dispose();
  });

  it('reports dependencies using explicit IDs and derived direct dependents', () => {
    const onShowDependencies = vi.fn();
    const container = document.createElement('div');
    const { panel } = setup({ container, onShowDependencies });
    container.querySelector<HTMLButtonElement>(
      '[data-node-key="feature:cut-1"] [data-action="dependencies"]',
    )!.click();

    expect(onShowDependencies).toHaveBeenCalledWith({
      featureId: 'cut-1', dependencyIds: ['box-1'], dependentIds: ['pattern-1'],
    });
    panel.dispose();
  });

  it('fails closed until a destructive rollback is explicitly confirmed', () => {
    const onRollback = vi.fn();
    const container = document.createElement('div');
    const { panel } = setup({ container, onRollback });
    container.querySelector<HTMLButtonElement>(
      '[data-node-key="feature:box-1"] [data-action="rollback"]',
    )!.click();

    expect(onRollback).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')?.textContent)
      .toContain('2 later features will be suppressed');
    container.querySelector<HTMLButtonElement>('[data-action="cancel-rollback"]')!.click();
    expect(onRollback).not.toHaveBeenCalled();

    container.querySelector<HTMLButtonElement>(
      '[data-node-key="feature:box-1"] [data-action="rollback"]',
    )!.click();
    container.querySelector<HTMLButtonElement>('[data-action="confirm-rollback"]')!.click();
    expect(onRollback).toHaveBeenCalledWith({
      featureId: 'box-1',
      featureIndex: 0,
      removedFeatureIds: ['cut-1', 'pattern-1'],
      affectedBodyIds: ['body-cut', 'body-pattern'],
      requiresConfirmation: true,
      confirmationReason: '2 later features will be suppressed.',
      confirmed: true,
    });
    panel.dispose();
  });

  it('rolls back the last feature directly and disables unavailable mutations', () => {
    const onRollback = vi.fn();
    const container = document.createElement('div');
    const { panel } = setup({ container, onRollback });
    container.querySelector<HTMLButtonElement>(
      '[data-node-key="feature:pattern-1"] [data-action="rollback"]',
    )!.click();
    expect(onRollback).toHaveBeenCalledWith(expect.objectContaining({
      featureId: 'pattern-1', removedFeatureIds: [], requiresConfirmation: false, confirmed: true,
    }));
    panel.dispose();

    const unavailable = setup();
    expect(unavailable.container.querySelector<HTMLButtonElement>('[data-action="rename"]')?.disabled)
      .toBe(true);
    expect(unavailable.container.querySelector<HTMLButtonElement>('[data-action="rollback"]')?.disabled)
      .toBe(true);
    unavailable.panel.dispose();
  });

  it('drops selection and pending confirmation when referenced IDs disappear', () => {
    const onRollback = vi.fn();
    const container = document.createElement('div');
    const { panel } = setup({ container, onRollback });
    expect(panel.select({ kind: 'feature', id: 'box-1' })).toBe(true);
    container.querySelector<HTMLButtonElement>(
      '[data-node-key="feature:box-1"] [data-action="rollback"]',
    )!.click();
    panel.setData({ ...data, features: [] });
    expect(panel.getSelectedTarget()).toBeNull();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(panel.select({ kind: 'feature', id: 'missing' })).toBe(false);
    panel.dispose();
  });
});
