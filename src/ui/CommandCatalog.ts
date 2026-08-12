export type CommandGroup =
  | 'File'
  | 'Create'
  | 'Transform'
  | 'Combine'
  | 'Assembly'
  | 'Edit'
  | 'Output'
  | 'View'
  | 'Help';
export type ShortcutCategory = 'Features' | 'Assembly' | 'Editing' | 'Navigation' | 'File' | 'General';
 
export type AppCommandId =
  | 'newDocument'
  | 'openDocument'
  | 'saveDocument'
  | 'undo'
  | 'redo'
  | 'addBox'
  | 'addSketch'
  | 'addExtrude'
  | 'addExtrudeCut'
  | 'addWoodJoint'
  | 'addMiterCut'
  | 'addFaceSketch'
  | 'enterPushPull'
  | 'addLinearPattern'
  | 'addMirror'
  | 'addMove'
  | 'addDuplicate'
  | 'addRotate'
  | 'placePointToPoint'
  | 'alignFaces'
  | 'rotateAboutEdge'
  | 'addJoin'
  | 'addUnion'
  | 'createComponent'
  | 'addInstance'
  | 'createMate'
  | 'rebuild'
  | 'deleteSelected'
  | 'addMoveVertex'
  | 'toggleGridSnap'
  | 'toggleGrid'
  | 'toggleProjection'
  | 'resetCamera'
  | 'fitView'
  | 'measureSelection'
  | 'exportCutList'
  | 'exportDrawing'
  | 'openCommandPalette'
  | 'toggleHelp';
 
export interface AppCommandDefinition {
  id: AppCommandId;
  icon: string;
  label: string;
  description: string;
  shortcut?: string;
  toolbarGroup: CommandGroup;
  shortcutCategory?: ShortcutCategory;
  placement?: 'primary' | 'menu' | 'palette';
  menu?: 'File' | 'View' | 'Assembly' | 'Output' | 'Help';
  keywords?: string[];
}
 
export interface CommandAvailability {
  enabled: boolean;
  reason?: string;
}
 
export interface ShortcutHelpEntry {
  key: string;
  action: string;
  category: ShortcutCategory;
}
 
export interface MouseHelpEntry {
  gesture: string;
  action: string;
}
 
// Modeling groups come first (the primary work surface); chrome groups last.
export const TOOLBAR_GROUP_ORDER: CommandGroup[] = [
  'Create',
  'Transform',
  'Combine',
  'Edit',
  'Assembly',
  'Output',
  'View',
  'File',
  'Help',
];

/** Groups expanded on the toolbar by default. Empty by design: the toolbar
 *  starts as a compact row of category chips and each category reveals its
 *  tools on click — progressive disclosure. Nothing is expanded by default. */
export const DEFAULT_EXPANDED_TOOLBAR_GROUPS: ReadonlySet<CommandGroup> = new Set();
 
export const SHORTCUT_CATEGORY_ORDER: ShortcutCategory[] = [
  'Features',
  'Assembly',
  'Editing',
  'Navigation',
  'File',
  'General',
];
 
export const COMMAND_DEFINITIONS: AppCommandDefinition[] = [
  {
    id: 'newDocument',
    icon: 'ï¼‹',
    label: 'New',
    description: 'Create a new document',
    shortcut: 'Ctrl+N',
    toolbarGroup: 'File',
    shortcutCategory: 'File',
  },
  {
    id: 'openDocument',
    icon: 'â†—',
    label: 'Open',
    description: 'Open a saved document or recent file',
    shortcut: 'Ctrl+O',
    toolbarGroup: 'File',
    shortcutCategory: 'File',
  },
  {
    id: 'saveDocument',
    icon: 'â†“',
    label: 'Save',
    description: 'Save the current document',
    shortcut: 'Ctrl+S',
    toolbarGroup: 'File',
    shortcutCategory: 'File',
  },
  {
    id: 'undo',
    icon: 'â†¶',
    label: 'Undo',
    description: 'Undo the last edit or parameter change',
    shortcut: 'Ctrl+Z',
    toolbarGroup: 'Edit',
    shortcutCategory: 'Editing',
  },
  {
    id: 'redo',
    icon: 'â†·',
    label: 'Redo',
    description: 'Redo the last undone edit or parameter change',
    shortcut: 'Ctrl+Y / Ctrl+Shift+Z',
    toolbarGroup: 'Edit',
    shortcutCategory: 'Editing',
  },
  {
    id: 'addBox',
    icon: 'â–£',
    label: 'Box',
    description: 'Add a box primitive',
    shortcut: 'B',
    toolbarGroup: 'Create',
    shortcutCategory: 'Features',
  },
  {
    id: 'addSketch',
    icon: 'âœŽ',
    label: 'Sketch',
    description: 'Start a sketch on the XY plane',
    shortcut: 'S',
    toolbarGroup: 'Create',
    shortcutCategory: 'Features',
  },
  {
    id: 'addExtrude',
    icon: 'â†‘',
    label: 'Extrude',
    description: 'Select a sketch with a closed profile, then extrude it',
    shortcut: 'E',
    toolbarGroup: 'Create',
    shortcutCategory: 'Features',
  },
  {
    id: 'addExtrudeCut',
    icon: 'â¬‡',
    label: 'Cut',
    description: 'Select a body and a closed-profile sketch, then cut the body',
    shortcut: 'C',
    toolbarGroup: 'Create',
    shortcutCategory: 'Features',
  },
  {
    id: 'addWoodJoint',
    icon: 'JT',
    label: 'Joint',
    description: 'Create a paired woodworking joint from exact member faces',
    shortcut: 'Shift+J',
    toolbarGroup: 'Combine',
    shortcutCategory: 'Features',
    placement: 'primary',
    keywords: ['mortise', 'tenon', 'dado', 'rabbet', 'lap', 'bridle', 'notch', 'miter'],
  },
  {
    id: 'addMiterCut',
    icon: '45',
    label: 'Miter Cut',
      description: 'Create a single or three-way miter from a selected planar face; keep both pieces or trim the end, or keep all three-way pieces',
    toolbarGroup: 'Combine',
    shortcutCategory: 'Features',
  },
  {
    id: 'addFaceSketch',
    icon: 'â—«',
    label: 'Sketch on Face',
    description: 'Pick a face first, then sketch directly on it',
    shortcut: 'F',
    toolbarGroup: 'Create',
    shortcutCategory: 'Features',
  },
  {
    id: 'enterPushPull',
    icon: 'â†•',
    label: 'Push/Pull',
    description: 'Pick a face and offset it as a parametric feature',
    shortcut: 'P',
    toolbarGroup: 'Create',
    shortcutCategory: 'Features',
  },
  {
    id: 'addLinearPattern',
    icon: 'â‰¡',
    label: 'Pattern',
    description: 'Select one body, then create a linear pattern',
    shortcut: 'L',
    toolbarGroup: 'Transform',
    shortcutCategory: 'Features',
  },
  {
    id: 'addMirror',
    icon: 'â‡†',
    label: 'Mirror',
    description: 'Select one body, then mirror it',
    shortcut: 'M',
    toolbarGroup: 'Transform',
    shortcutCategory: 'Features',
  },
  {
    id: 'addMove',
    icon: 'MV',
    label: 'Move Body',
    description: 'Select one body, then drag the XYZ triad or enter an exact displacement',
    toolbarGroup: 'Transform',
    shortcutCategory: 'Editing',
    placement: 'menu',
    keywords: ['move', 'translate', 'position', 'coordinates', 'drag', 'transform'],
  },
  {
    id: 'addDuplicate',
    icon: 'â§‰',
    label: 'Duplicate',
    description: 'Select one body, then place a copy',
    shortcut: 'Ctrl+D',
    toolbarGroup: 'Transform',
    shortcutCategory: 'Features',
  },
  {
    id: 'addRotate',
    icon: 'âŸ³',
    label: 'Rotate',
    description: 'Select one body, then rotate it as an editable feature',
    shortcut: 'Shift+R',
    toolbarGroup: 'Transform',
    shortcutCategory: 'Features',
  },
  {
    id: 'placePointToPoint',
    icon: 'P2P',
    label: 'Point to Point',
    description: 'Move or copy selected bodies from an exact point, edge point, or face center to another datum',
    toolbarGroup: 'Transform',
    placement: 'menu',
    keywords: ['move', 'copy', 'vertex', 'endpoint', 'midpoint', 'face center', 'placement'],
  },
  {
    id: 'alignFaces',
    icon: 'AL',
    label: 'Align Faces',
    description: 'Align two exact planar faces with signed gap, normal direction, and quarter-turn twist',
    toolbarGroup: 'Combine',
    placement: 'menu',
    keywords: ['align', 'face', 'gap', 'flush', 'opposed', 'twist'],
  },
  {
    id: 'rotateAboutEdge',
    icon: 'AX',
    label: 'Rotate About Edge',
    description: 'Rotate selected bodies around an exact edge using a signed angle',
    toolbarGroup: 'Transform',
    placement: 'menu',
    keywords: ['rotate', 'axis', 'edge', 'pivot', 'angle'],
  },
  {
    id: 'addJoin',
    icon: 'âŠž',
    label: 'Group Bodies',
    description: 'Select two or more touching (non-overlapping) solids and group them into one edit target without fusing material',
    shortcut: 'J',
    toolbarGroup: 'Combine',
    shortcutCategory: 'Features',
  },
  {
    id: 'addUnion',
    icon: 'COM',
    label: 'Combine',
    description: 'Select two or more overlapping bodies, then fuse them into one solid (Boolean union)',
    toolbarGroup: 'Combine',
    shortcutCategory: 'Features',
    placement: 'primary',
    keywords: ['union', 'merge', 'boolean', 'fuse', 'combine', 'join solids'],
  },
  {
    id: 'createComponent',
    icon: 'â–¦',
    label: 'Component',
    description: 'Create a component from the current selection',
    shortcut: 'Shift+G',
    toolbarGroup: 'Assembly',
    shortcutCategory: 'Assembly',
  },
  {
    id: 'addInstance',
    icon: 'â—Ž',
    label: 'Instance',
    description: 'Add an instance of the selected or latest component',
    shortcut: 'I',
    toolbarGroup: 'Assembly',
    shortcutCategory: 'Assembly',
  },
  {
    id: 'createMate',
    icon: 'MT',
    label: 'Mate Faces',
    description: 'Create a persistent driving mate between two exact component-instance faces',
    toolbarGroup: 'Assembly',
    shortcutCategory: 'Assembly',
    placement: 'menu',
    menu: 'Assembly',
    keywords: ['mate', 'flush', 'offset', 'constraint', 'keep aligned'],
  },
  {
    id: 'rebuild',
    icon: 'â†»',
    label: 'Rebuild',
    description: 'Apply pending parameter edits and rebuild',
    shortcut: 'Ctrl+Enter',
    toolbarGroup: 'Edit',
    shortcutCategory: 'Editing',
  },
  {
    id: 'deleteSelected',
    icon: 'âœ•',
    label: 'Delete',
    description: 'Delete the selected body or selected feature',
    shortcut: 'Delete',
    toolbarGroup: 'Edit',
    shortcutCategory: 'Editing',
  },
  {
    id: 'addMoveVertex',
    icon: 'âœ¥',
    label: 'Move Vertex',
    description: 'Create a guarded Move Vertex feature from the selected vertex and drag it in the viewport',
    shortcut: 'Shift+V',
    toolbarGroup: 'Transform',
    shortcutCategory: 'Editing',
  },
  {
    id: 'toggleGridSnap',
    icon: 'âŒ—',
    label: 'Grid Snap',
    description: 'Toggle snap-to-grid for manipulations',
    shortcut: 'G',
    toolbarGroup: 'Edit',
    shortcutCategory: 'Editing',
  },
  {
    id: 'toggleGrid',
    icon: '#',
    label: 'Grid',
    description: 'Toggle grid visibility',
    shortcut: 'Ctrl+G',
    toolbarGroup: 'View',
    shortcutCategory: 'Navigation',
  },
  {
    id: 'toggleProjection',
    icon: 'â—§',
    label: 'Projection',
    description: 'Toggle between perspective and orthographic cameras',
    shortcut: 'Ctrl+P',
    toolbarGroup: 'View',
    shortcutCategory: 'Navigation',
  },
  {
    id: 'resetCamera',
    icon: 'âŒ‚',
    label: 'Reset View',
    description: 'Reset the camera to the default view',
    shortcut: 'Ctrl+R',
    toolbarGroup: 'View',
    shortcutCategory: 'Navigation',
  },
  {
    id: 'fitView',
    icon: 'âŠ¡',
    label: 'Fit View',
    description: 'Zoom the camera to fit the visible model geometry',
    toolbarGroup: 'View',
  },
  {
    id: 'measureSelection',
    icon: 'M',
    label: 'Measure',
    description: 'Measure the selected body, planar face, or exact edge from B-Rep geometry',
    toolbarGroup: 'Output',
  },
  {
    id: 'exportCutList',
    icon: 'CSV',
    label: 'Cut List',
    description: 'Export tagged boards as a grouped cut-list CSV',
    toolbarGroup: 'Output',
  },
  {
    id: 'exportDrawing',
    icon: '2D',
    label: 'Drawing',
    description: 'Export exact top, front, and right orthographic SVG views',
    toolbarGroup: 'Output',
  },
  {
    id: 'openCommandPalette',
    icon: 'âŒ˜',
    label: 'Commands',
    description: 'Search and run any available command',
    shortcut: 'Ctrl+K',
    toolbarGroup: 'Help',
    shortcutCategory: 'General',
  },
  {
    id: 'toggleHelp',
    icon: '?',
    label: 'Help',
    description: 'Show shortcuts and mouse controls',
    shortcut: '? / F1',
    toolbarGroup: 'Help',
    shortcutCategory: 'General',
  },
];
 
const CONTEXTUAL_SHORTCUTS: ShortcutHelpEntry[] = [
  {
    key: 'V',
    action: 'Toggle vertex selection mode to reveal guided Move Vertex prompts and drag handles',
    category: 'Editing',
  },
  {
    key: 'Escape',
    action: 'Exit the active tool, close help, or clear selection',
    category: 'General',
  },
];
 
export const MOUSE_HELP: MouseHelpEntry[] = [
  { gesture: 'Left drag', action: 'Orbit the camera' },
  { gesture: 'Right drag', action: 'Pan the camera' },
  { gesture: 'Mouse wheel', action: 'Zoom in and out' },
  { gesture: 'Click', action: 'Select a body or face target' },
  { gesture: 'Shift+Click', action: 'Add or remove from the current body selection' },
];
 
export function getCommandDefinition(id: AppCommandId): AppCommandDefinition {
  const command = COMMAND_DEFINITIONS.find((entry) => entry.id === id);
  if (!command) {
    throw new Error(`Unknown command definition: ${id}`);
  }
  return command;
}
 
export function getShortcutHelpEntries(): ShortcutHelpEntry[] {
  const commandShortcuts = COMMAND_DEFINITIONS.flatMap((command) => {
    if (!command.shortcut || !command.shortcutCategory) {
      return [];
    }
 
    return [{
      key: command.shortcut,
      action: command.description,
      category: command.shortcutCategory,
    }];
  });
 
  return [...commandShortcuts, ...CONTEXTUAL_SHORTCUTS];
}
 
