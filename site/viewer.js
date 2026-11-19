import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {STLLoader} from './vendor/STLLoader.js';
import {createBlink1Model} from './models/mk2/light-model.js';

const canvas = document.querySelector('#model');
const status = document.querySelector('#status');
const reset = document.querySelector('#reset');
async function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .9;
  const scene = new THREE.Scene();
  // Same broad reflection cards, exposure and lights on both versions.
  const room = new THREE.Scene();
  room.background = new THREE.Color(.3, .32, .34);
  for (const [x, y, z, w, h, r, g, b] of [
    [-3, 7, 5, 10, 7, 1.9, 1.9, 1.9], [2, 3.5, -5, 10, 3.5, 1.3, 1.35, 1.4],
    [-7, 1, -1, 3, 8, .7, .75, .8], [7, 1, 3, 8, 5, .12, .15, .18],
  ]) {
    const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      color: new THREE.Color(r, g, b), side: THREE.DoubleSide,
    }));
    card.position.set(x, y, z);
    card.lookAt(0, 0, 0);
    room.add(card);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromScene(room, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .75;
  generator.dispose();
  for (const card of room.children) {
    card.geometry.dispose();
    card.material.dispose();
  }
  scene.add(new THREE.HemisphereLight(0xfffdf8, 0xc2d0d8, .45));
  const key = new THREE.DirectionalLight(0xfffcf6, 1.15);
  key.position.set(-3, 7, 5);
  const fill = new THREE.DirectionalLight(0xe6f2ff, .45);
  fill.position.set(4, 2, -4);
  scene.add(key, fill);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .05, 100);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enablePan = false;
  orbit.minZoom = .6;
  orbit.maxZoom = 3.5;

  const loader = new STLLoader();
  const [diffuserGeometry, frameGeometry] = await Promise.all(['diffuser', 'frame'].map(part =>
    loader.loadAsync(new URL('./models/mk2/model-assets/blink1mk2_enclosure_' + part + '_v3k.stl', import.meta.url).href)
  ));
  const model = createBlink1Model(THREE, {diffuserGeometry, frameGeometry});
  diffuserGeometry.dispose();
  frameGeometry.dispose();
  model.group.rotation.set(.035, -.12, .1);
  scene.add(model.group);
  const bounds = new THREE.Box3().setFromObject(model.group).getBoundingSphere(new THREE.Sphere());
  const radius = bounds.radius * 1.08;
  orbit.target.copy(bounds.center);
  camera.position.copy(bounds.center).add(new THREE.Vector3(-5.5, 7.5, 11));
  orbit.update();
  orbit.saveState();
  function render() { renderer.render(scene, camera); }
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    const halfHeight = radius / Math.min(1, aspect);
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.updateProjectionMatrix();
    render();
  }

  canvas.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const angle = new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbit.target));
    switch (event.key) {
      case 'ArrowLeft': angle.theta -= .15; break;
      case 'ArrowRight': angle.theta += .15; break;
      case 'ArrowUp': angle.phi -= .15; break;
      case 'ArrowDown': angle.phi += .15; break;
      case '+': case '=': camera.zoom = Math.min(orbit.maxZoom, camera.zoom * 1.2); break;
      case '-': case '_': camera.zoom = Math.max(orbit.minZoom, camera.zoom / 1.2); break;
      case 'Home': event.preventDefault(); orbit.reset(); return;
      default: return;
    }
    event.preventDefault();
    angle.makeSafe();
    camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(angle));
    camera.updateProjectionMatrix();
    orbit.update();
    render();
  });

  orbit.addEventListener('change', render);
  reset.addEventListener('click', () => orbit.reset());
  new ResizeObserver(resize).observe(canvas);
  reset.disabled = false;
  status.hidden = true;
  canvas.addEventListener('webglcontextlost', () => {
    status.hidden = false;
    status.textContent = 'Graphics paused. Reload to restore the view.';
  });
  resize();
}
start().catch(() => {
  status.hidden = false;
  status.textContent = '3D preview unavailable. Use the model download or source links.';
});
