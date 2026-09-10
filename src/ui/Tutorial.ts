/**
 * Tutorial - Interactive guided walkthrough for new users.
 */

import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('Tutorial');

/**
 * Tutorial step definition.
 */
export interface TutorialStep {
  /** Unique step identifier */
  id: string;
  /** Display title */
  title: string;
  /** Description text */
  description: string;
  /** Action to perform (command name) */
  action: 'box' | 'sketch' | 'extrude' | 'fillet' | 'cut';
  /** Whether step requires selection */
  requiresSelection?: boolean;
}

/**
 * Tutorial state.
 */
export interface TutorialState {
  /** Currently active step index */
  currentStep: number;
  /** Completed step IDs */
  completedSteps: string[];
  /** Whether tutorial is active */
  active: boolean;
}

/**
 * Tutorial configuration.
 */
export interface TutorialOptions {
  /** Callback when tutorial completes */
  onComplete?: () => void;
  /** Callback when tutorial is dismissed */
  onDismiss?: () => void;
  /** Callback when step advances */
  onStepChange?: (step: TutorialStep) => void;
}

const tutorialSteps: TutorialStep[] = [
  {
    id: 'step-1',
    title: 'Create a Box',
    description: 'Start by creating a box primitive. Click the Box button or press B.',
    action: 'box',
  },
  {
    id: 'step-2',
    title: 'Create a Sketch',
    description: 'Add a sketch to draw a profile. Click Sketch or press S.',
    action: 'sketch',
  },
  {
    id: 'step-3',
    title: 'Extrude the Profile',
    description: 'Turn your sketch into 3D by extruding. Click Extrude or press E.',
    action: 'extrude',
  },
  {
    id: 'step-4',
    title: 'Add a Fillet',
    description: 'Smooth the edges with a fillet. Click Fillet to add rounded edges.',
    action: 'fillet',
  },
  {
    id: 'step-5',
    title: 'Cut Material',
    description: 'Remove material with an extrude cut. Click Cut or press C.',
    action: 'cut',
    requiresSelection: true,
  },
];

/**
 * Get all tutorial steps.
 */
export function getTutorialSteps(): TutorialStep[] {
  return [...tutorialSteps];
}

/**
 * Get the initial tutorial state.
 */
export function createTutorialState(): TutorialState {
  return {
    currentStep: 0,
    completedSteps: [],
    active: false,
  };
}

/**
 * Get the current step from state.
 */
export function getCurrentStep(state: TutorialState): TutorialStep | null {
  if (state.currentStep >= tutorialSteps.length) return null;
  return tutorialSteps[state.currentStep] ?? null;
}

/**
 * Mark a step as completed.
 */
export function markStepCompleted(state: TutorialState, stepId: string): void {
  if (!state.completedSteps.includes(stepId)) {
    state.completedSteps.push(stepId);
    // Auto-advance to next step
    if (state.currentStep + 1 < tutorialSteps.length) {
      state.currentStep++;
    }
  }
}

/**
 * Check if tutorial is complete.
 */
export function isTutorialComplete(state: TutorialState): boolean {
  return state.completedSteps.length === tutorialSteps.length;
}

/**
 * Get progress percentage.
 */
export function getTutorialProgress(state: TutorialState): number {
  if (tutorialSteps.length === 0) return 0;
  return Math.round((state.completedSteps.length / tutorialSteps.length) * 100);
}

/**
 * Create a tutorial controller for UI interaction.
 */
export function createTutorialController(options: TutorialOptions = {}) {
  const state = createTutorialState();

  return {
    state,

    start() {
      state.active = true;
      state.currentStep = 0;
      state.completedSteps = [];
      log.info('Tutorial started');

      const step = getCurrentStep(state);
      if (step && options.onStepChange) {
        options.onStepChange(step);
      }
    },

    dismiss() {
      state.active = false;
      log.info('Tutorial dismissed');
      options.onDismiss?.();
    },

    advance() {
      const current = getCurrentStep(state);
      if (current) {
        markStepCompleted(state, current.id);
      }

      const next = getCurrentStep(state);
      if (next && options.onStepChange) {
        options.onStepChange(next);
      } else if (isTutorialComplete(state)) {
        options.onComplete?.();
        log.info('Tutorial completed');
      }
    },

    skip() {
      // Complete all remaining steps
      for (let i = state.currentStep; i < tutorialSteps.length; i++) {
        markStepCompleted(state, tutorialSteps[i]!.id);
      }
      options.onComplete?.();
      log.info('Tutorial skipped');
    },
  };
}
