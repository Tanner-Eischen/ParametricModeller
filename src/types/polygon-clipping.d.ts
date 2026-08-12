declare module 'polygon-clipping' {
  export type Pair = [number, number];
  export type Ring = Pair[];
  export type Polygon = Ring[];
  export type MultiPolygon = Polygon[];
  type Geometry = Polygon | MultiPolygon;

  const polygonClipping: {
    intersection(geometry: Geometry, ...geometries: Geometry[]): MultiPolygon;
    xor(geometry: Geometry, ...geometries: Geometry[]): MultiPolygon;
    union(geometry: Geometry, ...geometries: Geometry[]): MultiPolygon;
    difference(subject: Geometry, ...clips: Geometry[]): MultiPolygon;
  };

  export default polygonClipping;
}
