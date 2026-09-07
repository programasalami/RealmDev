import * as THREE from 'three';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const gameView = document.getElementById('game-view');
const canvas = document.getElementById('scene-canvas');
const loadingEl = document.getElementById('scene-loading');
const fallbackEl = document.getElementById('scene-fallback');
const joystickEl = document.getElementById('touch-joystick');
const joystickBase = document.getElementById('joystick-base');
const joystickKnob = document.getElementById('joystick-knob');
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    // failIfMajorPerformanceCaveat:false tells the browser we're fine with
    // a software/blocklisted-driver fallback instead of refusing outright —
    // without it, browsers silently return null on many older GPUs.
    const attrs = { failIfMajorPerformanceCaveat: false };
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext('webgl', attrs) || c.getContext('experimental-webgl', attrs))
    );
  } catch (e) {
    return false;
  }
}

function markReady() {
  if (window.__realmScene) window.__realmScene.ready = true;
}

function showFallback() {
  loadingEl.hidden = true;
  fallbackEl.hidden = false;
  markReady();
}

if (!supportsWebGL()) {
  showFallback();
} else {
  init().catch((err) => {
    console.error(err);
    showFallback();
  });
}

async function init() {
  const GROUND_SIZE = 40;
  const BOUNDS = GROUND_SIZE / 2 - 1.5;
  const SKY = 0x7ec9ec;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'default',
    failIfMajorPerformanceCaveat: false,
  });
  // Old / integrated GPUs choke on high-DPI fill rate far more than on
  // scene complexity, so don't scale the canvas up for retina displays.
  renderer.setPixelRatio(1);
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showFallback();
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 22, 46);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xfff3d6, 0.85);
  sun.position.set(-14, 20, 10);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x3a3350, 0.4));

  // ---------- ground ----------
  const groundTex = makeCheckerTexture();
  groundTex.repeat.set(GROUND_SIZE / 2, GROUND_SIZE / 2);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshLambertMaterial({ map: groundTex })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  buildPerimeter(scene, GROUND_SIZE);

  // ---------- player ----------
  // `player` is the transform every other system (movement, camera, facing)
  // drives; the actual model is loaded async and dropped in as its child so
  // walking/camera-follow all work even before the model finishes loading.
  const player = new THREE.Group();
  player.position.set(0, 0, 11);
  scene.add(player);
  let mixer = null;
  loadWizardModel(player, (m) => (mixer = m));

  // ---------- input ----------
  const keys = {};
  const moveKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (moveKeys.has(k)) e.preventDefault();
    keys[k] = true;
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  const touchVec = { x: 0, y: 0 };
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isTouch) {
    joystickEl.hidden = false;
    setupJoystick();
  }

  function setupJoystick() {
    const radius = 44;
    let activeId = null;
    const center = () => {
      const r = joystickBase.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const move = (clientX, clientY) => {
      const c = center();
      let dx = clientX - c.x;
      let dy = clientY - c.y;
      const dist = Math.min(Math.hypot(dx, dy), radius);
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * dist;
      dy = Math.sin(angle) * dist;
      joystickKnob.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
      touchVec.x = dx / radius;
      touchVec.y = dy / radius;
    };
    const reset = () => {
      touchVec.x = 0;
      touchVec.y = 0;
      joystickKnob.style.transform = 'translate(-50%, -50%)';
    };
    joystickBase.addEventListener('pointerdown', (e) => {
      activeId = e.pointerId;
      joystickBase.setPointerCapture(activeId);
      move(e.clientX, e.clientY);
    });
    joystickBase.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activeId) return;
      move(e.clientX, e.clientY);
    });
    const end = (e) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      reset();
    };
    joystickBase.addEventListener('pointerup', end);
    joystickBase.addEventListener('pointercancel', end);
  }

  // ---------- drag to look around ----------
  // Orbit the camera around the player on a sphere; yaw = 0 is "behind the
  // player looking north", matching the initial fixed camera angle.
  let camYaw = 0;
  let camPitch = 0.94; // ~54 degrees, matches the original fixed top-down-behind angle
  const MIN_PITCH = 0.35;
  const MAX_PITCH = 1.4;
  let dragId = null;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(dragId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    camYaw -= dx * 0.008;
    camPitch = THREE.MathUtils.clamp(camPitch + dy * 0.006, MIN_PITCH, MAX_PITCH);
  });
  const endDrag = (e) => {
    if (e.pointerId !== dragId) return;
    dragId = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------- resize ----------
  function onResize() {
    const w = gameView.clientWidth;
    const h = gameView.clientHeight;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', onResize);
  onResize();

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let facing = 0;
  const camLookAhead = new THREE.Vector3();
  const desiredCamPos = new THREE.Vector3();

  function updateMovement(delta) {
    let ix = touchVec.x;
    let iy = touchVec.y;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    if (keys['w'] || keys['arrowup']) iy -= 1;
    if (keys['s'] || keys['arrowdown']) iy += 1;

    const len = Math.hypot(ix, iy);
    if (len > 0.001) {
      const nx = ix / Math.max(len, 1);
      const ny = iy / Math.max(len, 1);
      const speed = 6.5;
      player.position.x += nx * speed * delta;
      player.position.z += ny * speed * delta;
      player.position.x = THREE.MathUtils.clamp(player.position.x, -BOUNDS, BOUNDS);
      player.position.z = THREE.MathUtils.clamp(player.position.z, -BOUNDS, BOUNDS);
      facing = Math.atan2(nx, ny);
      player.rotation.y = THREE.MathUtils.lerp(player.rotation.y, facing, Math.min(delta * 12, 1));
      player.userData.bob = (player.userData.bob || 0) + delta * 10;
    } else {
      player.userData.bob = 0;
    }
    const bobY = Math.abs(Math.sin(player.userData.bob || 0)) * 0.08;
    player.position.y = bobY;
  }

  const CAM_RADIUS = 13;
  function camOffsetFromOrbit() {
    return new THREE.Vector3(
      CAM_RADIUS * Math.sin(camYaw) * Math.cos(camPitch),
      CAM_RADIUS * Math.sin(camPitch),
      CAM_RADIUS * Math.cos(camYaw) * Math.cos(camPitch)
    );
  }

  function updateCamera(delta) {
    desiredCamPos.copy(player.position).add(camOffsetFromOrbit());
    camera.position.lerp(desiredCamPos, 1 - Math.pow(0.0008, delta));
    camLookAhead.copy(player.position).add(new THREE.Vector3(0, 1.4, 0));
    camera.lookAt(camLookAhead);
  }

  camera.position.copy(player.position).add(camOffsetFromOrbit());

  function animate() {
    const delta = Math.min(clock.getDelta(), 0.05);
    updateMovement(delta);
    updateCamera(delta);
    if (mixer) mixer.update(delta);
    drawMinimap();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  function drawMinimap() {
    if (!minimapCtx) return;
    const w = minimapCanvas.width;
    const h = minimapCanvas.height;
    minimapCtx.fillStyle = '#1a1a20';
    minimapCtx.fillRect(0, 0, w, h);

    // world bounds map to the minimap square, keeping aspect via the smaller dimension
    const pad = 8;
    const mapSize = Math.min(w, h) - pad * 2;
    const originX = (w - mapSize) / 2;
    const originY = (h - mapSize) / 2;
    minimapCtx.strokeStyle = '#5a5a66';
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(originX, originY, mapSize, mapSize);

    const nx = (player.position.x + BOUNDS) / (BOUNDS * 2);
    const nz = (player.position.z + BOUNDS) / (BOUNDS * 2);
    const dotX = originX + nx * mapSize;
    const dotY = originY + nz * mapSize;

    minimapCtx.fillStyle = '#ffcc4d';
    minimapCtx.beginPath();
    minimapCtx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  loadingEl.hidden = true;
  fallbackEl.hidden = true; // success always wins, even if the watchdog already fired
  markReady();
  requestAnimationFrame(animate);
}

// ---------------- builders ----------------

function makeCheckerTexture() {
  const size = 64;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  const tones = ['#d8d3c8', '#c7c1b3'];
  const tile = size / 4;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      ctx.fillStyle = tones[(x + y) % 2];
      ctx.fillRect(x * tile, y * tile, tile, tile);
    }
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function stoneMaterial(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function buildPerimeter(scene, groundSize) {
  const bounds = groundSize / 2;
  const stone = stoneMaterial(0xcfd3da);
  const roof = stoneMaterial(0x3f6fb0);
  const wood = stoneMaterial(0x7a5230);

  // back castle facade
  const facade = new THREE.Mesh(new THREE.BoxGeometry(22, 7, 1.5), stone);
  facade.position.set(0, 3.5, -bounds);
  scene.add(facade);

  const keep = new THREE.Mesh(new THREE.BoxGeometry(6, 10, 1.5), stone);
  keep.position.set(0, 5, -bounds - 0.2);
  scene.add(keep);

  [-1, 1].forEach((side) => {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 9, 10), stone);
    tower.position.set(side * 10, 4.5, -bounds);
    scene.add(tower);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2, 3, 10), roof);
    cone.position.set(side * 10, 10.5, -bounds);
    scene.add(cone);
  });

  // side buildings
  [-1, 1].forEach((side) => {
    for (let i = 0; i < 3; i++) {
      const h = 3 + Math.random() * 2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(4.5, h, 4.5), stone);
      box.position.set(side * (bounds - 2.2), h / 2, -bounds + 6 + i * 6);
      scene.add(box);
      const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.8, 4), roof);
      roofMesh.rotation.y = Math.PI / 4;
      roofMesh.position.set(box.position.x, h + 0.9, box.position.z);
      scene.add(roofMesh);
    }
  });

  // scattered trees
  for (let i = 0; i < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = bounds - 3 - Math.random() * 4;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (Math.abs(x) < 10 && z < -bounds + 8) continue;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.2, 6), wood);
    trunk.position.set(x, 0.6, z);
    scene.add(trunk);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 7), stoneMaterial(0x3f8f4d));
    leaves.position.set(x, 1.9, z);
    scene.add(leaves);
  }
}

const gltfLoader = new GLTFLoader();

// Loads assets/wizard.glb into `target`, auto-scaling it to a consistent
// height and sitting its base on the ground regardless of how it was
// modeled/exported. Calls onMixer(mixer) if the model has animations.
function loadWizardModel(target, onMixer) {
  const TARGET_HEIGHT = 1.7;
  gltfLoader.load(
    'assets/wizard.glb',
    (gltf) => {
      const model = gltf.scene;

      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scale = size.y > 0 ? TARGET_HEIGHT / size.y : 1;
      model.scale.setScalar(scale);

      // Re-measure after scaling, then shift so the model's feet sit at y=0
      // and it's centered on X/Z, regardless of the model's own pivot point.
      const scaledBox = new THREE.Box3().setFromObject(model);
      const center = new THREE.Vector3();
      scaledBox.getCenter(center);
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= scaledBox.min.y;

      target.add(model);

      if (gltf.animations && gltf.animations.length) {
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(gltf.animations[0]).play();
        onMixer(mixer);
      }
    },
    undefined,
    (err) => console.error('Failed to load wizard.glb', err)
  );
}
