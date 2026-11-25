// Steady-state, scalar diffusion in the manufactured shape. Distances in
// the transport equation are millimetres, independent of model display scale.
import {intersectionIndex} from './enclosure-fit.js';

const AIR = 0, PLASTIC = 1, OPAQUE = 2;
// Assumptions for milky plastic, pending photometric measurements.
const cellMM = .45, absorption = .008, reducedScattering = .42;
const diffusion = 1 / (3 * (absorption + reducedScattering));
const boundaryReflectance = .78;
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
function incidentFlux(grid, source) {
  const {nx, ny, nz, cell, origin, cells} = grid;
  const flux = new Float32Array(cells.length);
  const sign = source.normal.y;
  const cx = (source.position.x - origin.x) / cell;
  const cy = (source.position.y - origin.y) / cell;
  const cz = (source.position.z - origin.z) / cell;
  for (let i = 1; i <= rayCount; i++) {
    const r = Math.sqrt((i - .5) / rayCount) * source.radius / cell;
    const phi = 2 * Math.PI * radicalInverse(i, 2);
    const x = cx + r * Math.cos(phi), y = cy, z = cz + r * Math.sin(phi);
    const radial = Math.sqrt(radicalInverse(i, 3)), angle = 2 * Math.PI * radicalInverse(i, 5);
    const dx = radial * Math.cos(angle), dy = sign * Math.sqrt(1 - radial * radial), dz = radial * Math.sin(angle);
    // Traverse every crossed voxel, including shallow rays along the metal.
    let ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const tx = Math.abs(1 / dx), ty = Math.abs(1 / dy), tz = Math.abs(1 / dz);
    let ax = dx ? ((dx > 0 ? ix + 1 : ix) - x) / dx : Infinity;
    let ay = dy ? ((dy > 0 ? iy + 1 : iy) - y) / dy : Infinity;
    let az = dz ? ((dz > 0 ? iz + 1 : iz) - z) / dz : Infinity;
    while (ix >= 0 && ix < nx && iy >= 0 && iy < ny && iz >= 0 && iz < nz) {
      const j = ix + nx * (iy + ny * iz);
      if (cells[j] === OPAQUE) break;
      if (cells[j] === PLASTIC) {
        flux[j] += 1 / rayCount;
        break;
      }
      if (ax <= ay && ax <= az) { ix += sx; ax += tx; }
      else if (ay <= az) { iy += sy; ay += ty; }
      else { iz += sz; az += tz; }
    }
  }
  return flux;
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
  const plane = nx * ny;
  return sources.map(source => {
    const input = incidentFlux(grid, source);
    const field = new Float32Array(cells.length);
    const gain = 1 / (diffusion * stepMM);
    // Successive over-relaxation on the symmetric positive diffusion system.
    for (let pass = 0; pass < 500; pass++) {
      let change = 0;
      for (let k = 0; k < active.length; k++) {
        const j = active[k];
        const next = diagonal[k] * (input[j] * gain + field[j - 1] + field[j + 1]
          + field[j - nx] + field[j + nx] + field[j - plane] + field[j + plane]);
        const delta = 1.5 * (next - field[j]);
        field[j] += delta;
        change = Math.max(change, Math.abs(delta));
      }
      if (change < 1e-6) break;
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
