import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const root = document.getElementById('scene-root');
const canvas = document.getElementById('scene-canvas');
const loadingEl = document.getElementById('scene-loading');
const hintEl = document.getElementById('scene-hint');
const fallbackEl = document.getElementById('scene-fallback');
const joystickEl = document.getElementById('touch-joystick');
const joystickBase = document.getElementById('joystick-base');
const joystickKnob = document.getElementById('joystick-knob');

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
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
  // Best-effort: get the pixel font ready before drawing portal labels, but
  // never let this block startup — document.fonts.load() has been known to
  // hang indefinitely (never resolve or reject) in some browsers.
  try {
    await Promise.race([
      document.fonts.load('40px "Press Start 2P"'),
      new Promise((resolve) => setTimeout(resolve, 800)),
    ]);
  } catch (e) {
    /* labels just fall back to default font */
  }

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
  const camOffset = new THREE.Vector3(0, 11, 8);

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

  // ---------- portals ----------
  const portalMeshes = [];
  const portals = [
    createPortal({
      color: 0x39e6c2,
      label: 'FORUMS',
      position: new THREE.Vector3(-7.5, 0, -BOUNDS + 2.2),
      url: 'https://forum.realmdev.org',
      external: true,
    }),
    createPortal({
      color: 0xa06cff,
      label: 'DEVELOPERS',
      position: new THREE.Vector3(7.5, 0, -BOUNDS + 2.2),
      url: '/developers',
      external: false,
    }),
  ];
  portals.forEach((p) => {
    scene.add(p.group);
    p.group.traverse((child) => {
      if (child.isMesh) {
        child.userData.portal = p;
        portalMeshes.push(child);
      }
    });
  });

  // ---------- player ----------
  const player = createPlayer();
  player.position.set(0, 0, 11);
  scene.add(player);

  // ---------- input ----------
  const keys = {};
  const moveKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
  let activePortal = null;

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (moveKeys.has(k)) e.preventDefault();
    keys[k] = true;
    if (k === 'e' || k === ' ') {
      if (activePortal) enterPortal(activePortal);
    }
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

  // tap / click a portal to jump straight to it
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(portalMeshes, false);
    if (hits.length) enterPortal(hits[0].object.userData.portal);
  });

  function enterPortal(portal) {
    if (portal.external) {
      window.open(portal.url, '_blank', 'noopener');
    } else {
      window.location.href = portal.url;
    }
  }

  // ---------- resize ----------
  function onResize() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', onResize);
  onResize();

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let elapsed = 0;
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

  function updatePortals(delta) {
    activePortal = null;
    portals.forEach((p) => {
      p.ring.rotation.z += delta * 0.6;
      const pulse = 0.75 + Math.sin(elapsed * 2.4 + p.seed) * 0.15;
      p.disc.material.opacity = pulse;
      const dist = player.position.distanceTo(p.group.position);
      if (dist < 2.6) activePortal = p;
    });
  }

  function updateCamera(delta) {
    desiredCamPos.copy(player.position).add(camOffset);
    camera.position.lerp(desiredCamPos, 1 - Math.pow(0.0008, delta));
    camLookAhead.copy(player.position).add(new THREE.Vector3(0, 1.4, -3));
    camera.lookAt(camLookAhead);
  }

  camera.position.copy(player.position).add(camOffset);

  function animate() {
    const delta = Math.min(clock.getDelta(), 0.05);
    elapsed += delta;
    updateMovement(delta);
    updatePortals(delta);
    updateCamera(delta);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  loadingEl.hidden = true;
  hintEl.hidden = false;
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

function makeLabelTexture(text, color) {
  const cvs = document.createElement('canvas');
  cvs.width = 512;
  cvs.height = 128;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  ctx.font = '40px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(13,11,26,0.7)';
  ctx.fillRect(0, 30, cvs.width, 68);
  ctx.fillStyle = color;
  ctx.fillText(text, cvs.width / 2, 64);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createPortal({ color, label, position, url, external }) {
  const group = new THREE.Group();
  group.position.copy(position);

  const stone = stoneMaterial(0xb8b3a6);
  const pillarGeo = new THREE.BoxGeometry(0.6, 3.2, 0.6);
  const pillarL = new THREE.Mesh(pillarGeo, stone);
  pillarL.position.set(-1.3, 1.6, 0);
  const pillarR = new THREE.Mesh(pillarGeo, stone);
  pillarR.position.set(1.3, 1.6, 0);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.6, 0.7), stone);
  lintel.position.set(0, 3.5, 0);
  group.add(pillarL, pillarR, lintel);

  const discTex = makeRadialTexture(color);
  const discMat = new THREE.MeshBasicMaterial({
    map: discTex,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.05, 32), discMat);
  disc.position.set(0, 1.75, 0);
  group.add(disc);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.15, 0.07, 8, 24),
    new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 1.2 })
  );
  ring.position.copy(disc.position);
  group.add(ring);

  const labelTex = makeLabelTexture(label, '#ffcc4d');
  const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true }));
  labelSprite.scale.set(3.2, 0.8, 1);
  labelSprite.position.set(0, 4.5, 0);
  group.add(labelSprite);

  const portal = { group, disc, ring, url, external, seed: Math.random() * 10 };
  return portal;
}

function makeRadialTexture(color) {
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = 128;
  const ctx = cvs.getContext('2d');
  const c = new THREE.Color(color);
  const hex = `#${c.getHexString()}`;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.35, hex);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cvs);
}

function createPlayer() {
  const group = new THREE.Group();

  const robe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.5, 1.1, 8),
    new THREE.MeshLambertMaterial({ color: 0x5b3fd6, flatShading: true })
  );
  robe.position.y = 0.75;
  group.add(robe);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xe7b98c, flatShading: true })
  );
  head.position.y = 1.5;
  group.add(head);

  const hat = new THREE.Mesh(
    new THREE.ConeGeometry(0.36, 0.65, 8),
    new THREE.MeshLambertMaterial({ color: 0x3d2a99, flatShading: true })
  );
  hat.position.y = 1.95;
  group.add(hat);

  const hatBand = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.04, 6, 12),
    new THREE.MeshLambertMaterial({ color: 0xffcc4d, flatShading: true })
  );
  hatBand.rotation.x = Math.PI / 2;
  hatBand.position.y = 1.68;
  group.add(hatBand);

  const staff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6),
    new THREE.MeshLambertMaterial({ color: 0x8a5a2b, flatShading: true })
  );
  staff.position.set(0.45, 0.85, 0.1);
  staff.rotation.z = -0.15;
  group.add(staff);

  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 8, 8),
    new THREE.MeshLambertMaterial({ color: 0xffcc4d, emissive: 0xffcc4d, emissiveIntensity: 0.8 })
  );
  orb.position.set(0.5, 1.55, 0.12);
  group.add(orb);

  return group;
}
