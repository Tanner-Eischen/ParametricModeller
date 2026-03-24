/**
 * Diagnostic severity levels
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * A diagnostic message from feature validation or rebuild.
 */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  featureId?: string;
  entityId?: string;
}

/**
 * Create an error diagnostic.
 */
export function error(
  code: string,
  message: string,
  featureId?: string,
  entityId?: string
): Diagnostic {
  const d: Diagnostic = {
    severity: 'error',
    code,
    message,
  };
  if (featureId !== undefined) d.featureId = featureId;
  if (entityId !== undefined) d.entityId = entityId;
  return d;
}

/**
 * Create a warning diagnostic.
 */
export function warning(
  code: string,
  message: string,
  featureId?: string,
  entityId?: string
): Diagnostic {
  const d: Diagnostic = {
    severity: 'warning',
    code,
    message,
  };
  if (featureId !== undefined) d.featureId = featureId;
  if (entityId !== undefined) d.entityId = entityId;
  return d;
}

/**
 * Create an info diagnostic.
 */
export function info(
  code: string,
  message: string,
  featureId?: string,
  entityId?: string
): Diagnostic {
  const d: Diagnostic = {
    severity: 'info',
    code,
    message,
  };
  if (featureId !== undefined) d.featureId = featureId;
  if (entityId !== undefined) d.entityId = entityId;
  return d;
}

/**
 * Check if diagnostics contain any errors.
 */
export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}

/**
 * Get only error diagnostics.
 */
export function getErrors(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((d) => d.severity === 'error');
}

/**
 * Get only warning diagnostics.
 */
export function getWarnings(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((d) => d.severity === 'warning');
}

/**
 * Format a diagnostic for display.
 */
export function formatDiagnostic(d: Diagnostic): string {
  const prefix = d.severity === 'error' ? 'ERROR' : d.severity === 'warning' ? 'WARN' : 'INFO';
  const location = d.featureId
    ? d.entityId
      ? ` [feature:${d.featureId}, entity:${d.entityId}]`
      : ` [feature:${d.featureId}]`
    : '';
  return `${prefix}${location}: ${d.code} - ${d.message}`;
}
