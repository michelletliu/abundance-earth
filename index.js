import * as THREE from "three";
import { OrbitControls } from 'jsm/controls/OrbitControls.js';

import getStarfield from "./src/getStarfield.js";
import { getFresnelMat } from "./src/getFresnelMat.js";

let scrollPosY = 0;
let overlayContent = null;
let isSyncingFromWindow = false;
let isSyncingFromOverlay = false;
let scrollSpacer = null;

const MOBILE_VIEWPORT_BREAKPOINT = 768;
const DEFAULT_SCROLL_SPACER_HEIGHT = "400vh";

function isCoarsePointerDevice() {
  if (typeof navigator !== "undefined" && typeof navigator.maxTouchPoints === "number") {
    if (navigator.maxTouchPoints > 1) {
      return true;
    }
  }

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      if (window.matchMedia("(pointer: coarse)").matches) {
        return true;
      }
    } catch {
      // ignore matchMedia support issues
    }
  }

  return false;
}

function computeBidirectionalScrollSyncEnabled() {
  const hasCoarsePointer = isCoarsePointerDevice();
  const isNarrowViewport = window.innerWidth <= MOBILE_VIEWPORT_BREAKPOINT;
  return !(hasCoarsePointer || isNarrowViewport);
}

let bidirectionalScrollSyncEnabled = computeBidirectionalScrollSyncEnabled();

function updateScrollSpacerHeight() {
  if (scrollSpacer) {
    if (bidirectionalScrollSyncEnabled) {
      scrollSpacer.style.display = "block";
      scrollSpacer.style.height = DEFAULT_SCROLL_SPACER_HEIGHT;
    } else {
      scrollSpacer.style.display = "none";
      scrollSpacer.style.height = "0px";
    }
  }

  if (document.body) {
    const spacerHeight = bidirectionalScrollSyncEnabled ? DEFAULT_SCROLL_SPACER_HEIGHT : "0px";
    document.body.style.setProperty("--scroll-spacer-height", spacerHeight);
  }
}

function applyScrollBlockingStyles() {
  if (!document.body) return;
  const overflowValue = bidirectionalScrollSyncEnabled ? "" : "hidden";
  const heightValue = bidirectionalScrollSyncEnabled ? "" : "100%";
  document.documentElement.style.overflowY = overflowValue;
  document.documentElement.style.height = heightValue;
  document.body.style.overflowY = overflowValue;
  document.body.style.height = heightValue;
}

function refreshScrollSyncMode() {
  const nextEnabled = computeBidirectionalScrollSyncEnabled();
  if (nextEnabled === bidirectionalScrollSyncEnabled) return;

  bidirectionalScrollSyncEnabled = nextEnabled;
  updateScrollSpacerHeight();
  applyScrollBlockingStyles();

  if (bidirectionalScrollSyncEnabled) {
    syncScrollFromWindow();
  }
}

try {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const coarseMediaQuery = window.matchMedia("(pointer: coarse)");
    if (coarseMediaQuery) {
      if (typeof coarseMediaQuery.addEventListener === "function") {
        coarseMediaQuery.addEventListener("change", refreshScrollSyncMode);
      } else if (typeof coarseMediaQuery.addListener === "function") {
        coarseMediaQuery.addListener(refreshScrollSyncMode);
      }
    }
  }
} catch {
  // ignore matchMedia listener errors
}
const w = window.innerWidth;
const h = window.innerHeight;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
camera.position.z = 5;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(w, h);
renderer.setClearColor(0x0C0C0C, 1); // replace 0x0f172a with any hex color you like
renderer.domElement.style.position = "fixed";
renderer.domElement.style.top = "0";
renderer.domElement.style.left = "0";
renderer.domElement.style.width = "100%";
renderer.domElement.style.height = "100vh";
renderer.domElement.style.display = "block";
renderer.domElement.style.zIndex = "0";
document.body.appendChild(renderer.domElement);
// THREE.ColorManagement.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const EARTH_MAX_SCALE = 3;
const EARTH_MIN_SCALE = 2;
const EARTH_START_POSITION = new THREE.Vector3(0, -4, 3.7);
const EARTH_END_POSITION = new THREE.Vector3(0, 0, -8);
const CAMERA_START_LOOK_OFFSET = new THREE.Vector3(0, 4, -0.5);
const CAMERA_END_LOOK_OFFSET = new THREE.Vector3(0, 0, 0);
const CAMERA_START_LOOK_TARGET = new THREE.Vector3().addVectors(EARTH_START_POSITION, CAMERA_START_LOOK_OFFSET);
const CAMERA_END_LOOK_TARGET = new THREE.Vector3().addVectors(EARTH_END_POSITION, CAMERA_END_LOOK_OFFSET);

const earthGroup = new THREE.Group();
earthGroup.rotation.z = -23.4 * Math.PI / 180;
earthGroup.position.copy(EARTH_START_POSITION);
earthGroup.scale.setScalar(EARTH_MAX_SCALE);
scene.add(earthGroup);


const controls = new OrbitControls(camera, renderer.domElement);
controls.enableZoom = false;
controls.enablePan = false;
controls.target.copy(CAMERA_START_LOOK_TARGET);
controls.update();

const overlayDragState = {
  isDragging: false,
  pointerId: null,
  lastX: 0,
  lastY: 0,
};

const INTERACTIVE_SELECTOR = "a, button, input, textarea, select, [data-overlay-interactive]";
const overlayDragTargets = new WeakSet();

function attachOverlayDragHandlers(element) {
  if (!element || overlayDragTargets.has(element)) return;
  overlayDragTargets.add(element);

  const handlePointerDown = (event) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    if (!event.isPrimary || event.button !== 0) return;
    if (event.target && event.target.closest && event.target.closest(INTERACTIVE_SELECTOR)) return;

    overlayDragState.isDragging = true;
    overlayDragState.pointerId = event.pointerId;
    overlayDragState.lastX = event.clientX;
    overlayDragState.lastY = event.clientY;

    if (element.setPointerCapture) {
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // setPointerCapture can throw if the pointer is already captured elsewhere
      }
    }

    event.preventDefault();
  };

  const handlePointerMove = (event) => {
    if (!overlayDragState.isDragging || event.pointerId !== overlayDragState.pointerId) return;
    if ((event.buttons & 1) === 0) {
      handlePointerUp(event);
      return;
    }

    const deltaX = event.clientX - overlayDragState.lastX;
    const deltaY = event.clientY - overlayDragState.lastY;
    overlayDragState.lastX = event.clientX;
    overlayDragState.lastY = event.clientY;

    const elementHeight = renderer.domElement.clientHeight || window.innerHeight || 1;
    const rotateSpeed = controls.rotateSpeed;

    controls.rotateLeft((2 * Math.PI * deltaX * rotateSpeed) / elementHeight);
    controls.rotateUp((2 * Math.PI * deltaY * rotateSpeed) / elementHeight);
    controls.update();

    event.preventDefault();
  };

  const handlePointerUp = (event) => {
    if (!overlayDragState.isDragging || event.pointerId !== overlayDragState.pointerId) return;

    overlayDragState.isDragging = false;
    overlayDragState.pointerId = null;

    if (element.releasePointerCapture) {
      try {
        element.releasePointerCapture(event.pointerId);
      } catch {
        // ignore release errors (pointer may have already been released)
      }
    }

    event.preventDefault();
  };

  const handleLostPointerCapture = () => {
    overlayDragState.isDragging = false;
    overlayDragState.pointerId = null;
  };

  element.addEventListener("pointerdown", handlePointerDown);
  element.addEventListener("pointermove", handlePointerMove);
  element.addEventListener("pointerup", handlePointerUp);
  element.addEventListener("pointercancel", handlePointerUp);
  element.addEventListener("lostpointercapture", handleLostPointerCapture);
}

scrollSpacer = document.getElementById("scroll-spacer");
if (!scrollSpacer) {
  scrollSpacer = document.createElement("div");
  scrollSpacer.id = "scroll-spacer";
  scrollSpacer.style.height = DEFAULT_SCROLL_SPACER_HEIGHT;
  scrollSpacer.style.pointerEvents = "none";
  document.body.appendChild(scrollSpacer);
}
updateScrollSpacerHeight();
applyScrollBlockingStyles();
const detail = 12;
const loader = new THREE.TextureLoader();
const geometry = new THREE.IcosahedronGeometry(1, detail);
const material = new THREE.MeshPhongMaterial({
  map: loader.load("./textures/8081_earthmap10k.jpg"),
  specularMap: loader.load("./textures/8081_earthspec10k.jpg"),
  bumpMap: loader.load("./textures/8081_earthbump10k.jpg"),
  bumpScale: 0.04,
});
// material.map.colorSpace = THREE.SRGBColorSpace;
const earthMesh = new THREE.Mesh(geometry, material);
earthGroup.add(earthMesh);


const lightsMat = new THREE.MeshBasicMaterial({
  map: loader.load("./textures/8081_earthlights10k.jpg"),
  blending: THREE.AdditiveBlending,
});
const lightsMesh = new THREE.Mesh(geometry, lightsMat);
earthGroup.add(lightsMesh);


const cloudsMat = new THREE.MeshStandardMaterial({
  map: loader.load("./textures/04_earthcloudmap.jpg"),
  transparent: true,
  opacity: 0.8,
  blending: THREE.AdditiveBlending,
  alphaMap: loader.load('./textures/05_earthcloudmaptrans.jpg'),
  // alphaTest: 0.3,
});
const cloudsMesh = new THREE.Mesh(geometry, cloudsMat);
cloudsMesh.scale.setScalar(1.003);
earthGroup.add(cloudsMesh);


const fresnelMat = getFresnelMat({ opacity: 0.5 });
const glowMesh = new THREE.Mesh(geometry, fresnelMat);
glowMesh.scale.setScalar(1.009);
earthGroup.add(glowMesh);


const stars = getStarfield({numStars: 2000});
scene.add(stars);

const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
sunLight.position.set(-2, 0.5, 1.5);
scene.add(sunLight);

const rate = 1;
const targetEarthPos = new THREE.Vector3();
const targetLookAt = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);

  const scrollFactor = THREE.MathUtils.clamp(scrollPosY, 0, 1);

  targetEarthPos.lerpVectors(EARTH_START_POSITION, EARTH_END_POSITION, scrollFactor);
  targetLookAt.lerpVectors(CAMERA_START_LOOK_TARGET, CAMERA_END_LOOK_TARGET, scrollFactor);
  const targetScale = THREE.MathUtils.lerp(EARTH_MAX_SCALE, EARTH_MIN_SCALE, scrollFactor);

  const targetStarsZ = scrollPosY * 8;
  earthMesh.rotation.y += 0.002;
  lightsMesh.rotation.y += 0.002;
  cloudsMesh.rotation.y += 0.0023;
  glowMesh.rotation.y += 0.002;
  stars.rotation.y -= 0.0002;
  // Smoothly interpolate group position per axis to keep the globe centered
  earthGroup.position.x += (targetEarthPos.x - earthGroup.position.x) * rate;
  earthGroup.position.y += (targetEarthPos.y - earthGroup.position.y) * rate;
  earthGroup.position.z += (targetEarthPos.z - earthGroup.position.z) * rate;
  earthGroup.scale.x += (targetScale - earthGroup.scale.x) * rate;
  earthGroup.scale.y += (targetScale - earthGroup.scale.y) * rate;
  earthGroup.scale.z += (targetScale - earthGroup.scale.z) * rate;


  controls.target.x += (targetLookAt.x - controls.target.x) * rate;
  controls.target.y += (targetLookAt.y - controls.target.y) * rate;
  controls.target.z += (targetLookAt.z - controls.target.z) * rate;
  controls.update();
  stars.position.z += (targetStarsZ - stars.position.z) * rate;
  renderer.render(scene, camera);
}

animate();

function getMaxWindowScroll() {
  return Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
}

function syncScrollFromWindow() {
  const maxWindowScroll = getMaxWindowScroll();
  const ratio = maxWindowScroll > 0 ? window.scrollY / maxWindowScroll : 0;
  scrollPosY = ratio;

  if (!overlayContent) return;
  if (!bidirectionalScrollSyncEnabled) return;
  if (isSyncingFromOverlay) return;

  isSyncingFromWindow = true;

  const maxOverlayScroll = overlayContent.scrollHeight - overlayContent.clientHeight;
  if (maxOverlayScroll > 0) {
    overlayContent.scrollTop = ratio * maxOverlayScroll;
  }

  isSyncingFromWindow = false;
}

function syncScrollFromOverlay() {
  if (!overlayContent) return;

  const maxOverlayScroll = overlayContent.scrollHeight - overlayContent.clientHeight;
  const ratio = maxOverlayScroll > 0 ? overlayContent.scrollTop / maxOverlayScroll : 0;
  scrollPosY = ratio;

  if (!bidirectionalScrollSyncEnabled) return;
  if (isSyncingFromWindow) return;

  isSyncingFromOverlay = true;

  const maxWindowScroll = getMaxWindowScroll();
  if (maxWindowScroll > 0) {
    window.scrollTo(0, ratio * maxWindowScroll);
  }

  isSyncingFromOverlay = false;
}

window.addEventListener("scroll", syncScrollFromWindow);
syncScrollFromWindow();

const attachOverlayScrollListener = () => {
  if (overlayContent) return true;

  overlayContent = document.querySelector(".overlay__content");
  if (!overlayContent) return false;

  overlayContent.addEventListener("scroll", syncScrollFromOverlay, { passive: true });
  attachOverlayDragHandlers(overlayContent);
  syncScrollFromWindow();
  return true;
};

if (!attachOverlayScrollListener()) {
  window.addEventListener("DOMContentLoaded", attachOverlayScrollListener, { once: true });
}

function handleWindowResize () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  refreshScrollSyncMode();
  syncScrollFromWindow();
}
window.addEventListener('resize', handleWindowResize, false);