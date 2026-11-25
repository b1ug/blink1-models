import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as THREE from '../site/node_modules/three/build/three.module.js';
import {STLLoader} from '../site/node_modules/three/examples/jsm/loaders/STLLoader.js';
import {createBlink1Model} from '../models/mk2/light-model.js';
import {createCutaway} from '../site/cutaway.js';

test('the three longitudinal sections follow the v3k material and wall thickness', t => {
  const load = part => {
    const uri = new URL(`../models/mk2/model-assets/blink1mk2_enclosure_${part}_v3k.stl`, import.meta.url);
    const geometry = new STLLoader().parse(readFileSync(uri, 'utf8'));
    t.after(() => geometry.dispose());
    return geometry;
  };
  const model = createBlink1Model(THREE, {variant: 'assembled',
    frameGeometry: load('frame'), diffuserGeometry: load('diffuser')});
  const probe = new THREE.MeshBasicMaterial({side: THREE.DoubleSide});
  const cut = createCutaway(THREE, model.group);
  t.after(() => { cut.dispose(); model.dispose(); probe.dispose(); });
  const parts = ['One continuous milky diffuser', 'Original frame — CAD details retained']
    .map(name => model.group.getObjectByName(name));
  const original = parts.map(p => new THREE.Mesh(p.geometry, probe));
  const originals = parts.map(part => part.material);
  const cutMaterials = new Set(), disposedMaterials = new Set();
  const unit = model.group.userData.unitsPerMillimetre;
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0), inward = new THREE.Vector3(0, 0, -1);
  const from = new THREE.Vector3();
  for (const [offset, top, bottom] of [[0, 2.992, 2.996], [7.25, 1.770, 1.772], [8.42, .999, .999]]) {
    const gauge = cut.setEnabled(true, offset);
    assert.ok(Math.abs(gauge.top - top) < .005 && Math.abs(gauge.bottom - bottom) < .005);
    const z = -offset * unit;
    for (const [i, part] of parts.entries()) {
      const cap = part.getObjectByName(part.name + ' section');
      const surface = part.geometry;
      assert.ok(cap.visible && surface !== original[i].geometry);
      assert.equal(part.material, originals[i]);
      assert.notEqual(cap.material, part.material);
      assert.ok(cap.material.roughness > part.material.roughness);
      if (!cutMaterials.has(cap.material)) {
        cutMaterials.add(cap.material);
        cap.material.addEventListener('dispose', () => disposedMaterials.add(cap.material));
        const shader = {...THREE.ShaderLib.standard, uniforms: {}};
        cap.material.onBeforeCompile(shader);
        assert.match(shader.fragmentShader, /fwidth\(sectionHatch\)/);
        if (i === 0) {
          const light = part.material.userData.lightField.uniforms;
          for (const key of Object.keys(light)) assert.equal(shader.uniforms[key], light[key]);
        }
      }
      // All indexed, visible vertices must lie in the half-space behind the
      // selected plane. Every cap triangle lies on the actual section.
      const vertices = surface.getAttribute('position'), index = surface.getIndex();
      for (let j = 0; j < index.count; j++) assert.ok(vertices.getZ(index.getX(j)) <= z + 1e-6);
      const points = cap.geometry.getAttribute('position');
      for (let j = 0; j < points.count; j++) assert.ok(Math.abs(points.getZ(j) - z) < 1e-6);
      // Use the uncut CAD walls as the reference. At each longitude probe
      // materials from above, then test the filled section from the side.
      const box = new THREE.Box3().setFromObject(original[i]);
      let solidCount = 0, cavityCount = 0;
      for (let x = box.min.x + .117 * unit; x < box.max.x; x += .43 * unit) {
        ray.set(from.set(x, box.max.y + unit, z), down);
        const hits = ray.intersectObject(original[i], false).map(hit => hit.point.y);
        const heights = hits.filter((v, j) => j === 0 || Math.abs(v - hits[j - 1]) > 1e-6);
        assert.equal(heights.length % 2, 0);
        for (let y = box.min.y + .071 * unit; y < box.max.y; y += .31 * unit) {
          const solid = heights.filter(h => h > y).length % 2 === 1;
          ray.set(from.set(x, y, z + unit), inward);
          assert.equal(ray.intersectObject(cap, false).length > 0, solid,
            `${part.name} misfilled at offset ${offset}, (${x}, ${y})`);
          if (solid) solidCount++; else cavityCount++;
        }
      }
      assert.ok(solidCount > 0 && cavityCount > 0);
    }
  }
  cut.setEnabled(false);
  for (const [i, part] of parts.entries()) {
    assert.equal(part.geometry, original[i].geometry);
    assert.equal(part.getObjectByName(part.name + ' section').visible, false);
  }
  assert.equal(cutMaterials.size, 2);
  assert.equal(disposedMaterials.size, 0);
  cut.dispose();
  assert.deepEqual(disposedMaterials, cutMaterials);
});
