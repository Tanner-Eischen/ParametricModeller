/**
 * 3MF Exporter - Exports geometry as 3D Manufacturing Format.
 * Modern format for 3D printing with support for materials and colors.
 */

import type { Body } from '../geometry';

/**
 * Export options for 3MF.
 */
export interface MF3ExportOptions {
  /** Optional document body name */
  name?: string;
}

/**
 * Export bodies as 3MF package.
 * Returns the 3MF model XML content.
 */
export function exportToMF3(bodies: Body[], options: MF3ExportOptions): string {
  return build3MFModel(bodies, options);
}

/**
 * Build the 3MF model XML content.
 */
function build3MFModel(bodies: Body[], options: MF3ExportOptions): string {
  const name = options.name || 'Model';

  const parts: string[] = [];

  // Root element
  parts.push('<?xml version="1.0" encoding="utf-8"?>');
  parts.push('<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02/" unit="millimeter">');

  // Metadata
  parts.push('  <metadata name="Title">' + encodeXml(name) + '</metadata>');
  parts.push('  <metadata name="Created">2026-09-07T00:00:00Z</metadata>');

  // Build resources
  parts.push('  <resources>');
  parts.push('    <build>');

  // Convert each body to mesh and add as object
  let objectIndex = 1;
  for (const body of bodies) {
    const mesh = bodyToMesh(body);
    const objectXml = buildObjectXml(mesh, objectIndex);
    parts.push('      ' + objectXml);
    objectIndex++;
  }

  parts.push('    </build>');
  parts.push('  </resources>');
  parts.push('</model>');

  return parts.join('\n');
}

/**
 * Convert a B-Rep body to a mesh representation.
 */
function bodyToMesh(body: Body): { vertices: number[]; triangles: number[] } {
  const vertices: number[] = [];
  const vertexMap = new Map<string, number>();

  const triangles: number[] = [];

  for (const [, face] of body.faces) {
    // Collect boundary vertices
    const boundaryVertices: { x: number; y: number; z: number }[] = [];

    for (const edgeId of face.boundaryEdgeIds) {
      const edge = body.edges.get(edgeId);
      if (!edge) continue;

      for (const vertexId of edge.vertexIds) {
        const vertex = body.vertices.get(vertexId);
        if (vertex) {
          boundaryVertices.push({ x: vertex.position[0], y: vertex.position[1], z: vertex.position[2] });
        }
      }
    }

    // Simple triangulation: fan from first vertex
    if (boundaryVertices.length >= 3 && boundaryVertices[0]) {
      const v0 = boundaryVertices[0];

      for (let i = 1; i < boundaryVertices.length - 1; i++) {
        const v1 = boundaryVertices[i];
        const v2 = boundaryVertices[i + 1];
        if (!v1 || !v2) continue;

        // Add vertices
        const i0 = addVertex(vertices, vertexMap, v0.x, v0.y, v0.z);
        const i1 = addVertex(vertices, vertexMap, v1.x, v1.y, v1.z);
        const i2 = addVertex(vertices, vertexMap, v2.x, v2.y, v2.z);

        // Add triangle
        triangles.push(i0, i1, i2);
      }
    }
  }

  return { vertices, triangles };
}

function addVertex(vertices: number[], vertexMap: Map<string, number>, x: number, y: number, z: number): number {
  const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
  const existing = vertexMap.get(key);
  if (existing !== undefined) return existing;

  const index = vertices.length / 3;
  vertices.push(x, y, z);
  vertexMap.set(key, index);
  return index;
}

function buildObjectXml(mesh: { vertices: number[]; triangles: number[] }, index: number): string {
  const objId = `o${index}`;

  const vertices = mesh.vertices.map((v, i) => `vertex id="${i}" p1="${v.toFixed(4)}" p2="${mesh.vertices[i + 1]?.toFixed(4)}" p3="${mesh.vertices[i + 2]?.toFixed(4)}"`).join('\n      ');

  const triangles = mesh.triangles
    .reduce((acc, t, i) => i % 3 === 0 ? `${acc}\n      ${t}` : `${acc} ${t}`, '')
    .trim();

  return `<object id="${objId}" name="Body">
    <mesh>
      <vertices>
      ${vertices}
      </vertices>
      <triangles>
      ${triangles}
      </triangles>
    </mesh>
  </object>`;
}

function encodeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
