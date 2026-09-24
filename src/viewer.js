import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

async function loadModel(config, manager, warnings) {
  if (config.format === 'stl') {
    const geometry = await new STLLoader(manager).loadAsync(config.modelUrl);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: 0xbcc7d4, roughness: 0.72, metalness: 0.08, side: THREE.DoubleSide,
      vertexColors: geometry.hasColors === true
    }));
  }
  if (config.format === 'obj') {
    const loader = new OBJLoader(manager);
    if (config.materialWarning) warnings.push(config.materialWarning);
    if (config.materialUrl) {
      try {
        const mtlLoader = new MTLLoader(manager);
        mtlLoader.setResourcePath(config.materialUrl.slice(0, config.materialUrl.lastIndexOf('/') + 1));
        const materials = await mtlLoader.loadAsync(config.materialUrl);
        materials.preload();
        loader.setMaterials(materials);
      } catch (error) {
        warnings.push(`Material library could not be loaded: ${error.message}`);
      }
    }
    return loader.loadAsync(config.modelUrl);
  }
  return new FBXLoader(manager).loadAsync(config.modelUrl);
}

function prepareMaterials(root) {
  root.traverse(node => {
    if (!node.isMesh) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!material) continue;
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
    }
  });
}

async function waitForTextures(root) {
  const pending = [];
  root.traverse(node => {
    if (!node.isMesh) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!material) continue;
      for (const key of ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
        const image = material[key]?.image;
        if (image && typeof image.decode === 'function') pending.push(image.decode().catch(() => {}));
      }
    }
  });
  await Promise.all(pending);
}

function renderView(renderer, scene, center, size, direction) {
  const width = 508;
  const height = 490;
  const aspect = width / height;
  const visibleWidth = direction.x ? size.z : size.x;
  const visibleHeight = size.y;
  const halfHeight = Math.max(visibleHeight * 1.22, visibleWidth * 1.22 / aspect, 0.001) / 2;
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const camera = new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.01, maxDimension * 20);
  camera.position.copy(center).addScaledVector(direction, maxDimension * 3);
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
}

async function main() {
  const config = await (await fetch('/config.json')).json();
  document.getElementById('model-name').textContent = config.name;
  document.getElementById('format').textContent = config.format.toUpperCase();
  document.getElementById('footer').textContent = `Front: +Z  ·  Right side: +X  ·  Up axis: ${config.upAxis.toUpperCase()}  ·  Model units preserved`;

  const warnings = [];
  const manager = new THREE.LoadingManager();
  let loading = false;
  let resolveIdle;
  manager.onStart = () => { loading = true; };
  manager.onLoad = () => {
    loading = false;
    if (resolveIdle) { resolveIdle(); resolveIdle = undefined; }
  };
  manager.onError = url => warnings.push(`Asset failed to load: ${url.split('/').pop()}`);
  const root = await loadModel(config, manager, warnings);
  if (loading) await new Promise(resolve => { resolveIdle = resolve; });
  if (config.upAxis === 'z') root.rotation.x = -Math.PI / 2;
  prepareMaterials(root);
  await waitForTextures(root);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error('The model contains no visible geometry');
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite)) throw new Error('The model has invalid geometry bounds');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9edf2);
  scene.add(root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x718096, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(3, 6, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdcecff, 0.8);
  fill.position.set(-5, 2, -4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.7);
  rim.position.set(5, 4, -5);
  scene.add(rim);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(508, 490, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.getElementById('front').src = renderView(renderer, scene, center, size, new THREE.Vector3(0, 0, 1));
  document.getElementById('side').src = renderView(renderer, scene, center, size, new THREE.Vector3(1, 0, 0));
  await Promise.all([document.getElementById('front').decode(), document.getElementById('side').decode()]);
  renderer.dispose();
  window.renderResult = { dimensions: size.toArray(), warnings };
}

main().catch(error => { window.renderError = error.stack || error.message || String(error); });
