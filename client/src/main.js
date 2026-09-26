import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const WS_URL = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787`;

// wake the (possibly sleeping free-tier) server while the user is on the join screen
fetch(WS_URL.replace(/^ws(s?):/, 'http$1:') + '/health').catch(() => {});

// ---------- three.js scene ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1420);
scene.fog = new THREE.Fog(0x0d1420, 30, 90);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);

scene.add(new THREE.HemisphereLight(0x9db4d4, 0x1a1f2a, 1.1));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
sun.position.set(15, 25, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -60;
sun.shadow.camera.right = sun.shadow.camera.top = 60;
scene.add(sun);

// ground: dark grid arena
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(50, 64),
  new THREE.MeshStandardMaterial({ color: 0x18202e, roughness: 0.9 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.PolarGridHelper(50, 16, 24, 64, 0x2a4a6a, 0x1c2c40);
grid.position.y = 0.01;
scene.add(grid);
// boundary pillars
const pillarGeo = new THREE.CylinderGeometry(0.3, 0.4, 5, 8);
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x24354d, emissive: 0x0a2038 });
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  const p = new THREE.Mesh(pillarGeo, pillarMat);
  p.position.set(Math.cos(a) * 48.5, 2.5, Math.sin(a) * 48.5);
  p.castShadow = true;
  scene.add(p);
}

// ---------- avatar ----------
let template = null;
let animClips = [];
const loader = new GLTFLoader();
loader.load('/assets/avatar.glb', (gltf) => {
  template = gltf.scene;
  animClips = gltf.animations;
  // normalize: model height -> 2.6 units, grounded at y=0
  const box = new THREE.Box3().setFromObject(template);
  const size = box.getSize(new THREE.Vector3());
  const s = 2.6 / size.y;
  template.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(template);
  template.position.y = -box2.min.y;
  template.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  document.getElementById('conn').textContent = '— model ready';
});

function findClip(re) {
  return animClips.find((c) => re.test(c.name)) || null;
}

function makeLabel(text, colorHex) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
  ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
  ctx.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(2.2, 0.55, 1);
  sp.position.y = 3.1;
  return sp;
}

const players = new Map(); // id -> { group, label, x, z, rotY }
function addPlayer(id, info) {
  const group = new THREE.Group();
  const body = template ? SkeletonUtils.clone(template) : placeholderMech(info.color);
  group.add(body);
  const label = makeLabel(info.name, info.color);
  group.add(label);
  scene.add(group);
  const p = { group, label, body, tx: info.x ?? 0, tz: info.z ?? 0, trot: info.rotY ?? 0, name: info.name, color: info.color, mixer: null, actions: null, anim: null };
  setupAnims(p);
  players.set(id, p);
  updateCount();
}

// real skeletal animation: idle / run (rigged CC0 knight model)
function setupAnims(p) {
  if (!animClips.length) return;
  const idle = findClip(/^Idle$/) || findClip(/Idle/);
  const move = findClip(/Running_A/) || findClip(/Walking_A/);
  if (!idle && !move) return;
  p.mixer = new THREE.AnimationMixer(p.body);
  p.actions = {};
  if (idle) p.actions.idle = p.mixer.clipAction(idle);
  if (move) p.actions.move = p.mixer.clipAction(move);
  p.anim = 'idle';
  (p.actions.idle || p.actions.move).play();
}
function setAnim(p, name) {
  if (!p.actions || p.anim === name) return;
  const from = p.actions[p.anim], to = p.actions[name];
  if (!to) return;
  to.reset().fadeIn(0.15).play();
  if (from) from.fadeOut(0.15);
  p.anim = name;
}
function placeholderMech(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.4, 4, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 }));
  body.position.y = 1.3; body.castShadow = true;
  g.add(body);
  return g;
}
function removePlayer(id) {
  const p = players.get(id);
  if (p) { scene.remove(p.group); players.delete(id); updateCount(); }
}
function updateCount() { document.getElementById('count').textContent = players.size; }

// when template finishes loading later, swap placeholders for real models
function upgradePlaceholders() {
  if (!template) return;
  for (const p of players.values()) {
    const isPlaceholder = p.body.children[0]?.geometry?.type === 'CapsuleGeometry';
    if (isPlaceholder) {
      const real = SkeletonUtils.clone(template);
      p.group.remove(p.body); p.group.add(real); p.body = real;
      setupAnims(p);
    }
  }
}
const _origLoad = template;
setInterval(upgradePlaceholders, 1000);

// ---------- networking ----------
let ws, myId = null, myName = '';
const posBuffer = new Map(); // id -> {tx, tz, trot} latest target

function connect() {
  document.getElementById('conn').textContent = '— connecting…';
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    document.getElementById('conn').textContent = '— connected';
    ws.send(JSON.stringify({ type: 'input', name: myName || undefined }));
  };
  ws.onclose = () => {
    document.getElementById('conn').textContent = '— disconnected, retrying…';
    for (const id of [...players.keys()]) removePlayer(id);
    setTimeout(connect, 1500);
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'welcome') {
      myId = m.id;
      for (const q of m.players) addPlayer(q.id, q);
    } else if (m.type === 'join') {
      addPlayer(m.id, m);
    } else if (m.type === 'leave') {
      removePlayer(m.id);
    } else if (m.type === 'state') {
      for (const [id, x, z, rotY, name, color] of m.players) {
        let p = players.get(id);
        if (!p) { addPlayer(id, { x, z, rotY, name, color }); p = players.get(id); }
        p.tx = x; p.tz = z; p.trot = rotY;
        if (p.name !== name) { // name arrives after join — rebuild the nameplate
          p.name = name;
          p.group.remove(p.label);
          p.label.material.map.dispose();
          p.label.material.dispose();
          p.label = makeLabel(name, p.color);
          p.group.add(p.label);
        }
      }
    }
  };
}

// ---------- input ----------
// hand-rolled joystick (pointer events work on every mobile browser)
let joyX = 0, joyZ = 0;
const zone = document.querySelector('#stick .zone');
zone.innerHTML = '<div class="jbase"></div><div class="jknob"></div>';
const knob = zone.querySelector('.jknob');
let joyPointer = null;
function joyMove(e) {
  const r = zone.getBoundingClientRect();
  const max = r.width / 2 - 26;
  let vx = e.clientX - (r.left + r.width / 2);
  let vy = e.clientY - (r.top + r.height / 2);
  const len = Math.hypot(vx, vy);
  if (len > max) { vx *= max / len; vy *= max / len; }
  knob.style.transform = `translate(${vx}px, ${vy}px)`;
  joyX = vx / max;
  joyZ = vy / max; // screen space: down = +1
}
function joyEnd(e) {
  if (e.pointerId !== joyPointer) return;
  joyPointer = null;
  joyX = 0; joyZ = 0;
  knob.style.transform = 'translate(0px, 0px)';
}
zone.addEventListener('pointerdown', (e) => {
  joyPointer = e.pointerId;
  zone.setPointerCapture(joyPointer);
  joyMove(e);
  e.preventDefault();
});
zone.addEventListener('pointermove', (e) => { if (e.pointerId === joyPointer) joyMove(e); });
zone.addEventListener('pointerup', joyEnd);
zone.addEventListener('pointercancel', joyEnd);

// desktop fallback: WASD/arrows
const keys = {};
addEventListener('keydown', (e) => keys[e.key.toLowerCase()] = true);
addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

// send input at 30Hz — joystick/keys are screen-space, converted to world via camera basis
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
setInterval(() => {
  if (!ws || ws.readyState !== 1) return;
  let sx = joyX, sy = -joyZ; // screen space: right = +x, up = +1
  if (keys['w'] || keys['arrowup']) sy += 1;
  if (keys['s'] || keys['arrowdown']) sy -= 1;
  if (keys['a'] || keys['arrowleft']) sx -= 1;
  if (keys['d'] || keys['arrowright']) sx += 1;
  camera.getWorldDirection(_fwd); _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1); _fwd.normalize();
  _right.crossVectors(_fwd, _up); // screen-right on the ground plane
  const dx = _right.x * sx + _fwd.x * sy;
  const dz = _right.z * sx + _fwd.z * sy;
  const rotY = Math.hypot(dx, dz) > 0.1 ? Math.atan2(dx, dz) : undefined;
  ws.send(JSON.stringify({ type: 'input', dx, dz, rotY }));
}, 33);

// ---------- camera + render ----------
const camOffset = new THREE.Vector3(0, 4.2, -6.5);
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);
  const k = 1 - Math.exp(-10 * dt); // smoothing

  const me = players.get(myId);
  for (const [id, p] of players) {
    p.group.position.x += (p.tx - p.group.position.x) * k;
    p.group.position.z += (p.tz - p.group.position.z) * k;
    // shortest-angle turn
    let d = p.trot - p.group.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    p.group.rotation.y += d * k;
    const moving = Math.hypot(p.tx - p.group.position.x, p.tz - p.group.position.z) > 0.05;
    if (p.mixer) {
      setAnim(p, moving ? 'move' : 'idle');
      p.mixer.update(dt);
    } else {
      // placeholder bob until the rigged model loads
      const t = performance.now() / 1000;
      p.body.position.y = moving ? Math.abs(Math.sin(t * 9)) * 0.12 : p.body.position.y * (1 - k);
    }
  }

  if (me) {
    const target = me.group.position.clone().add(camOffset);
    camera.position.lerp(target, k * 0.8);
    camera.lookAt(me.group.position.x, me.group.position.y + 1.5, me.group.position.z);
  } else {
    camera.position.lerp(new THREE.Vector3(0, 30, 30), k);
    camera.lookAt(0, 0, 0);
  }
  renderer.render(scene, camera);
}
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- join flow ----------
function start() {
  myName = document.getElementById('name').value.trim() || `Knight-${Math.floor(Math.random() * 1000)}`;
  document.getElementById('join').style.display = 'none';
  connect();
}
document.getElementById('play').addEventListener('click', start);
if (new URLSearchParams(location.search).has('auto')) start();
