type Rule = (value: unknown, path: string) => string | null;

export interface DocumentValidationOptions {
  /** Permit only fields for which normalization or legacy migration supplies defaults. */
  allowLegacyDefaults?: boolean;
}

/** Check runtime shapes before document state is replaced; geometry remains the rebuild's responsibility. */
export function validateDocumentStructure(value: unknown, options: DocumentValidationOptions = {}): string | null {
  const defaults = options.allowLegacyDefaults === true;
  const legacyMetadata = defaults && isRecord(value)
    && typeof value.version === 'string' && /^0\.[12]\./.test(value.version);
  const defaultable = (rule: Rule): Rule => defaults ? optional(rule) : rule;
  const identity = { id: string, name: string };
  const visibility = { visible: optional(boolean), locked: optional(boolean) };
  const body = object({
    ...identity, type: string, transform: tuple(16), visible: boolean, locked: boolean,
  });
  const feature = object({
    ...identity, type: string, parameters: record, refsIn: array(string), refsOut: array(string), suppressed: boolean,
  });
  const component = object({
    ...identity, featureIds: array(string), bodyIds: array(string), ...visibility,
  });
  const lockedAxes = object(Object.fromEntries(
    ['translateX', 'translateY', 'translateZ', 'rotateX', 'rotateY', 'rotateZ'].map((key) => [key, boolean])
  ));
  const instance = object({
    ...identity, componentId: string, transform: tuple(16), lockedAxes, grounded: boolean, ...visibility,
  });
  const faceReference = object({ instanceId: string, bodyId: string, faceId: string });
  const constraint = object({
    ...identity, type: oneOf('flush', 'offset'), refA: faceReference, refB: faceReference,
    offset: number, satisfied: boolean, suppressed: boolean,
    driving: optional(boolean), status: optional(string), errorMessage: optional(string),
  });
  const allowance = object({ length: optional(number), width: optional(number), thickness: optional(number) });
  const material = object({
    id: string, species: string, grade: optional(string), stockCode: optional(string), densityKgM3: optional(number),
  });
  const metadataField = (rule: Rule): Rule => legacyMetadata ? optional(rule) : rule;
  const orientation: Rule = legacyMetadata ? either(string, tuple(3)) : tuple(3);
  const woodworking = object({
    sourceFeatureId: optional(string), isBoard: metadataField(boolean), label: metadataField(string),
    material: metadataField(legacyMetadata ? either(string, material) : material),
    grainAxis: metadataField(orientation), thicknessAxis: metadataField(orientation),
    grainPattern: optional(string), partNumber: optional(string), notes: optional(string), stockAllowance: optional(allowance),
    bodyFrame: optional(object({
      origin: tuple(3), xAxis: tuple(3), yAxis: tuple(3), zAxis: tuple(3),
      provenance: optional(object({ kind: string, source: string, sourceFeatureId: optional(string) })),
    })),
  });
  const drawingReference = object({ bodyId: string, topologyId: string, kind: string });
  const drawing = object({
    ...identity,
    scope: (scope, path) => {
      const shape = object({ type: oneOf('document', 'bodies', 'component') })(scope, path);
      if (shape || !isRecord(scope)) return shape;
      if (scope.type === 'bodies') return array(string)(scope.bodyIds, `${path}.bodyIds`);
      if (scope.type === 'component') return string(scope.componentId, `${path}.componentId`);
      return null;
    },
    views: array(oneOf('front', 'top', 'right')),
    sheet: object({ width: number, height: number, orientation: oneOf('portrait', 'landscape') }),
    scale: either(oneOf('fit'), number), unit: oneOf('in', 'mm'), precision: number, showHiddenLines: boolean,
    dimensions: array(object({
      id: string, kind: string, references: array(drawingReference), view: oneOf('front', 'top', 'right'),
      position: tuple(2), prefix: optional(string), suffix: optional(string),
    })),
    notes: array(object({
      id: string, text: string, view: optional(oneOf('front', 'top', 'right')), position: tuple(2), featureId: optional(string),
    })),
  });
  const issue = object({
    version: string,
    metadata: object({ name: defaultable(string), created: defaultable(string), modified: defaultable(string) }),
    config: defaultable(object({
      units: defaultable(oneOf('inch', 'mm')),
      gridSpacing: defaultable(object({ major: defaultable(number), minor: defaultable(number) })),
      snapEnabled: defaultable(boolean),
    })),
    bodies: array(body),
    features: defaultable(array(feature)),
    components: defaultable(array(component)),
    componentInstances: defaultable(array(instance)),
    constraints: defaultable(array(constraint)),
    activeComponentId: defaultable(either(string, nullValue)),
    bodyPresentations: optional(dictionary(object({ name: string, visible: boolean, locked: boolean }))),
    bodyMetadata: optional(dictionary(woodworking)),
    drawingDefinitions: optional(array(drawing)),
    manufacturingDefaults: optional(object({
      units: defaults ? optional(oneOf('in', 'mm')) : oneOf('in', 'mm'),
      stockAllowance: defaults ? optional(allowance) : object({ length: number, width: number, thickness: number }),
    })),
  })(value, 'document');
  return issue ? `Invalid document structure: ${issue}` : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const record: Rule = (value, path) => isRecord(value) ? null : `${path} must be an object`;
const string: Rule = (value, path) => typeof value === 'string' ? null : `${path} must be a string`;
const boolean: Rule = (value, path) => typeof value === 'boolean' ? null : `${path} must be a boolean`;
const number: Rule = (value, path) => typeof value === 'number' && Number.isFinite(value) ? null : `${path} must be a finite number`;
const nullValue: Rule = (value, path) => value === null ? null : `${path} must be null`;

function optional(rule: Rule): Rule {
  return (value, path) => value === undefined ? null : rule(value, path);
}
function either(first: Rule, second: Rule): Rule {
  return (value, path) => first(value, path) === null || second(value, path) === null
    ? null : `${path} has an invalid type or value`;
}
function oneOf(...values: string[]): Rule {
  return (value, path) => typeof value === 'string' && values.includes(value)
    ? null : `${path} must be one of ${values.join(', ')}`;
}
function object(fields: Record<string, Rule>): Rule {
  return (value, path) => {
    if (!isRecord(value)) return `${path} must be an object`;
    for (const [key, rule] of Object.entries(fields)) {
      const issue = rule(value[key], `${path}.${key}`);
      if (issue) return issue;
    }
    return null;
  };
}
function array(item: Rule): Rule {
  return (value, path) => {
    if (!Array.isArray(value)) return `${path} must be an array`;
    for (let index = 0; index < value.length; index++) {
      const issue = item(value[index], `${path}[${index}]`);
      if (issue) return issue;
    }
    return null;
  };
}
function tuple(length: number): Rule {
  return (value, path) => !Array.isArray(value) || value.length !== length
    ? `${path} must contain ${length} finite numbers` : array(number)(value, path);
}
function dictionary(item: Rule): Rule {
  return (value, path) => {
    if (!isRecord(value)) return `${path} must be an object`;
    for (const [key, entry] of Object.entries(value)) {
      const issue = item(entry, `${path}[${JSON.stringify(key)}]`);
      if (issue) return issue;
    }
    return null;
  };
}
