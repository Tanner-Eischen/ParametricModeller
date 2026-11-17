import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import type { Body } from '../geometry/Body';
import { buildExportMesh, requireBodies } from './ExportMesh';

export interface MF3ExportOptions {
  name?: string;
}

/** Returns an OPC ZIP package, ready to save as a binary .3mf file. */
export function exportToMF3(bodies: readonly Body[], options: MF3ExportOptions = {}): Uint8Array {
  requireBodies(bodies);
  const objects = bodies.map((body, index) => {
    const mesh = buildExportMesh(body);
    const vertices = mesh.vertices.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('');
    const triangles = mesh.triangles.map(([v1, v2, v3]) => `<triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`).join('');
    return `<object id="${index + 1}" type="model" name="${encodeXml(body.name)}"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`;
  });
  const model = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter" xml:lang="en-US">'
    + `<metadata name="Title">${encodeXml(options.name ?? 'Model')}</metadata>`
    + `<resources>${objects.join('')}</resources>`
    + `<build>${bodies.map((_, index) => `<item objectid="${index + 1}"/>`).join('')}</build></model>`;
  const contentTypes = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const relationships = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>';
  return zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8(contentTypes)),
    '_rels/.rels': new Uint8Array(strToU8(relationships)),
    '3D/3dmodel.model': new Uint8Array(strToU8(model)),
  }, { level: 0, mtime: new Date(1980, 0, 1) });
}

function encodeXml(text: string): string {
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (!(code === 9 || code === 10 || code === 13
      || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd)
      || (code >= 0x10000 && code <= 0x10ffff))) {
      throw new Error('3MF names must contain valid XML characters');
    }
  }
  return text.replace(/[&<>"']/g, (value) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[value]!);
}
