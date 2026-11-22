/* Visual MK2 PCB assembly derived from the official v2c6 EAGLE placement.
 * PCB layout data: CC BY-SA 3.0, see model-assets/PCB-LICENSE.txt.
 * Component body heights are visual estimates, not manufacturing dimensions.
 */
import layout from './model-assets/pcb-layout.json' with {type: 'json'};

export function createBlink1PCB(THREE, {unit, originX, centerY, centerZ}) {
  const group = new THREE.Group();
  group.name = 'blink(1) mk2 PCB v2c6';
  group.userData.pcbRevision = layout.revision;
  group.userData.pcbSource = layout.source.url;
  group.userData.leds = {L1: '+Y / blink(1)', L2: '-Y / ThingM'};
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const ownGeometry = value => { geometries.add(value); return value; };
  const ownMaterial = value => { materials.add(value); return value; };
  const ownTexture = value => { textures.add(value); return value; };
  const minX = layout.bounds.min[0], maxX = layout.bounds.max[0];
  const minY = layout.bounds.min[1], maxY = layout.bounds.max[1];
  const boardWidth = maxX - minX, boardLength = maxY - minY;
  const boardThickness = layout.visual_approximations.board_thickness;
  const boardBottom = centerY - boardThickness * unit / 2;
  const mmX = value => (value - minX) * unit;
  const mmZ = value => -(value - layout.coordinate_system.center_y) * unit;
  const point = (x, y) => ({x: originX + mmX(x), z: centerZ + mmZ(y)});
  const sideSign = side => side === 'top' ? 1 : -1;

  function makeMaterial(Material, options) {
    return ownMaterial(new Material(options));
  }
  function mesh(name, shape, surface) {
    ownGeometry(shape);
    const object = new THREE.Mesh(shape, surface);
    object.name = name;
    object.castShadow = true;
    object.receiveShadow = true;
    group.add(object);
    return object;
  }
  function box(name, x, y, z, sizeX, sizeY, sizeZ, surface) {
    const shape = new THREE.BoxGeometry(sizeX * unit, sizeY * unit, sizeZ * unit);
    const object = mesh(name, shape, surface);
    object.position.set(x, y, z);
    return object;
  }
  function pcbShape() {
    const shape = new THREE.Shape();
    const xy = ([x, y]) => [(x - minX) * unit, -(y - layout.coordinate_system.center_y) * unit];
    for (const command of layout.outline) {
      if (command.op === 'move') {
        const [x, y] = xy(command.to); shape.moveTo(x, y);
      } else if (command.op === 'line') {
        const [x, y] = xy(command.to); shape.lineTo(x, y);
      } else if (command.op === 'arc') {
        const [x, y] = xy(command.center);
        const start = -THREE.MathUtils.degToRad(command.start);
        const end = -THREE.MathUtils.degToRad(command.end);
        shape.absarc(x, y, command.radius * unit, start, end, true);
      } else if (command.op === 'close') shape.closePath();
    }
    for (const hole of layout.holes) {
      const x = mmX(hole.x);
      const y = -(hole.y - layout.coordinate_system.center_y) * unit;
      const holePath = new THREE.Path();
      holePath.absarc(x, y, hole.drill * unit / 2, 0, Math.PI * 2, false);
      shape.holes.push(holePath);
    }
    return shape;
  }

  const boardMaterial = makeMaterial(THREE.MeshPhysicalMaterial, {
    color: 0xf0eee5, metalness: 0, roughness: .62, clearcoat: .08,
    clearcoatRoughness: .55, side: THREE.DoubleSide,
  });
  const copper = makeMaterial(THREE.MeshStandardMaterial, {
    color: 0xc69b59, metalness: .68, roughness: .38, side: THREE.DoubleSide,
  });
  const solder = makeMaterial(THREE.MeshStandardMaterial, {
    color: 0xb9b7ae, metalness: .72, roughness: .3, side: THREE.DoubleSide,
  });
  const ceramic = makeMaterial(THREE.MeshPhysicalMaterial, {
    color: 0xd6c8a8, metalness: 0, roughness: .4,
  });
  const resistorBody = makeMaterial(THREE.MeshStandardMaterial, {
    color: 0xb9aa8f, metalness: .05, roughness: .56,
  });
  const chipBody = makeMaterial(THREE.MeshPhysicalMaterial, {
    color: 0x17191a, metalness: .12, roughness: .36, clearcoat: .16,
  });
  const markMaterial = makeMaterial(THREE.MeshBasicMaterial, {color: 0xb0493d});
  const lensMaterial = makeMaterial(THREE.MeshPhysicalMaterial, {
    color: 0xf8f6ec, metalness: 0, roughness: .28, transmission: .22,
    thickness: .14, ior: 1.45, side: THREE.DoubleSide,
  });

  const boardGeometry = new THREE.ExtrudeGeometry(pcbShape(), {
    depth: boardThickness * unit, bevelEnabled: false, curveSegments: 12,
  });
  boardGeometry.rotateX(-Math.PI / 2);
  const board = mesh('White solder-mask PCB', boardGeometry, boardMaterial);
  board.position.set(originX, boardBottom, centerZ);

  function surfaceY(side, offset = .012) {
    const sign = sideSign(side);
    return centerY + sign * (boardThickness / 2 + offset) * unit;
  }
  function addSmdPad(name, x, y, side, width, depth, rotation = 0, surface = copper) {
    const location = point(x, y), angle = THREE.MathUtils.degToRad(rotation);
    const sizeX = Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * depth;
    const sizeZ = Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * depth;
    return box(name, location.x, surfaceY(side, .02), location.z,
      sizeX, .035, sizeZ, surface);
  }
  function addRingPad(name, x, y, side, diameter, drill) {
    const location = point(x, y), outer = new THREE.Shape();
    outer.absarc(0, 0, diameter * unit / 2, 0, Math.PI * 2, false);
    const inner = new THREE.Path();
    inner.absarc(0, 0, drill * unit / 2, 0, Math.PI * 2, true);
    outer.holes.push(inner);
    const shape = new THREE.ExtrudeGeometry(outer, {
      depth: .035 * unit, bevelEnabled: false, curveSegments: 20,
    });
    shape.rotateX(-Math.PI / 2);
    const object = mesh(name, shape, copper);
    object.position.set(location.x, surfaceY(side, .005), location.z);
    return object;
  }

  function rotatedOffset(dx, dz, rotation) {
    const angle = THREE.MathUtils.degToRad(rotation);
    return {
      x: dx * Math.cos(angle) - dz * Math.sin(angle),
      z: dx * Math.sin(angle) + dz * Math.cos(angle),
    };
  }
  const componentLocations = new Map(layout.components.map(component => [component.ref, point(component.x, component.y)]));
  const ledEmitters = new Map();

  for (const component of layout.components) {
    const location = componentLocations.get(component.ref);
    const sign = sideSign(component.side);
    const surface = surfaceY(component.side);
    const angle = component.rotation;
    if (component.kind === 'usb') {
      // Four SMD contact lands and two mechanical anchor rings join the
      // separately constructed metal USB shell to this PCB.
      for (const [index, offsetY] of [-3.5, -1, 1, 3.5].entries()) {
        addSmdPad(`X1 contact ${index + 1}`, component.x + 2.6,
          component.y + offsetY, 'top', 1.2, 2, 270, solder);
      }
      for (const [index, [offsetX, offsetY]] of component.mounting_pads.offsets.entries()) {
        addSmdPad(`X1 shell anchor ${index + 1}`,
          component.x + offsetX, component.y + offsetY,
          component.mounting_pads.side,
          ...component.mounting_pads.size, 0, solder);
      }
      continue;
    }
    if (component.kind === 'programming-pads') {
      for (let i = 0; i < component.count; i++) {
        const x = component.x + i * component.pitch;
        for (const side of ['top', 'bottom']) addRingPad(`JP3 pad ${i + 1} ${side}`,
          x, component.y, side, 1.27, .8);
      }
      continue;
    }
    if (component.kind === 'testpad') {
      const radius = .55 * unit;
      const pad = mesh('P1 exposed test pad',
        new THREE.CylinderGeometry(radius, radius, .035 * unit, 24), copper);
      pad.position.set(location.x, surface + sign * .02 * unit, location.z);
      continue;
    }
    if (component.kind === 'rgb-led') {
      // The two 5050 packages occupy the same XY position on opposite PCB
      // faces. Each gets its own white package, cover, and variable RGB emitter.
      const [width, height, depth] = component.body;
      const padOffsets = [[-2.45, -1.65], [2.45, -1.65], [-2.45, 1.65], [2.45, 1.65]];
      for (let i = 0; i < padOffsets.length; i++) {
        const offset = rotatedOffset(...padOffsets[i], angle);
        addSmdPad(`${component.ref} LED land ${i + 1}`,
          component.x + offset.x, component.y + offset.z, component.side, 1.5, .9, angle);
      }
      const bodyCenter = surface + sign * (height / 2 + .025) * unit;
      box(`${component.ref} WS2812B package`, location.x, bodyCenter, location.z,
        width, height, depth, lensMaterial);
      const lensCenter = bodyCenter + sign * height * .47 * unit;
      box(`${component.ref} LED optic`, location.x, lensCenter, location.z,
        3.25, .12, 3.25, lensMaterial);
      const emitterY = lensCenter + sign * .075 * unit;
      const emitterMaterial = makeMaterial(THREE.MeshStandardMaterial, {
        color: 0x101010, emissive: 0x000000, roughness: .36, metalness: .05,
        emissiveIntensity: 0,
      });
      const emitter = box(`${component.ref} RGB emitter`, location.x, emitterY, location.z,
        1.2, .08, 1.2, emitterMaterial);
      ledEmitters.set(component.ref, emitter.material);
      continue;
    }

    const body = component.body;
    if (component.kind === 'microcontroller') {
      const [width, height, depth] = body;
      for (const direction of [-1, 1]) {
        for (const offset of [-.975, -.325, .325, .975]) {
          const left = rotatedOffset(direction * 1.95, offset, angle);
          const top = rotatedOffset(offset, direction * 1.95, angle);
          addSmdPad(`U1 QFN perimeter land`, component.x + left.x,
            component.y + left.z, component.side, .8, .35, angle);
          addSmdPad(`U1 QFN perimeter land`, component.x + top.x,
            component.y + top.z, component.side, .8, .35, angle);
        }
      }
      const centerY = surface + sign * (height / 2 + .025) * unit;
      box('U1 PIC16F1455ML QFN16', location.x, centerY, location.z,
        width, height, depth, chipBody);
      box('U1 pin 1 mark',
        location.x - .9 * unit, centerY + sign * (height / 2 + .01) * unit,
        location.z + .9 * unit, .28, .025, .28, markMaterial);
      continue;
    }
    if (component.kind === 'capacitor' || component.kind === 'resistor') {
      const [rawLength, rawHeight, rawWidth] = body;
      const rotated = Math.abs(angle % 180) === 90;
      const length = rotated ? rawWidth : rawLength;
      const width = rotated ? rawLength : rawWidth;
      for (const signPad of [-1, 1]) {
        const offset = rotatedOffset(signPad * .85, 0, angle);
        addSmdPad(`${component.ref} solder land`, component.x + offset.x,
          component.y + offset.z, component.side, 1.1, 1, angle);
      }
      const centerY = surface + sign * (rawHeight / 2 + .025) * unit;
      const bodyMaterial = component.kind === 'resistor' ? resistorBody : ceramic;
      box(`${component.ref} ${component.value} ${component.kind}`,
        location.x, centerY, location.z, length, rawHeight, width, bodyMaterial);
      for (const end of [-1, 1]) {
        const offset = rotatedOffset(end * (rawLength / 2 - .11), 0, angle);
        const termination = point(component.x + offset.x, component.y + offset.z);
        box(`${component.ref} metal termination`, termination.x,
          centerY, termination.z, rotated ? rawWidth : .22,
          rawHeight * .72, rotated ? .22 : rawWidth, solder);
      }
    }
  }

  function makeSilkscreen(side) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const sx = canvas.width / boardWidth, sy = canvas.height / boardLength;
    context.fillStyle = '#242629';
    context.textBaseline = 'middle';
    for (const mark of layout.silkscreen.filter(value => value.side === side)) {
      const x = (mark.x - minX) * sx;
      const y = (maxY - mark.y) * sy;
      context.save();
      context.translate(x, y);
      context.rotate(-THREE.MathUtils.degToRad(mark.rotation || 0));
      context.font = `600 ${Math.max(12, mark.size * sx)}px Arial, sans-serif`;
      context.fillText(mark.text, 0, 0);
      context.restore();
    }
    const texture = ownTexture(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }
  function addSilkscreen(side) {
    const map = makeSilkscreen(side);
    if (!map) return;
    const material = makeMaterial(THREE.MeshBasicMaterial, {
      color: 0xffffff, map, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1,
    });
    const plane = mesh(`${side} PCB silkscreen`,
      new THREE.PlaneGeometry(boardWidth * unit, boardLength * unit), material);
    const sign = sideSign(side);
    plane.rotation.x = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
    plane.position.set(originX + boardWidth * unit / 2,
      centerY + sign * (boardThickness / 2 + .006) * unit, centerZ);
  }
  addSilkscreen('top');
  addSilkscreen('bottom');

  function setColors(one, two, active) {
    for (const [ref, color] of [['L1', one], ['L2', two]]) {
      const surface = ledEmitters.get(ref);
      if (!surface) continue;
      const value = active && color ? color : '#000000';
      surface.color.set(value);
      surface.emissive.set(value);
      surface.emissiveIntensity = active && color ? 2.4 : 0;
    }
  }
  function dispose() {
    group.removeFromParent();
    for (const value of geometries) value.dispose();
    for (const value of materials) value.dispose();
    for (const value of textures) value.dispose();
    group.clear();
  }
  return {group, setColors, dispose};
}
