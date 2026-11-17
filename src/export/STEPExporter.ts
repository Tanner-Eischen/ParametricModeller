import type { Body } from '../geometry/Body';
import { getOrderedLoopVertices } from '../geometry/Triangulator';
import { buildExportMesh, MILLIMETERS_PER_INCH, requireBodies } from './ExportMesh';

export interface STEPExportOptions {
  name?: string;
  author?: string;
  organization?: string;
}

/** AP203 planar faceted B-Rep. Original polygon boundaries and holes are retained. */
export function exportToSTEP(bodies: readonly Body[], options: STEPExportOptions = {}): string {
  requireBodies(bodies);
  bodies.forEach(buildExportMesh);
  const entities: string[] = [];
  const add = (entity: string): string => {
    entities.push(`#${entities.length + 1}=${entity};`);
    return `#${entities.length}`;
  };
  const application = add("APPLICATION_CONTEXT('configuration controlled 3d designs of mechanical parts and assemblies')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','config_control_design',1994,${application})`);
  const productContext = add(`PRODUCT_CONTEXT('',${application},'mechanical')`);
  const product = add(`PRODUCT(${stepString(options.name ?? 'Model')},${stepString(options.name ?? 'Model')},'',(${productContext}))`);
  const formation = add(`PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',${product},.NOT_KNOWN.)`);
  const definitionContext = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${application},'design')`);
  const definition = add(`PRODUCT_DEFINITION('design','',${formation},${definitionContext})`);
  const productShape = add(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
  const lengthUnit = add('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))');
  const angleUnit = add('(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))');
  const solidAngleUnit = add('(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())');
  const uncertainty = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.0000254),${lengthUnit},'distance_accuracy_value','model tolerance')`);
  const context = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${lengthUnit},${angleUnit},${solidAngleUnit})) REPRESENTATION_CONTEXT('','3D'))`);
  const solids: string[] = [];
  for (const body of bodies) {
    const vertices = new Map([...body.vertices].sort(([a], [b]) => a.localeCompare(b)).map(([id, vertex]) => [
      id, add(`CARTESIAN_POINT('',(${vertex.position.map((value) => stepNumber(value * MILLIMETERS_PER_INCH)).join(',')}))`),
    ]));
    const faces: string[] = [];
    for (const [, face] of [...body.faces].sort(([a], [b]) => a.localeCompare(b))) {
      const plane = body.planes.get(face.planeId)!;
      const normal = plane.normal;
      const bounds = [face.boundaryEdgeIds, ...(face.innerBoundaryEdgeIds ?? [])].map((edges, loopIndex) => {
        let loop = getOrderedLoopVertices(body, edges);
        // Newell's normal is stable for concave polygons and collinear corners.
        const sum = [0, 0, 0];
        for (let i = 0; i < loop.length; i++) {
          const a = loop[i]!.position;
          const b = loop[(i + 1) % loop.length]!.position;
          sum[0]! += (a[1] - b[1]) * (a[2] + b[2]);
          sum[1]! += (a[2] - b[2]) * (a[0] + b[0]);
          sum[2]! += (a[0] - b[0]) * (a[1] + b[1]);
        }
        const aligned = sum.reduce((value, component, i) => value + component * normal[i]!, 0) > 0;
        if (aligned !== (loopIndex === 0)) loop = loop.reverse();
        const polygon = add(`POLY_LOOP('',(${loop.map((vertex) => vertices.get(vertex.id)!).join(',')}))`);
        return add(`${loopIndex === 0 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',${polygon},.T.)`);
      });
      const origin = add(`CARTESIAN_POINT('',(${plane.origin.map((value) => stepNumber(value * MILLIMETERS_PER_INCH)).join(',')}))`);
      const axis = add(`DIRECTION('',(${normal.map(stepNumber).join(',')}))`);
      const reference = add(`DIRECTION('',(${plane.uAxis.map(stepNumber).join(',')}))`);
      const placement = add(`AXIS2_PLACEMENT_3D('',${origin},${axis},${reference})`);
      const surface = add(`PLANE('',${placement})`);
      faces.push(add(`FACE_SURFACE('',(${bounds.join(',')}),${surface},.T.)`));
    }
    const shell = add(`CLOSED_SHELL('',(${faces.join(',')}))`);
    solids.push(add(`FACETED_BREP(${stepString(body.name)},${shell})`));
  }
  const representation = add(`FACETED_BREP_SHAPE_REPRESENTATION('',(${solids.join(',')}),${context})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${productShape},${representation})`);
  return [
    'ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('Planar woodworking solids; millimeters'),'2;1');",
    `FILE_NAME(${stepString(options.name ?? 'Model')},${stepString(new Date().toISOString())},(${stepString(options.author ?? '')}),(${stepString(options.organization ?? '')}),'Parametric Modeler','Parametric Modeler','');`,
    "FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));", 'ENDSEC;', 'DATA;', ...entities, 'ENDSEC;', 'END-ISO-10303-21;',
  ].join('\n');
}

function stepNumber(value: number): string {
  const text = value.toString().toUpperCase();
  return text.includes('.') || text.includes('E') ? text : `${text}.`;
}

function stepString(value: string): string {
  return `'${value.replace(/['\\]|[^\x20-\x7E]/g, (character) => {
    if (character === "'") return "''";
    if (character === '\\') return '\\\\';
    return `\\X2\\${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
  })}'`;
}
