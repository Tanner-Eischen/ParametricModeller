import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { createDefaultDocument, type Document } from '../../src/types';
import { createComponentInstance } from '../../src/assembly/AssemblyTypes';

describe('App document load guard', () => {
  it('rejects malformed incoming state before cancelling a preview or touching the active document and scene', () => {
    const incoming = createDefaultDocument('Malformed');
    incoming.componentInstances = [createComponentInstance('component', 'Instance')];
    incoming.componentInstances[0]!.transform = null as unknown as number[];
    const previous = createDefaultDocument('Unsaved work');
    const sceneObject = { name: 'Last valid body' };
    const sceneObjects = new Map([['existing', sceneObject]]);
    const cancelActiveInteraction = vi.fn();
    const remove = vi.fn();
    const load = vi.fn();
    const clear = vi.fn();
    const resetFramePanel = vi.fn();
    const app = Object.assign(Object.create(App.prototype), {
      cancelActiveInteraction,
      viewport: { remove },
      documentManager: { load, getDocument: () => previous },
      meshCache: { clear },
      portfolioFramePanel: { reset: resetFramePanel },
      sceneObjects,
    }) as { loadDocument: (document: Document) => void };

    expect(() => app.loadDocument(incoming)).toThrow('componentInstances[0].transform');
    expect(cancelActiveInteraction).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(resetFramePanel).not.toHaveBeenCalled();
    expect(sceneObjects.get('existing')).toBe(sceneObject);
    expect(previous.metadata.name).toBe('Unsaved work');
  });
});
