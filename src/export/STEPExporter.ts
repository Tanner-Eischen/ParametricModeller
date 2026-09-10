/**
 * STEP Exporter - Exports geometry as ISO 10303 STEP (AP214) files.
 * Industry-standard format for CAD interoperability.
 */

import type { Body } from '../geometry';

/**
 * Export options for STEP.
 */
export interface STEPExportOptions {
  /** Optional document body name */
  name?: string;
  /** Author name */
  author?: string;
  /** Organization */
  organization?: string;
}

/**
 * Export bodies as STEP file.
 */
export function exportToSTEP(bodies: Body[], options: STEPExportOptions): string {
  const timestamp = new Date().toISOString();
  const author = options.author || 'User';
  const organization = options.organization || 'Parametric Modeler';
  const name = options.name || 'Model';

  // Collect all geometry entities
  const allVertices: STEPVertex[] = [];
  const allEdges: STEPEdge[] = [];
  const allFaces: STEPFace[] = [];

  for (const body of bodies) {
    for (const [, face] of body.faces) {
      const plane = body.planes.get(face.planeId);
      if (!plane) continue;

      // Get boundary edges and vertices
      const edges: STEPEdge[] = [];
      const vertices: STEPVertex[] = [];

      for (const edgeId of face.boundaryEdgeIds) {
        const edge = body.edges.get(edgeId);
        if (!edge) continue;

        const v0 = body.vertices.get(edge.vertexIds[0]);
        const v1 = body.vertices.get(edge.vertexIds[1]);
        if (!v0 || !v1) continue;

        // Create vertices if not exists
        const vertex0 = createVertex(v0.position);
        const vertex1 = createVertex(v1.position);
        vertices.push(vertex0, vertex1);
        allVertices.push(vertex0, vertex1);

        const edgeEntity = createEdge(vertex0, vertex1);
        edges.push(edgeEntity);
        allEdges.push(edgeEntity);
      }

      // Create face from edge loop
      const faceEntity = createFace(edges);
      allFaces.push(faceEntity);
    }
  }

  // Build STEP content
  const lines: string[] = [];

  // Header section
  lines.push('ISO-10303-21;');
  lines.push('HEADER;');
  lines.push('FILE_DESCRIPTION(("Manual"),"2;1");');
  lines.push(`FILE_NAME("${name}","${timestamp}","${author}","${organization}","Parametric Modeler","Parametric Modeler","ISO-10303-21");`);
  lines.push('FILE_SCHEMA(("AUTOMATED_DESIGN"));');
  lines.push('ENDSEC;');

  // Data section
  lines.push('DATA;');

  // Write vertices
  let id = 1;
  for (const vertex of allVertices) {
    lines.push(`#${id} = CARTESIAN_POINT((),(${vertex.x.toFixed(6)}, ${vertex.y.toFixed(6)}, ${vertex.z.toFixed(6)}));`);
    vertex.id = id;
    id++;
  }

  // Write edges
  for (const edge of allEdges) {
    lines.push(`#${id} = EDGE_CURVE(${(edge.start.id || 0)}, ${(edge.end.id || 0)}, #1, .T.);`);
    edge.id = id;
    id++;
  }

  // Write faces
  for (const face of allFaces) {
    const edgeRefs = face.edges.map(e => `#${e.id || 0}`).join(', ');
    lines.push(`#${id} = ADVANCED_FACE((),(${edgeRefs}), #1, .T.);`);
    face.id = id;
    id++;
  }

  // Write shell
  const faceIds = allFaces.map(f => `#${f.id || 0}`).join(', ');
  lines.push(`#${id} = CLOSED_SHELL((),(${faceIds}));`);

  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');

  return lines.join('\n');
}

interface STEPVertex {
  id?: number;
  x: number;
  y: number;
  z: number;
}

interface STEPEdge {
  id?: number;
  start: STEPVertex;
  end: STEPVertex;
}

interface STEPFace {
  id?: number;
  edges: STEPEdge[];
}

function createVertex(position: [number, number, number]): STEPVertex {
  return {
    x: position[0],
    y: position[1],
    z: position[2],
  };
}

function createEdge(start: STEPVertex, end: STEPVertex): STEPEdge {
  return { start, end };
}

function createFace(edges: STEPEdge[]): STEPFace {
  return { edges };
}
