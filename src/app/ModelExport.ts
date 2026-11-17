import type { Body } from '../geometry/Body';

export type ModelExportFormat = 'stl' | 'step' | '3mf';
export interface ModelExportFile {
  filename: string;
  mimeType: string;
  data: string | Uint8Array;
}

/** Load optional exporters only when requested. All physical output uses millimeters. */
export async function createModelExport(
  format: ModelExportFormat,
  bodies: readonly Body[],
  name: string,
): Promise<ModelExportFile> {
  // eslint-disable-next-line no-control-regex -- Download names must exclude control characters.
  const basename = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'Model';
  if (format === 'stl') {
    const { exportBodiesToSTL } = await import('../export/STLExporter');
    return { filename: `${basename}.stl`, mimeType: 'model/stl', data: exportBodiesToSTL(bodies) };
  }
  if (format === 'step') {
    const { exportToSTEP } = await import('../export/STEPExporter');
    return { filename: `${basename}.step`, mimeType: 'model/step', data: exportToSTEP(bodies, { name }) };
  }
  const { exportToMF3 } = await import('../export/MF3Exporter');
  return { filename: `${basename}.3mf`, mimeType: 'model/3mf', data: exportToMF3(bodies, { name }) };
}
