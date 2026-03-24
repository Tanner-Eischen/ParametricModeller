import type { Body } from './Body';
import type { Plane } from './Plane';
import type { Diagnostic } from '../features/Diagnostics';
import { cloneBody } from './Body';
import { validateBody } from './Validation';

import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('FaceOffset');

/**
 * Result of offsetting a face.
 */
export interface OffsetFaceResult {
  ok: true;
  body: Body;
  diagnostics: Diagnostic[];
}

/**
 * Validate that an offset operation is valid.
 * Checks if offset would invert volume or cause self-intersection.
 */
export function validateOffsetFace(
  body: Body,
  faceId: string,
  distance: number
): { valid: boolean; error: string | null } {
  // Get the target face
    const face = body.faces.get(faceId);
    if (!face) {
    return { valid: false, error: `Face ${faceId} not found in body ${body.id}` };
    }

    // Get the plane for this face
    const plane = body.planes.get(face.planeId);
    if (!plane) {
    return { valid: false, error: `Plane ${face.planeId} not found for face ${faceId}` };
    }

    // Check if offset would invert volume
    // For positive offset (extending), we check if we face is already at max extent
    // For negative offset (removing), check if it face is already at min extent

    // Find the center point of the face
    const faceCenter = getFaceCenter(body, faceId);

    // Get the adjacent faces (faces that share edges with target face)
    const adjacentFaces = getAdjacentFaces(body, faceId);

    // Check for adjacent face distances
    for (const adjFaceId of adjacentFaces) {
        const adjFace = body.faces.get(adjFaceId);
        if (!adjFace) continue;

        const adjPlane = body.planes.get(adjFace.planeId);
        if (!adjPlane) continue;

        // Calculate distance from face plane to adjacent face plane
        const adjDist = distanceToPoint(adjPlane, faceCenter);

        // For negative offset, check if we would go past the adjacent face
        if (distance < 0 && Math.abs(distance) > adjDist) {
            return {
                valid: false,
                error: `Offset of ${distance} would pass through adjacent face ${adjFaceId}`,
            };
        }
    }

    return { valid: true, error: null };
}

/**
 * Get adjacent faces (faces that share edges with the target face).
 */
function getAdjacentFaces(body: Body, faceId: string): string[] {
    const adjacentFaceIds: string[] = [];
    const targetFace = body.faces.get(faceId);
    if (!targetFace) return adjacentFaceIds;

    // Find all edges of the target face
    for (const edgeId of targetFace.boundaryEdgeIds) {
        const edge = body.edges.get(edgeId);
        if (!edge) continue;

        // For each vertex of the edge, check adjacent faces
        for (const vertexId of edge.vertexIds) {
            const vertex = body.vertices.get(vertexId);
            if (!vertex) continue;

            // Find all faces this vertex belongs to
            for (const vEdgeId of vertex.edgeIds) {
                const vEdge = body.edges.get(vEdgeId);
                if (!vEdge) continue;

                for (const adjFaceId of vEdge.faceIds) {
                    if (adjFaceId !== faceId && !adjacentFaceIds.includes(adjFaceId)) {
                        adjacentFaceIds.push(adjFaceId);
                    }
                }
            }
        }
    }

    return adjacentFaceIds;
}

/**
 * Get the center point of a face.
 */
function getFaceCenter(body: Body, faceId: string): [number, number, number] {
    const face = body.faces.get(faceId);
    if (!face) return [0, 0, 0];

    const plane = body.planes.get(face.planeId);
    if (!plane) return [0, 0, 0];

    // Calculate centroid by averaging vertices
    let sumX = 0, sumY = 0, sumZ = 0;
    let count = 0;

    for (const edgeId of face.boundaryEdgeIds) {
        const edge = body.edges.get(edgeId);
        if (!edge) continue;

        for (const vertexId of edge.vertexIds) {
            const vertex = body.vertices.get(vertexId);
            if (!vertex) continue;

            sumX += vertex.position[0];
            sumY += vertex.position[1];
            sumZ += vertex.position[2];
            count += 2;
        }
    }

    if (count === 0) return [0, 0, 0];

    return [sumX / count, sumY / count, sumZ / count];
}

/**
 * Distance from point to plane.
 */
function distanceToPoint(plane: Plane, point: [number, number, number]): number {
    // Plane equation: ax + by + cz + d = 0
    // Point: (x, y, z)
    // d = a*x + b*y + c*z
    // We normal as (a, b, c)
    const normal = plane.normal;
    return (
        normal[0] * (point[0] - plane.origin[0]) +
        normal[1] * (point[1] - plane.origin[1]) +
        normal[2] * (point[2] - plane.origin[2])
    );
}

/**
 * Offset a face by the given distance.
 * Returns a new body with the offset face moved and adjacent faces extended.
 */
export function offsetFace(
    body: Body,
    faceId: string,
    distance: number
): Body | null {
    // Validate the offset
    const validation = validateOffsetFace(body, faceId, distance);
    if (!validation.valid) {
        log.warn('Face offset validation failed', { faceId, distance, error: validation.error });
        return null;
    }

    // Clone the body for modification (preserve original ID)
    const newBody = cloneBody(body, body.id);

    // Get target face and its plane
    const targetFace = newBody.faces.get(faceId);
    if (!targetFace) return null;

    const targetPlane = newBody.planes.get(targetFace.planeId);
    if (!targetPlane) return null;

    // Calculate new plane at offset distance
    const newOrigin: [number, number, number] = [
        targetPlane.origin[0] + targetPlane.normal[0] * distance,
        targetPlane.origin[1] + targetPlane.normal[1] * distance,
        targetPlane.origin[2] + targetPlane.normal[2] * distance,
    ];

    const newPlane: Plane = {
        ...targetPlane,
        origin: newOrigin,
    };

    newBody.planes.set(targetFace.planeId, newPlane);

    // Get adjacent faces
    const adjacentFaceIds = getAdjacentFaces(newBody, faceId);

    // Extend/shrink adjacent faces
    for (const adjFaceId of adjacentFaceIds) {
        extendAdjacentFace(newBody, adjFaceId, faceId, distance);
    }

    // Validate the result
    const validationResult = validateBody(newBody);
    if (!validationResult.ok) {
        log.warn('Offset face produced invalid body', { faceId, distance, errors: validationResult.errors });
        return null;
    }

    log.info('Face offset complete', { faceId, distance, adjacentCount: adjacentFaceIds.length });
    return newBody;
}

/**
 * Extend an adjacent face to meet the offset face.
 */
function extendAdjacentFace(
    body: Body,
    adjFaceId: string,
    targetFaceId: string,
    distance: number
): void {
    const adjFace = body.faces.get(adjFaceId);
    if (!adjFace) return;

    const adjPlane = body.planes.get(adjFace.planeId);
    if (!adjPlane) return;

    const targetFace = body.faces.get(targetFaceId);
    if (!targetFace) return;

    const targetPlane = body.planes.get(targetFace.planeId);
    if (!targetPlane) return;

    // Find shared edges between adjacent face and target face
    const sharedEdgeIds: string[] = [];
    for (const adjEdgeId of adjFace.boundaryEdgeIds) {
        const edge = body.edges.get(adjEdgeId);
        if (!edge) continue;

        if (edge.faceIds.includes(targetFaceId)) {
            sharedEdgeIds.push(adjEdgeId);
        }
    }

    if (sharedEdgeIds.length === 0) return;

    // For each shared edge, move the vertices along the target face normal
    for (const sharedEdgeId of sharedEdgeIds) {
        const edge = body.edges.get(sharedEdgeId);
        if (!edge) continue;

        // Move both vertices of the shared edge along the target normal
        for (const vertexId of edge.vertexIds) {
            const vertex = body.vertices.get(vertexId);
            if (!vertex) continue;

            // Calculate new position
            const newPos: [number, number, number] = [
                vertex.position[0] + targetPlane.normal[0] * distance,
                vertex.position[1] + targetPlane.normal[1] * distance,
                vertex.position[2] + targetPlane.normal[2] * distance,
            ];

            // Update vertex
            body.vertices.set(vertexId, {
                ...vertex,
                position: newPos,
            });
        }
    }

    // Extend the adjacent face edges to meet the new vertex positions
    extendEdgesAlongNormal(body, adjFaceId, targetPlane.normal, distance);
}

/**
 * Extend edges along the given normal direction.
 */
function extendEdgesAlongNormal(
    body: Body,
    faceId: string,
    normal: [number, number, number],
    distance: number
): void {
    const face = body.faces.get(faceId);
    if (!face) return;

    // For each boundary edge, extend the vertices
    for (const edgeId of face.boundaryEdgeIds) {
        const edge = body.edges.get(edgeId);
        if (!edge) continue;

        for (const vertexId of edge.vertexIds) {
            const vertex = body.vertices.get(vertexId);
            if (!vertex) continue;

            // Calculate new position
            const newPos: [number, number, number] = [
                vertex.position[0] + normal[0] * distance,
                vertex.position[1] + normal[1] * distance,
                vertex.position[2] + normal[2] * distance,
            ];

            body.vertices.set(vertexId, {
                ...vertex,
                position: newPos,
            });
        }
    }
}
