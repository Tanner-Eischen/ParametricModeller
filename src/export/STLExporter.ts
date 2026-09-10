/**
 * STL Exporter - Exports geometry as ASCII STL files.
 * Used for 3D printing workflows.
 */

import type { Body } from '../geometry';

/**
 * Export options for STL.
 */
export interface STLExportOptions {
  /** Output format: 'ascii' */
  format: 'ascii';
}

/**
 * Export a body as STL.
 */
export function exportBodyToSTL(body: Body): string {
  const lines: string[] = [];
  lines.push('solid model');

  for (const [, face] of body.faces) {
    // Get boundary vertices
    const vertices: [number, number, number][] = [];
    const vertexIds = new Set<string>();

    for (const edgeId of face.boundaryEdgeIds) {
      const edge = body.edges.get(edgeId);
      if (!edge) continue;

      for (const vertexId of edge.vertexIds) {
        if (!vertexIds.has(vertexId)) {
          vertexIds.add(vertexId);
          const vertex = body.vertices.get(vertexId);
          if (vertex) {
            vertices.push(vertex.position);
          }
        }
      }
    }

    // Simple triangulation: fan from first vertex
    if (vertices.length >= 3) {
      const [v0, v1, v2] = vertices;
      if (!v0 || !v1 || !v2) continue;

      // Compute face normal
      const e1x = v1[0] - v0[0];
      const e1y = v1[1] - v0[1];
      const e1z = v1[2] - v0[2];
      const e2x = v2[0] - v0[0];
      const e2y = v2[1] - v0[1];
      const e2z = v2[2] - v0[2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      lines.push(`  facet normal ${(nx / len).toFixed(6)} ${(ny / len).toFixed(6)} ${(nz / len).toFixed(6)}`);
      lines.push('    outer loop');

      // Output all vertices
      for (const v of vertices) {
        lines.push(`      vertex ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}`);
      }

      lines.push('    endloop');
      lines.push('  endfacet');
    }
  }

  lines.push('endsolid model');

  return lines.join('\n');
}
