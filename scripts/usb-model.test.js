import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../site/node_modules/three/build/three.module.js';
import {createBlink1Model} from '../models/mk2/light-model.js';

// All variants use the same connector builder. The PCB-only view exposes
// both the Type-A mating end and the terminations on the actual board model.
test('USB shield and contacts meet the v2c6 PCB footprint', t => {
  const model = createBlink1Model(THREE, {variant: 'internals'});
  t.after(() => model.dispose());
  model.group.updateMatrixWorld(true);
  const plug = model.group.getObjectByName('USB-A plug');
  const box = object => new THREE.Box3().setFromObject(object);
  const roof = plug.getObjectByName('Perforated steel roof'), floor = plug.getObjectByName('Steel floor');
  const top = box(roof), bottom = box(floor);
  const unit = (top.max.y - bottom.min.y) / 4.5;
  const lip = top.min.x;
  const close = (a, b) => assert.ok(Math.abs(a - b) < .001 * unit, `${a} should coincide with ${b}`);
  close(box(plug).max.z - box(plug).min.z, 12 * unit);
  const ray = new THREE.Raycaster();
  for (const [panel, sign, y] of [[roof, 1, top.max.y], [floor, -1, bottom.min.y]]) {
    for (const offset of [-3, 0, 3]) {
      ray.set(new THREE.Vector3(lip + 6.16 * unit, y + sign * unit, offset * unit),
        new THREE.Vector3(0, -sign, 0));
      assert.equal(ray.intersectObject(panel).length > 0, offset === 0, 'two through-holes and a solid central strip');
    }
    for (const side of [-1, 1]) {
      ray.set(new THREE.Vector3(lip + .2 * unit, y + sign * unit, side * 5.9 * unit),
        new THREE.Vector3(0, -sign, 0));
      const [fold] = ray.intersectObject(plug, true);
      const setback = (y - fold.point.y) * sign / unit;
      // At 0.1 mm from the outer side, the R0.64 bend has turned about 58°.
      assert.ok(setback > .28 && setback < .32, 'rolled corner at the mating end');
    }
  }
  const tongue = box(plug.getObjectByName('Black recessed tongue'));
  close(tongue.min.y, bottom.max.y);
  const board = box(model.group.getObjectByName('White solder-mask PCB'));
  close(board.min.x - lip, 16.111 * unit);
  for (const [index, offset] of [3.5, 1, -1, -3.5].entries()) {
    const contact = box(plug.getObjectByName('Recessed contact ' + (index + 1)));
    close((contact.min.z + contact.max.z) / 2, offset * unit);
    close(contact.min.x - lip, (Math.abs(offset) > 1 ? 1.24 : 2.24) * unit);
    const tail = box(plug.getObjectByName('X1 solder tail ' + (index + 1)));
    const pad = box(model.group.getObjectByName('X1 contact ' + (index + 1)));
    assert.ok(tail.intersectsBox(pad), 'each termination meets its PCB pad');
  }
});
