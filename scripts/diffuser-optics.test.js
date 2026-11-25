import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../site/node_modules/three/build/three.module.js';
import {createDiffuserTransfer} from '../models/mk2/diffuser-optics.js';

test('a shutter, window position and emission direction control the two volume responses', t => {
  // A solid 16 × 2 × 10 mm diffuser with an LED facing each side.
  const slab = new THREE.BoxGeometry(16, 2, 10);
  const shutter = new THREE.BoxGeometry(18, .8, 12);
  const frame = new THREE.BoxGeometry(1, 1, 1).translate(0, 20, 0);
  const board = new THREE.Mesh(shutter);
  t.after(() => {
    for (const geometry of [slab, shutter, frame]) geometry.dispose();
    board.material.dispose();
  });
  const lower = {position: new THREE.Vector3(-3.5, -3.5, 0), normal: new THREE.Vector3(0, 1, 0), radius: .8};
  const upper = {position: new THREE.Vector3(3.5, 3.5, 0), normal: new THREE.Vector3(0, -1, 0), radius: .8};

  function response() {
    const {texture, origin, extent} = createDiffuserTransfer(THREE, slab, frame, board, [lower, upper], 1);
    t.after(() => texture.dispose());
    assert.ok(texture.isData3DTexture);
    assert.equal(texture.format, THREE.RGFormat);
    assert.equal(texture.type, THREE.HalfFloatType);
    const {data, width, height, depth} = texture.image;
    return [0, 1].map(channel => {
      const samples = new Float32Array(width * height * depth);
      let sum = 0, moment = 0;
      for (let i = 0; i < samples.length; i++) {
        const value = THREE.DataUtils.fromHalfFloat(data[2 * i + channel]);
        assert.ok(Number.isFinite(value) && value >= 0);
        samples[i] = value;
        sum += value;
        moment += value * (origin.x + (i % width + .5) * extent.x / width);
      }
      return {samples, sum, centroidX: sum > 0 ? moment / sum : null};
    });
  }

  // The opaque board starts between the lower window and diffuser, clear
  // of the plastic itself. Sliding it out of the beam restores that face.
  board.position.y = -2.2;
  const blocked = response();
  assert.equal(blocked[0].sum, 0);
  assert.ok(blocked[1].sum > 0);
  board.position.x = 30;
  const open = response();
  assert.ok(open[0].sum > 0 && open[0].centroidX < -1);
  assert.ok(open[1].centroidX > 1);
  assert.ok(open[1].samples.every((value, i) => value === blocked[1].samples[i]));

  lower.position.x = 3.5;
  const moved = response();
  assert.ok(moved[0].centroidX > 1);
  assert.ok(moved[1].samples.every((value, i) => value === open[1].samples[i]));

  lower.normal.negate();
  const reversed = response();
  assert.equal(reversed[0].sum, 0);
  assert.ok(reversed[1].samples.every((value, i) => value === open[1].samples[i]));

  // A shutter covering the centre of two concentric windows can clip the
  // smaller window completely while leaving part of the larger disk clear.
  lower.normal.set(0, 1, 0);
  upper.position.copy(lower.position);
  upper.normal.copy(lower.normal);
  lower.radius = .02;
  board.position.set(lower.position.x - 9 + .3, lower.position.y, 0);
  const clipped = response();
  assert.equal(clipped[0].sum, 0);
  assert.ok(clipped[1].sum > 0);
});

test('diffuse light crosses a visible air gap, and an opaque partition stops that path', t => {
  // The source shines upwards into the larger, lower panel. Every straight
  // path from the window to the upper panel passes through the lower one.
  const floor = new THREE.BoxGeometry(10, 1.8, 10).toNonIndexed().translate(0, -2.5, 0);
  const ceiling = new THREE.BoxGeometry(8, 1.8, 8).toNonIndexed().translate(0, 2.5, 0);
  const shell = new THREE.BufferGeometry();
  const vertices = [...floor.getAttribute('position').array, ...ceiling.getAttribute('position').array];
  shell.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const partition = new THREE.BoxGeometry(12, 1.2, 12);
  const led = {position: new THREE.Vector3(0, -4.5, 0), normal: new THREE.Vector3(0, 1, 0), radius: .8};
  const dark = {...led, normal: led.normal.clone().negate()};
  t.after(() => { for (const g of [floor, ceiling, shell, partition]) g.dispose(); });
  function responseAt(transfer, point) {
    const {texture, origin, extent} = transfer;
    const {width, height, depth, data} = texture.image;
    const cell = point.clone().sub(origin).divide(extent).multiply(new THREE.Vector3(width, height, depth)).floor();
    const index = 2 * (cell.x + width * (cell.y + height * cell.z));
    return [0, 1].map(channel => THREE.DataUtils.fromHalfFloat(data[index + channel]));
  }
  const covered = createDiffuserTransfer(THREE, shell, partition, null, [led, dark], 1);
  partition.translate(20, 0, 0);
  const open = createDiffuserTransfer(THREE, shell, partition, null, [led, dark], 1);
  t.after(() => { covered.texture.dispose(); open.texture.dispose(); });
  const far = new THREE.Vector3(0, 2.5, 0), near = new THREE.Vector3(0, -2.5, 0);
  const [transmitted, otherLED] = responseAt(open, far);
  assert.ok(transmitted > 0 && transmitted < responseAt(open, near)[0]);
  assert.equal(otherLED, 0);
  assert.deepEqual(responseAt(covered, far), [0, 0]);
  assert.ok(responseAt(covered, near)[0] > 0);
});
