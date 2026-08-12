export { DocumentManager } from './document';
export {
  AutosaveManager,
  createDocumentAutosaveKey,
  type AutosaveContext,
  type AutosaveEntrySummary,
  type AutosaveSaveOutcome,
  type AutosaveManagerOptions,
  type RestoredAutosaveEntry,
} from './AutosaveManager';
export {
  RecentFilesStore,
  type RecentFileEntry,
  type RecentFilesStoreOptions,
} from './RecentFilesStore';
export {
  serialize,
  deserialize,
  saveToFile,
  loadFromFile,
  type SerializeOutcome,
  type DeserializeOutcome,
} from './serializer';
export {
  CURRENT_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
  DEFAULT_STOCK_ALLOWANCE,
  DEFAULT_MANUFACTURING_DEFAULTS,
  DEFAULT_DRAWING_DEFINITIONS,
  LEGACY_CONSTRAINT_PERSISTENCE_DEFAULTS,
  NEW_CONSTRAINT_PERSISTENCE_DEFAULTS,
  SCHEMA_MIGRATIONS,
  migrateDocumentSchema,
  migrateSketchFeatureToSchemaV03,
  type MigrationDiagnostic,
  type MigrationDiagnosticCode,
  type MigrationErrorCode,
  type MigrationOutcome,
} from './Migrations';
export {
  createMemoryStorage,
  resolveStorage,
  type StorageLike,
} from './storage';
