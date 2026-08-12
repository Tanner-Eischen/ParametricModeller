/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VertexEditPrompt } from '../../src/ui/VertexEditPrompt';

describe('VertexEditPrompt', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts a Move Vertex flow from the selection state button', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onStart = vi.fn();
    const prompt = new VertexEditPrompt({ container });
    prompt.showSelection({
      vertexId: '+X+Y+Z',
      onStart,
    });

    const button = container.querySelector('.vertex-edit-prompt__button--primary');
    expect(button).not.toBeNull();

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onStart).toHaveBeenCalledTimes(1);
    prompt.dispose();
  });

  it('updates the axis lock from the editing state chips', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onSetConstraint = vi.fn();
    const prompt = new VertexEditPrompt({ container });
    prompt.showEditing({
      vertexId: '+X+Y+Z',
      translation: [0.25, 0, 0],
      constrainAxis: undefined,
      onSetConstraint,
    });

    const chips = Array.from(container.querySelectorAll('.vertex-edit-prompt__chip'));
    const xChip = chips.find((chip) => chip.textContent === 'X');
    expect(xChip).not.toBeUndefined();

    xChip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSetConstraint).toHaveBeenCalledWith('x');
    prompt.dispose();
  });
});
