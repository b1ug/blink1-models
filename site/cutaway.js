// Cut the fitted display mesh in its own coordinates. The cut surface and its
// cap then share the model transform, intersection points and MSAA coverage.
function cutGeometry(THREE, geometry, planeZ, stationX) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const attributes = Object.entries(geometry.attributes).map(([name, source]) => ({
    name, source, values: Array.from(source.array),
  }));
  const surfaceIndices = [], nodes = new Map(), wallHits = [];
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
      const za = position.getZ(a) - planeZ, zb = position.getZ(b) - planeZ;
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
      // Intersect this section edge with a vertical line at the LED's
      // longitudinal station. A half-open interval counts shared tips once.
      if ((a.x <= stationX) !== (b.x <= stationX)) {
        wallHits.push(THREE.MathUtils.lerp(a.y, b.y, (stationX - a.x) / (b.x - a.x)));
      }
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
  const cap = new THREE.ShapeGeometry(paths.toShapes());
  cap.translate(0, 0, planeZ);
  return {surface, cap, wallHits: wallHits.sort((a, b) => a - b)};
}

function sectionMaterial(THREE, source, unit, slope) {
  const material = new THREE.MeshStandardMaterial({
    color: source.color, roughness: .88, metalness: source.metalness * .45,
    emissive: source.emissive, emissiveIntensity: source.emissiveIntensity * .55,
  });
  material.onBeforeCompile = (shader, renderer) => {
    // The plastic section samples the same local light field as its exterior.
    source.onBeforeCompile(shader, renderer);
    shader.uniforms.sectionHatchDirection = {value: new THREE.Vector2(1, slope)
      .normalize().divideScalar(1.1 * unit)};
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec2 sectionHatchDirection;
        varying float sectionHatch;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        sectionHatch = dot(position.xy, sectionHatchDirection);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float sectionHatch;
        float hatchIntegral(float phase) {
          return floor(phase) * 0.16 + min(fract(phase), 0.16);
        }`)
      .replace('#include <opaque_fragment>', `
        // Average the diagonal ink coverage across a pixel at oblique angles.
        float span = max(fwidth(sectionHatch), 0.0001);
        float coverage = (hatchIntegral(sectionHatch + 0.5 * span)
          - hatchIntegral(sectionHatch - 0.5 * span)) / span;
        outgoingLight *= 1.0 - 0.54 * clamp(coverage, 0.0, 1.0);
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => source.customProgramCacheKey() + '/hatched-section';
  return material;
}

export function createCutaway(THREE, group) {
  const diffuser = group.getObjectByName('One continuous milky diffuser');
  const frame = group.getObjectByName('Original frame — CAD details retained');
  const unit = group.userData.unitsPerMillimetre;
  const diffuserBounds = new THREE.Box3().setFromBufferAttribute(diffuser.geometry.getAttribute('position'));
  const stationX = group.getObjectByName('L1 RGB emitter').position.x;
  const capMaterials = new Map([
    [diffuser, sectionMaterial(THREE, diffuser.material, unit, -1)],
    [frame, sectionMaterial(THREE, frame.material, unit, 1)],
  ]);
  let activeOffset = null, sections = [], measurements = null;

  function clearSections() {
    for (const {part, original, surface, face} of sections) {
      part.geometry = original;
      face.removeFromParent();
      face.geometry.dispose();
      surface.dispose();
    }
    sections = [];
    activeOffset = null;
  }
  function setEnabled(enabled, offsetMM = 0) {
    if (enabled && activeOffset !== offsetMM) {
      clearSections();
      // The cut opens toward +Z. Moving it from the center to the near lip
      // leaves more of the housing behind the plane (z < planeZ).
      const planeZ = offsetMM * unit;
      for (const [part, material] of capMaterials) {
        const original = part.geometry;
        const {surface, cap, wallHits} = cutGeometry(THREE, original, planeZ, stationX);
        const face = new THREE.Mesh(cap, material);
        face.name = part.name + ' section';
        part.add(face);
        sections.push({part, original, surface, face});
        if (part === diffuser) {
          const [bottom, lowerSeat, upperSeat, top] = wallHits;
          measurements = {
            top: (top - upperSeat) / unit, bottom: (lowerSeat - bottom) / unit,
            retainedWidth: (planeZ - diffuserBounds.min.z) / unit,
          };
        }
      }
      activeOffset = offsetMM;
    }
    for (const {part, original, surface, face} of sections) {
      part.geometry = enabled ? surface : original;
      face.visible = enabled;
    }
    return measurements;
  }
  function dispose() {
    clearSections();
    for (const material of capMaterials.values()) material.dispose();
    capMaterials.clear();
  }
  return {setEnabled, dispose};
}
