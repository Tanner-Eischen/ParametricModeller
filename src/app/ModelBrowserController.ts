import type { Object3D } from 'three';
import { eventBus } from '../core';
import { select, clearSelection, selectMultiple, type SelectionState } from '../core/selection';
import {
  type FeatureRecord,
  type Diagnostic,
  createDependencyGraph,
  planFeatureSuppression,
  error,
} from '../features';
import type { Body, BodyPresentation, Document } from '../types';
import type { Component, ComponentInstance } from '../assembly/AssemblyTypes';
import type { ContextTaskPanelState } from '../ui/ContextTaskPanel';
import type {
  ModelBrowserTarget,
  ModelBrowserRenameRequest,
  ModelBrowserVisibilityRequest,
  ModelBrowserLockRequest,
  ModelBrowserRollbackRequest,
  ModelBrowserDependenciesRequest,
} from '../ui/ModelBrowserPanel';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('ModelBrowserController');

/**
 * The model browser's mutation handlers, extracted from App.
 *
 * The browser view (`ModelBrowserPanel`) never mutates document data; every
 * change is emitted as a typed request to one of these handlers. This controller
 * owns those handlers as a cohesive group behind an injected dependency surface.
 *
 * Injection contract (matches `PanelChrome` / `GizmoManager`):
 * - read context comes through getter callbacks (returning the *live*
 *   collections/objects, so contained-object field mutations like
 *   `feature.name = ...` are visible to the rest of App exactly as before);
 * - the few shared-mutable field *reassignments* (`selection`,
 *   `browserContextTask`, `activeComponentId`) go through setter callbacks;
 * - the feature-tree panel is exposed via two narrow callbacks
 *   (`selectFeatureInTree` / `getSelectedFeatureInTree`) instead of injecting
 *   the whole panel, so this module never depends on `FeatureTreePanel`'s API.
 *
 * Moves code only; changes no behavior.
 */
export interface ModelBrowserControllerDeps {
  features: () => FeatureRecord[];
  components: () => Component[];
  componentInstances: () => ComponentInstance[];
  instanceBodyIdsByInstance: () => Map<string, string[]>;
  sceneObjects: () => Map<string, Object3D>;
  selection: () => SelectionState;
  getFeatureById: (featureId: string | null) => FeatureRecord | null;
  getFeatureByBodyId: (bodyId: string | null) => FeatureRecord | null;
  isBodyVisible: (bodyId: string) => boolean;
  isBodyLocked: (bodyId: string) => boolean;
  getDocument: () => Document;
  updateBody: (id: string, updates: Partial<Body>) => void;
  selectFeatureInTree: (featureId: string | null) => void;
  getSelectedFeatureInTree: () => FeatureRecord | null;
  setSelection: (state: SelectionState) => void;
  setBrowserContextTask: (value: ContextTaskPanelState | null) => void;
  setActiveComponentId: (id: string | null) => void;
  cancelActiveInteraction: () => void;
  rebuildAll: (
    label: string,
    options?: { trackHistory?: boolean }
  ) => { ok: boolean; diagnostics: Diagnostic[] };
  commitDocumentHistory: (label: string) => void;
  refreshUiChrome: () => void;
  updateSelectionVisuals: () => void;
  updateAssemblyPanel: () => void;
  updateBodyPresentation: (id: string, updates: Partial<BodyPresentation>) => void;
  applyDocumentBodyPresentation: () => void;
  selectFeatureById: (featureId: string) => void;
  clearSubObjectSelectionState: () => void;
}

export class ModelBrowserController {
  private readonly d: ModelBrowserControllerDeps;

  constructor(deps: ModelBrowserControllerDeps) {
    this.d = deps;
    log.debug('Model browser controller created');
  }

  selectModelBrowserTarget(target: ModelBrowserTarget): void {
    this.d.setBrowserContextTask(null);
    if (target.kind === 'feature') {
      this.d.selectFeatureInTree(target.id);
      this.d.selectFeatureById(target.id);
      return;
    }

    if (target.kind === 'body') {
      const documentBody = this.d.getDocument().bodies.find(
        (body) => body.id === target.id
      );
      if (!this.d.isBodyVisible(target.id) || this.d.isBodyLocked(target.id)) {
        eventBus.emit('ui:status', {
          message: this.d.isBodyLocked(target.id)
            ? `${documentBody?.name ?? 'Body'} is locked`
            : `${documentBody?.name ?? 'Body'} is hidden`,
        });
        return;
      }
      this.d.clearSubObjectSelectionState();
      this.d.setSelection(select(clearSelection(this.d.selection()), target.id, false));
      const feature = this.d.getFeatureByBodyId(target.id);
      this.d.selectFeatureInTree(feature?.id ?? null);
      this.d.updateSelectionVisuals();
      this.d.refreshUiChrome();
      return;
    }

    const component = target.kind === 'component'
      ? this.d.components().find((item) => item.id === target.id) ?? null
      : null;
    const instance = target.kind === 'instance'
      ? this.d.componentInstances().find((item) => item.id === target.id) ?? null
      : null;
    this.d.setActiveComponentId(component?.id ?? instance?.componentId ?? null);
    const name = component?.name ?? instance?.name;
    this.d.refreshUiChrome();
    eventBus.emit('ui:status', { message: `${name ?? target.id} selected in the model browser` });
  }

  renameModelBrowserTarget(request: ModelBrowserRenameRequest): void {
    this.d.cancelActiveInteraction();
    const name = request.name.trim();
    if (!name) return;
    const { target } = request;
    let previousName: string | null = null;

    if (target.kind === 'feature') {
      const feature = this.d.getFeatureById(target.id);
      if (feature) {
        previousName = feature.name;
        feature.name = name;
        eventBus.emit('document:loaded', { features: this.d.features() });
      }
    } else if (target.kind === 'body') {
      const body = this.d.getDocument().bodies.find((item) => item.id === target.id);
      if (body) {
        previousName = body.name;
        this.d.updateBody(target.id, { name });
        this.d.updateBodyPresentation(target.id, { name });
        const object = this.d.sceneObjects().get(target.id);
        if (object) object.userData.name = name;
      }
    } else if (target.kind === 'component') {
      const component = this.d.components().find((item) => item.id === target.id);
      if (component) {
        previousName = component.name;
        component.name = name;
      }
    } else {
      const instance = this.d.componentInstances().find((item) => item.id === target.id);
      if (instance) {
        previousName = instance.name;
        instance.name = name;
      }
    }

    if (previousName === null || previousName === name) {
      this.d.refreshUiChrome();
      return;
    }
    this.d.updateAssemblyPanel();
    this.d.commitDocumentHistory(`Rename ${previousName}`);
    eventBus.emit('ui:status', { message: `Renamed ${previousName} to ${name}` });
    this.d.refreshUiChrome();
  }

  setFeatureSuppressedFromBrowser(featureId: string, suppressed: boolean): void {
    this.d.cancelActiveInteraction();
    const feature = this.d.getFeatureById(featureId);
    if (!feature || feature.suppressed === suppressed) return;
    const graph = createDependencyGraph(this.d.features());

    if (suppressed) {
      const plan = planFeatureSuppression(graph, featureId);
      if (!plan.allowed) {
        this.emitBrowserDiagnostics(plan.diagnostics);
        return;
      }
    } else {
      const invalidDependencyIds = (graph.dependenciesByFeature.get(featureId) ?? []).filter(
        (dependencyId) =>
          !graph.featuresById.has(dependencyId)
          || graph.featuresById.get(dependencyId)?.suppressed
      );
      if (invalidDependencyIds.length > 0) {
        this.emitBrowserDiagnostics([error(
          'RESUME_BLOCKED_BY_DEPENDENCY',
          `Cannot resume "${feature.name}" until these dependencies are active: ${invalidDependencyIds.join(', ')}.`,
          featureId
        )]);
        return;
      }
    }

    const previousSuppressed = feature.suppressed;
    feature.suppressed = suppressed;
    const result = this.d.rebuildAll(`${suppressed ? 'Suppress' : 'Resume'} ${feature.name}`);
    if (!result.ok) {
      const failedDiagnostics = result.diagnostics;
      feature.suppressed = previousSuppressed;
      this.d.rebuildAll(`Restore ${feature.name}`, { trackHistory: false });
      this.emitBrowserDiagnostics(failedDiagnostics);
      return;
    }
    eventBus.emit('ui:status', {
      message: `${suppressed ? 'Suppressed' : 'Resumed'} ${feature.name}`,
    });
  }

  setModelBrowserVisibility(request: ModelBrowserVisibilityRequest): void {
    this.d.cancelActiveInteraction();
    const { target, visible } = request;
    if (target.kind === 'component') {
      const component = this.d.components().find((item) => item.id === target.id);
      if (component) component.visible = visible;
    } else if (target.kind === 'instance') {
      const instance = this.d.componentInstances().find((item) => item.id === target.id);
      if (instance) instance.visible = visible;
    } else {
      for (const bodyId of this.getModelBrowserTargetBodyIds(target)) {
        this.d.updateBody(bodyId, { visible });
        this.d.updateBodyPresentation(bodyId, { visible });
      }
    }
    this.d.applyDocumentBodyPresentation();
    if (!visible) this.removeBodiesFromSelection(this.getModelBrowserTargetBodyIds(target));
    this.d.commitDocumentHistory(`${visible ? 'Show' : 'Hide'} ${target.kind}`);
    eventBus.emit('ui:status', {
      message: `${visible ? 'Shown' : 'Hidden'} ${target.kind} ${target.id}`,
    });
    this.d.refreshUiChrome();
  }

  setModelBrowserLocked(request: ModelBrowserLockRequest): void {
    this.d.cancelActiveInteraction();
    const { target, locked } = request;
    const affectedBodyIds = this.getModelBrowserTargetBodyIds(target);
    if (target.kind === 'component') {
      const component = this.d.components().find((item) => item.id === target.id);
      if (component) component.locked = locked;
    } else if (target.kind === 'instance') {
      const instance = this.d.componentInstances().find((item) => item.id === target.id);
      if (instance) instance.locked = locked;
    } else {
      for (const bodyId of affectedBodyIds) {
        this.d.updateBody(bodyId, { locked });
        this.d.updateBodyPresentation(bodyId, { locked });
      }
    }
    if (locked) {
      this.removeBodiesFromSelection(affectedBodyIds);
      const affected = new Set(affectedBodyIds);
      const selectedFeature = this.d.getSelectedFeatureInTree();
      if (selectedFeature?.refsOut.some((bodyId) => affected.has(bodyId))) {
        this.d.selectFeatureInTree(null);
      }
    }
    this.d.commitDocumentHistory(`${locked ? 'Lock' : 'Unlock'} ${target.kind}`);
    eventBus.emit('ui:status', {
      message: `${locked ? 'Locked' : 'Unlocked'} ${target.kind} ${target.id}`,
    });
    this.d.refreshUiChrome();
  }

  rollbackHistoryFromBrowser(request: ModelBrowserRollbackRequest): void {
    if (!request.confirmed) return;
    this.d.cancelActiveInteraction();
    const laterFeatures = this.d.features().slice(request.featureIndex + 1);
    const changed = laterFeatures.filter((feature) => !feature.suppressed);
    if (changed.length === 0) {
      eventBus.emit('ui:status', { message: 'History is already rolled back to this feature' });
      return;
    }
    for (const feature of changed) feature.suppressed = true;
    const target = this.d.getFeatureById(request.featureId);
    const result = this.d.rebuildAll(`Rollback to ${target?.name ?? request.featureId}`);
    if (!result.ok) {
      const failedDiagnostics = result.diagnostics;
      for (const feature of changed) feature.suppressed = false;
      this.d.rebuildAll('Restore history after blocked rollback', { trackHistory: false });
      this.emitBrowserDiagnostics(failedDiagnostics);
      return;
    }
    eventBus.emit('ui:status', {
      message: `Rolled back after ${target?.name ?? request.featureId}; Undo restores later features`,
    });
  }

  showFeatureDependencies(request: ModelBrowserDependenciesRequest): void {
    const graph = createDependencyGraph(this.d.features());
    const names = (ids: readonly string[]) => ids.map(
      (id) => graph.featuresById.get(id)?.name ?? id
    );
    const dependencies = names(request.dependencyIds);
    const dependents = names(request.dependentIds);
    this.d.setBrowserContextTask({
      toolName: `${graph.featuresById.get(request.featureId)?.name ?? request.featureId} dependencies`,
      instructions: 'References are resolved from the deterministic history dependency graph.',
      fields: [
        {
          id: 'dependencies',
          label: 'Depends on',
          type: 'readonly',
          value: dependencies.join(', ') || 'None',
        },
        {
          id: 'dependents',
          label: 'Used by',
          type: 'readonly',
          value: dependents.join(', ') || 'None',
        },
      ],
      canCommit: false,
      canCancel: false,
    });
    eventBus.emit('ui:status', { message: 'Dependency details shown in the task panel' });
    this.d.refreshUiChrome();
  }

  private emitBrowserDiagnostics(diagnostics: Diagnostic[]): void {
    eventBus.emit('feature:diagnostics', { diagnostics });
    const message = diagnostics[0]?.message ?? 'The history operation was blocked';
    eventBus.emit('ui:status', { message });
    this.d.refreshUiChrome();
  }

  private getModelBrowserTargetBodyIds(target: ModelBrowserTarget): string[] {
    if (target.kind === 'body') return [target.id];
    if (target.kind === 'feature') {
      return this.d.getFeatureById(target.id)?.refsOut.filter((id) => this.d.sceneObjects().has(id)) ?? [];
    }
    if (target.kind === 'instance') return [...(this.d.instanceBodyIdsByInstance().get(target.id) ?? [])];

    const component = this.d.components().find((item) => item.id === target.id);
    if (!component) return [];
    const sourceBodyIds = component.featureIds.flatMap(
      (featureId) => this.d.getFeatureById(featureId)?.refsOut ?? []
    );
    const instanceBodyIds = this.d.componentInstances()
      .filter((instance) => instance.componentId === component.id)
      .flatMap((instance) => this.d.instanceBodyIdsByInstance().get(instance.id) ?? []);
    return Array.from(new Set([...component.bodyIds, ...sourceBodyIds, ...instanceBodyIds]));
  }

  private removeBodiesFromSelection(bodyIds: string[]): void {
    const removed = new Set(bodyIds);
    const remaining = [...this.d.selection().selectedIds].filter((id) => !removed.has(id));
    let next = clearSelection(this.d.selection());
    if (remaining.length > 0) next = selectMultiple(next, remaining, false);
    this.d.setSelection(next);
    this.d.updateSelectionVisuals();
  }
}
