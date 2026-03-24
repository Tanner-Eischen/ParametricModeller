/**
 * Constraint Creation Controller - Milestone 06: Assembly-lite
 *
 * Step-by-step constraint creation workflow:
 * 1. User clicks "Add Flush/Offset Mate"
 * 2. Select face on instance A
 * 3. Select face on instance B
 * 4. (Offset) Enter distance
 * 5. Create constraint, run solver
 */

import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import {
  createMateConstraint,
  createInstanceFaceRef,
  type ComponentInstance,
  type MateConstraint,
  type InstanceFaceRef,
} from '../assembly/AssemblyTypes';

const log = createModuleLogger('ConstraintCreationController');

/**
 * Constraint creation mode.
 */
export type ConstraintCreationMode = 'idle' | 'selectFaceA' | 'selectFaceB' | 'enterOffset';

/**
 * Options for the ConstraintCreationController.
 */
export interface ConstraintCreationControllerOptions {
  instances: () => ComponentInstance[];
  onConstraintCreated: (constraint: MateConstraint) => void;
}

/**
 * Controller for creating constraints.
 */
export class ConstraintCreationController {
  private instances: () => ComponentInstance[];
  private onConstraintCreated: (constraint: MateConstraint) => void;

  private mode: ConstraintCreationMode = 'idle';
  private constraintType: 'flush' | 'offset' = 'flush';
  private refA: InstanceFaceRef | null = null;
  private refB: InstanceFaceRef | null = null;
  private pendingOffset: number = 0;

  constructor(options: ConstraintCreationControllerOptions) {
    this.instances = options.instances;
    this.onConstraintCreated = options.onConstraintCreated;
    this.setupEventListeners();
    log.debug('ConstraintCreationController initialized');
  }

  private setupEventListeners(): void {
    // Listen for face selection events
    eventBus.on('face:selected', ({ faceId, bodyId }) => {
      this.handleFaceSelection(faceId, bodyId);
    });
  }

  /**
   * Start creating a flush constraint.
   */
  startFlushConstraint(): void {
    this.startConstraint('flush');
  }

  /**
   * Start creating an offset constraint.
   */
  startOffsetConstraint(): void {
    this.startConstraint('offset');
  }

  /**
   * Start constraint creation.
   */
  private startConstraint(type: 'flush' | 'offset'): void {
    if (this.instances().length < 2) {
      eventBus.emit('ui:status', { message: 'Need at least 2 instances to create a constraint' });
      return;
    }

    this.mode = 'selectFaceA';
    this.constraintType = type;
    this.refA = null;
    this.refB = null;
    this.pendingOffset = type === 'offset' ? 1 : 0;

    eventBus.emit('face:mode:changed', { isActive: true });
    eventBus.emit('ui:status', {
      message: `Creating ${type} mate - select first face (on any instance)`,
    });

    log.debug('Started constraint creation', { type });
  }

  /**
   * Handle face selection during constraint creation.
   */
  private handleFaceSelection(faceId: string, bodyId: string): void {
    if (this.mode === 'idle') return;

    // Find the instance that contains this body
    const instance = this.instances().find(inst => {
      // Check if bodyId starts with or matches expected pattern
      return bodyId.includes(inst.id) || inst.id === this.extractInstanceIdFromBodyId(bodyId);
    });

    if (!instance) {
      eventBus.emit('ui:status', { message: 'Selected face is not part of any instance' });
      return;
    }

    const faceRef = createInstanceFaceRef(instance.id, faceId, bodyId);

    if (this.mode === 'selectFaceA') {
      this.refA = faceRef;
      this.mode = 'selectFaceB';
      eventBus.emit('ui:status', {
        message: `Select second face (on a different instance)`,
      });
      log.debug('Face A selected', { faceId, bodyId, instanceId: instance.id });
    } else if (this.mode === 'selectFaceB') {
      // Validate different instance
      if (faceRef.instanceId === this.refA?.instanceId) {
        eventBus.emit('ui:status', {
          message: 'Select a face on a different instance',
        });
        return;
      }

      this.refB = faceRef;

      if (this.constraintType === 'offset') {
        this.mode = 'enterOffset';
        this.promptForOffset();
      } else {
        this.createConstraint();
      }
    }
  }

  /**
   * Extract instance ID from body ID.
   * Body IDs are formatted as: {sourceBodyId}_{instanceId}
   */
  private extractInstanceIdFromBodyId(bodyId: string): string {
    const parts = bodyId.split('_');
    return parts.length > 1 ? parts[parts.length - 1]! : '';
  }

  /**
   * Prompt user for offset distance.
   */
  private promptForOffset(): void {
    const input = prompt('Enter offset distance:', '1.0');
    if (input === null) {
      this.cancel();
      return;
    }

    const offset = parseFloat(input);
    if (isNaN(offset) || offset < 0) {
      eventBus.emit('ui:status', { message: 'Invalid offset value' });
      this.cancel();
      return;
    }

    this.pendingOffset = offset;
    this.createConstraint();
  }

  /**
   * Create the constraint.
   */
  private createConstraint(): void {
    if (!this.refA || !this.refB) {
      this.cancel();
      return;
    }

    const constraint = createMateConstraint(
      this.constraintType,
      this.refA,
      this.refB,
      this.pendingOffset,
      `${this.constraintType.charAt(0).toUpperCase() + this.constraintType.slice(1)} Mate`
    );

    log.info('Constraint created', {
      id: constraint.id,
      type: constraint.type,
      refA: this.refA.instanceId,
      refB: this.refB.instanceId,
    });

    this.onConstraintCreated(constraint);
    this.reset();

    eventBus.emit('constraint:added', {
      constraintId: constraint.id,
      type: constraint.type,
    });

    eventBus.emit('ui:status', {
      message: `Created ${constraint.type} mate`,
    });
  }

  /**
   * Cancel constraint creation.
   */
  cancel(): void {
    this.reset();
    eventBus.emit('face:mode:changed', { isActive: false });
    eventBus.emit('ui:status', { message: 'Constraint creation cancelled' });
    log.debug('Constraint creation cancelled');
  }

  /**
   * Reset the controller state.
   */
  private reset(): void {
    this.mode = 'idle';
    this.refA = null;
    this.refB = null;
    this.pendingOffset = 0;
  }

  /**
   * Check if currently creating a constraint.
   */
  isActive(): boolean {
    return this.mode !== 'idle';
  }

  /**
   * Get current mode.
   */
  getMode(): ConstraintCreationMode {
    return this.mode;
  }

  /**
   * Dispose the controller.
   */
  dispose(): void {
    this.reset();
    log.debug('ConstraintCreationController disposed');
  }
}
