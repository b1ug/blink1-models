import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as THREE from '../site/node_modules/three/build/three.module.js';
import {STLLoader} from '../site/node_modules/three/examples/jsm/loaders/STLLoader.js';
import {createBlink1Model} from '../models/mk2/light-model.js';
import {createBlink1PCB, getBlink1LEDSources} from '../models/mk2/pcb-model.js';
import layout from '../models/mk2/model-assets/pcb-layout.json' with {type: 'json'};

test('the two resin windows transmit light from independent RGB dies', t => {
  const placement = {unit: .23, originX: 4, centerY: -.38, centerZ: .62};
  const sources = getBlink1LEDSources(THREE, placement);
  const pcb = createBlink1PCB(THREE, placement, sources);
  t.after(() => pcb.dispose());
  pcb.group.updateMatrixWorld(true);
  assert.deepEqual(sources.map(source => source.ref), ['L1', 'L2']);
  const ray = new THREE.Raycaster();
  pcb.setColors(new THREE.Color(1, 0, 0), new THREE.Color(0, 0, 1), true);
  for (const source of sources) {
    const optic = pcb.group.getObjectByName(`${source.ref} RGB emitter`);
    const sign = source.ref === 'L1' ? 1 : -1;
    assert.deepEqual(source.normal.toArray(), [0, sign, 0]);
    assert.ok(optic.material.transmission > 0);
    assert.ok(optic.position.distanceTo(source.position) < 1e-8);
    assert.ok(Math.abs(optic.geometry.parameters.radius - source.radius) < 1e-8);
    const inward = source.normal.clone().negate();
    for (const [index, channel] of ['R', 'G', 'B'].entries()) {
      const die = pcb.group.getObjectByName(`${source.ref} ${channel} die`);
      const origin = die.position.clone().addScaledVector(source.normal, placement.unit);
      ray.set(origin, inward);
      const hits = ray.intersectObjects(pcb.group.children, false);
      assert.equal(hits[0].object, optic);
      assert.equal(hits[1].object, die);
      assert.equal(die.material.emissiveIntensity > 0, index === (sign > 0 ? 0 : 2));
    }
  }
  const green = pcb.group.getObjectByName('L1 G die').material;
  pcb.setColors(new THREE.Color(0, 1, 0), null, true);
  const full = green.emissiveIntensity;
  pcb.setColors(new THREE.Color(0, 128 / 255, 0), null, true);
  assert.ok(full > 0 && Math.abs(green.emissiveIntensity / full - 128 / 255) < 1e-8);
  assert.equal(pcb.group.getObjectByName('L1 R die').material.emissiveIntensity, 0);
  assert.equal(pcb.group.getObjectByName('L2 B die').material.emissiveIntensity, 0);
  pcb.setColors(new THREE.Color(1, 1, 1), new THREE.Color(1, 1, 1), false);
  assert.equal(pcb.group.getObjectByName('L1 G die').material.emissiveIntensity, 0);
  assert.equal(pcb.group.getObjectByName('L2 RGB emitter').material.emissiveIntensity, 0);
});

test('v2c6 LED footprints register the bare sources and drive both exterior diffuser faces', t => {
  function load(part) {
    const url = new URL(`../models/mk2/model-assets/blink1mk2_enclosure_${part}_v3k.stl`, import.meta.url);
    const geometry = new STLLoader().parse(readFileSync(url, 'utf8'));
    t.after(() => geometry.dispose());
    return geometry;
  }
  const cad = {frameGeometry: load('frame'), diffuserGeometry: load('diffuser')};
  const model = createBlink1Model(THREE, {...cad, variant: 'assembled'});
  const bare = createBlink1Model(THREE, {...cad, variant: 'internals'});
  t.after(() => { model.dispose(); bare.dispose(); });
  model.group.updateMatrixWorld(true);
  const board = model.group.getObjectByName('White solder-mask PCB');
  const parts = board.parent;
  const bounds = new THREE.Box3().setFromObject(board);
  const unit = (bounds.max.x - bounds.min.x) / layout.bounds.size[0];
  const center = bounds.getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster();
  const diffuser = model.group.getObjectByName('One continuous milky diffuser');
  const shellBounds = new THREE.Box3().setFromObject(diffuser);
  const bareLights = bare.group.children.filter(part => part.isSpotLight);
  const exteriorLights = model.group.children.filter(part => part.isSpotLight);
  assert.equal(bareLights.length, 2);
  assert.equal(exteriorLights.length, 2);
  const transfer = diffuser.material.userData.lightField.uniforms.nb1Transfer.value;
  assert.ok(transfer.isData3DTexture);
  assert.equal(transfer.format, THREE.RGFormat);
  const sources = getBlink1LEDSources(THREE, {
    unit, originX: bounds.min.x, centerY: center.y, centerZ: center.z,
  });
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
    const source = sources.find(source => source.ref === led.ref);
    const bareOptic = bare.group.getObjectByName(`${led.ref} RGB emitter`);
    const onSide = light => sign * (light.position.y - center.y) > 0;
    const direct = bareLights.find(onSide), spill = exteriorLights.find(onSide);
    assert.ok(optic.position.distanceTo(source.position) < .00001);
    assert.ok(direct.position.distanceTo(bareOptic.position) < .00001);
    assert.ok(direct.position.distanceTo(source.position) < .00001);
    const outerY = sign > 0 ? shellBounds.max.y : shellBounds.min.y;
    assert.ok((spill.position.y - outerY) * sign > 0);
    for (const light of [direct, spill]) {
      assert.ok(light.target.position.clone().sub(light.position).normalize().dot(source.normal) > .9999);
    }
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
  const top = exteriorLights.find(light => light.position.y > center.y);
  const bottom = exteriorLights.find(light => light.position.y < center.y);
  model.setColors('#ff0000', '#0000ff', 'preview');
  assert.ok(top.intensity * top.color.r > bottom.intensity * bottom.color.r);
  assert.ok(bottom.intensity * bottom.color.b > top.intensity * top.color.b);
  assert.equal(top.color.g + bottom.color.g, 0);
  model.setColors('#000000', '#000000', 'preview');
  assert.equal(top.intensity, 0);
  assert.equal(bottom.intensity, 0);
  const testpad = layout.components.find(c => c.ref === 'P1');
  assert.equal(hit(testpad.x + .49, testpad.y + .49, 1)?.object.name, 'P1 exposed test pad');
});
