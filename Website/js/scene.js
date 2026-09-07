import * as THREE from 'three';

const canvas = document.getElementById('scene-canvas');
const tooltip = document.getElementById('tooltip');
const loadingScreen = document.getElementById('loading-screen');
const loadingBarFill = document.getElementById('loading-bar-fill');

const PIXEL_SCALE = 0.4; // render small, upscale with CSS pixelation for the retro look

// ---------- loading screen: cosmetic, everything here builds synchronously ----------
let loadingPct = 0;
const loadingTimer = setInterval(() => {
  loadingPct = Math.min(100, loadingPct + 20);
  loadingBarFill.style.width = loadingPct + '%';
  if (loadingPct >= 100) {
    clearInterval(loadingTimer);
    setTimeout(() => loadingScreen.classList.add('hidden'), 200);
  }
}, 150);

// ---------- pixel texture helpers ----------
function makeTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const floorTexture = makeTexture(16, (ctx, s) => {
  const a = '#4a4358', b = '#3c3648', mortar = '#2a2534';
  for (let y = 0; y < s; y += 8) {
    for (let x = 0; x < s; x += 8) {
      ctx.fillStyle = ((x / 8 + y / 8) % 2 === 0) ? a : b;
      ctx.fillRect(x, y, 8, 8);
    }
  }
  ctx.fillStyle = mortar;
  for (let i = 0; i <= s; i += 8) {
    ctx.fillRect(0, i, s, 1);
    ctx.fillRect(i, 0, 1, s);
  }
});
floorTexture.repeat.set(10, 10);

const rugTexture = makeTexture(16, (ctx, s) => {
  ctx.fillStyle = '#5c1f2b';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#7a2c3a';
  ctx.fillRect(2, 2, s - 4, s - 4);
  ctx.fillStyle = '#e6c260';
  ctx.fillRect(0, 0, s, 2);
  ctx.fillRect(0, s - 2, s, 2);
  ctx.fillRect(0, 0, 2, s);
  ctx.fillRect(s - 2, 0, 2, s);
});
rugTexture.repeat.set(1, 1);

const wallTexture = makeTexture(16, (ctx, s) => {
  ctx.fillStyle = '#241f2e';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#332c40';
  ctx.fillRect(0, 0, s, 7);
  ctx.fillRect(0, 8, s, 7);
  ctx.fillStyle = '#1a1622';
  ctx.fillRect(0, 7, s, 1);
  ctx.fillRect(0, 15, s, 1);
  ctx.fillRect(0, 0, 1, 7);
  ctx.fillRect(8, 8, 1, 7);
});
wallTexture.repeat.set(6, 2);

// ---------- renderer / scene / camera ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x241c30);
scene.fog = new THREE.Fog(0x241c30, 22, 40);

const FRUSTUM = 9;
let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(
  -FRUSTUM * aspect, FRUSTUM * aspect, FRUSTUM, -FRUSTUM, 0.1, 100
);
const camDistance = 18;
const camBase = new THREE.Vector3(camDistance, camDistance * 0.92, camDistance);
camera.position.copy(camBase);
camera.lookAt(0, 1.5, 0);

const rig = new THREE.Group();
scene.add(rig);

// ---------- lighting: torch-lit vault ----------
const ambient = new THREE.HemisphereLight(0x8878b0, 0x2a2034, 2.2);
scene.add(ambient);

const fillLight = new THREE.DirectionalLight(0x8fa8ff, 1.6);
fillLight.position.set(-6, 6, -4);
scene.add(fillLight);

const keyLight = new THREE.DirectionalLight(0xffb46b, 3.4);
keyLight.position.set(6, 10, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -12;
keyLight.shadow.camera.right = 12;
keyLight.shadow.camera.top = 12;
keyLight.shadow.camera.bottom = -12;
keyLight.shadow.camera.far = 30;
keyLight.shadow.bias = -0.0015;
scene.add(keyLight);

function makeTorch(x, z, rotY) {
  const group = new THREE.Group();
  const holder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 0.7, 6),
    new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.9 })
  );
  holder.position.y = 0.35;
  holder.castShadow = true;
  group.add(holder);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.36, 6),
    new THREE.MeshStandardMaterial({ color: 0xffa23c, emissive: 0xff6a00, emissiveIntensity: 1.6, roughness: 0.4 })
  );
  flame.position.y = 0.9;
  group.add(flame);

  const light = new THREE.PointLight(0xff8a3c, 6, 10, 2);
  light.position.y = 0.95;
  group.add(light);

  group.position.set(x, 0, z);
  group.rotation.y = rotY;
  group.userData.flame = flame;
  group.userData.light = light;
  group.userData.baseIntensity = 6;
  return group;
}

const torches = [
  makeTorch(-4.6, -4.6, Math.PI / 4),
  makeTorch(4.6, -4.6, -Math.PI / 4),
];
torches.forEach((t) => rig.add(t));

// ---------- room geometry ----------
const ROOM = 10;

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM, ROOM),
  new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.95 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
rig.add(floor);

const rug = new THREE.Mesh(
  new THREE.PlaneGeometry(4, 4),
  new THREE.MeshStandardMaterial({ map: rugTexture, roughness: 0.85 })
);
rug.rotation.x = -Math.PI / 2;
rug.position.y = 0.01;
rig.add(rug);

const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.95 });
const wallHeight = 4.5;

const backWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, wallHeight), wallMat);
backWall.position.set(0, wallHeight / 2, -ROOM / 2);
backWall.receiveShadow = true;
rig.add(backWall);

const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, wallHeight), wallMat);
leftWall.rotation.y = Math.PI / 2;
leftWall.position.set(-ROOM / 2, wallHeight / 2, 0);
leftWall.receiveShadow = true;
rig.add(leftWall);

// ---------- interactive objects: four vault chests along the back wall ----------
const interactive = [];

function registerInteractive(object, type, label) {
  object.userData.type = type;
  object.userData.label = label;
  interactive.push(object);
  rig.add(object);
}

function buildChest() {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.8 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd8ab3f, metalness: 0.6, roughness: 0.35, emissive: 0x3a2400, emissiveIntensity: 0.2 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 0.9), woodMat);
  base.position.y = 0.35;
  base.castShadow = true;
  group.add(base);

  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.3, 8, 1, false, 0, Math.PI), woodMat);
  lid.rotation.z = Math.PI / 2;
  lid.scale.set(1, 0.7, 1);
  lid.position.y = 0.72;
  lid.castShadow = true;
  group.add(lid);

  const band = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.1, 0.94), goldMat);
  band.position.y = 0.35;
  group.add(band);

  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.1), goldMat);
  lock.position.set(0, 0.55, 0.48);
  group.add(lock);

  return group;
}

const CHESTS = [
  { x: -3.6, type: 'forum', label: 'Vault Chest — Forums' },
  { x: -1.2, type: 'portal', label: 'Vault Chest — Warriors & Wizards' },
  { x: 1.2, type: 'team', label: 'Vault Chest — RealmDev Team' },
  { x: 3.6, type: 'log', label: 'Vault Chest — Update Log' },
];

CHESTS.forEach(({ x, type, label }) => {
  const chest = buildChest();
  chest.position.set(x, 0, -4);
  registerInteractive(chest, type, label);
});

// ---------- torch flicker + idle animation ----------
const clock = new THREE.Clock();

function animate() {
  const t = clock.getElapsedTime();

  torches.forEach((torch, i) => {
    const flicker = Math.sin(t * 9 + i * 3) * 0.9 + Math.sin(t * 23 + i) * 0.5;
    torch.userData.light.intensity = torch.userData.baseIntensity + flicker;
    torch.userData.flame.scale.y = 1 + Math.sin(t * 14 + i) * 0.08;
  });

  const targetTiltX = pointerNorm.y * 0.05;
  const targetTiltY = pointerNorm.x * 0.08;
  rig.rotation.x += (targetTiltX - rig.rotation.x) * 0.04;
  rig.rotation.y += (targetTiltY - rig.rotation.y) * 0.04;

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// ---------- pointer interaction: hover tooltip + click ----------
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2(-10, -10);
const pointerNorm = new THREE.Vector2(0, 0);
let lastClientX = 0, lastClientY = 0;
let hovered = null;

function setPointerFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  lastClientX = e.clientX;
  lastClientY = e.clientY;
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  pointerNorm.x = pointerNDC.x;
  pointerNorm.y = pointerNDC.y;
}

function pickInteractive() {
  raycaster.setFromCamera(pointerNDC, camera);
  const meshes = [];
  interactive.forEach((obj) => obj.traverse((c) => { if (c.isMesh) meshes.push(c); }));
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  return interactive.find((obj) => {
    let found = false;
    obj.traverse((c) => { if (c === hits[0].object) found = true; });
    return found;
  }) || null;
}

function setHoverEmissive(obj, on) {
  obj.traverse((c) => {
    if (c.isMesh && c.material && 'emissiveIntensity' in c.material) {
      c.userData._baseEmissive = c.userData._baseEmissive ?? c.material.emissiveIntensity;
      c.material.emissiveIntensity = on ? c.userData._baseEmissive + 0.8 : c.userData._baseEmissive;
    }
  });
}

window.addEventListener('pointermove', (e) => {
  setPointerFromEvent(e);
  const hit = pickInteractive();
  if (hit !== hovered) {
    if (hovered) setHoverEmissive(hovered, false);
    hovered = hit;
    if (hovered) {
      setHoverEmissive(hovered, true);
      tooltip.textContent = hovered.userData.label;
      tooltip.hidden = false;
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.hidden = true;
      canvas.style.cursor = 'grab';
    }
  }
  if (hovered) {
    tooltip.style.left = lastClientX + 'px';
    tooltip.style.top = lastClientY + 'px';
  }
});

window.addEventListener('click', (e) => {
  if (e.target !== canvas) return;
  setPointerFromEvent(e);
  const hit = pickInteractive();
  if (hit) handleInteract(hit.userData.type);
});

// ---------- interactions ----------
const overlay = document.getElementById('panel-overlay');
const panels = {
  forum: document.getElementById('panel-forum'),
  portal: document.getElementById('panel-portal'),
  team: document.getElementById('panel-team'),
  log: document.getElementById('panel-log'),
};

function openPanel(key) {
  overlay.hidden = false;
  Object.values(panels).forEach((p) => (p.hidden = true));
  panels[key].hidden = false;
}
function closeOverlay() {
  overlay.hidden = true;
  Object.values(panels).forEach((p) => (p.hidden = true));
}
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeOverlay();
});
document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeOverlay));

let changelogLoaded = false;
async function loadChangelog() {
  if (changelogLoaded) return;
  changelogLoaded = true;
  const list = document.getElementById('changelog-list');
  try {
    const res = await fetch('https://api.github.com/repos/programasalami/RealmDev/commits?per_page=8');
    if (!res.ok) throw new Error('bad response');
    const commits = await res.json();
    list.innerHTML = '';
    commits.forEach((c) => {
      const li = document.createElement('li');
      const date = new Date(c.commit.author.date).toLocaleDateString();
      const msg = c.commit.message.split('\n')[0];
      li.innerHTML = `<a href="${c.html_url}" target="_blank" rel="noopener">${escapeHtml(msg)}</a><br>
        <span class="changelog-sha">${c.sha.slice(0, 7)} · ${date}</span>`;
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = '<li class="changelog-error">Could not load commits right now — see the full history on GitHub below.</li>';
  }
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function handleInteract(type) {
  openPanel(type);
  if (type === 'log') loadChangelog();
}

// ---------- resize ----------
function onResize() {
  aspect = window.innerWidth / window.innerHeight;
  camera.left = -FRUSTUM * aspect;
  camera.right = FRUSTUM * aspect;
  camera.top = FRUSTUM;
  camera.bottom = -FRUSTUM;
  camera.updateProjectionMatrix();
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  const w = Math.max(1, Math.round(window.innerWidth * PIXEL_SCALE));
  const h = Math.max(1, Math.round(window.innerHeight * PIXEL_SCALE));
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', onResize);
onResize();

animate();
