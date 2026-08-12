/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createComponent,
  createComponentInstance,
  createIdentityTransform,
} from '../../src/assembly/AssemblyTypes';
import { AssemblyPanel } from '../../src/ui/AssemblyPanel';

describe('AssemblyPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('invokes the create-component callback from the section button', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onCreateComponent = vi.fn();
    const panel = new AssemblyPanel({
      container,
      onCreateComponent,
    });

    const button = container.querySelector('button[title="Create a component from the current selection"]');
    expect(button).not.toBeNull();

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onCreateComponent).toHaveBeenCalledTimes(1);
    panel.dispose();
  });

  it('invokes the add-instance callback with the selected component id', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const component = createComponent('Cabinet Side', ['feature-1']);
    const onAddInstance = vi.fn();
    const panel = new AssemblyPanel({
      container,
      onAddInstance,
    });

    panel.setAssemblyData([component], [], []);

    const componentItem = container.querySelector(`[data-component-id="${component.id}"]`);
    componentItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const button = container.querySelector('button[title="Add an instance of the selected component"]');
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onAddInstance).toHaveBeenCalledWith(component.id);
    panel.dispose();
  });

  it('invokes the create-constraint callback once there are at least two instances', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const component = createComponent('Shelf', ['feature-1']);
    const instanceA = createComponentInstance(component.id, 'Shelf A', createIdentityTransform());
    const instanceB = createComponentInstance(component.id, 'Shelf B', createIdentityTransform());
    const onCreateConstraint = vi.fn();
    const panel = new AssemblyPanel({
      container,
      onCreateConstraint,
    });

    panel.setAssemblyData([component], [instanceA, instanceB], []);

    const button = container.querySelector('button[title="Create a flush mate between two instances"]');
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onCreateConstraint).toHaveBeenCalledTimes(1);
    panel.dispose();
  });

  it('notifies App when an instance is selected for transform', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const component = createComponent('Door', ['feature-1']);
    const instance = createComponentInstance(component.id, 'Door Instance', createIdentityTransform());
    const onSelectInstance = vi.fn();
    const panel = new AssemblyPanel({ container, onSelectInstance });
    panel.setAssemblyData([component], [instance], []);

    container.querySelector(`[data-instance-id="${instance.id}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSelectInstance).toHaveBeenCalledWith(instance);
    expect(panel.getSelectedInstance()).toBe(instance);
    panel.dispose();
  });
});
