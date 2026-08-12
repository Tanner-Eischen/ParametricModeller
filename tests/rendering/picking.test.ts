import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Picking } from '../../src/rendering/Picking';

describe('Picking face intersections', () => {
  it('skips a closer wireframe hit and resolves the planar mesh face', () => {
    const group = new THREE.Group();
    group.userData.id = 'body-1';
    group.userData.bodyId = 'body-1';

    const faceGeometry = new THREE.PlaneGeometry(2, 2);
    faceGeometry.setAttribute(
      'faceId',
      new THREE.Uint32BufferAttribute([42, 42, 42, 42], 1),
    );
    const faceMesh = new THREE.Mesh(faceGeometry, new THREE.MeshBasicMaterial());
    faceMesh.userData.bodyId = 'body-1';
    group.add(faceMesh);

    const wireGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1, 0, 1),
      new THREE.Vector3(1, 0, 1),
    ]);
    const wireframe = new THREE.LineSegments(wireGeometry, new THREE.LineBasicMaterial());
    wireframe.userData.bodyId = 'body-1';
    group.add(wireframe);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    group.updateMatrixWorld(true);

    const picking = new Picking();
    const result = picking.pickFace(50, 50, 100, 100, camera, [group]);

    expect(result).toMatchObject({
      objectId: 'body-1',
      bodyId: 'body-1',
      faceId: '42',
    });

    picking.dispose();
    faceGeometry.dispose();
    wireGeometry.dispose();
  });
});
