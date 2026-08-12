import { describe, it, expect } from 'vitest';
import { COMMAND_DEFINITIONS, getShortcutHelpEntries } from '../../src/ui/CommandCatalog';

describe('CommandCatalog', () => {
  it('advertises vertex selection and move-vertex shortcuts in help', () => {
    const shortcuts = getShortcutHelpEntries().map((entry) => entry.key);

    expect(shortcuts).toContain('V');
    expect(shortcuts).toContain('Shift+V');
  });

  it('keeps discoverable commands aligned with the toolbar/help feature set', () => {
    const ids = COMMAND_DEFINITIONS.map((definition) => definition.id);

    expect(ids).toContain('undo');
    expect(ids).toContain('redo');
    expect(ids).toContain('addMoveVertex');
    expect(ids).toContain('addFaceSketch');
    expect(ids).toContain('enterPushPull');
    expect(ids).toContain('addMiterCut');
    expect(ids).toContain('fitView');
    expect(ids).toContain('measureSelection');
    expect(ids).toContain('exportCutList');
    expect(ids).toContain('exportDrawing');
    expect(ids).toContain('toggleHelp');
  });

  it('advertises undo and redo in the shortcut help entries', () => {
    const shortcuts = getShortcutHelpEntries().filter((entry) => entry.category === 'Editing');

    expect(shortcuts.map((entry) => entry.key)).toContain('Ctrl+Z');
    expect(shortcuts.map((entry) => entry.key)).toContain('Ctrl+Y / Ctrl+Shift+Z');
    expect(shortcuts.map((entry) => entry.key)).toContain('V');
    expect(shortcuts.map((entry) => entry.key)).toContain('Shift+V');
  });

  it('explains explicit modeling selection requirements', () => {
    const descriptions = new Map(
      COMMAND_DEFINITIONS.map((definition) => [definition.id, definition.description])
    );

    expect(descriptions.get('addExtrude')).toMatch(/Select a sketch/i);
    expect(descriptions.get('addExtrudeCut')).toMatch(/Select a body and a closed-profile sketch/i);
    expect(descriptions.get('addMiterCut')).toMatch(/selected planar face/i);
    expect(descriptions.get('addMiterCut')).toMatch(/keep both pieces or trim the end/i);
    expect(descriptions.get('addLinearPattern')).toMatch(/Select one body/i);
    expect(descriptions.get('addMirror')).toMatch(/Select one body/i);
    expect(descriptions.get('addDuplicate')).toMatch(/Select one body/i);
    expect(descriptions.get('addRotate')).toMatch(/Select one body/i);
    for (const commandId of [
      'addExtrude',
      'addExtrudeCut',
      'addMiterCut',
      'addLinearPattern',
      'addMirror',
      'addDuplicate',
      'addRotate',
    ] as const) {
      expect(descriptions.get(commandId)).not.toMatch(/selected or latest/i);
    }
  });
});
