import type { FeatureRecord } from '../features/FeatureRecord';
import { migrateSketchFeature } from '../features/sketch/SketchFeature';
import {
  migrateNormalizedSketchDataToV2,
  type NormalizedSketchDataMigrationInput,
} from '../sketch/NormalizedSketchV2';

/** The only schema version emitted by the current application. */
export const CURRENT_SCHEMA_VERSION = '0.3.0';

export const LEGACY_SCHEMA_VERSION = '0.2.0';

export const DEFAULT_STOCK_ALLOWANCE = Object.freeze({
  length: 0,
  width: 0,
  thickness: 0,
});

export const DEFAULT_MANUFACTURING_DEFAULTS = Object.freeze({
  units: 'in' as const,
  stockAllowance: DEFAULT_STOCK_ALLOWANCE,
});

export const DEFAULT_DRAWING_DEFINITIONS: readonly never[] = Object.freeze([]);

export const LEGACY_CONSTRAINT_PERSISTENCE_DEFAULTS = Object.freeze({
  driving: false,
  status: 'legacy-validate-only' as const,
});

export const NEW_CONSTRAINT_PERSISTENCE_DEFAULTS = Object.freeze({
  driving: true,
  status: 'unsolved' as const,
});

export type MigrationDiagnosticCode = 'SCHEMA_MIGRATED';

export interface MigrationDiagnostic {
  code: MigrationDiagnosticCode;
  fromVersion: string;
  toVersion: string;
  message: string;
}

export type MigrationErrorCode =
  | 'INVALID_SCHEMA_VERSION'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'FUTURE_SCHEMA_VERSION'
  | 'MIGRATION_FAILED';

export interface MigrationSuccess {
  ok: true;
  document: Record<string, unknown> & { version: string };
  diagnostics: MigrationDiagnostic[];
}

export interface MigrationFailure {
  ok: false;
  code: MigrationErrorCode;
  error: string;
}

export type MigrationOutcome = MigrationSuccess | MigrationFailure;

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

interface SchemaMigration {
  readonly fromMajor: number;
  readonly fromMinor: number;
  readonly toVersion: string;
  migrate(document: Record<string, unknown> & { version: string }): Record<string, unknown> & {
    version: string;
  };
}

function parseVersion(version: string): SemanticVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(left: SemanticVersion, right: SemanticVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function cloneRecord(
  document: Record<string, unknown> & { version: string }
): Record<string, unknown> & { version: string } {
  if (typeof structuredClone === 'function') {
    return structuredClone(document);
  }

  return JSON.parse(JSON.stringify(document)) as Record<string, unknown> & { version: string };
}

type Vector3 = [number, number, number];

class MigrationDataError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function axisFromLegacy(value: unknown, field: string): Vector3 {
  if (typeof value === 'string') {
    const axis = value.trim().toLowerCase();
    const vectors: Record<string, Vector3> = {
      x: [1, 0, 0],
      '+x': [1, 0, 0],
      '-x': [-1, 0, 0],
      y: [0, 1, 0],
      '+y': [0, 1, 0],
      '-y': [0, -1, 0],
      z: [0, 0, 1],
      '+z': [0, 0, 1],
      '-z': [0, 0, -1],
    };
    const vector = vectors[axis];
    if (vector) return vector;
  }

  if (
    Array.isArray(value)
    && value.length === 3
    && value.every((component) => typeof component === 'number' && Number.isFinite(component))
  ) {
    const vector = value as Vector3;
    if (Math.hypot(...vector) > 0) return [...vector];
  }

  throw new MigrationDataError(`${field} must be an axis name or three finite non-zero numbers.`);
}

function defaultThicknessAxis(grainAxis: Vector3): Vector3 {
  const magnitude = Math.hypot(...grainAxis);
  const normalized = grainAxis.map((component) => component / magnitude) as Vector3;
  const candidates: Vector3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return candidates.reduce((best, candidate) =>
    Math.abs(dot(normalized, candidate)) < Math.abs(dot(normalized, best)) ? candidate : best
  );
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function humanizeIdentifier(value: string): string {
  return value.trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

function bodyLabel(document: Record<string, unknown>, bodyId: string): string {
  const presentations = isRecord(document.bodyPresentations) ? document.bodyPresentations : {};
  const presentation = isRecord(presentations[bodyId]) ? presentations[bodyId] : null;
  if (presentation && typeof presentation.name === 'string' && presentation.name.trim()) {
    return presentation.name;
  }

  const bodies = Array.isArray(document.bodies) ? document.bodies : [];
  const body = bodies.find((candidate) => isRecord(candidate) && candidate.id === bodyId);
  return isRecord(body) && typeof body.name === 'string' && body.name.trim() ? body.name : bodyId;
}

function sourceFeatureId(document: Record<string, unknown>, bodyId: string): string | undefined {
  const features = Array.isArray(document.features) ? document.features : [];
  const owner = features.find((candidate) =>
    isRecord(candidate) && Array.isArray(candidate.refsOut) && candidate.refsOut.includes(bodyId)
  );
  return isRecord(owner) && typeof owner.id === 'string' ? owner.id : undefined;
}

function migrateMaterial(value: unknown, bodyId: string): Record<string, unknown> {
  if (typeof value === 'string' && value.trim()) {
    const id = value.trim();
    return { id, species: humanizeIdentifier(id) };
  }

  if (!isRecord(value)) {
    throw new MigrationDataError(`bodyMetadata.${bodyId}.material must be a string or object.`);
  }
  if (typeof value.id !== 'string' || !value.id.trim()) {
    throw new MigrationDataError(`bodyMetadata.${bodyId}.material.id is required.`);
  }
  if (typeof value.species !== 'string' || !value.species.trim()) {
    throw new MigrationDataError(`bodyMetadata.${bodyId}.material.species is required.`);
  }
  return { ...value, id: value.id.trim(), species: value.species.trim() };
}

function migrateBodyMetadata(document: Record<string, unknown>): Record<string, unknown> {
  if (document.bodyMetadata === undefined) return {};
  if (!isRecord(document.bodyMetadata)) {
    throw new MigrationDataError('bodyMetadata must be an object keyed by body id.');
  }

  return Object.fromEntries(Object.entries(document.bodyMetadata).map(([bodyId, value]) => {
    if (!isRecord(value)) {
      throw new MigrationDataError(`bodyMetadata.${bodyId} must be an object.`);
    }

    const grainAxis = axisFromLegacy(value.grainAxis, `bodyMetadata.${bodyId}.grainAxis`);
    const thicknessAxis = value.thicknessAxis === undefined
      ? defaultThicknessAxis(grainAxis)
      : axisFromLegacy(value.thicknessAxis, `bodyMetadata.${bodyId}.thicknessAxis`);
    const normalizedDot = Math.abs(dot(grainAxis, thicknessAxis))
      / (Math.hypot(...grainAxis) * Math.hypot(...thicknessAxis));
    if (normalizedDot > 1e-9) {
      throw new MigrationDataError(
        `bodyMetadata.${bodyId}.grainAxis and thicknessAxis must be perpendicular.`
      );
    }
    if (value.isBoard !== undefined && typeof value.isBoard !== 'boolean') {
      throw new MigrationDataError(`bodyMetadata.${bodyId}.isBoard must be a boolean.`);
    }
    if (value.label !== undefined && typeof value.label !== 'string') {
      throw new MigrationDataError(`bodyMetadata.${bodyId}.label must be a string.`);
    }

    const derivedSourceFeatureId = sourceFeatureId(document, bodyId);
    return [bodyId, {
      ...value,
      ...(typeof value.sourceFeatureId === 'string'
        ? { sourceFeatureId: value.sourceFeatureId }
        : derivedSourceFeatureId ? { sourceFeatureId: derivedSourceFeatureId } : {}),
      isBoard: value.isBoard ?? true,
      label: typeof value.label === 'string' ? value.label : bodyLabel(document, bodyId),
      material: migrateMaterial(value.material, bodyId),
      grainAxis,
      thicknessAxis,
    }];
  }));
}

/** Normalize a sketch feature to the additive v2 persistence envelope. */
export function migrateSketchFeatureToSchemaV03<T extends FeatureRecord>(feature: T): T {
  if (feature.type !== 'sketch') return feature;

  const originalParameters = feature.parameters;
  const normalizedFeature = migrateSketchFeature(feature);
  const normalizedParameters = normalizedFeature.parameters;
  const envelope = migrateNormalizedSketchDataToV2({
    geometry: normalizedParameters.geometry,
    entities: normalizedParameters.entities,
    relations: normalizedParameters.relations,
    drivingDimensions: normalizedParameters.drivingDimensions,
    inferenceInputs: originalParameters.inferenceInputs,
  } as NormalizedSketchDataMigrationInput);

  return {
    ...normalizedFeature,
    parameters: {
      ...originalParameters,
      ...normalizedParameters,
      ...envelope,
    },
  };
}

function migrateSketchFeaturesToV2(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new MigrationDataError('features must be an array.');
  }

  return value.map((feature, index) => {
    if (!isRecord(feature)) {
      throw new MigrationDataError(`features[${index}] must be an object.`);
    }
    if (feature.type !== 'sketch') return feature;
    if (
      typeof feature.id !== 'string'
      || typeof feature.name !== 'string'
      || !isRecord(feature.parameters)
      || !Array.isArray(feature.refsIn)
      || !Array.isArray(feature.refsOut)
      || typeof feature.suppressed !== 'boolean'
    ) {
      throw new MigrationDataError(`features[${index}] is not a valid sketch feature.`);
    }
    return migrateSketchFeatureToSchemaV03(feature as unknown as FeatureRecord);
  });
}

function migrateManufacturingDefaults(
  document: Record<string, unknown>
): Record<string, unknown> {
  const existing = document.manufacturingDefaults;
  if (existing !== undefined && !isRecord(existing)) {
    throw new MigrationDataError('manufacturingDefaults must be an object.');
  }
  const defaults = existing ?? {};
  const config = isRecord(document.config) ? document.config : {};
  const units = defaults.units ?? (config.units === 'mm' ? 'mm' : 'in');
  const allowance = defaults.stockAllowance;
  if (allowance !== undefined && !isRecord(allowance)) {
    throw new MigrationDataError('manufacturingDefaults.stockAllowance must be an object.');
  }

  return {
    ...defaults,
    units,
    stockAllowance: {
      ...DEFAULT_STOCK_ALLOWANCE,
      ...(allowance ?? {}),
    },
  };
}

function migrateLegacyConstraints(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new MigrationDataError('constraints must be an array.');
  }

  return value.map((constraint, index) => {
    if (!isRecord(constraint)) {
      throw new MigrationDataError(`constraints[${index}] must be an object.`);
    }
    const authoredDriving = constraint.driving;
    const authoredStatus = constraint.status;
    return {
      ...constraint,
      // A 0.2 constraint was persisted before runtime residuals were
      // authoritative. Opening it must therefore validate, never move parts.
      driving: LEGACY_CONSTRAINT_PERSISTENCE_DEFAULTS.driving,
      status: LEGACY_CONSTRAINT_PERSISTENCE_DEFAULTS.status,
      ...(authoredDriving !== undefined || authoredStatus !== undefined
        ? {
            legacyState: {
              ...(authoredDriving !== undefined ? { driving: authoredDriving } : {}),
              ...(authoredStatus !== undefined ? { status: authoredStatus } : {}),
            },
          }
        : {}),
    };
  });
}

function migrateV03BodyMetadata(document: Record<string, unknown>): Record<string, unknown> {
  if (document.bodyMetadata === undefined) return {};
  if (!isRecord(document.bodyMetadata)) {
    throw new MigrationDataError('bodyMetadata must be an object keyed by body id.');
  }

  return Object.fromEntries(
    Object.entries(document.bodyMetadata).map(([bodyId, metadata]) => {
      if (!isRecord(metadata)) {
        throw new MigrationDataError(`bodyMetadata.${bodyId} must be an object.`);
      }
      const allowance = metadata.stockAllowance;
      if (allowance !== undefined && !isRecord(allowance)) {
        throw new MigrationDataError(
          `bodyMetadata.${bodyId}.stockAllowance must be an object.`
        );
      }
      return [bodyId, {
        ...metadata,
        stockAllowance: {
          ...DEFAULT_STOCK_ALLOWANCE,
          ...(allowance ?? {}),
        },
        ...(metadata.bodyFrame === undefined
          ? deriveBodyFrameMetadata(document, bodyId, metadata)
          : {}),
      }];
    })
  );
}

function deriveBodyFrameMetadata(
  document: Record<string, unknown>,
  bodyId: string,
  metadata: Record<string, unknown>
): { bodyFrame: Record<string, unknown> } | Record<string, never> {
  const grainAxis = finiteVector(metadata.grainAxis);
  const thicknessAxis = finiteVector(metadata.thicknessAxis);
  if (!grainAxis || !thicknessAxis) return {};

  const xAxis = normalizeVector(grainAxis);
  const zAxis = normalizeVector(thicknessAxis);
  if (Math.abs(dot(xAxis, zAxis)) > 1e-9) return {};
  const yAxis = normalizeVector(cross(zAxis, xAxis));
  const body = (Array.isArray(document.bodies) ? document.bodies : [])
    .find((candidate) => isRecord(candidate) && candidate.id === bodyId);
  const transform = isRecord(body) && Array.isArray(body.transform)
    ? body.transform
    : [];
  const origin: Vector3 = [12, 13, 14].map((index) => {
    const component = transform[index];
    return typeof component === 'number' && Number.isFinite(component) ? component : 0;
  }) as Vector3;

  return {
    bodyFrame: {
      origin,
      xAxis,
      yAxis,
      zAxis,
      provenance: {
        kind: 'derived',
        source: 'woodworking-orientation',
        ...(typeof metadata.sourceFeatureId === 'string'
          ? { sourceFeatureId: metadata.sourceFeatureId }
          : {}),
      },
    },
  };
}

function finiteVector(value: unknown): Vector3 | null {
  return Array.isArray(value)
    && value.length === 3
    && value.every((component) => typeof component === 'number' && Number.isFinite(component))
    && Math.hypot(...value) > 0
    ? [...value] as Vector3
    : null;
}

function normalizeVector(vector: Vector3): Vector3 {
  const magnitude = Math.hypot(...vector);
  return vector.map((component) => component / magnitude) as Vector3;
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

/**
 * v0.2 makes the history and assembly collections explicit while retaining
 * every v0.1 field. Additive defaults are applied only when a field is absent.
 */
const migrateV01ToV02: SchemaMigration = {
  fromMajor: 0,
  fromMinor: 1,
  toVersion: LEGACY_SCHEMA_VERSION,
  migrate(document) {
    const migrated = cloneRecord(document);
    migrated.version = LEGACY_SCHEMA_VERSION;
    migrated.features ??= [];
    migrated.components ??= [];
    migrated.componentInstances ??= [];
    migrated.constraints ??= [];
    migrated.activeComponentId ??= null;
    migrated.bodyMetadata = migrateBodyMetadata(migrated);
    return migrated;
  },
};

/**
 * v0.3 adds renderer-independent drawings and manufacturing intent while
 * retaining all v0.2 fields. Defaults are additive, deterministic, and do not
 * replace any authored value.
 */
const migrateV02ToV03: SchemaMigration = {
  fromMajor: 0,
  fromMinor: 2,
  toVersion: CURRENT_SCHEMA_VERSION,
  migrate(document) {
    const migrated = cloneRecord(document);
    migrated.version = CURRENT_SCHEMA_VERSION;
    migrated.features = migrateSketchFeaturesToV2(migrated.features);
    if (migrated.drawingDefinitions === undefined) {
      migrated.drawingDefinitions = [];
    } else if (!Array.isArray(migrated.drawingDefinitions)) {
      throw new MigrationDataError('drawingDefinitions must be an array.');
    }
    migrated.manufacturingDefaults = migrateManufacturingDefaults(migrated);
    migrated.constraints = migrateLegacyConstraints(migrated.constraints);
    migrated.bodyMetadata = migrateV03BodyMetadata(migrated);
    return migrated;
  },
};

/** Ordered schema upgrades. Each step must be deterministic and lossless. */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  migrateV01ToV02,
  migrateV02ToV03,
];

/**
 * Upgrade a parsed document to the current schema. Future versions fail
 * closed so opening a file can never silently discard newer data.
 */
export function migrateDocumentSchema(value: Record<string, unknown>): MigrationOutcome {
  if (typeof value.version !== 'string') {
    return {
      ok: false,
      code: 'INVALID_SCHEMA_VERSION',
      error: 'Schema version must be a semantic version string.',
    };
  }

  let currentVersion = parseVersion(value.version);
  const supportedVersion = parseVersion(CURRENT_SCHEMA_VERSION)!;
  if (!currentVersion) {
    return {
      ok: false,
      code: 'INVALID_SCHEMA_VERSION',
      error: `Invalid schema version: ${value.version}.`,
    };
  }

  if (compareVersions(currentVersion, supportedVersion) > 0) {
    return {
      ok: false,
      code: 'FUTURE_SCHEMA_VERSION',
      error: `Schema version ${value.version} is newer than supported version ${CURRENT_SCHEMA_VERSION}.`,
    };
  }

  let document = cloneRecord(value as Record<string, unknown> & { version: string });
  const diagnostics: MigrationDiagnostic[] = [];

  while (document.version !== CURRENT_SCHEMA_VERSION) {
    const migration = SCHEMA_MIGRATIONS.find(
      (candidate) =>
        candidate.fromMajor === currentVersion!.major &&
        candidate.fromMinor === currentVersion!.minor
    );
    if (!migration) {
      return {
        ok: false,
        code: 'UNSUPPORTED_SCHEMA_VERSION',
        error: `Schema version ${document.version} cannot be migrated to ${CURRENT_SCHEMA_VERSION}.`,
      };
    }

    const fromVersion = document.version;
    try {
      document = migration.migrate(document);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown migration error';
      return {
        ok: false,
        code: 'MIGRATION_FAILED',
        error: `Migration from ${fromVersion} failed: ${message}`,
      };
    }
    const nextVersion = parseVersion(document.version);
    if (!nextVersion || compareVersions(nextVersion, currentVersion) <= 0) {
      return {
        ok: false,
        code: 'UNSUPPORTED_SCHEMA_VERSION',
        error: `Migration from ${fromVersion} did not advance the schema version.`,
      };
    }

    diagnostics.push({
      code: 'SCHEMA_MIGRATED',
      fromVersion,
      toVersion: document.version,
      message: `Migrated document schema from ${fromVersion} to ${document.version}.`,
    });
    currentVersion = nextVersion;
  }

  return { ok: true, document, diagnostics };
}
