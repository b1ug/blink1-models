import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {STLLoader} from './vendor/STLLoader.js';
import {createBlink1Model} from './models/mk2/light-model.js';
import {createCutaway} from './cutaway.js';

const canvas = document.querySelector('#model');
const status = document.querySelector('#status');
const reset = document.querySelector('#reset');
const sideView = document.querySelector('#side-view');
const variantButtons = [...document.querySelectorAll('[data-variant]')];
const cutControls = document.querySelector('#cut-controls');
const cutButtons = [...cutControls.querySelectorAll('[data-offset]')];
const gauge = document.querySelector('#section-gauge');
const sectionLabel = document.querySelector('#section-label');
const ledControls = document.querySelector('#led-controls');
const leds = [...ledControls.querySelectorAll('.led')].map(row => ({
  power: row.querySelector('[type="checkbox"]'),
  color: row.querySelector('[type="color"]'),
}));
async function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .65;
  const scene = new THREE.Scene();
  // Keep the studio lighting fixed as the LEDs and model view change.
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
  scene.environmentIntensity = .42;
  generator.dispose();
  for (const card of room.children) {
    card.geometry.dispose();
    card.material.dispose();
  }
  scene.add(new THREE.HemisphereLight(0xfffdf8, 0xc2d0d8, .24));
  const key = new THREE.DirectionalLight(0xfffcf6, .62);
  key.position.set(-3, 7, 5);
  const fill = new THREE.DirectionalLight(0xe6f2ff, .24);
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
  let model = null, cutaway = null, viewRadius = 1, currentView = null;
  let offsetMM = 0;
  function render() { renderer.render(scene, camera); }
  function updateLeds() {
    const [one, two] = leds.map(led => led.power.checked ? led.color.value : null);
    model.setColors(one, two, ledControls.disabled ? 'none' : 'preview');
  }
  function showSection() {
    const thickness = cutaway.setEnabled(true, offsetMM);
    gauge.textContent = `${offsetMM} mm from center. At the LED station the top wall is ${thickness.top.toFixed(2)} mm and the bottom wall is ${thickness.bottom.toFixed(2)} mm.`;
    for (const button of cutButtons) {
      const selected = Number(button.dataset.offset) === offsetMM;
      button.setAttribute('aria-pressed', String(selected));
      if (selected) sectionLabel.textContent = `Cutaway · ${button.textContent}`;
    }
  }
  function showVariant(view) {
    if (currentView === view) return;
    const variant = view === 'cutaway' ? 'assembled' : view;
    if (model?.group.userData.variant !== variant) {
      const direction = model
        ? camera.position.clone().sub(orbit.target).normalize()
        : new THREE.Vector3(-4.5, 5.6, 11).normalize();
      cutaway?.dispose();
      cutaway = null;
      model?.dispose();
      model = createBlink1Model(THREE, {diffuserGeometry, frameGeometry, variant});
      ledControls.disabled = variant === 'shell';
      updateLeds();
      model.group.rotation.set(.035, -.12, .1);
      scene.add(model.group);
      const bounds = new THREE.Box3().setFromObject(model.group).getBoundingSphere(new THREE.Sphere());
      viewRadius = bounds.radius * 1.08;
      orbit.target.copy(bounds.center);
      camera.position.copy(bounds.center).addScaledVector(direction, viewRadius * 5.5);
      orbit.update();
      orbit.saveState();
    }
    cutControls.hidden = view !== 'cutaway';
    sectionLabel.hidden = view !== 'cutaway';
    if (view === 'cutaway') {
      cutaway ??= createCutaway(THREE, model.group);
      showSection();
    } else {
      cutaway?.setEnabled(false);
    }
    currentView = view;
    for (const button of variantButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.variant === view));
    }
    resize();
  }
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    const halfHeight = viewRadius / Math.min(1.28, aspect);
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
  sideView.addEventListener('click', () => {
    const distance = camera.position.distanceTo(orbit.target);
    const direction = model.group.getWorldDirection(new THREE.Vector3());
    camera.position.copy(orbit.target).addScaledVector(direction, distance);
    orbit.update();
  });
  ledControls.addEventListener('input', () => {
    updateLeds();
    render();
  });
  for (const button of cutButtons) {
    button.addEventListener('click', () => {
      offsetMM = Number(button.dataset.offset);
      showSection();
      render();
    });
  }
  for (const button of variantButtons) {
    button.addEventListener('click', () => showVariant(button.dataset.variant));
    button.disabled = false;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  reset.disabled = false;
  status.hidden = true;
  canvas.addEventListener('webglcontextlost', () => {
    sideView.disabled = true;
    status.hidden = false;
    status.textContent = 'Graphics paused. Reload to restore the view.';
  });
  showVariant('assembled');
  sideView.disabled = false;
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    observer.disconnect();
    orbit.dispose();
    cutaway?.dispose();
    model?.dispose();
    diffuserGeometry.dispose(); frameGeometry.dispose();
    environment.dispose();
    renderer.dispose();
  });
}
start().catch(() => {
  status.hidden = false;
  status.textContent = '3D preview unavailable. Use the model download or source links.';
});
