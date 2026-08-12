/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '../../src/core';
import {
  createBoxFeature,
  createFaceRef,
  createFeatureRecord,
  createMiterCutFeature,
  createSketchFeature,
} from '../../src/features';
import {
  migrateSketchParams,
  type NormalizedSketchParams,
} from '../../src/features/sketch/SketchFeature';
import { createFacePlaneRef, createLineEntity, createRectangleEntity, createWorldPlaneRef } from '../../src/sketch';
import { PropertyInspector } from '../../src/ui/PropertyInspector';

describe('PropertyInspector sketch parameters', () => {
  let inspector: PropertyInspector | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    eventBus.clear();
    if (inspector) {
      inspector.dispose();
      inspector = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    document.body.innerHTML = '';
  });

  it('summarizes sketch entities and applies world-plane edits through feature:update', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    inspector = new PropertyInspector({ container });

    const planeRef = createWorldPlaneRef('xz', 2.5);
    const feature = createSketchFeature({
      planeRef,
      entities: [
        createRectangleEntity([1, 2], 4, 6, Math.PI / 4, 'rect-1'),
        createLineEntity([0, 0], [3, 4], 'line-1'),
      ],
      dimensions: [],
    }, 'Sketch 1');

    const onUpdate = vi.fn();
    eventBus.on('feature:update', onUpdate);

    inspector.setFeature(feature);

    expect(container.textContent).toContain('2 total');
    expect(container.textContent).toContain('1 rectangle');
    expect(container.textContent).toContain('1 line');
    expect(container.textContent).toContain('Rectangle 1');
    expect(container.textContent).toContain('Line 2');
    expect(container.textContent).toContain('Origin');
    expect(container.textContent).toContain('Length');

    const planeSelect = container.querySelector('select') as HTMLSelectElement | null;
    expect(planeSelect).not.toBeNull();
    planeSelect!.value = 'yz';
    planeSelect!.dispatchEvent(new Event('change', { bubbles: true }));

    const offsetInput = container.querySelector(
      'input[data-numeric-label="Plane Offset"]'
    ) as HTMLInputElement | null;
    expect(offsetInput).not.toBeNull();
    offsetInput!.value = '7.5';
    offsetInput!.dispatchEvent(new Event('input', { bubbles: true }));

    const applyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Apply'
    );
    expect(applyButton).not.toBeUndefined();
    applyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updatePayload = onUpdate.mock.calls[0]?.[0] as {
      featureId: string;
      parameters: { planeRef: { id: string; type: string; worldPlane?: string; offset?: number } };
    };
    expect(updatePayload.featureId).toBe(feature.id);
    expect(updatePayload.parameters.planeRef).toMatchObject({
      id: planeRef.id,
      type: 'world',
      worldPlane: 'yz',
      offset: 7.5,
    });
  });

  it('keeps face-based sketch plane info read-only', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    inspector = new PropertyInspector({ container });

    const feature = createSketchFeature({
      planeRef: createFacePlaneRef('face-12', 'body-7'),
      entities: [createLineEntity([0, 0], [5, 0], 'line-1')],
      dimensions: [],
    }, 'Sketch on Face');

    inspector.setFeature(feature);

    expect(container.textContent).toContain('Source Face');
    expect(container.textContent).toContain('face-12');
    expect(container.textContent).toContain('Source Body');
    expect(container.textContent).toContain('body-7');
    expect(container.textContent).toContain('Face-based sketch planes are read-only in the inspector.');
    expect(container.querySelector('select')).toBeNull();
  });

  it('edits authoritative driving dimensions without losing normalized geometry or relations', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    inspector = new PropertyInspector({ container });
    const feature = createSketchFeature({
      planeRef: createWorldPlaneRef('xy'),
      entities: [createLineEntity([0, 0], [4, 0], 'segment-a')],
      dimensions: [{
        id: 'width-dimension',
        type: 'distance',
        entityId: 'segment-a',
        value: 4,
        name: 'Width',
      }],
      geometry: {
        schemaVersion: 1,
        points: [
          { id: 'point-a', position: [0, 0] },
          { id: 'point-b', position: [4, 0] },
        ],
        segments: [{
          id: 'segment-a',
          type: 'line',
          startPointId: 'point-a',
          endPointId: 'point-b',
          construction: false,
        }],
      },
      relations: [{ id: 'horizontal-a', type: 'horizontal', segmentId: 'segment-a' }],
      drivingDimensions: [{
        id: 'width-dimension',
        type: 'distance',
        pointAId: 'point-a',
        pointBId: 'point-b',
        value: 4,
        name: 'Width',
      }],
    }, 'Dimensioned sketch');
    const original = migrateSketchParams(
      feature.parameters as unknown as NormalizedSketchParams
    );
    const onUpdate = vi.fn();
    eventBus.on('feature:update', onUpdate);
    inspector.setFeature(feature);

    const width = container.querySelector(
      'input[data-numeric-label="Width"]'
    ) as HTMLInputElement | null;
    expect(width).not.toBeNull();
    width!.value = '6';
    width!.dispatchEvent(new Event('input', { bubbles: true }));
    const applyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Apply'
    );
    applyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const parameters = onUpdate.mock.calls[0]?.[0].parameters as unknown as NormalizedSketchParams;
    expect(parameters.geometry.points.map((point) => point.id)).toEqual(
      original.geometry.points.map((point) => point.id)
    );
    expect(parameters.geometry.segments).toEqual(original.geometry.segments);
    expect(parameters.relations).toEqual(original.relations);
    expect(parameters.drivingDimensions).toEqual([
      expect.objectContaining({ id: 'width-dimension', value: 6 }),
    ]);
    expect(parameters.dimensions).toEqual([
      expect.objectContaining({ id: 'width-dimension', value: 6 }),
    ]);
    expect(migrateSketchParams(parameters)).toEqual(parameters);

    width!.value = '0';
    width!.dispatchEvent(new Event('input', { bubbles: true }));
    applyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('displays and parses driving dimensions in millimeters while explicit units override', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    inspector = new PropertyInspector({ container, units: 'mm' });
    const feature = createSketchFeature({
      planeRef: createWorldPlaneRef('xy'),
      entities: [createLineEntity([0, 0], [1, 0], 'segment-mm')],
      dimensions: [],
      geometry: {
        schemaVersion: 1,
        points: [
          { id: 'point-mm-a', position: [0, 0] },
          { id: 'point-mm-b', position: [1, 0] },
        ],
        segments: [{
          id: 'segment-mm',
          type: 'line',
          startPointId: 'point-mm-a',
          endPointId: 'point-mm-b',
          construction: false,
        }],
      },
      relations: [],
      drivingDimensions: [{
        id: 'length-mm',
        type: 'distance',
        pointAId: 'point-mm-a',
        pointBId: 'point-mm-b',
        value: 1,
        name: 'Length',
      }],
    });
    inspector.setFeature(feature);

    const length = container.querySelector(
      'input[data-numeric-label="Length"]'
    ) as HTMLInputElement;
    expect(length.value).toBe('25.4');
    expect(length.dataset.unit).toBe('mm');
    expect(container.textContent).toContain('Length (mm)');

    length.value = '50.8';
    length.dispatchEvent(new Event('input', { bubbles: true }));
    expect((inspector as unknown as { currentFeature: typeof feature }).currentFeature.parameters)
      .toMatchObject({ drivingDimensions: [expect.objectContaining({ value: 2 })] });

    length.value = '3 in';
    length.dispatchEvent(new Event('input', { bubbles: true }));
    expect((inspector as unknown as { currentFeature: typeof feature }).currentFeature.parameters)
      .toMatchObject({ drivingDimensions: [expect.objectContaining({ value: 3 })] });
  });

  it('does not advertise unsupported angular dimensions as editable inputs', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    inspector = new PropertyInspector({ container });
    const feature = createSketchFeature({
      planeRef: createWorldPlaneRef('xy'),
      entities: [createLineEntity([0, 0], [4, 0], 'line-a')],
      dimensions: [{ id: 'angle-a', type: 'angle', entityId: 'line-a', value: 45 }],
    });

    inspector.setFeature(feature);

    expect(container.textContent).toContain('Angular dimensions');
    expect(container.textContent).toContain('Not editable in this version');
    expect(container.querySelector('input[data-numeric-label="angle"]')).toBeNull();
  });

  it('edits Miter Cut result, angle, inset, and face-local tilt axis', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    inspector = new PropertyInspector({ container });
    const feature = createMiterCutFeature(
      createFaceRef('+X', 'board-body', 'board-feature'),
      { resultMode: 'split', angleDegrees: 45, inset: 0, tiltAxis: 'u' },
      'Miter Cut 1'
    );
    const onUpdate = vi.fn();
    eventBus.on('feature:update', onUpdate);

    inspector.setFeature(feature);

    expect(container.textContent).toContain('board-body');
    expect(container.textContent).toContain('+X');
    const selects = Array.from(container.querySelectorAll('select'));
    const result = selects.find((select) =>
      Array.from(select.options).some((option) => option.value === 'trim')
    );
    const tiltAxis = selects.find((select) =>
      Array.from(select.options).some((option) => option.value === 'v')
    );
    const angle = container.querySelector<HTMLInputElement>('input[data-numeric-label="Angle (deg)"]');
    const inset = container.querySelector<HTMLInputElement>('input[data-numeric-label="Inset"]');
    expect(result).not.toBeUndefined();
    expect(tiltAxis).not.toBeUndefined();
    expect(angle).not.toBeNull();
    expect(inset).not.toBeNull();

    result!.value = 'trim';
    result!.dispatchEvent(new Event('change', { bubbles: true }));
    tiltAxis!.value = 'v';
    tiltAxis!.dispatchEvent(new Event('change', { bubbles: true }));
    angle!.value = '0 - 30';
    angle!.dispatchEvent(new Event('input', { bubbles: true }));
    inset!.value = '1/2';
    inset!.dispatchEvent(new Event('input', { bubbles: true }));
    const applyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Apply'
    );
    applyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate.mock.calls[0]?.[0]).toMatchObject({
      featureId: feature.id,
      parameters: {
        faceRef: { featureId: 'board-feature', bodyId: 'board-body', faceId: '+X' },
        resultMode: 'trim',
        angleDegrees: -30,
        inset: 0.5,
        tiltAxis: 'v',
      },
    });
  });

  it('shows exact three-way end controls without exposing a misleading single angle', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    inspector = new PropertyInspector({ container });
    const feature = createMiterCutFeature(
      createFaceRef('+X', 'square-body', 'square-feature'),
      {
        cutStyle: 'threeWay',
        threeWayCorner: 'corner2',
        resultMode: 'split',
        inset: 0,
      },
      'Three-way end'
    );
    const onUpdate = vi.fn();
    eventBus.on('feature:update', onUpdate);

    inspector.setFeature(feature);

    expect(container.textContent).toContain('Three-way end');
    expect(container.textContent).toContain('Keep all pieces');
    expect(container.textContent).toContain('45\u00b0 + 45\u00b0');
    expect(container.querySelector('input[data-numeric-label="Angle (deg)"]')).toBeNull();
    expect(container.textContent).not.toContain('Angle across');

    const corner = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'corner3')
    );
    expect(corner?.value).toBe('corner2');
    corner!.value = 'corner3';
    corner!.dispatchEvent(new Event('change', { bubbles: true }));
    const applyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Apply'
    );
    applyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate.mock.calls[0]?.[0]).toMatchObject({
      featureId: feature.id,
      parameters: {
        cutStyle: 'threeWay',
        threeWayCorner: 'corner3',
        resultMode: 'split',
      },
    });
  });

  it('replaces single-miter controls immediately when Cut type changes', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    inspector = new PropertyInspector({ container });
    const feature = createMiterCutFeature(
      createFaceRef('+X', 'square-body', 'square-feature'),
      { cutStyle: 'single' },
      'Miter Cut 1'
    );
    inspector.setFeature(feature);

    expect(container.querySelector('input[data-numeric-label="Angle (deg)"]')).not.toBeNull();
    const cutType = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'threeWay')
    );
    expect(cutType).not.toBeUndefined();
    cutType!.value = 'threeWay';
    cutType!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(container.querySelector('input[data-numeric-label="Angle (deg)"]')).toBeNull();
    expect(container.textContent).not.toContain('Angle across');
    expect(container.textContent).toContain('45\u00b0 + 45\u00b0');
    expect(Array.from(container.querySelectorAll('select')).some((select) =>
      Array.from(select.options).some((option) => option.value === 'corner3')
    )).toBe(true);
  });

  it('offers a quick box creator when the document is empty', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    inspector = new PropertyInspector({ container });

    const onCreateBox = vi.fn();
    eventBus.on('feature:create-box', onCreateBox);

    eventBus.emit('document:loaded', { features: [] });

    expect(container.textContent).toContain('Create a box');
    expect(container.textContent).toContain('square prism');

    const numberInputs = Array.from(
      container.querySelectorAll('input[data-numeric-input="true"]')
    ) as HTMLInputElement[];
    expect(numberInputs).toHaveLength(3);

    numberInputs[0]!.value = '5';
    numberInputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
    numberInputs[1]!.value = '5';
    numberInputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
    numberInputs[2]!.value = '12';
    numberInputs[2]!.dispatchEvent(new Event('input', { bubbles: true }));

    const createButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Create box'
    );
    expect(createButton).not.toBeUndefined();
    createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onCreateBox).toHaveBeenCalledTimes(1);
    expect(onCreateBox.mock.calls[0]?.[0]).toMatchObject({
      parameters: {
        width: 5,
        depth: 5,
        height: 12,
        anchorMode: 'corner',
        origin: [0, 0, 0],
      },
    });
  });

  it('returns to the normal empty state once features exist', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    inspector = new PropertyInspector({ container });

    const feature = createSketchFeature({
      planeRef: createWorldPlaneRef('xy'),
      entities: [],
      dimensions: [],
    }, 'Sketch 1');

    eventBus.emit('document:loaded', { features: [feature] });

    expect(container.textContent).toContain('Select a feature to edit');
    expect(container.textContent).not.toContain('Create a box');
  });

  it('accepts fractions, metric units, and relative values without committing invalid expressions', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    inspector = new PropertyInspector({ container });
    const feature = createBoxFeature({ width: 4, depth: 2, height: 8, origin: [0, 0, 0] });
    const onUpdate = vi.fn();
    eventBus.on('feature:update', onUpdate);
    inspector.setFeature(feature);

    const inputFor = (label: string): HTMLInputElement => {
      const input = container!.querySelector(
        `input[data-numeric-label="${label}"]`
      ) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      return input!;
    };
    const enter = (input: HTMLInputElement, expression: string): void => {
      input.value = expression;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const width = inputFor('Width (X)');
    enter(width, '3/4');
    enter(inputFor('Depth (Y)'), '25 mm');
    enter(inputFor('Height (Z)'), '+1/8');
    enter(inputFor('X'), '1 + 2 * 3');
    enter(width, 'not a distance');

    expect(width.getAttribute('aria-invalid')).toBe('true');
    expect(width.validationMessage).toContain('Expected a number');
    expect(container.textContent).toContain('Expected a number');

    const applyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Apply'
    );
    applyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]?.[0]).toMatchObject({
      featureId: feature.id,
      parameters: {
        width: 0.75,
        depth: 25 / 25.4,
        height: 8.125,
        origin: [7, 0, 0],
      },
    });
  });

  it('edits free placement translation and rotation without exposing body IDs', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    inspector = new PropertyInspector({ container });
    const feature = createFeatureRecord('transformBodies', 'Move table top', {
      bodyRefs: [{ featureId: 'source-feature', bodyId: 'private-body-id' }],
      mode: 'move',
      placement: {
        type: 'Free',
        translation: [0, 0, 0],
        rotationDegrees: [0, 0, 0],
        pivot: [0, 0, 0],
      },
    });
    const onUpdate = vi.fn();
    eventBus.on('feature:update', onUpdate);
    inspector.setFeature(feature);

    expect(container.textContent).toContain('1 selected');
    expect(container.textContent).not.toContain('private-body-id');
    const x = container.querySelector<HTMLInputElement>(
      'input[data-numeric-label="X displacement"]',
    );
    const zRotation = container.querySelector<HTMLInputElement>(
      'input[data-numeric-label="Z rotation"]',
    );
    expect(x).not.toBeNull();
    expect(zRotation).not.toBeNull();
    x!.value = '2 1/2';
    x!.dispatchEvent(new Event('input', { bubbles: true }));
    zRotation!.value = '45';
    zRotation!.dispatchEvent(new Event('input', { bubbles: true }));
    const applyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Apply',
    );
    applyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate.mock.calls[0]?.[0]).toMatchObject({
      featureId: feature.id,
      parameters: {
        placement: {
          type: 'Free',
          translation: [2.5, 0, 0],
          rotationDegrees: [0, 0, 45],
        },
      },
    });
  });

  it('programmatically associates every editable property control with its visible label', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    inspector = new PropertyInspector({ container });

    const features = [
      createBoxFeature({ width: 4, depth: 2, height: 8, origin: [0, 0, 0] }),
      createFeatureRecord('linearPattern', 'Pattern', {
        sourceFeatureId: 'box-1',
        count: 3,
        spacing: 1,
        direction: [1, 0, 0],
        symmetric: false,
      }),
      createFeatureRecord('createComponent', 'Component', {
        name: 'Cabinet side',
        featureIds: ['box-1'],
      }),
    ];

    for (const feature of features) {
      inspector.setFeature(feature);
      const controls = Array.from(container.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        'input:not([type="hidden"]), select'
      ));
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        expect(control.id).not.toBe('');
        expect(
          control.closest('label') ?? container.querySelector(`label[for="${control.id}"]`)
        ).not.toBeNull();
      }
    }
  });
});
