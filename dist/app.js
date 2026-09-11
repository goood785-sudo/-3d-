import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";

const canvas = document.querySelector("#scene");
const wrap = document.querySelector("#canvasWrap");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x081116, 0.015);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 240);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI / 2.02;
controls.minDistance = 8;
controls.maxDistance = 100;

scene.add(new THREE.HemisphereLight(0xcce9ea, 0x172027, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.8);
sun.position.set(-18, 36, 24);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -44;
sun.shadow.camera.right = 44;
sun.shadow.camera.top = 32;
sun.shadow.camera.bottom = -32;
scene.add(sun);

const grid = new THREE.GridHelper(90, 90, 0x31535a, 0x172a30);
grid.position.y = -0.015;
grid.material.opacity = 0.42;
grid.material.transparent = true;
scene.add(grid);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(90, 58),
  new THREE.MeshStandardMaterial({ color: 0x0d181e, roughness: 0.96, metalness: 0.02 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const selectionArea = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0x47c2ae, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
);
selectionArea.rotation.x = -Math.PI / 2;
selectionArea.position.y = 0.018;
selectionArea.visible = false;
scene.add(selectionArea);

const modelRoot = new THREE.Group();
const furnitureRoot = new THREE.Group();
scene.add(modelRoot, furnitureRoot);

const materials = {
  structure: new THREE.MeshStandardMaterial({ color: 0xd7dfde, roughness: 0.84 }),
  partition: new THREE.MeshStandardMaterial({ color: 0x76898e, roughness: 0.9 }),
  window: new THREE.MeshStandardMaterial({ color: 0x4caed1, transparent: true, opacity: 0.76, roughness: 0.25, metalness: 0.12 }),
  door: new THREE.MeshStandardMaterial({ color: 0xe8a25c, emissive: 0x5f2c10, emissiveIntensity: 0.2, roughness: 0.68 })
};

const layerGroups = {};
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const furniture = [];
let selected = null;
let dragging = false;
let dragOffset = new THREE.Vector3();
let cameraTween = null;
let toastTimer;

const furnitureSpecs = {
  sofa: { label: "3인 소파", size: [2.1, 0.72, 0.9], color: 0x4e817e },
  bed: { label: "퀸 침대", size: [1.6, 0.5, 2.0], color: 0xb8afa1 },
  table: { label: "6인 식탁", size: [1.8, 0.73, 0.85], color: 0x8f6344 },
  fridge: { label: "냉장고", size: [0.91, 1.85, 0.73], color: 0x6e7b80 }
};

function segmentMesh(segment, kind) {
  const [x1, z1] = segment.a;
  const [x2, z2] = segment.b;
  const length = Math.hypot(x2 - x1, z2 - z1);
  if (length < 0.025) return null;
  const settings = {
    structure: { thickness: 0.16, height: 2.7, y: 1.35 },
    partition: { thickness: 0.09, height: 2.58, y: 1.29 },
    window: { thickness: 0.055, height: 1.12, y: 1.48 },
    door: { thickness: 0.065, height: 0.045, y: 0.03 }
  }[kind];
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, settings.height, settings.thickness),
    materials[kind]
  );
  mesh.position.set((x1 + x2) / 2, settings.y, (z1 + z2) / 2);
  mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
  mesh.castShadow = kind !== "door";
  mesh.receiveShadow = true;
  return mesh;
}

async function loadModel() {
  try {
    const response = await fetch("./assets/101-standard-floor-model.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const byKind = { structure: [], partition: [], window: [], door: [] };
    data.segments.forEach((segment) => byKind[segment.kind]?.push(segment));

    for (const kind of Object.keys(byKind)) {
      const group = new THREE.Group();
      group.name = kind;
      byKind[kind].forEach((segment) => {
        const mesh = segmentMesh(segment, kind);
        if (mesh) group.add(mesh);
      });
      layerGroups[kind] = group;
      modelRoot.add(group);
    }

    document.querySelector("#segmentCount").textContent = `${data.segments.length.toLocaleString("ko-KR")}개`;
    frameZone("all", true);
    document.querySelector("#modelLoading").classList.add("hidden");
  } catch (error) {
    document.querySelector("#modelLoading").innerHTML = `<p>모델을 불러오지 못했습니다.<br>${error.message}</p>`;
  }
}

const views = {
  all: { position: [36, 42, 43], target: [-4, 0, 1] },
  "119c": { position: [-18, 15, 16], target: [-29, 0, -1] },
  "110a": { position: [24, 15, 18], target: [13, 0, 3] },
  "110b": { position: [31, 17, 22], target: [20, 0, 8] },
  "110c": { position: [31, 17, 10], target: [20, 0, -4] },
  "110d": { position: [21, 16, 17], target: [11, 0, 1] },
  plan: { position: [-4, 66, 1], target: [-4, 0, 1] }
};

const unitViews = {
  all: { label: "동 전체 기준층", bounds: null },
  "119c": { label: "119C · 판상형", bounds: [-33, -25.4, -7.4, 4.7] },
  "110a": { label: "110A · 타워형", bounds: [8, 18.8, -1.8, 7.2] },
  "110b": { label: "110B · 타워형", bounds: [16.5, 25.8, 1.5, 14.2] },
  "110c": { label: "110C · 타워형", bounds: [15.5, 25.8, -8.8, 1.1] },
  "110d": { label: "110D · 타워형", bounds: [7, 17.2, -5.2, 6.6] }
};

function tweenCamera(position, target, immediate = false) {
  const endPosition = new THREE.Vector3(...position);
  const endTarget = new THREE.Vector3(...target);
  if (immediate) {
    camera.position.copy(endPosition);
    controls.target.copy(endTarget);
    controls.update();
    return;
  }
  cameraTween = {
    start: performance.now(), duration: 620,
    fromPosition: camera.position.clone(), toPosition: endPosition,
    fromTarget: controls.target.clone(), toTarget: endTarget
  };
}

function frameZone(zone, immediate = false) {
  document.querySelectorAll(".zone-button").forEach((button) => button.classList.toggle("active", button.dataset.zone === zone));
  document.querySelectorAll(".view-tab").forEach((button) => button.classList.toggle("active", button.dataset.view === "3d"));
  controls.enableRotate = true;
  applyUnitView(zone);
  tweenCamera(views[zone].position, views[zone].target, immediate);
}

function applyUnitView(zone) {
  const view = unitViews[zone] || unitViews.all;
  document.querySelector("#selectedUnit").textContent = view.label;
  Object.values(layerGroups).forEach((group) => group.children.forEach((mesh) => { mesh.visible = true; }));
  selectionArea.visible = Boolean(view.bounds);
  if (view.bounds) {
    const [x1, x2, z1, z2] = view.bounds;
    selectionArea.position.set((x1 + x2) / 2, 0.018, (z1 + z2) / 2);
    selectionArea.scale.set(x2 - x1, z2 - z1, 1);
  }
  document.querySelectorAll("[data-layer]").forEach((input) => {
    const group = layerGroups[input.dataset.layer];
    if (group) group.visible = input.checked;
  });
  furnitureRoot.visible = zone !== "all";
  if (zone === "all") selectFurniture(null);
}

function setPlanView() {
  document.querySelectorAll(".view-tab").forEach((button) => button.classList.toggle("active", button.dataset.view === "plan"));
  document.querySelectorAll(".zone-button").forEach((button) => button.classList.remove("active"));
  controls.enableRotate = false;
  applyUnitView("all");
  tweenCamera(views.plan.position, views.plan.target);
}

function furnitureMesh(type) {
  const spec = furnitureSpecs[type];
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.72, metalness: 0.04 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(...spec.size), material);
  body.position.y = spec.size[1] / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  if (type === "sofa") {
    const back = new THREE.Mesh(new THREE.BoxGeometry(spec.size[0], 0.62, 0.18), material);
    back.position.set(0, 0.75, -0.36); back.castShadow = true; group.add(back);
    [-0.93, 0.93].forEach((x) => { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.45, 0.86), material); arm.position.set(x, 0.48, 0); arm.castShadow = true; group.add(arm); });
  }
  if (type === "bed") {
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.14, 0.38), new THREE.MeshStandardMaterial({ color: 0xe8e1d5, roughness: 0.95 }));
    pillow.position.set(0, 0.58, -0.67); group.add(pillow);
  }
  if (type === "table") {
    body.scale.y = 0.12; body.position.y = 0.72;
  }
  group.userData = { furniture: true, type, label: spec.label };
  group.traverse((child) => { child.userData.owner = group; });
  return group;
}

function addFurniture(type) {
  const item = furnitureMesh(type);
  item.position.set(controls.target.x, 0, controls.target.z);
  furnitureRoot.add(item);
  furniture.push(item);
  selectFurniture(item);
  updateFurnitureUI();
  showToast(`${item.userData.label}를 배치했습니다.`);
}

function selectFurniture(item) {
  if (selected) selected.traverse((child) => {
    if (child.isMesh && child.material?.emissive) child.material.emissive.setHex(0x000000);
  });
  selected = item;
  if (selected) selected.traverse((child) => {
    if (child.isMesh && child.material?.emissive) child.material.emissive.setHex(0x234f49);
  });
  document.querySelector("#rotateFurniture").disabled = !selected;
  document.querySelector("#deleteFurniture").disabled = !selected;
}

function deleteSelected() {
  if (!selected) return;
  const index = furniture.indexOf(selected);
  if (index >= 0) furniture.splice(index, 1);
  furnitureRoot.remove(selected);
  selectFurniture(null);
  updateFurnitureUI();
}

function updateFurnitureUI() {
  document.querySelector("#furnitureCount").textContent = furniture.length;
  document.querySelector("#clearFurniture").disabled = furniture.length === 0;
}

function setPointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function hitFurniture(event) {
  setPointer(event);
  const hits = raycaster.intersectObjects(furnitureRoot.children, true);
  return hits[0]?.object.userData.owner || null;
}

function hitGround(event) {
  setPointer(event);
  return raycaster.intersectObject(ground, false)[0]?.point || null;
}

canvas.addEventListener("pointerdown", (event) => {
  const item = hitFurniture(event);
  if (!item) return;
  selectFurniture(item);
  const point = hitGround(event);
  if (point) dragOffset.copy(item.position).sub(point);
  dragging = true;
  controls.enabled = false;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging || !selected) return;
  const point = hitGround(event);
  if (point) selected.position.copy(point.add(dragOffset)).setY(0);
});

function endDrag(event) {
  if (!dragging) return;
  dragging = false;
  controls.enabled = true;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

document.querySelectorAll("[data-furniture]").forEach((button) => button.addEventListener("click", () => addFurniture(button.dataset.furniture)));
document.querySelectorAll(".zone-button").forEach((button) => button.addEventListener("click", () => frameZone(button.dataset.zone)));
document.querySelectorAll(".view-tab").forEach((button) => button.addEventListener("click", () => button.dataset.view === "plan" ? setPlanView() : frameZone("all")));
document.querySelector("#resetView").addEventListener("click", () => frameZone("all"));
document.querySelector("#rotateFurniture").addEventListener("click", () => { if (selected) selected.rotation.y += Math.PI / 2; });
document.querySelector("#deleteFurniture").addEventListener("click", deleteSelected);
document.querySelector("#clearFurniture").addEventListener("click", () => {
  furniture.splice(0).forEach((item) => furnitureRoot.remove(item));
  selectFurniture(null); updateFurnitureUI(); showToast("배치한 가구를 모두 비웠습니다.");
});
document.querySelector("#showAll").addEventListener("click", () => {
  document.querySelectorAll("[data-layer]").forEach((input) => { input.checked = true; if (layerGroups[input.dataset.layer]) layerGroups[input.dataset.layer].visible = true; });
});
document.querySelectorAll("[data-layer]").forEach((input) => input.addEventListener("change", () => {
  if (layerGroups[input.dataset.layer]) layerGroups[input.dataset.layer].visible = input.checked;
}));
document.querySelector("#floorSelect").addEventListener("change", (event) => showToast(`${event.target.value} 기준층 형상을 표시합니다.`));
window.addEventListener("keydown", (event) => {
  if ((event.key === "Delete" || event.key === "Backspace") && selected) deleteSelected();
  if (event.key.toLowerCase() === "r" && selected) selected.rotation.y += Math.PI / 2;
});

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function resize() {
  const width = wrap.clientWidth;
  const height = wrap.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);

function animate(now) {
  requestAnimationFrame(animate);
  if (cameraTween) {
    const t = Math.min(1, (now - cameraTween.start) / cameraTween.duration);
    const eased = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
    controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
    if (t >= 1) cameraTween = null;
  }
  controls.update();
  renderer.render(scene, camera);
}

resize();
loadModel();
requestAnimationFrame(animate);
