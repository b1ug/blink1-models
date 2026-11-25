// Steady-state, scalar diffusion in the manufactured shape. Distances in
// the transport equation are millimetres, independent of model display scale.
import {intersectionIndex} from './enclosure-fit.js';

const AIR = 0, PLASTIC = 1, OPAQUE = 2;
// Assumptions for milky plastic, pending photometric measurements.
const cellMM = .45, absorption = .008, reducedScattering = .42;
const diffusion = 1 / (3 * (absorption + reducedScattering));
const boundaryReflectance = .78;
export const diffuserIOR = 1.44;
const rayCount = 4096;
// Relative axial intensity at full PWM with distances measured in mm. One
// display scale drives the bare source, diffuser exitance and external spill.
export const fullDriveIntensity = 3450;

function rasterize(grid, geometry, offset, medium) {
  const {nx, ny, nz, cell, origin, cells} = grid;
  const index = intersectionIndex(geometry, 1, cell * 3);
  for (let z = 1; z < nz - 1; z++) for (let x = 1; x < nx - 1; x++) {
    const hits = index.at(origin.z + (z + .5) * cell - offset.z,
      origin.x + (x + .5) * cell - offset.x);
    for (let k = 1; k < hits.length; k += 2) {
      const bottom = Math.max(1, Math.ceil((hits[k - 1] + offset.y - origin.y) / cell - .5));
      const top = Math.min(ny - 2, Math.floor((hits[k] + offset.y - origin.y) / cell - .5));
      for (let y = bottom; y <= top; y++) cells[x + nx * (y + ny * z)] = medium;
    }
  }
}

// A low-discrepancy sequence covers the finite window and its cosine-weighted
// outward hemisphere deterministically. Air gaps transmit, opaque cells stop
// a ray, and the first plastic voxel receives its share of the window flux.
function radicalInverse(i, base) {
  let result = 0, weight = 1 / base;
  while (i > 0) {
    result += (i % base) * weight;
    i = Math.floor(i / base);
    weight /= base;
  }
  return result;
}

// Fraction transmitted at a smooth air-to-plastic interface. The exiting
// diffuse field already includes the separate internal boundary reflectance.
function entryTransmittance(cosine) {
  const cosineIn = Math.sqrt(1 - (1 - cosine * cosine) / (diffuserIOR * diffuserIOR));
  const s = (cosine - diffuserIOR * cosineIn) / (cosine + diffuserIOR * cosineIn);
  const p = (diffuserIOR * cosine - cosineIn) / (diffuserIOR * cosine + cosineIn);
  return 1 - (s * s + p * p) / 2;
}

function trace(grid, x, y, z, dx, dy, dz, hit) {
  const {nx, ny, nz, cells} = grid;
  // Traverse every crossed voxel, including shallow rays along the metal.
  let ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tx = Math.abs(1 / dx), ty = Math.abs(1 / dy), tz = Math.abs(1 / dz);
  let ax = dx ? ((dx > 0 ? ix + 1 : ix) - x) / dx : Infinity;
  let ay = dy ? ((dy > 0 ? iy + 1 : iy) - y) / dy : Infinity;
  let az = dz ? ((dz > 0 ? iz + 1 : iz) - z) / dz : Infinity;
  // The mk2 windows face ±Y. If a sub-voxel air gap puts the ray origin
  // inside plastic, approximate its entry plane by the window plane.
  let axis = 1;
  while (ix >= 0 && ix < nx && iy >= 0 && iy < ny && iz >= 0 && iz < nz) {
    const j = ix + nx * (iy + ny * iz);
    if (cells[j] !== AIR) {
      hit.axis = axis;
      return j;
    }
    if (ax <= ay && ax <= az) { ix += sx; ax += tx; axis = 0; }
    else if (ay <= az) { iy += sy; ay += ty; axis = 1; }
    else { iz += sz; az += tz; axis = 2; }
  }
  return -1;
}

function incidentFlux(grid, source) {
  const {cell, origin, cells} = grid;
  const flux = new Float32Array(cells.length);
  const sign = source.normal.y;
  const hit = {axis: 1};
  const cx = (source.position.x - origin.x) / cell;
  const cy = (source.position.y - origin.y) / cell;
  const cz = (source.position.z - origin.z) / cell;
  for (let i = 1; i <= rayCount; i++) {
    const r = Math.sqrt((i - .5) / rayCount) * source.radius / cell;
    const phi = 2 * Math.PI * radicalInverse(i, 2);
    const x = cx + r * Math.cos(phi), y = cy, z = cz + r * Math.sin(phi);
    const radial = Math.sqrt(radicalInverse(i, 3)), angle = 2 * Math.PI * radicalInverse(i, 5);
    const dx = radial * Math.cos(angle), dy = sign * Math.sqrt(1 - radial * radial), dz = radial * Math.sin(angle);
    const target = trace(grid, x, y, z, dx, dy, dz, hit);
    if (cells[target] === PLASTIC) {
      const cosine = Math.abs(hit.axis === 0 ? dx : hit.axis === 1 ? dy : dz);
      flux[target] += entryTransmittance(cosine) / rayCount;
    }
  }
  return flux;
}

// Integrate the cosine-weighted solid angle occupied by other diffuser
// surfaces. A ray that leaves the grid, or meets an opaque part, terminates.
// Each successful path transfers a share of an existing air-boundary loss.
function cavityExchange(grid, active, offsets, airLoss) {
  const {nx, ny, cells} = grid;
  const plane = nx * ny, samples = 48;
  const directions = Array.from({length: 6}, (_, face) =>
    Array.from({length: samples}, (_, i) => {
      const r = Math.sqrt((i + .5) / samples), phi = i * Math.PI * (3 - Math.sqrt(5));
      const v = [0, 0, 0], axis = face >> 1;
      v[axis] = (face % 2 ? 1 : -1) * Math.sqrt(1 - r * r);
      v[(axis + 1) % 3] = r * Math.cos(phi);
      v[(axis + 2) % 3] = r * Math.sin(phi);
      return {dx: v[0], dy: v[1], dz: v[2],
        transmission: v.map(value => entryTransmittance(Math.abs(value)))};
    }));
  const origins = [], destinations = [], weights = [];
  const hit = {axis: 1};
  const hits = new Map();
  for (const j of active) {
    const x = j % nx + .5, y = Math.floor(j / nx) % ny + .5, z = Math.floor(j / plane) + .5;
    hits.clear();
    for (let face = 0; face < 6; face++) {
      if (cells[j + offsets[face]] !== AIR) continue;
      const shift = face % 2 ? .50001 : -.50001;
      const a = face < 2 ? x + shift : x;
      const b = face === 2 || face === 3 ? y + shift : y;
      const c = face >= 4 ? z + shift : z;
      for (const ray of directions[face]) {
        const target = trace(grid, a, b, c, ray.dx, ray.dy, ray.dz, hit);
        if (cells[target] === PLASTIC) {
          hits.set(target, (hits.get(target) ?? 0) + ray.transmission[hit.axis]);
        }
      }
    }
    for (const [target, transmitted] of hits) {
      origins.push(j); destinations.push(target); weights.push(transmitted * airLoss / samples);
    }
  }
  return {from: Int32Array.from(origins), to: Int32Array.from(destinations), weight: Float32Array.from(weights)};
}

function solve(grid, sources, stepMM, airLoss) {
  const {nx, ny, cells} = grid;
  const offsets = [-1, 1, -nx, nx, -nx * ny, nx * ny];
  const active = [], diagonal = [];
  // Finite-volume balance: internal neighbours exchange flux, air interfaces
  // leak through an extrapolated diffusion boundary, opaque contacts absorb
  // a fraction and return the rest to the same side.
  for (let j = 0; j < cells.length; j++) {
    if (cells[j] !== PLASTIC) continue;
    let total = absorption * stepMM * stepMM / diffusion;
    for (const offset of offsets) {
      const adjacent = cells[j + offset];
      total += adjacent === PLASTIC ? 1 : adjacent === AIR ? airLoss : .28;
    }
    active.push(j);
    diagonal.push(1 / total);
  }
  const exchange = cavityExchange(grid, active, offsets, airLoss);
  const plane = nx * ny;
  return sources.map(source => {
    const input = incidentFlux(grid, source);
    const field = new Float32Array(cells.length);
    const gain = 1 / (diffusion * stepMM);
    const returned = new Float32Array(cells.length);
    // Update the nonlocal boundary flux between short blocks of diffusion
    // sweeps. Each source drives its own linear field through the same paths.
    for (let pass = 0; pass < 800; pass++) {
      if (pass % 8 === 0) {
        returned.fill(0);
        for (let n = 0; n < exchange.from.length; n++) {
          returned[exchange.to[n]] += field[exchange.from[n]] * exchange.weight[n];
        }
      }
      let change = 0;
      for (let k = 0; k < active.length; k++) {
        const j = active[k];
        const next = diagonal[k] * (input[j] * gain + returned[j] + field[j - 1] + field[j + 1]
          + field[j - nx] + field[j + nx] + field[j - plane] + field[j + plane]);
        const delta = 1.5 * (next - field[j]);
        field[j] += delta;
        change = Math.max(change, Math.abs(delta));
      }
      if (change < 1e-7 && pass % 8 === 0) break;
    }
    return field;
  });
}

// A surface fragment can lie between a cell centre inside the plastic and
// one in air. Reconstruct from the nearby plastic samples only. Padding here
// is for trilinear texture reads and never participates in diffusion.
function transferTexture(THREE, grid, fields) {
  const {nx, ny, nz, cells} = grid;
  const values = new Uint16Array(cells.length * 2);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let total = 0, one = 0, two = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const a = x + dx, b = y + dy, c = z + dz;
      if (a < 0 || a >= nx || b < 0 || b >= ny || c < 0 || c >= nz) continue;
      const neighbour = a + nx * (b + ny * c);
      if (cells[neighbour] !== PLASTIC) continue;
      const weight = (2 - Math.abs(dx)) * (2 - Math.abs(dy)) * (2 - Math.abs(dz));
      total += weight;
      one += weight * fields[0][neighbour];
      two += weight * fields[1][neighbour];
    }
    if (!total) continue;
    const j = (x + nx * (y + ny * z)) * 2;
    values[j] = THREE.DataUtils.toHalfFloat(Math.max(0, one / total));
    values[j + 1] = THREE.DataUtils.toHalfFloat(Math.max(0, two / total));
  }
  const texture = new THREE.Data3DTexture(values, nx, ny, nz);
  texture.format = THREE.RGFormat;
  texture.type = THREE.HalfFloatType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Collapse the broad faces' outgoing radiance to two Lambertian lobes for
// nearby scene objects. Only the first occupied cell seen from outside can
// contribute. Metal covering a column hides the plastic behind it.
function outgoingLobes(THREE, grid, fields, shellBox) {
  const {nx, ny, nz, cell, origin, cells} = grid;
  return [1, -1].map(sign => {
    const response = [0, 0];
    let weightedX = 0, weightedZ = 0;
    for (let z = 1; z < nz - 1; z++) for (let x = 1; x < nx - 1; x++) {
      for (let y = sign > 0 ? ny - 2 : 1; y > 0 && y < ny - 1; y -= sign) {
        const i = x + nx * (y + ny * z);
        if (cells[i] === AIR) continue;
        if (cells[i] === PLASTIC) {
          const a = fields[0][i] * cell * cell, b = fields[1][i] * cell * cell;
          response[0] += a; response[1] += b;
          weightedX += (a + b) * (origin.x + (x + .5) * cell);
          weightedZ += (a + b) * (origin.z + (z + .5) * cell);
        }
        break;
      }
    }
    const total = response[0] + response[1];
    const position = shellBox.getCenter(new THREE.Vector3());
    if (total > 0) {
      position.x = weightedX / total;
      position.z = weightedZ / total;
    }
    position.y = (sign > 0 ? shellBox.max.y : shellBox.min.y) + sign * cell * .05;
    return {position, normal: new THREE.Vector3(0, sign, 0), response};
  });
}

// Shell and frame are in assembled object coordinates. The PCB substrate has
// a translated local mesh. Its bores and outline come from the EAGLE board.
export function createDiffuserTransfer(THREE, shell, frame, board, sources, unit) {
  const box = new THREE.Box3().setFromBufferAttribute(shell.getAttribute('position'));
  const shellBox = box.clone();
  for (const source of sources) {
    box.expandByPoint(source.position.clone().addScalar(source.radius));
    box.expandByPoint(source.position.clone().subScalar(source.radius));
  }
  const size = box.getSize(new THREE.Vector3());
  const cell = Math.max(cellMM * unit, Math.max(size.x, size.y, size.z) / 72);
  const extent = size.clone().divideScalar(cell).ceil().addScalar(2);
  const [nx, ny, nz] = extent.toArray();
  extent.multiplyScalar(cell);
  const origin = box.getCenter(new THREE.Vector3()).addScaledVector(extent, -.5);
  const grid = {nx, ny, nz, cell, origin, cells: new Uint8Array(nx * ny * nz)};
  const zero = new THREE.Vector3();
  rasterize(grid, shell, zero, PLASTIC);
  rasterize(grid, frame, zero, OPAQUE);
  if (board) rasterize(grid, board.geometry, board.position, OPAQUE);
  const stepMM = cell / unit;
  const airLoss = stepMM / (.5 * stepMM + 2 * diffusion * (1 + boundaryReflectance) / (1 - boundaryReflectance));
  const fields = solve(grid, sources, stepMM, airLoss);
  const surfaceGain = fullDriveIntensity * diffusion * airLoss / stepMM;
  return {texture: transferTexture(THREE, grid, fields), origin, extent, surfaceGain,
    lobes: outgoingLobes(THREE, grid, fields, shellBox)};
}
