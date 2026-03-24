import * as THREE from 'three';
import { CameraControls } from './CameraControls';
import { Grid } from './Grid';
import { Axes } from './Axes';
import { PlaneHelper } from './PlaneHelper';
import { createModuleLogger } from '../core/logger';
import type { ConstructionPlane } from '../geometry';

const log = createModuleLogger('Viewport');

export interface ViewportOptions {
  container: HTMLElement;
  antialias?: boolean;
  shadows?: boolean;
}

export class Viewport {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraControls: CameraControls;
  private grid: Grid;
  private axes: Axes;
  private planeHelper: PlaneHelper;
  private animationId: number | null = null;
  private resizeObserver: ResizeObserver;

  constructor(options: ViewportOptions) {
    this.container = options.container;

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: options.antialias ?? true,
      alpha: false,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x252526, 1);

    if (options.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.container.appendChild(this.renderer.domElement);

    // Create scene
    this.scene = new THREE.Scene();

    // Add default lighting
    this.setupLighting();

    // Create camera controls
    this.cameraControls = new CameraControls(this.container);

    // Create grid
    this.grid = new Grid();
    this.scene.add(this.grid.group);

    // Create axes
    this.axes = new Axes();
    this.scene.add(this.axes.group);

    // Create plane helper (hidden by default)
    this.planeHelper = new PlaneHelper();
    this.scene.add(this.planeHelper.group);

    // Handle resize
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
    this.handleResize();

    log.info('Viewport initialized');
  }

  private setupLighting(): void {
    // Ambient light for overall illumination
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    // Directional light for shadows and depth
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(10, 20, 10);
    directional.castShadow = true;
    directional.shadow.mapSize.width = 2048;
    directional.shadow.mapSize.height = 2048;
    this.scene.add(directional);

    // Secondary directional for fill
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-10, 10, -10);
    this.scene.add(fill);
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.cameraControls.setSize(width, height);
    this.renderer.setSize(width, height);

    log.debug(`Viewport resized to ${width}x${height}`);
  }

  startRenderLoop(): void {
    if (this.animationId !== null) return;

    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      this.cameraControls.update();
      this.renderer.render(this.scene, this.cameraControls.camera);
    };

    animate();
    log.info('Render loop started');
  }

  stopRenderLoop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
      log.info('Render loop stopped');
    }
  }

  add(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  remove(object: THREE.Object3D): void {
    this.scene.remove(object);
  }

  getCameraControls(): CameraControls {
    return this.cameraControls;
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getGrid(): Grid {
    return this.grid;
  }

  getAxes(): Axes {
    return this.axes;
  }

  fitToView(box: THREE.Box3): void {
    this.cameraControls.fitToView(box);
  }

  /**
   * Show the sketch plane helper at the given plane position/orientation.
   */
  showPlane(plane: ConstructionPlane): void {
    this.planeHelper.update(plane);
    this.planeHelper.setVisible(true);
    log.debug('Plane helper shown');
  }

  /**
   * Hide the sketch plane helper.
   */
  hidePlane(): void {
    this.planeHelper.setVisible(false);
    log.debug('Plane helper hidden');
  }

  /**
   * Get the plane helper instance.
   */
  getPlaneHelper(): PlaneHelper {
    return this.planeHelper;
  }

  dispose(): void {
    this.stopRenderLoop();
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.cameraControls.dispose();
    this.grid.dispose();
    this.axes.dispose();
    this.planeHelper.dispose();

    while (this.scene.children.length > 0) {
      const child = this.scene.children[0];
      if (child) {
        this.scene.remove(child);
      }
    }

    this.container.removeChild(this.renderer.domElement);
    log.info('Viewport disposed');
  }
}
