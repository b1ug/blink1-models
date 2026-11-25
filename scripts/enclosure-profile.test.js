import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as THREE from '../site/node_modules/three/build/three.module.js';
import {STLLoader} from '../site/node_modules/three/examples/jsm/loaders/STLLoader.js';
import {createBlink1Model} from '../models/mk2/light-model.js';

function loadPart(part) {
  const url = new URL(`../models/mk2/model-assets/blink1mk2_enclosure_${part}_v3k.stl`, import.meta.url);
  const bytes = readFileSync(url);
  return new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

test('assembled rails have level seams, smooth USB shoulders and a rounded rear return', t => {
  const frameGeometry = loadPart('frame');
  const diffuserGeometry = loadPart('diffuser');
  const model = createBlink1Model(THREE, {frameGeometry, diffuserGeometry, variant: 'assembled'});
  t.after(() => {
    model.dispose();
    frameGeometry.dispose();
    diffuserGeometry.dispose();
  });
  model.group.updateMatrixWorld(true);
  const box = object => new THREE.Box3().setFromObject(object);
  const frameBounds = new THREE.Box3().setFromBufferAttribute(frameGeometry.getAttribute('position'));
  // The diffuser wraps beyond the metal at the tail. Identify both CAD parts
  // from their geometry so display labels and finishes can change freely.
  const [frame, diffuser] = model.group.children.filter(child => child.isMesh)
    .sort((a, b) => box(a).max.x - box(b).max.x);
  const bounds = box(diffuser);
  const unit = (bounds.max.z - bounds.min.z) / (frameBounds.max.x - frameBounds.min.x);
  const nominalHeight = frameBounds.max.z - frameBounds.min.z;
  const probeMaterial = new THREE.MeshBasicMaterial({side: THREE.DoubleSide});
  t.after(() => probeMaterial.dispose());
  function probe(object) {
    const mesh = new THREE.Mesh(object.geometry, probeMaterial);
    mesh.matrixWorld.copy(object.matrixWorld);
    return mesh;
  }
  const metalProbe = probe(frame), plasticProbe = probe(diffuser);
  const down = new THREE.Vector3(0, -1, 0);
  const ray = new THREE.Raycaster();
  let firstSection;
  for (const side of [-1, 1]) {
    const outside = side === -1 ? bounds.min.z : bounds.max.z;
    const inward = new THREE.Vector3(0, 0, -side);
    // This section is just inside both exterior walls, clear of the PCB and
    // internal bosses. Its four plastic intersections include both seats.
    function heights(mesh, x, z = outside - side * .08 * unit) {
      ray.set(new THREE.Vector3(x, bounds.max.y + unit, z), down);
      return ray.intersectObject(mesh, false).map(hit => hit.point.y / unit)
        .sort((a, b) => a - b)
        .filter((value, index, values) => index === 0 || value - values[index - 1] > .0001);
    }
    for (const distance of [3.8, 6.1, 9.3, 12.7, 16.1]) {
      const x = bounds.min.x + distance * unit;
      const metal = heights(metalProbe, x);
      const plastic = heights(plasticProbe, x);
      const section = `side ${side}, ${distance} units behind the USB opening`;
      assert.equal(metal.length, 2, section);
      assert.equal(plastic.length, 4, section);
      const seams = plastic.slice(1, 3);
      firstSection ??= plastic;
      for (const [i, height] of plastic.entries()) {
        assert.ok(Math.abs(height - firstSection[i]) < .02, `diffuser surface slopes at ${section}`);
      }
      const bandHeight = seams[1] - seams[0];
      assert.ok(Math.abs(bandHeight - nominalHeight) < .04,
        `exposed band is ${bandHeight.toFixed(3)} units, expected ${nominalHeight} at ${section}`);
      for (const [index, sign] of [[0, -1], [1, 1]]) {
        const overlap = (metal[index] - seams[index]) * sign;
        assert.ok(overlap >= -.002 && overlap < .08, `metal seat at ${section}`);
        // Test the first surface the viewer sees on either side of the join.
        for (const [offset, owner] of [[-.05, frame], [.05, diffuser]]) {
          const y = (seams[index] + sign * offset) * unit;
          ray.set(new THREE.Vector3(x, y, outside + side * unit), inward);
          const [hit] = ray.intersectObjects([frame, diffuser], false);
          assert.ok(hit?.object === owner && hit.distance < 1.2 * unit, `visible seam at ${section}`);
        }
      }
    }
    const tailHeight = distance => {
      const metal = heights(metalProbe, bounds.min.x + distance * unit);
      assert.equal(metal.length, 2, `rear metal section at ${distance}`);
      return metal[1] - metal[0];
    };
    const shoulder = tailHeight(18.5), tip = tailHeight(19.7);
    assert.ok(shoulder > tip && tip > 0 && shoulder < nominalHeight - .3, 'metal rounds into the rear cap');

    // Check just behind the rounded USB shoulder. Refitting the frame to an
    // already leveled diffuser opened a gap here even with both rails level.
    const z = outside - side * .4 * unit;
    const centerY = (firstSection[1] + firstSection[2]) / 2 * unit;
    ray.set(new THREE.Vector3(bounds.min.x - unit, centerY, z), new THREE.Vector3(1, 0, 0));
    const [front] = ray.intersectObject(metalProbe, false);
    assert.ok(front, 'USB shoulder exists on both sides');
    const x = front.point.x + .025 * unit;
    const plastic = heights(plasticProbe, x, z);
    const metal = heights(metalProbe, x, z);
    assert.equal(plastic.length, 4, 'diffuser wraps the shoulder');
    assert.ok(metal.length >= 2, 'front metal spans the joint');
    assert.ok(metal[0] <= plastic[1] + .003 && metal.at(-1) >= plastic[2] - .003,
      'both USB shoulder joints meet');

    // Sweep the middle of the visible metal wall about the v3k shoulder's
    // arc center. Interpolated normals should turn throughout each STL facet.
    const arcCenter = new THREE.Vector3(bounds.min.x + 2.715 * unit, centerY, outside - side * 2.75 * unit);
    let lastAngle;
    for (let degrees = 20; degrees <= 78; degrees += 2) {
      const angle = THREE.MathUtils.degToRad(degrees);
      const outward = new THREE.Vector3(-Math.cos(angle), 0, side * Math.sin(angle));
      ray.set(arcCenter.clone().addScaledVector(outward, 6 * unit), outward.clone().negate());
      const [hit] = ray.intersectObjects([frame, diffuser], false);
      assert.equal(hit?.object, frame, `exposed USB shoulder at ${degrees}° on side ${side}`);
      const normalAngle = THREE.MathUtils.radToDeg(Math.atan2(side * hit.normal.z, -hit.normal.x));
      if (lastAngle !== undefined) {
        const turn = normalAngle - lastAngle;
        assert.ok(turn > .3 && turn < 4, `USB shoulder normal turned ${turn}° at ${degrees}° on side ${side}`);
      }
      lastAngle = normalAngle;

      // Long triangles on the upright white rim share vertices with the bevel.
      // At mid-wall, their normals should stay in the same plane as the rail.
      for (const face of [-1, 1]) {
        ray.ray.origin.y = centerY + face * (nominalHeight / 2 + .5) * unit;
        const [rim] = ray.intersectObject(diffuser, false);
        assert.ok(rim && Math.abs(rim.normal.y) < .035, `smooth diffuser rim at ${degrees}° on side ${side}`);
      }
    }
  }
});
