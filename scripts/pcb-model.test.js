import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as THREE from '../site/node_modules/three/build/three.module.js';
import {STLLoader} from '../site/node_modules/three/examples/jsm/loaders/STLLoader.js';
import {createBlink1Model} from '../models/mk2/light-model.js';
import layout from '../models/mk2/model-assets/pcb-layout.json' with {type: 'json'};

test('PCB holes, pads and both LED windows match the v2c6 footprints', t => {
  function load(part) {
    const url = new URL(`../models/mk2/model-assets/blink1mk2_enclosure_${part}_v3k.stl`, import.meta.url);
    const geometry = new STLLoader().parse(readFileSync(url, 'utf8'));
    t.after(() => geometry.dispose());
    return geometry;
  }
  const model = createBlink1Model(THREE, {variant: 'assembled', frameGeometry: load('frame'), diffuserGeometry: load('diffuser')});
  t.after(() => model.dispose());
  model.group.updateMatrixWorld(true);
  const board = model.group.getObjectByName('White solder-mask PCB');
  const parts = board.parent;
  const bounds = new THREE.Box3().setFromObject(board);
  const unit = (bounds.max.x - bounds.min.x) / layout.bounds.size[0];
  const center = bounds.getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster();
  const diffuser = model.group.getObjectByName('One continuous milky diffuser');
  const glowCenter = diffuser.material.userData.lightField.uniforms.nb1EmitterXZ.value;
  // Shoot straight through the board at an EAGLE XY coordinate.
  function hit(x, y, sign, targets = parts.children) {
    const origin = new THREE.Vector3(bounds.min.x + (x - layout.bounds.min[0]) * unit,
      center.y + sign * 8 * unit, center.z - (y - layout.coordinate_system.center_y) * unit);
    ray.set(origin, new THREE.Vector3(0, -sign, 0));
    return ray.intersectObjects(targets, false)[0];
  }
  for (const hole of layout.holes) {
    assert.ok(!hit(hole.x, hole.y, 1, [board]), `open drill at ${hole.source}`);
  }
  for (const sign of [1, -1]) {
    const side = sign === 1 ? 'top' : 'bottom';
    for (const [i, hole] of layout.holes.filter(h => h.source.startsWith('JP3')).entries()) {
      assert.ok(!hit(hole.x, hole.y, sign), `through-hole ${i + 1} open from ${side}`);
      const land = hit(hole.x + .50, hole.y, sign);
      assert.equal(land?.object.name, `JP3 pad ${i + 1} ${side}`);
      const height = (land.point.y - center.y) * sign / unit;
      assert.ok(height > layout.visual_approximations.board_thickness / 2 + .03);
    }
    const led = layout.components.find(c => c.kind === 'rgb-led' && c.side === side);
    const optic = hit(led.x + 1.5, led.y, sign)?.object;
    assert.equal(optic?.name, `${led.ref} RGB emitter`);
    const spill = model.group.children.find(part => part.isPointLight &&
      sign * (part.position.y - center.y) > 0);
    assert.ok(Math.hypot(spill.position.x - optic.position.x, spill.position.z - optic.position.z) < .00001);
    assert.ok(Math.hypot(glowCenter.x - optic.position.x, glowCenter.y - optic.position.z) < .00001);
    assert.equal(hit(led.x + 1.5, led.y + 1.5, sign)?.object.name, `${led.ref} WS2812B package`);
    // The circular window must clear the inside of the closed diffuser.
    const lens = new THREE.Box3().setFromObject(optic);
    for (const x of [lens.min.x, optic.position.x, lens.max.x]) {
      ray.set(new THREE.Vector3(x, center.y, optic.position.z), new THREE.Vector3(0, sign, 0));
      const [inner] = ray.intersectObject(diffuser);
      assert.ok(inner && (inner.point.y - (sign > 0 ? lens.max.y : lens.min.y)) * sign > 0);
    }
    const unlit = optic.material.color.getHex();
    model.setColors('#ff0000', '#0000ff', 'preview');
    assert.equal(optic.material.emissive.getHex(), sign === 1 ? 0xff0000 : 0x0000ff);
    assert.ok(optic.material.emissiveIntensity > 0);
    model.setColors('#000000', '#000000', 'preview');
    assert.equal(optic.material.emissiveIntensity, 0);
    assert.equal(optic.material.color.getHex(), unlit);
  }
  const testpad = layout.components.find(c => c.ref === 'P1');
  assert.equal(hit(testpad.x + .49, testpad.y + .49, 1)?.object.name, 'P1 exposed test pad');
});
