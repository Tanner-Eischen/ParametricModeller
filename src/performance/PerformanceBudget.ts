import type { PerfReport } from './PerfReport';

export interface PerformanceBudget {
  maxRebuildMs: number;
  maxAveragePickingMs: number;
  maxSinglePickingMs: number;
}

export interface PerformanceBudgetViolation {
  metric: 'totalRebuildMs' | 'averagePickingMs' | 'maxPickingMs';
  actualMs: number;
  budgetMs: number;
}

/** Pure budget evaluation suitable for CI and benchmark reporting. */
export function evaluatePerformanceBudget(
  report: PerfReport,
  budget: PerformanceBudget
): PerformanceBudgetViolation[] {
  const violations: PerformanceBudgetViolation[] = [];

  if (report.totalRebuildMs > budget.maxRebuildMs) {
    violations.push({
      metric: 'totalRebuildMs',
      actualMs: report.totalRebuildMs,
      budgetMs: budget.maxRebuildMs,
    });
  }
  if (report.picking.averageMs > budget.maxAveragePickingMs) {
    violations.push({
      metric: 'averagePickingMs',
      actualMs: report.picking.averageMs,
      budgetMs: budget.maxAveragePickingMs,
    });
  }
  if (report.picking.maxMs > budget.maxSinglePickingMs) {
    violations.push({
      metric: 'maxPickingMs',
      actualMs: report.picking.maxMs,
      budgetMs: budget.maxSinglePickingMs,
    });
  }

  return violations;
}
