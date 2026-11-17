import type { Body } from '../geometry/Body';
import { buildExportMesh, requireBodies, triangleNormal, type ExportPoint } from './ExportMesh';

export interface STLExportOptions {
  format: 'ascii';
}

/** ASCII STL has no unit field; coordinates are explicitly converted to mm. */
export function exportBodiesToSTL(bodies: readonly Body[]): string {
  requireBodies(bodies);
  const lines = ['solid model_mm'];
  for (const body of bodies) {
    const mesh = buildExportMesh(body);
    for (const triangle of mesh.triangles) {
      const [a, b, c] = triangle.map((index) => mesh.vertices[index]!) as [ExportPoint, ExportPoint, ExportPoint];
      lines.push(`  facet normal ${triangleNormal(a, b, c).join(' ')}`, '    outer loop');
      for (const vertex of [a, b, c]) lines.push(`      vertex ${vertex.join(' ')}`);
      lines.push('    endloop', '  endfacet');
    }
  }
  lines.push('endsolid model_mm');
  return lines.join('\n');
}

export function exportBodyToSTL(body: Body): string {
  return exportBodiesToSTL([body]);
}
