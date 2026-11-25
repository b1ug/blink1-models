/* blink(1) mk2 object for the isolated local design study.
 * Derived from ThingM/todbot blink1 official enclosure CAD at fixed commit
 * 101abe3599c661c4dd4d1204b4d50fb592293143. Changes: visual assembly alignment,
 * level diffuser seats, derived frame contact fitting, crease-preserving shading normals, procedural finishes, colour illustration
 * and supplemental USB geometry.
 * Enclosure CAD derivatives: CC BY-SA 4.0. PCB layout data: CC BY-SA 3.0.
 * See the notices in model-assets/ and model-assets/source.json.
 * THREE and the raw official STL geometries are supplied by the caller.
 * The diffuser is continuous; LED 1 and LED 2 illuminate opposite PCB faces.
 * The project author's original LED table identifies blink(1) as LED 1/top
 * and ThingM as LED 2/bottom; that identity is fixed in object coordinates.
 * Colour rendering is a screen illustration, never an optical measurement.
 */
import {fitFrameToDiffuser, levelEnclosureRails} from './enclosure-fit.js';
import {createBlink1PCB} from './pcb-model.js';
import pcbLayout from './model-assets/pcb-layout.json' with {type: 'json'};

export function createBlink1Model(THREE, {
  diffuserGeometry, frameGeometry, variant = 'shell',
} = {}) {
  if (!['shell', 'internals', 'assembled'].includes(variant)) {
    throw new Error('Unknown blink(1) model variant: ' + variant);
  }
  const showShell = variant !== 'internals';
  const showPCB = variant !== 'shell';
  const group = new THREE.Group();
  group.name = 'blink(1) mk2';
  group.userData.variant = variant;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const geometry = value => { geometries.add(value); return value; };
  const material = value => { materials.add(value); return value; };
  const texture = value => { textures.add(value); return value; };
  let disposed = false, lastColors = '';

  function add(name, shape, surface, parent = group) {
    const mesh = new THREE.Mesh(geometry(shape), material(surface));
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function bounds(shape) {
    return new THREE.Box3().setFromBufferAttribute(shape.getAttribute('position'));
  }
  function roundedRectangle(length, width, radius) {
    const path = new THREE.Shape(), x = -length / 2, z = -width / 2;
    const r = Math.min(radius, length / 2, width / 2);
    path.moveTo(x + r, z);
    path.lineTo(x + length - r, z);
    path.quadraticCurveTo(x + length, z, x + length, z + r);
    path.lineTo(x + length, z + width - r);
    path.quadraticCurveTo(x + length, z + width, x + length - r, z + width);
    path.lineTo(x + r, z + width);
    path.quadraticCurveTo(x, z + width, x, z + width - r);
    path.lineTo(x, z + r);
    path.quadraticCurveTo(x, z, x + r, z);
    return path;
  }
  function plate(path, thickness, edgeRadius = 0) {
    const bevel = Math.min(edgeRadius, thickness * .28);
    const result = new THREE.ExtrudeGeometry(path, {
      depth: thickness - bevel * 2, bevelEnabled: bevel > 0,
      bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3,
      curveSegments: 16, steps: 1,
    });
    // Local x/y form the footprint; extrusion becomes upward world y.
    result.rotateX(-Math.PI / 2);
    if (bevel) result.translate(0, bevel, 0);
    return result;
  }
  function creasedNormals(input, threshold = Math.PI / 6) {
    // Smooth curved CAD facets, but keep the actual 90-degree engraving and
    // sheet edges sharp. Angle weighting avoids skinny STL triangles pulling
    // a moulded surface's highlight towards a large neighbouring triangle.
    const position = input.getAttribute('position'), index = input.getIndex();
    const count = index ? index.count : position.count;
    const faces = [], adjoining = new Map(), cosine = Math.cos(threshold);
    const point = i => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i) : i);
    const key = p => `${Math.round(p.x * 100000)}:${Math.round(p.y * 100000)}:${Math.round(p.z * 100000)}`;
    for (let i = 0; i < count; i += 3) {
      const corners = [point(i), point(i + 1), point(i + 2)];
      const normal = corners[1].clone().sub(corners[0]).cross(corners[2].clone().sub(corners[0])).normalize();
      const face = { corners, normal };
      faces.push(face);
      for (let c = 0; c < 3; c++) {
        const a = corners[(c + 1) % 3].clone().sub(corners[c]).normalize();
        const b = corners[(c + 2) % 3].clone().sub(corners[c]).normalize();
        const weight = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
        const id = key(corners[c]);
        if (!adjoining.has(id)) adjoining.set(id, []);
        adjoining.get(id).push({ normal, weight });
      }
    }
    const points = [], normals = [];
    for (const face of faces) for (const corner of face.corners) {
      const normal = new THREE.Vector3();
      for (const neighbour of adjoining.get(key(corner))) {
        if (face.normal.dot(neighbour.normal) >= cosine) normal.addScaledVector(neighbour.normal, neighbour.weight);
      }
      if (normal.lengthSq() < .000001) normal.copy(face.normal); else normal.normalize();
      points.push(corner.x, corner.y, corner.z); normals.push(normal.x, normal.y, normal.z);
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return result;
  }

  function enclosureNormals(input, frameCAD, tangentOffset) {
    const shape = creasedNormals(input);
    // Both v3k USB shoulders have a 2.75-unit plan radius. Subdivision for
    // the joint puts many coplanar triangles inside each original STL chord.
    // Give the exposed wall a radial normal at every one of those vertices.
    const radius = 2.75, tangentY = frameCAD.min.y + tangentOffset;
    const position = shape.getAttribute('position'), normal = shape.getAttribute('normal');
    const left = frameCAD.min.x + radius, right = frameCAD.max.x - radius;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i);
      if (y > tangentY + .2 || (x > left + .2 && x < right - .2)) continue;
      const dx = x - THREE.MathUtils.clamp(x, left, right), dy = Math.min(0, y - tangentY);
      const distance = Math.hypot(dx, dy);
      // The fitted exterior lies within 0.2 units of the CAD arc. Its outward
      // direction distinguishes it from the cut end, aperture and seating faces.
      if (Math.abs(distance - radius) > .2) continue;
      const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
      const horizontal = Math.hypot(nx, ny);
      if (horizontal < .5 || nx * dx + ny * dy < .9 * horizontal * distance) continue;
      // Long rim triangles borrow tilt from the adjacent narrow bevel. Keep
      // upright wall normals in plan and ease into the bevel's axial tilt.
      const tilt = nz * THREE.MathUtils.smoothstep(Math.abs(nz), .18, .45);
      const radial = Math.sqrt(1 - tilt * tilt) / distance;
      normal.setXYZ(i, dx * radial, dy * radial, tilt);
    }
    return shape;
  }

  let shell, frame, shellBox, frameBox, unit;
  const hasCAD = Boolean(diffuserGeometry?.getAttribute('position') && frameGeometry?.getAttribute('position'));
  if (hasCAD) {
    const frameCAD = bounds(frameGeometry), diffuserCAD = bounds(diffuserGeometry);
    const center = frameCAD.getCenter(new THREE.Vector3());
    const rotate = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const rotated = diffuserCAD.clone().applyMatrix4(rotate);
    const offset = center.clone().sub(rotated.getCenter(new THREE.Vector3()));
    // The USB/front opening is the shared longitudinal datum. Centering the
    // unequal-length bounding boxes shifted the plastic over the USB corner.
    offset.y = frameCAD.min.y - rotated.min.y;
    const diffuserToFrame = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z).multiply(rotate);
    const seatingShell = diffuserGeometry.clone().applyMatrix4(diffuserToFrame);
    let seating, diffuserProfile;
    try {
      seating = fitFrameToDiffuser(THREE, frameGeometry, seatingShell);
      diffuserProfile = levelEnclosureRails(seatingShell, seating.geometry, frameCAD);
      const alignedDiffuser = bounds(seatingShell);
      // A proper half-turn fixes blink(1) at +Y and ThingM at -Y, according to
      // the project author's original LED address table. Never swap colours to
      // compensate for the camera. The USB is built separately with its roof up.
      const world = new THREE.Matrix4().set(
        0, 1, 0, -center.y,
        0, 0, -1, alignedDiffuser.max.z,
        -1, 0, 0, center.x,
        0, 0, 0, 1,
      );
      const rawShellBox = alignedDiffuser.clone().applyMatrix4(world);
      const rawFrameBox = frameCAD.clone().applyMatrix4(world);
      // Keep CAD proportions intact and normalize the complete object to ~4.4.
      // The plug exits the low-Y CAD end, whose aperture is ~12.38 mm wide.
      unit = 4.4 / (rawShellBox.max.x - rawFrameBox.min.x + 11);
      const normalized = new THREE.Matrix4().makeScale(unit, unit, unit).multiply(world);
      // Front-datum distances to the long-side tangent in each v3k mesh.
      shell = enclosureNormals(seatingShell, frameCAD, 2.79).applyMatrix4(normalized);
      frame = enclosureNormals(seating.geometry, frameCAD, 2.715).applyMatrix4(normalized);
    } finally {
      seatingShell.dispose();
      seating?.geometry.dispose();
    }
    shellBox = bounds(shell); frameBox = bounds(frame);
    group.userData.geometrySource = 'ThingM v3k enclosure STL with leveled diffuser seats and fitted metal joints';
    group.userData.assemblyAlignment = 'shared USB front datum and parallel side rails';
    group.userData.enclosureFit = {
      ...seating.stats,
      measurementStage: 'frame joint fit before leveling both parts',
      diffuserProfile,
    };
  } else {
    // A small loading/failure fallback. The reviewed renderer supplies both
    // official geometries; this shape is never identified as the official CAD.
    unit = .136;
    frame = plate(roundedRectangle(2.72, 2.31, .35), .76);
    frame.translate(0, .32, 0);
    const cap = roundedRectangle(3.08, 2.31, .43);
    shell = new THREE.ExtrudeGeometry(cap, { depth: 1.13, bevelEnabled: true, bevelThickness: .11, bevelSize: .055, bevelSegments: 4, curveSegments: 16 });
    shell.rotateX(-Math.PI / 2); shell.translate(0, .11, 0);
    shellBox = bounds(shell); frameBox = bounds(frame);
    group.userData.geometrySource = 'approximate loading fallback';
  }

  const shellSize = shellBox.getSize(new THREE.Vector3());
  const midY = (frameBox.min.y + frameBox.max.y) / 2;
  const midZ = (frameBox.min.z + frameBox.max.z) / 2;
  // Registration in the v2c6 EAGLE footprint: the mating lip is 17.5 mm
  // ahead of X1, and L1 and L2 share the same coordinates on opposite faces.
  const plugEnd = frameBox.min.x - 11 * unit;
  const plugLength = 17.5 * unit, plugRoot = plugEnd + plugLength;
  const x1 = pcbLayout.components.find(component => component.ref === 'X1');
  const boardFront = plugRoot + (pcbLayout.bounds.min[0] - x1.x) * unit;
  const led = pcbLayout.components.find(component => component.ref === 'L1');
  const emitterXZ = new THREE.Vector2(plugRoot + (led.x - x1.x) * unit,
    midZ - (led.y - pcbLayout.coordinate_system.center_y) * unit);
  function finishTexture(kind) {
    const size = 256, data = new Uint8Array(size * size * 4);
    const hash = n => { let v = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); v ^= v >>> 13; return (v >>> 0) / 4294967295; };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const grain = hash(y + 631) * 2 - 1;
      const fine = hash(x + y * 65537) * 2 - 1;
      if (kind === 'metal-normal') {
        data[offset] = Math.round(128 + fine * 2);
        data[offset + 1] = Math.round(128 + grain * 21 + fine * 2);
        data[offset + 2] = 254;
      } else if (kind === 'frost-normal') {
        data[offset] = Math.round(128 + fine * 8);
        data[offset + 1] = Math.round(128 + (hash(offset + 941) * 2 - 1) * 8);
        data[offset + 2] = 255;
      } else {
        const value = kind === 'metal-roughness' ? 210 + grain * 22 + fine * 3 : 223 + fine * 15;
        data[offset] = data[offset + 1] = data[offset + 2] = Math.round(value);
      }
      data[offset + 3] = 255;
    }
    const result = texture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat));
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.magFilter = THREE.LinearFilter;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.generateMipmaps = true; result.needsUpdate = true;
    return result;
  }
  const metalNormal = finishTexture('metal-normal'), metalRoughness = finishTexture('metal-roughness');
  const frostNormal = finishTexture('frost-normal'), frostRoughness = finishTexture('frost-roughness');
  function metalUV(shape, wrapSides = false) {
    const p = shape.getAttribute('position'), n = shape.getAttribute('normal');
    const values = [];
    const box = bounds(shape), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const radiusX = Math.max(.0001, size.x / 2), radiusZ = Math.max(.0001, size.z / 2);
    const perimeterScale = 2 * (size.x + size.z) * 3 / (Math.PI * 2);
    // Every supplied metal surface is non-indexed, so a UV seam can be
    // unwrapped per triangle without changing the authored CAD vertices.
    for (let i = 0; i < p.count; i += 3) {
      const face = new THREE.Vector3();
      for (let c = 0; c < 3; c++) face.add(new THREE.Vector3().fromBufferAttribute(n, i + c));
      face.normalize();
      if (wrapSides && Math.abs(face.y) < .75) {
        const angles = [0, 1, 2].map(c => Math.atan2((p.getZ(i + c) - center.z) / radiusZ, (p.getX(i + c) - center.x) / radiusX));
        const crossesSeam = Math.max(...angles) - Math.min(...angles) > Math.PI;
        for (let c = 0; c < 3; c++) {
          const angle = crossesSeam && angles[c] < 0 ? angles[c] + Math.PI * 2 : angles[c];
          values.push(angle * perimeterScale, p.getY(i + c) * 3);
        }
      } else {
        // Choose a plane for the whole triangle, never independently for its
        // corners. A per-vertex dominant-axis switch made the former bright
        // vertical stripe by reversing the tangent frame inside faces 471/472.
        const a = Math.abs(face.x), b = Math.abs(face.y), c = Math.abs(face.z);
        for (let corner = 0; corner < 3; corner++) {
          const vertex = i + corner, x = p.getX(vertex), y = p.getY(vertex), z = p.getZ(vertex);
          if (b > a && b > c) values.push(x * 3, z * 3);
          else if (a > c) values.push(z * 3, y * 3);
          else values.push(x * 3, y * 3);
        }
      }
    }
    shape.setAttribute('uv', new THREE.Float32BufferAttribute(values, 2));
    return shape;
  }
  const positions = shell.getAttribute('position'), uv = [];
  for (let i = 0; i < positions.count; i++) {
    const u = (positions.getX(i) - shellBox.min.x) / shellSize.x;
    const across = (positions.getZ(i) - shellBox.min.z) / shellSize.z;
    // UVs now carry only the fine frosted finish. Light uses continuous model
    // coordinates below, so neither UV chart nor a triangle edge divides it.
    uv.push(u, across);
  }
  shell.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));

  const plastic = material(new THREE.MeshPhysicalMaterial({
    color: 0xf8faf7,
    metalness: 0, roughness: .47, roughnessMap: frostRoughness, envMapIntensity: .32,
    normalMap: frostNormal, normalScale: new THREE.Vector2(.11, .11),
    transmission: .12, thickness: .13, ior: 1.44,
    attenuationColor: new THREE.Color(0xf5faf7), attenuationDistance: 1.6,
    clearcoat: .035, clearcoatRoughness: .42, specularIntensity: .75,
    emissive: new THREE.Color(0xffffff), emissiveIntensity: 2.15,
  }));
  // Both LEDs illuminate the same continuous volume. Work in linear light:
  // contributions add before tone mapping, while distance gives each main
  // face its own dominant source and allows a soft overlap around the rim.
  // These widths are visual scattering parameters, not measured optics.
  const lightField = {
    uniforms: {
      nb1SourceOne: {value: new THREE.Color(0, 0, 0)},
      nb1SourceTwo: {value: new THREE.Color(0, 0, 0)},
      nb1ShellMin: {value: shellBox.min.clone()},
      nb1ShellSize: {value: shellSize.clone()},
      nb1EmitterXZ: {value: emitterXZ},
    },
    fragment: `
      uniform vec3 nb1SourceOne;
      uniform vec3 nb1SourceTwo;
      uniform vec3 nb1ShellMin;
      uniform vec3 nb1ShellSize;
      uniform vec2 nb1EmitterXZ;
      vec3 nb1LightField(vec3 localPosition) {
        vec3 p = (localPosition - nb1ShellMin) / nb1ShellSize;
        vec2 plane = 2.0 * (localPosition.xz - nb1EmitterXZ) / nb1ShellSize.xz;
        float radius = dot(plane * plane, vec2(1.8, 2.2));
        float radial = 0.72 * exp(-0.55 * radius) + 0.28 * exp(-3.2 * radius);
        float upper = exp(-8.0 * (p.y - 0.8) * (p.y - 0.8));
        float lower = exp(-8.0 * (p.y - 0.2) * (p.y - 0.2));
        return 1.38 * radial * (nb1SourceOne * upper + nb1SourceTwo * lower);
      }
    `,
  };
  plastic.userData.lightField = lightField;
  plastic.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, lightField.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 nb1LocalPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nnb1LocalPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 nb1LocalPosition;\n${lightField.fragment}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 nb1Radiance = nb1LightField(nb1LocalPosition);
        float nb1Strength = max(nb1Radiance.r, max(nb1Radiance.g, nb1Radiance.b));
        vec3 nb1Hue = nb1Strength > 0.0 ? nb1Radiance / nb1Strength : vec3(1.0);
        float nb1PeakOne = max(nb1SourceOne.r, max(nb1SourceOne.g, nb1SourceOne.b));
        float nb1PeakTwo = max(nb1SourceTwo.r, max(nb1SourceTwo.g, nb1SourceTwo.b));
        float nb1Peak = max(nb1PeakOne, nb1PeakTwo);
        float nb1Coverage = clamp(nb1Strength / max(nb1Peak, 0.000001), 0.0, 1.0);
        float nb1Tint = 0.94 * pow(clamp(nb1Peak, 0.0, 1.0), 0.15) * nb1Coverage;
        // Keep the lit core from being washed out by the milky reflection.
        // This surface tint is separate from the additive linear emission.
        vec3 nb1SurfaceTint = mix(vec3(1.0), pow(nb1Hue, vec3(1.0 / 2.2)), nb1Tint);
        diffuseColor.rgb *= pow(nb1SurfaceTint, vec3(2.2));
      `)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= nb1Radiance;');
  };
  plastic.customProgramCacheKey = () => 'nb1-continuous-scattering-v2';
  const graphite = material(new THREE.MeshPhysicalMaterial({
    color: 0x91999f, metalness: .94, roughness: .62,
  }));
  const steel = material(new THREE.MeshPhysicalMaterial({
    color: 0xb4bcc0, metalness: .96, roughness: .54,
    roughnessMap: metalRoughness, normalMap: metalNormal, normalScale: new THREE.Vector2(.08, .1), anisotropy: 0,
  }));
  const solderTail = material(new THREE.MeshStandardMaterial({ color: 0xb9b7ae, metalness: .72, roughness: .3 }));
  const darkPolymer = material(new THREE.MeshStandardMaterial({ color: 0x151d22, metalness: 0, roughness: .84 }));
  const contacts = material(new THREE.MeshStandardMaterial({ color: 0xbca16b, metalness: .88, roughness: .31 }));
  if (showShell) {
    add('Original frame — CAD details retained', metalUV(frame, true), graphite);
    add('One continuous milky diffuser', shell, plastic);
  } else {
    geometries.add(frame); geometries.add(shell);
  }

  // The front of the PCB slides between the shield walls.
  const plug = new THREE.Group(); plug.name = 'USB-A plug'; group.add(plug);
  const boardTop = midY + pcbLayout.visual_approximations.board_thickness * unit / 2;

  // Nominal mating dimensions from USB-IF Figure 6-9. Two perforated
  // panels meet the rounded folds at their tangents along the long sides.
  const halfWidth = 6 * unit, halfHeight = 2.25 * unit;
  const wall = .315 * unit, radius = .64 * unit;
  const flat = halfWidth - radius, shoulder = halfHeight - radius;
  const panel = new THREE.Shape();
  panel.moveTo(0, -flat); panel.lineTo(plugLength, -flat);
  panel.lineTo(plugLength, flat); panel.lineTo(0, flat); panel.closePath();
  for (const offset of [-3, 3]) {
    const x = 5.16 * unit, z = offset * unit;
    const hole = new THREE.Path();
    hole.moveTo(x, z - 1.25 * unit); hole.lineTo(x, z + 1.25 * unit);
    hole.lineTo(x + 2 * unit, z + 1.25 * unit); hole.lineTo(x + 2 * unit, z - 1.25 * unit);
    hole.closePath(); panel.holes.push(hole);
  }
  const face = metalUV(plate(panel, wall));
  add('Perforated steel roof', face, steel, plug).position.set(plugEnd, midY + halfHeight - wall, 0);
  add('Steel floor', face, steel, plug).position.set(plugEnd, midY - halfHeight, 0);

  const bend = new THREE.Shape();
  bend.moveTo(flat, halfHeight); bend.absarc(flat, shoulder, radius, Math.PI / 2, 0, true);
  bend.lineTo(halfWidth, -shoulder); bend.absarc(flat, -shoulder, radius, 0, -Math.PI / 2, true);
  bend.lineTo(flat, -halfHeight + wall); bend.absarc(flat, -shoulder, radius - wall, -Math.PI / 2, 0, false);
  bend.lineTo(halfWidth - wall, shoulder); bend.absarc(flat, shoulder, radius - wall, 0, Math.PI / 2, false);
  bend.closePath();
  const folded = new THREE.ExtrudeGeometry(bend, {depth: plugLength, bevelEnabled: false, curveSegments: 12});
  folded.rotateY(-Math.PI / 2);
  const side = metalUV(creasedNormals(folded));
  folded.dispose();
  for (const sign of [-1, 1]) {
    const mesh = add('Folded side wall', side, steel, plug);
    mesh.position.set(plugRoot, midY, 0);
    if (sign < 0) mesh.rotation.x = Math.PI;
  }

  // The black carrier sits against the ThingM-side inner wall. Its nose
  // chamfer and rear termination are approximated from the Molex connector.
  const insideTop = midY + halfHeight - wall, insideBottom = midY - halfHeight + wall;
  const tongueTop = insideTop - 1.95 * unit, nose = plugEnd + .5 * unit;
  const carrierWidth = 10.5 * unit, carrier = new THREE.Shape();
  carrier.moveTo(nose, insideBottom); carrier.lineTo(boardFront, insideBottom);
  carrier.lineTo(boardFront, insideTop); carrier.lineTo(boardFront - .3 * unit, insideTop);
  carrier.lineTo(boardFront - .3 * unit, tongueTop); carrier.lineTo(nose + .35 * unit, tongueTop);
  carrier.lineTo(nose, tongueTop - .25 * unit); carrier.closePath();
  const tongue = new THREE.ExtrudeGeometry(carrier, {depth: carrierWidth, bevelEnabled: false});
  add('Black recessed tongue', tongue, darkPolymer, plug).position.z = -carrierWidth / 2;

  function plugBox(name, length, height, width, x, y, z, surface) {
    const mesh = add(name, new THREE.BoxGeometry(length, height, width), surface, plug);
    mesh.position.set(x, y, z);
  }
  const carrierRear = plugEnd + 18.8 * unit;
  plugBox('Rear insulator', carrierRear - boardFront, insideTop - boardTop, carrierWidth,
    (carrierRear + boardFront) / 2, (insideTop + boardTop) / 2, 0, darkPolymer);
  const contactRear = plugEnd + 8.65 * unit, tailEnd = plugRoot + 2.6 * unit;
  for (const [index, offset] of [3.5, 1, -1, -3.5].entries()) {
    const length = (Math.abs(offset) > 1 ? 7.41 : 6.41) * unit;
    plugBox('Recessed contact ' + (index + 1), length, .08 * unit, unit,
      contactRear - length / 2, tongueTop + .04 * unit, offset * unit, contacts);
    plugBox('X1 solder tail ' + (index + 1), tailEnd - carrierRear, .12 * unit, .65 * unit,
      (tailEnd + carrierRear) / 2, boardTop + .09 * unit, offset * unit, solderTail);
  }
  group.userData.usbInterior = { openFace: '+y', tongueFace: '-y', contactFace: '+y', midplaneY: midY };

  const pcbModel = showPCB ? createBlink1PCB(THREE, {
    unit,
    originX: boardFront,
    centerY: midY,
    centerZ: midZ,
  }) : null;
  if (pcbModel) group.add(pcbModel.group);

  // A physical pair above/below the PCB. Their spill can illuminate a caller's
  // desk plane, while the continuous cap stays white between softer highlights.
  // Keep a lamp's spill near its own face and the desk. A long-range,
  // unshadowed point light would shine through the PCB into the opposite cap.
  const spillDistance = Math.max(.75, shellSize.y * .6);
  const upperLight = new THREE.PointLight(0xffffff, 0, spillDistance, 2);
  const lowerLight = new THREE.PointLight(0xffffff, 0, spillDistance, 2);
  upperLight.name = 'LED 1 — top'; lowerLight.name = 'LED 2 — bottom';
  upperLight.position.set(emitterXZ.x, frameBox.max.y + .18 * unit, emitterXZ.y);
  lowerLight.position.set(emitterXZ.x, frameBox.min.y - .18 * unit, emitterXZ.y);
  group.add(upperLight, lowerLight);
  group.userData.ledPlacement = 'independent top/bottom PCB faces; not side-by-side bulbs';
  group.userData.ledFaces = {
    1: { axis: '+y', wordmark: hasCAD ? 'blink(1)' : null },
    2: { axis: '-y', wordmark: hasCAD ? 'ThingM' : null },
  };
  group.userData.pcbRevision = pcbModel ? 'v2c6' : null;
  group.userData.faceMappingSource = 'Project MK2 wordmark mapping; manufacturer references supply top/bottom numbering. See model-assets/source.json.';
  group.userData.bodySize = { x: shellSize.x, y: shellSize.y, z: shellSize.z };
  group.userData.upAxis = 'y';

  function canonical(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
  }
  function rgb(value) { return value ? [1, 3, 5].map(start => parseInt(value.slice(start, start + 2), 16)) : [0, 0, 0]; }
  function setColors(one, two, source = 'none') {
    if (disposed) return;
    const first = canonical(one), second = canonical(two);
    const active = source !== 'none' && Boolean(first || second);
    const key = `${active}:${source}:${first}:${second}`;
    if (key === lastColors) return;
    lastColors = key;
    // THREE.Color decodes the canonical sRGB strings to the working linear
    // color space once. Do not average the sources or clip their HDR sum.
    lightField.uniforms.nb1SourceOne.value.set(active && first ? first : '#000000');
    lightField.uniforms.nb1SourceTwo.value.set(active && second ? second : '#000000');
    pcbModel?.setColors(first, second, active);
    for (const [light, color] of [[upperLight, first], [lowerLight, second]]) {
      const power = active && color ? Math.max(...rgb(color)) / 255 : 0;
      light.color.set(color || '#ffffff'); light.intensity = power * .48;
    }
    group.userData.colorSource = active ? source : 'none';
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    pcbModel?.dispose();
    for (const value of textures) value.dispose();
    for (const value of materials) value.dispose();
    for (const value of geometries) value.dispose();
    upperLight.dispose(); lowerLight.dispose();
    group.clear();
    textures.clear(); materials.clear(); geometries.clear();
  }
  setColors(null, null, 'none');
  return { group, setColors, dispose };
}
