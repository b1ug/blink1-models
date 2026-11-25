// Cut the fitted display mesh in its own coordinates. The cut surface and its
// cap then share the model transform, intersection points and MSAA coverage.
function cutGeometry(THREE, geometry) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const attributes = Object.entries(geometry.attributes).map(([name, source]) => ({
    name, source, values: Array.from(source.array),
  }));
  const surfaceIndices = [], nodes = new Map();
  function endpoint(x, y) {
    // STL triangles repeat their shared vertices. Join duplicates at float32
    // precision, retaining the unrounded point for the actual section edge.
    const key = Math.round(x * 1e7) + ',' + Math.round(y * 1e7);
    if (!nodes.has(key)) nodes.set(key, {x, y, joined: new Set()});
    return nodes.get(key);
  }
  let nextVertex = position.count;
  for (let face = 0; face < count; face += 3) {
    const polygon = [], crossings = [];
    for (let edge = 0; edge < 3; edge++) {
      const a = index ? index.getX(face + edge) : face + edge;
      const next = face + (edge + 1) % 3;
      const b = index ? index.getX(next) : next;
      const za = position.getZ(a), zb = position.getZ(b);
      if (za < 0) polygon.push(a);
      if ((za < 0) === (zb < 0)) continue;
      const t = za / (za - zb);
      for (const {source, values} of attributes) {
        for (let j = 0; j < source.itemSize; j++) {
          values.push(THREE.MathUtils.lerp(source.getComponent(a, j), source.getComponent(b, j), t));
        }
      }
      crossings.push(endpoint(
        THREE.MathUtils.lerp(position.getX(a), position.getX(b), t),
        THREE.MathUtils.lerp(position.getY(a), position.getY(b), t),
      ));
      polygon.push(nextVertex++);
    }
    for (let i = 2; i < polygon.length; i++) surfaceIndices.push(polygon[0], polygon[i - 1], polygon[i]);
    if (crossings.length === 2) {
      const [a, b] = crossings;
      if (a !== b) { a.joined.add(b); b.joined.add(a); }
    }
  }
  const surface = new THREE.BufferGeometry();
  surface.setIndex(surfaceIndices);
  for (const {name, source, values} of attributes) {
    surface.setAttribute(name, new THREE.Float32BufferAttribute(values, source.itemSize));
  }
  // Follow the closed cut edges and triangulate the nested contours. Even–odd
  // fill leaves the PCB cavity and any enclosed holes open.
  const paths = new THREE.ShapePath();
  paths.userData.style = {fillRule: 'evenodd'};
  for (const start of nodes.values()) {
    if (!start.joined.size) continue;
    paths.moveTo(start.x, start.y);
    let cursor = start;
    do {
      const next = cursor.joined.values().next().value;
      if (!next) throw new Error('Open contour in the mk2 enclosure section');
      cursor.joined.delete(next);
      next.joined.delete(cursor);
      paths.lineTo(next.x, next.y);
      cursor = next;
    } while (cursor !== start);
  }
  return {surface, cap: new THREE.ShapeGeometry(paths.toShapes())};
}

export function createCutaway(THREE, group) {
  const parts = ['Original frame — CAD details retained', 'One continuous milky diffuser'].map(name => {
    const part = group.getObjectByName(name);
    const original = part.geometry;
    const {surface, cap} = cutGeometry(THREE, original);
    // The cut face uses the same material and model-local light field as the
    // outer face. Both respond to color changes without recomputing transport.
    const face = new THREE.Mesh(cap, part.material);
    face.name = name + ' section';
    face.visible = false;
    part.add(face);
    return {part, original, surface, face};
  });
  function setEnabled(enabled) {
    for (const {part, original, surface, face} of parts) {
      part.geometry = enabled ? surface : original;
      face.visible = enabled;
    }
  }
  function dispose() {
    for (const {part, original, surface, face} of parts) {
      part.geometry = original;
      face.removeFromParent();
      face.geometry.dispose();
      surface.dispose();
    }
  }
  return {setEnabled, dispose};
}
