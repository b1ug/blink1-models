/* Visual MK2 PCB assembly derived from the official v2c6 EAGLE placement.
 * PCB layout data: CC BY-SA 3.0, see model-assets/PCB-LICENSE.txt.
 * Component body heights are visual estimates, not manufacturing dimensions.
 */
import {fullDriveIntensity} from './diffuser-optics.js';
import layout from './model-assets/pcb-layout.json' with {type: 'json'};

// Distances in mm. The window radius comes from the circle in the EAGLE
// WS2812B package. The solder standoff and resin rise are visual estimates.
const windowRadius = 1.7204625;
const solderStandoff = .037;
const resinRise = .02;
// The clear resin scatters a small assumed fraction of the outgoing light.
// Direct emission stays concentrated at the dies below it.
const windowRadiance = fullDriveIntensity / (Math.PI * windowRadius ** 2);

export function getBlink1LEDSources(THREE, {unit, originX, centerY, centerZ}) {
  const halfBoard = layout.visual_approximations.board_thickness / 2;
  return layout.components.filter(part => part.kind === 'rgb-led').map(part => {
    const sign = part.side === 'top' ? 1 : -1;
    return {
      ref: part.ref,
      position: new THREE.Vector3(
        originX + (part.x - layout.bounds.min[0]) * unit,
        centerY + sign * (halfBoard + solderStandoff + part.body[1] + resinRise) * unit,
        centerZ - (part.y - layout.coordinate_system.center_y) * unit,
      ),
      normal: new THREE.Vector3(0, sign, 0),
      radius: windowRadius * unit,
    };
  });
}

export function createBlink1PCB(THREE, placement, sources = getBlink1LEDSources(THREE, placement)) {
  const {unit, originX, centerY, centerZ} = placement;
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
  const mmY = value => (value - layout.coordinate_system.center_y) * unit;
  const point = (x, y) => ({x: originX + mmX(x), z: centerZ - mmY(y)});
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
    // Extrude in the EAGLE XY plane. The board's -90° rotation maps +Y to -Z.
    const xy = ([x, y]) => [mmX(x), mmY(y)];
    for (const command of layout.outline) {
      if (command.op === 'move') {
        const [x, y] = xy(command.to); shape.moveTo(x, y);
      } else if (command.op === 'line') {
        const [x, y] = xy(command.to); shape.lineTo(x, y);
      } else if (command.op === 'arc') {
        const [x, y] = xy(command.center);
        const start = THREE.MathUtils.degToRad(command.start);
        const end = THREE.MathUtils.degToRad(command.end);
        shape.absarc(x, y, command.radius * unit, start, end, false);
      } else if (command.op === 'close') shape.closePath();
    }
    for (const hole of layout.holes) {
      const holePath = new THREE.Path();
      holePath.absarc(mmX(hole.x), mmY(hole.y), hole.drill * unit / 2, 0, Math.PI * 2, true);
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
  const packageMaterial = makeMaterial(THREE.MeshStandardMaterial, {color: 0xf8f6ec, roughness: .48});
  const reflector = makeMaterial(THREE.MeshStandardMaterial, {
    color: 0xe4decb, metalness: .22, roughness: .4,
  });
  const polarityMark = makeMaterial(THREE.MeshStandardMaterial, {
    color: 0xe4e1d6, roughness: .52,
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
    shape.rotateX(-sideSign(side) * Math.PI / 2);
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
      addSmdPad('P1 exposed test pad', component.x, component.y, component.side, 1.1, 1.1);
      continue;
    }
    if (component.kind === 'rgb-led') {
      const [width, height, depth] = component.body;
      const source = sources.find(({ref}) => ref === component.ref);
      // EAGLE mirrors bottom-side packages about board Y after rotation.
      const footprintOffset = (x, y) => {
        const offset = rotatedOffset(x, y, angle);
        return {x: sign * offset.x, y: offset.z};
      };
      const orient = geometry => {
        geometry.rotateZ(THREE.MathUtils.degToRad(angle));
        geometry.rotateX(-Math.PI / 2);
        if (sign < 0) geometry.rotateZ(Math.PI);
        return geometry;
      };
      const padOffsets = [[2.45, -1.65], [2.45, 1.65], [-2.45, 1.65], [-2.45, -1.65]];
      for (let i = 0; i < padOffsets.length; i++) {
        const offset = footprintOffset(...padOffsets[i]);
        addSmdPad(`${component.ref} LED land ${i + 1}`,
          component.x + offset.x, component.y + offset.y, component.side, 1.5, .9, angle);
      }
      // The moulded body surrounds an open well. The shared source plane
      // sits on the outward face of its resin fill.
      const halfX = width * unit / 2, halfZ = depth * unit / 2;
      const outline = new THREE.Shape();
      outline.moveTo(-halfX, -halfZ);
      outline.lineTo(halfX, -halfZ); outline.lineTo(halfX, halfZ);
      outline.lineTo(-halfX, halfZ); outline.closePath();
      const aperture = new THREE.Path();
      aperture.absarc(0, 0, source.radius, 0, Math.PI * 2, true);
      outline.holes.push(aperture);
      const housing = new THREE.ExtrudeGeometry(outline, {
        depth: height * unit, bevelEnabled: false, curveSegments: 32,
      });
      const body = mesh(`${component.ref} WS2812B package`, orient(housing), packageMaterial);
      body.position.copy(source.position).addScaledVector(source.normal, -(height + resinRise) * unit);
      const corner = new THREE.Shape();
      corner.moveTo(-halfX, halfZ); corner.lineTo(-halfX, halfZ - .9 * unit);
      corner.lineTo(-halfX + .9 * unit, halfZ); corner.closePath();
      const mark = mesh(`${component.ref} polarity mark`, orient(new THREE.ShapeGeometry(corner)), polarityMark);
      mark.position.copy(source.position).addScaledVector(source.normal, -(resinRise - .002) * unit);

      // Worldsemi specifies three LEDs and an integrated controller. Die
      // locations, well depth and optical constants are illustrative.
      const wellDepth = .49 * unit;
      const floor = mesh(`${component.ref} well`,
        new THREE.CircleGeometry(source.radius, 64), packageMaterial);
      floor.rotation.x = -sign * Math.PI / 2;
      floor.position.copy(source.position).addScaledVector(source.normal, -wellDepth);
      // Four separated lead-frame sections are visible in the manufacturer's
      // WS2812B pin-configuration drawing.
      const gap = .065 * unit, plateRadius = source.radius * .94;
      const start = Math.asin(gap / plateRadius);
      const plate = new THREE.Shape();
      plate.moveTo(gap, gap);
      plate.lineTo(plateRadius * Math.cos(start), gap);
      plate.absarc(0, 0, plateRadius, start, Math.PI / 2 - start, false);
      plate.closePath();
      for (let i = 0; i < 4; i++) {
        const section = new THREE.ShapeGeometry(plate, 16);
        section.rotateZ(i * Math.PI / 2);
        const land = mesh(`${component.ref} internal electrode ${i + 1}`, orient(section), reflector);
        land.position.copy(floor.position).addScaledVector(source.normal, .005 * unit);
      }
      const channels = [];
      const dieY = floor.position.y + sign * .035 * unit;
      for (const [channel, color, dx, dz] of [
        ['R', 0xff0000, -.49, -.30],
        ['G', 0x00ff00, .31, -.30],
        ['B', 0x0000ff, .31, .43],
      ]) {
        const material = makeMaterial(THREE.MeshStandardMaterial, {
          color: 0xafa58b, emissive: color, emissiveIntensity: 0,
          roughness: .36, metalness: .12,
        });
        const offset = footprintOffset(dx, dz);
        box(`${component.ref} ${channel} die`, location.x + offset.x * unit, dieY,
          location.z - offset.y * unit, .34, .07, .34, material);
        channels.push(material);
      }
      const driver = footprintOffset(-.67, .52);
      box(`${component.ref} controller die`, location.x + driver.x * unit, dieY,
        location.z - driver.y * unit, .55, .07, .49, chipBody);
      const resin = makeMaterial(THREE.MeshPhysicalMaterial, {
        color: 0xf8f6ef, roughness: .22, ior: 1.48, transmission: .87,
        thickness: wellDepth, emissiveIntensity: 0,
      });
      const window = mesh(`${component.ref} RGB emitter`, new THREE.CircleGeometry(source.radius, 64), resin);
      window.rotation.x = -sign * Math.PI / 2;
      window.position.copy(source.position);
      window.castShadow = false;
      ledEmitters.set(component.ref, {resin, channels});
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
            component.y + top.z, component.side, .8, .35, angle + 90);
        }
      }
      const centerY = surface + sign * (height / 2 + .025) * unit;
      box('U1 PIC16F1455ML QFN16', location.x, centerY, location.z,
        width, height, depth, chipBody);
      box('U1 pin 1 mark',
        location.x + .9 * unit, centerY + sign * (height / 2 + .01) * unit,
        location.z - .9 * unit, .28, .025, .28, markMaterial);
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
    context.textBaseline = 'alphabetic';
    for (const mark of layout.silkscreen.filter(value => value.side === side)) {
      const x = (mark.x - minX) * sx;
      // Each canvas is viewed from its own side. Turning the plane over
      // reverses its vertical texture axis relative to EAGLE coordinates.
      const y = (side === 'top' ? maxY - mark.y : mark.y - minY) * sy;
      context.save();
      context.translate(x, y);
      context.rotate(-sideSign(side) * THREE.MathUtils.degToRad(mark.rotation || 0));
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
      const {resin, channels} = ledEmitters.get(ref);
      resin.emissive.set(active && color ? color : 0x000000);
      const {r, g, b} = resin.emissive;
      for (const [index, level] of [r, g, b].entries()) {
        channels[index].emissiveIntensity = level * windowRadiance;
      }
      // Some light scatters across the resin on its way out of the well.
      resin.emissiveIntensity = r + g + b > 0 ? windowRadiance * .012 : 0;
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
