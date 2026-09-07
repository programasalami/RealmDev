import * as THREE from 'three';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const gltfLoader = new GLTFLoader();

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

// Catch-all: any uncaught exception or rejected promise anywhere in the
// scene (not just inside init()'s own try/catch) falls back gracefully
// instead of leaving a half-broken canvas, and gets logged so it's
// actually diagnosable instead of a silent guess.
window.addEventListener('error', (e) => {
  console.error('[RealmDev scene] uncaught error:', e.error || e.message);
  showFallback();
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[RealmDev scene] unhandled rejection:', e.reason);
  showFallback();
});

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
  const SKY = 0x4a4470; // brighter cozy dusk tone — visible and colorful, not blown out

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'default',
    failIfMajorPerformanceCaveat: false,
  });
  // Old / integrated GPUs choke on high-DPI fill rate far more than on
  // scene complexity, so don't scale the canvas up for retina displays.
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showFallback();
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 34, 70);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);

  // Bright but still moody: a strong key light casts real shadows for
  // definition, kept in check by modest ambient/hemisphere fill so
  // surfaces stay lit without flattening into a shadowless haze.
  scene.add(new THREE.AmbientLight(0x5c5580, 0.55));
  const sun = new THREE.DirectionalLight(0xffe6b8, 1.2);
  sun.position.set(-14, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -BOUNDS - 2;
  sun.shadow.camera.right = BOUNDS + 2;
  sun.shadow.camera.top = BOUNDS + 2;
  sun.shadow.camera.bottom = -BOUNDS - 2;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.002;
  sun.shadow.normalBias = 0.05; // extra insurance against acne on grazing-angle wall faces
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x413a68, 0x201c33, 0.45));
  // Ceiling-mounted lanterns (added in buildPerimeter) are the room's real
  // light fixtures — no separate corner torches needed on top of those.

  // ---------- ground ----------
  const groundTex = makeCheckerTexture();
  groundTex.repeat.set(GROUND_SIZE / 2, GROUND_SIZE / 2);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshLambertMaterial({ map: groundTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
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
  const camLookAhead = new THREE.Vector3();
  const desiredCamPos = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const tmpForward = new THREE.Vector3();
  const tmpRight = new THREE.Vector3();
  const tmpMove = new THREE.Vector3();

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

      // Movement is relative to where the (drag-rotated) camera is looking,
      // not fixed world axes — "forward" is whichever way the camera faces.
      tmpForward.set(0, 0, -1).applyAxisAngle(UP, camYaw);
      tmpRight.set(1, 0, 0).applyAxisAngle(UP, camYaw);
      tmpMove.set(0, 0, 0).addScaledVector(tmpForward, -ny).addScaledVector(tmpRight, nx);

      const speed = 6.5;
      player.position.x += tmpMove.x * speed * delta;
      player.position.z += tmpMove.z * speed * delta;
      player.position.x = THREE.MathUtils.clamp(player.position.x, -BOUNDS, BOUNDS);
      player.position.z = THREE.MathUtils.clamp(player.position.z, -BOUNDS, BOUNDS);
      const facing = Math.atan2(tmpMove.x, tmpMove.z);
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

// Blocky brick/stone texture with per-block tone variation, built from a
// base color, so walls read as textured masonry instead of flat plastic.
function makeBrickTexture(baseHex, { rows = 6, cols = 6, variance = 18 } = {}) {
  const size = 128;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  const base = new THREE.Color(baseHex);
  const tileW = size / cols;
  const tileH = size / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (tileW / 2);
    for (let c = -1; c <= cols; c++) {
      const shade = 1 + (Math.random() - 0.5) * (variance / 100);
      ctx.fillStyle = `rgb(${Math.min(255, base.r * 255 * shade) | 0}, ${Math.min(255, base.g * 255 * shade) | 0}, ${Math.min(255, base.b * 255 * shade) | 0})`;
      ctx.fillRect(c * tileW + offset, r * tileH, tileW - 3, tileH - 3);
    }
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function brickMaterial(baseHex, repeatX = 3, repeatY = 3, opts) {
  const tex = makeBrickTexture(baseHex, opts);
  tex.repeat.set(repeatX, repeatY);
  return new THREE.MeshLambertMaterial({ map: tex, flatShading: true });
}

function bannerMaterial(hex) {
  return new THREE.MeshLambertMaterial({ color: hex, side: THREE.DoubleSide });
}

function castAndReceive(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildPerimeter(scene, groundSize) {
  const bounds = groundSize / 2;

  // Single stone material for every structural surface (walls, facade,
  // towers, merlons) so the room reads as one consistent material.
  const wallMat = brickMaterial(0xcbb48a, 10, 7); // warm sandstone, textured
  const roofBlue = stoneMaterial(0x3f6fb0);
  const merlonMat = brickMaterial(0xb7a17c, 1, 1);

  // enclosing walls on all 4 sides — everything else below is decoration
  // layered against these, but this guarantees a fully closed-in room
  // regardless of gaps between the decorative buildings/towers.
  const WALL_HEIGHT = 30;
  const WALL_THICK = 1;
  // NS walls span the full width (and thus own the 4 corners); EW walls are
  // shortened to fit exactly between them so the two never occupy the same
  // space — that overlap was causing z-fighting ("smoke") at the corners,
  // worst from a distance where depth-buffer precision is coarsest.
  const nsWallGeo = new THREE.BoxGeometry(groundSize, WALL_HEIGHT, WALL_THICK);
  const ewWallGeo = new THREE.BoxGeometry(WALL_THICK, WALL_HEIGHT, groundSize - WALL_THICK);
  [-1, 1].forEach((side) => {
    const wallNS = castAndReceive(new THREE.Mesh(nsWallGeo, wallMat));
    wallNS.position.set(0, WALL_HEIGHT / 2, side * bounds);
    scene.add(wallNS);
    const wallEW = castAndReceive(new THREE.Mesh(ewWallGeo, wallMat));
    wallEW.position.set(side * bounds, WALL_HEIGHT / 2, 0);
    scene.add(wallEW);

    // crenellations along the top edge for a proper castle-wall silhouette.
    // Inset from the exact corner so the NS and EW rows below never place
    // a merlon at the same spot (that duplicate/overlapping geometry was
    // causing a flickering "smoke" artifact right at the corners).
    for (let x = -bounds + 1.5; x <= bounds - 1.5; x += 3) {
      const merlonNS = castAndReceive(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, WALL_THICK + 0.4), merlonMat));
      merlonNS.position.set(x, WALL_HEIGHT + 0.8, side * bounds);
      scene.add(merlonNS);
      const merlonEW = castAndReceive(new THREE.Mesh(new THREE.BoxGeometry(WALL_THICK + 0.4, 1.6, 1.4), merlonMat));
      merlonEW.position.set(side * bounds, WALL_HEIGHT + 0.8, x);
      scene.add(merlonEW);
    }
  });

  // colorful banners hanging at intervals along the walls
  const bannerColors = [0xffcc4d, 0xa06cff, 0x39c2a0];
  [-1, 1].forEach((side) => {
    [-bounds + 3, -6, 0, 6, bounds - 3].forEach((x, i) => {
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 3.4),
        bannerMaterial(bannerColors[i % bannerColors.length])
      );
      banner.position.set(x, 7, side * bounds - side * 0.6);
      banner.rotation.y = side > 0 ? Math.PI : 0;
      scene.add(banner);
    });
  });

  // back castle facade
  const facade = castAndReceive(new THREE.Mesh(new THREE.BoxGeometry(22, 14, 1.5), wallMat));
  facade.position.set(0, 7, -bounds);
  scene.add(facade);

  const keep = castAndReceive(new THREE.Mesh(new THREE.BoxGeometry(7, 20, 1.5), wallMat));
  keep.position.set(0, 10, -bounds - 0.2);
  scene.add(keep);

  [-1, 1].forEach((side) => {
    const tower = castAndReceive(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 18, 10), wallMat));
    tower.position.set(side * 10, 9, -bounds);
    scene.add(tower);
    const cone = castAndReceive(new THREE.Mesh(new THREE.ConeGeometry(2.8, 4.5, 10), roofBlue));
    cone.position.set(side * 10, 20.25, -bounds);
    scene.add(cone);
  });

  // ceiling — fully seals the room top, and gives the hanging lanterns
  // below something to be mounted to.
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    stoneMaterial(0x8a7a5c)
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = WALL_HEIGHT;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // hardcoded hanging lanterns — the room's real light sources, rather than
  // relying on a sun-like light shining into a sealed building. A plus-shaped
  // layout gives even coverage across the room without piling up too many
  // real-time point lights (costly on weaker/older GPUs).
  const lanternGlow = new THREE.MeshLambertMaterial({ color: 0xffcc80, emissive: 0xffaa40, emissiveIntensity: 1.5 });
  const chainMat = stoneMaterial(0x2a2a2a);
  const lanternSpots = [
    [0, 0],
    [-14, 0],
    [14, 0],
    [0, -14],
    [0, 14],
  ];
  lanternSpots.forEach(([x, z]) => {
    const dropY = WALL_HEIGHT - 4;
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), chainMat);
    chain.position.set(x, WALL_HEIGHT - 2, z);
    scene.add(chain);
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), lanternGlow);
    lantern.position.set(x, dropY, z);
    scene.add(lantern);
    const light = new THREE.PointLight(0xffb866, 1.4, 24, 2);
    light.position.set(x, dropY, z);
    scene.add(light);
  });
}

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

      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

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
