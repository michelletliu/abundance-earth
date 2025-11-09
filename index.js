import * as THREE from "three";
import { OrbitControls } from 'jsm/controls/OrbitControls.js';
import { EffectComposer } from 'jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'jsm/postprocessing/UnrealBloomPass.js';

import getStarfield from "./src/getStarfield.js";
import { getFresnelMat } from "./src/getFresnelMat.js";

let scrollPosY = 0;
let targetScrollPosY = 0;
let isApplyingSnapToDom = false;
let lastWindowScrollY = 0;
let lastOverlayScrollTop = 0;
let isAnimatingSnap = false;
let snapAnimationStartTime = 0;
let snapAnimationSource = null;
let snapStartScrollPos = 0;
let snapTargetScrollPos = 1;
let activeSnapDirection = null;
let overlayContent = null;
let isSyncingFromWindow = false;
let isSyncingFromOverlay = false;
let scrollSpacer = null;
let overlayFadeObserver = null;
let hasWindowScrollInteracted = false;
let hasOverlayScrollInteracted = false;
let earthGroup = null;
let secondEarthGroup = null;
let thirdEarthGroup = null;
let controls = null;

const HIGH_RES_TEXTURE_SET = {
  surfaceMap: "./textures/8081_earthmap10k.jpg",
  specularMap: "./textures/8081_earthspec10k.jpg",
  bumpMap: "./textures/8081_earthbump10k.jpg",
  lightsMap: "./textures/8081_earthlights10k.jpg",
  bumpScale: 0.04,
};

const LOW_RES_TEXTURE_SET = {
  surfaceMap: "./textures/8081_earthmap2k.jpg",
  specularMap: "./textures/8081_earthspec2k.jpg",
  bumpMap: "./textures/8081_earthbump2k.jpg",
  lightsMap: "./textures/8081_earthlights2k.jpg",
  bumpScale: 0.025,
};

const CLOUD_TEXTURES = {
  map: "./textures/04_earthcloudmap.jpg",
  alphaMap: "./textures/05_earthcloudmaptrans.jpg",
};

const textureCache = new Map();
const loader = new THREE.TextureLoader();
const earthMeshSets = [];

function loadTexture(path) {
  if (!path) return null;
  if (textureCache.has(path)) {
    return textureCache.get(path);
  }
  const texture = loader.load(path);
  textureCache.set(path, texture);
  return texture;
}

const MOBILE_VIEWPORT_BREAKPOINT = 768;
const DEFAULT_SCROLL_SPACER_HEIGHT = "260vh";
const SCROLL_SMOOTHING_ALPHA = 0.08;
const SCROLL_SNAP_EPSILON = 1e-4;
const SCROLL_SNAP_RESET_THRESHOLD = 0.001;
const SCROLL_DIRECTION_MIN_DELTA = 0.08;
const SCROLL_SNAP_ACTIVATE_END_THRESHOLD = 0.12;
const SCROLL_SNAP_ACTIVATE_START_THRESHOLD = 0.88;
const SNAP_ANIMATION_DURATION_MS = 1000;
const SCROLL_SNAP_ENABLED = false;

const DESKTOP_EARTH_SETTINGS = {
  maxScale: 3,
  minScale: 2,
  startYOffset: 0,
  cloneSpacingMultiplier: 2,
  startZOffset: 0,
};

const MOBILE_EARTH_SETTINGS = {
  maxScale: 2.2,
  minScale: 1.4,
  startYOffset: 1.8,
  cloneSpacingMultiplier: 1.6,
  startZOffset: -1.6,
};

const computeEarthSettings = () => {
  const baseSettings = window.innerWidth <= MOBILE_VIEWPORT_BREAKPOINT ? MOBILE_EARTH_SETTINGS : DESKTOP_EARTH_SETTINGS;
  const cloneSpacingMultiplier = baseSettings.cloneSpacingMultiplier ?? 2;
  const cloneOffsetX = baseSettings.maxScale * cloneSpacingMultiplier;
  return {
    ...baseSettings,
    cloneOffsetX,
  };
};

let EARTH_MAX_SCALE = DESKTOP_EARTH_SETTINGS.maxScale;
let EARTH_MIN_SCALE = DESKTOP_EARTH_SETTINGS.minScale;
let CLONE_OFFSET_X = DESKTOP_EARTH_SETTINGS.maxScale * (DESKTOP_EARTH_SETTINGS.cloneSpacingMultiplier ?? 2);

const BASE_EARTH_START_POSITION = new THREE.Vector3(0, -4, 3.7);
const EARTH_START_POSITION = BASE_EARTH_START_POSITION.clone();
const EARTH_END_POSITION = new THREE.Vector3(0, 0, -8);
const CAMERA_START_LOOK_OFFSET = new THREE.Vector3(0, 4, -0.5);
const CAMERA_END_LOOK_OFFSET = new THREE.Vector3(0, 0, 0);
const CAMERA_START_LOOK_TARGET = new THREE.Vector3().addVectors(EARTH_START_POSITION, CAMERA_START_LOOK_OFFSET);
const CAMERA_END_LOOK_TARGET = new THREE.Vector3().addVectors(EARTH_END_POSITION, CAMERA_END_LOOK_OFFSET);

function applyEarthScaleSettings() {
  const {
    maxScale,
    minScale,
    cloneOffsetX,
    startYOffset = 0,
    startZOffset = 0,
  } = computeEarthSettings();
  EARTH_MAX_SCALE = maxScale;
  EARTH_MIN_SCALE = minScale;
  CLONE_OFFSET_X = cloneOffsetX;

  EARTH_START_POSITION.copy(BASE_EARTH_START_POSITION);
  EARTH_START_POSITION.y += startYOffset;
  EARTH_START_POSITION.z += startZOffset;
  CAMERA_START_LOOK_TARGET.copy(EARTH_START_POSITION).add(CAMERA_START_LOOK_OFFSET);

  if (earthGroup) {
    earthGroup.position.copy(EARTH_START_POSITION);
    earthGroup.scale.setScalar(EARTH_MAX_SCALE);
  }

  const applyCloneTransform = (group, direction = 1) => {
    if (!group) return;
    group.position.copy(EARTH_START_POSITION);
    group.position.x += CLONE_OFFSET_X * direction;
    group.scale.setScalar(EARTH_MAX_SCALE);
  };
  applyCloneTransform(secondEarthGroup, 1);
  applyCloneTransform(thirdEarthGroup, -1);

  if (controls) {
    controls.target.copy(CAMERA_START_LOOK_TARGET);
    controls.update();
  }
}
applyEarthScaleSettings();

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

function computeActiveTextureSet() {
  const prefersLowRes =
    window.innerWidth <= MOBILE_VIEWPORT_BREAKPOINT || isCoarsePointerDevice();
  return prefersLowRes ? LOW_RES_TEXTURE_SET : HIGH_RES_TEXTURE_SET;
}

function getTargetPixelRatio() {
  const devicePixelRatio = window.devicePixelRatio || 1;
  const maxRatio = isCoarsePointerDevice() ? 1.5 : 2;
  return Math.min(devicePixelRatio, maxRatio);
}

let activeTextureSet = computeActiveTextureSet();

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
  refreshActiveTextureSet();

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
renderer.setPixelRatio(getTargetPixelRatio());
renderer.setClearColor(0x0C0C0C, 1); // replace 0x0f172a with any hex color you like
renderer.autoClear = false;
renderer.domElement.style.position = "fixed";
renderer.domElement.style.top = "0";
renderer.domElement.style.left = "0";
renderer.domElement.style.width = "100%";
renderer.domElement.style.height = "100vh";
renderer.domElement.style.display = "block";
renderer.domElement.style.zIndex = "0";
document.body.appendChild(renderer.domElement);
lastWindowScrollY = window.scrollY || 0;
// THREE.ColorManagement.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const DEFAULT_LAYER = 0;
const BLOOM_LAYER = 1;

const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.5,
  0.2,
  0.85
);
bloomPass.threshold = 0;
bloomPass.strength = 4;
bloomPass.radius = 0.5;

const bloomComposer = new EffectComposer(renderer);
bloomComposer.setPixelRatio(getTargetPixelRatio());
bloomComposer.setSize(window.innerWidth, window.innerHeight);
bloomComposer.addPass(renderScene);
bloomComposer.addPass(bloomPass);

const CLONE_FADE_START = 0.88;
const CLONE_FADE_END = 1.0;
earthGroup = new THREE.Group();
earthGroup.rotation.z = -23.4 * Math.PI / 180;
earthGroup.position.copy(EARTH_START_POSITION);
earthGroup.scale.setScalar(EARTH_MAX_SCALE);
scene.add(earthGroup);


controls = new OrbitControls(camera, renderer.domElement);
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
const geometry = new THREE.IcosahedronGeometry(1, detail);

function prepareFadeTarget(target) {
  const delay = target.dataset.fadeDelay;
  if (delay) {
    target.style.setProperty("--fade-delay", delay);
  }
  const duration = target.dataset.fadeDuration;
  if (duration) {
    target.style.setProperty("--fade-duration", duration);
  }
  const easing = target.dataset.fadeEasing;
  if (easing) {
    target.style.setProperty("--fade-easing", easing);
  }
  const distance = target.dataset.fadeDistance;
  if (distance) {
    target.style.setProperty("--fade-distance", distance);
  }
  target.classList.remove("is-in");
  // Force a reflow so the browser registers the initial state before we trigger transitions.
  void target.getBoundingClientRect();
}

function revealFadeTarget(target) {
  if (target.classList.contains("is-in")) return;
  requestAnimationFrame(() => {
    target.classList.add("is-in");
  });
}

function resetFadeTarget(target) {
  if (!target.classList.contains("is-in")) return;
  target.classList.remove("is-in");
  // Force a reflow so future re-entries trigger the fade transition.
  void target.getBoundingClientRect();
}

function initOverlayFadeAnimations() {
  const targetRoot = document.querySelector(".overlay__content");
  if (!targetRoot) return;

  const fadeTargets = Array.from(targetRoot.querySelectorAll(".fade-up"));
  if (!fadeTargets.length) return;

  fadeTargets.forEach((target) => {
    prepareFadeTarget(target);
  });

  if (overlayFadeObserver) {
    overlayFadeObserver.disconnect();
    overlayFadeObserver = null;
  }

  if (!("IntersectionObserver" in window)) {
    fadeTargets.forEach((target) => revealFadeTarget(target));
    return;
  }

  overlayFadeObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const target = entry.target;

        if (entry.isIntersecting) {
          revealFadeTarget(target);
          return;
        }

        if (entry.intersectionRatio > 0) {
          return;
        }

        const rootBounds = entry.rootBounds;
        const fullyAbove = rootBounds
          ? entry.boundingClientRect.bottom <= rootBounds.top
          : entry.boundingClientRect.bottom <= 0;
        const fullyBelow = rootBounds
          ? entry.boundingClientRect.top >= rootBounds.bottom
          : entry.boundingClientRect.top >= (window.innerHeight || 0);

        if (fullyAbove || fullyBelow) {
          resetFadeTarget(target);
        }
      });
    },
    {
      root: targetRoot,
      rootMargin: "0px 0px -10% 0px",
      threshold: 0.15,
    }
  );

  fadeTargets.forEach((target) => overlayFadeObserver.observe(target));

  // Fallback: if something is already in view when we attach, ensure it animates.
  const triggerVisibleTargets = () => {
    const rootRect = targetRoot.getBoundingClientRect();
    fadeTargets.forEach((target) => {
      const rect = target.getBoundingClientRect();
      const isVisible =
        rect.bottom > rootRect.top && rect.top < rootRect.bottom;
      if (isVisible) {
        revealFadeTarget(target);
      }
    });
  };

  requestAnimationFrame(triggerVisibleTargets);
  setTimeout(triggerVisibleTargets, 120);
}

function populateEarthGroup(group, { shouldFadeIn = false } = {}) {
  const {
    surfaceMap,
    specularMap,
    bumpMap,
    lightsMap,
    bumpScale,
  } = activeTextureSet;

  const surfaceMaterial = new THREE.MeshPhongMaterial({
    map: loadTexture(surfaceMap),
    specularMap: loadTexture(specularMap),
    bumpMap: loadTexture(bumpMap),
    bumpScale,
  });
  const baseEarthOpacity = surfaceMaterial.opacity;
  const earthMesh = new THREE.Mesh(geometry, surfaceMaterial);
  group.add(earthMesh);

  const lightsMaterial = new THREE.MeshBasicMaterial({
    map: loadTexture(lightsMap),
    blending: THREE.AdditiveBlending,
  });
  const baseLightsOpacity = lightsMaterial.opacity;
  const lightsMesh = new THREE.Mesh(geometry, lightsMaterial);
  group.add(lightsMesh);

  const cloudsMaterial = new THREE.MeshStandardMaterial({
    map: loadTexture(CLOUD_TEXTURES.map),
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    alphaMap: loadTexture(CLOUD_TEXTURES.alphaMap),
  });
  const baseCloudsOpacity = cloudsMaterial.opacity;
  const cloudsMesh = new THREE.Mesh(geometry, cloudsMaterial);
  cloudsMesh.scale.setScalar(1.003);
  group.add(cloudsMesh);

  const fresnelMaterial = getFresnelMat({ opacity: 0.5 });
  const baseGlowOpacity = fresnelMaterial.uniforms && fresnelMaterial.uniforms.opacity ? fresnelMaterial.uniforms.opacity.value : typeof fresnelMaterial.opacity === "number" ? fresnelMaterial.opacity : 1;
  const glowGeometry = new THREE.SphereGeometry(1, 128, 128);
  const glowMesh = new THREE.Mesh(glowGeometry, fresnelMaterial);
  glowMesh.scale.setScalar(1.0025);
  group.add(glowMesh);

  if (shouldFadeIn) {
    surfaceMaterial.transparent = true;
    surfaceMaterial.opacity = 0;
    surfaceMaterial.depthWrite = false;

    lightsMaterial.transparent = true;
    lightsMaterial.opacity = 0;
    lightsMaterial.depthWrite = false;

    cloudsMaterial.transparent = true;
    cloudsMaterial.opacity = 0;
    cloudsMaterial.depthWrite = false;

    if (fresnelMaterial.uniforms && fresnelMaterial.uniforms.opacity) {
      fresnelMaterial.uniforms.opacity.value = 0;
    } else if (typeof fresnelMaterial.opacity === "number") {
      fresnelMaterial.opacity = 0;
    }
  }

  earthMeshSets.push({
    group,
    earthMesh,
    lightsMesh,
    cloudsMesh,
    glowMesh,
    shouldFadeIn,
    baseOpacities: {
      earth: shouldFadeIn ? baseEarthOpacity || 1 : surfaceMaterial.opacity,
      lights: shouldFadeIn ? baseLightsOpacity || 1 : lightsMaterial.opacity,
      clouds: shouldFadeIn ? baseCloudsOpacity || 0.8 : cloudsMaterial.opacity,
      glow: baseGlowOpacity,
    },
  });
}

populateEarthGroup(earthGroup);

function enableBloomLayer(object) {
  object.traverse((child) => {
    if (child.isMesh || child.isLine || child.isPoints) {
      child.layers.enable(BLOOM_LAYER);
    }
  });
}

enableBloomLayer(earthGroup);

function applyTextureSetToEarthSet(earthSet, textureSet) {
  if (!earthSet) return;

  const {
    surfaceMap,
    specularMap,
    bumpMap,
    lightsMap,
    bumpScale,
  } = textureSet;

  const { earthMesh, lightsMesh } = earthSet;

  const earthMaterial = earthMesh.material;
  if (earthMaterial) {
    earthMaterial.map = loadTexture(surfaceMap);
    earthMaterial.specularMap = loadTexture(specularMap);
    earthMaterial.bumpMap = loadTexture(bumpMap);
    earthMaterial.bumpScale = bumpScale;
    earthMaterial.needsUpdate = true;
  }

  const lightsMaterial = lightsMesh.material;
  if (lightsMaterial) {
    lightsMaterial.map = loadTexture(lightsMap);
    lightsMaterial.needsUpdate = true;
  }
}

function refreshActiveTextureSet(options = {}) {
  const { force = false } = options;
  const nextTextureSet = computeActiveTextureSet();
  if (!force && nextTextureSet === activeTextureSet) {
    return;
  }

  activeTextureSet = nextTextureSet;
  earthMeshSets.forEach((earthSet) => applyTextureSetToEarthSet(earthSet, activeTextureSet));
}

secondEarthGroup = new THREE.Group();
secondEarthGroup.rotation.z = earthGroup.rotation.z;
secondEarthGroup.position.copy(EARTH_START_POSITION);
secondEarthGroup.position.x += CLONE_OFFSET_X;
secondEarthGroup.scale.setScalar(EARTH_MAX_SCALE);
scene.add(secondEarthGroup);
populateEarthGroup(secondEarthGroup, { shouldFadeIn: true });

thirdEarthGroup = new THREE.Group();
thirdEarthGroup.rotation.z = earthGroup.rotation.z;
thirdEarthGroup.position.copy(EARTH_START_POSITION);
thirdEarthGroup.position.x -= CLONE_OFFSET_X;
thirdEarthGroup.scale.setScalar(EARTH_MAX_SCALE);
scene.add(thirdEarthGroup);
populateEarthGroup(thirdEarthGroup, { shouldFadeIn: true });

function updateEarthSetFade(earthSet, factor) {
  if (!earthSet.shouldFadeIn) return;
  const clamped = THREE.MathUtils.clamp(factor, 0, 1);
  const { baseOpacities, earthMesh, lightsMesh, cloudsMesh, glowMesh } = earthSet;

  const earthMaterial = earthMesh.material;
  earthMaterial.opacity = baseOpacities.earth * clamped;
  earthMaterial.depthWrite = clamped > 0.01;

  const lightsMaterial = lightsMesh.material;
  lightsMaterial.opacity = baseOpacities.lights * clamped;
  lightsMaterial.depthWrite = clamped > 0.01;

  const cloudsMaterial = cloudsMesh.material;
  cloudsMaterial.opacity = baseOpacities.clouds * clamped;
  cloudsMaterial.depthWrite = clamped > 0.01;

  const glowMaterial = glowMesh.material;
  if (glowMaterial.uniforms && glowMaterial.uniforms.opacity) {
    glowMaterial.uniforms.opacity.value = baseOpacities.glow * clamped;
  } else if (typeof glowMaterial.opacity === "number") {
    glowMaterial.opacity = baseOpacities.glow * clamped;
  }
}

function easeInOutQuint(t) {
  return t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

function getLuxFadeFactor(scrollFactor) {
  const range = CLONE_FADE_END - CLONE_FADE_START;
  if (range <= 0) return scrollFactor >= CLONE_FADE_END ? 1 : 0;
  const normalized = THREE.MathUtils.clamp((scrollFactor - CLONE_FADE_START) / range, 0, 1);
  return easeInOutQuint(normalized);
}


const stars = getStarfield({numStars: 2000});
scene.add(stars);

const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
sunLight.position.set(-2, 0.5, 1.5);
scene.add(sunLight);

const rate = 1;
const targetEarthPos = new THREE.Vector3();
const targetLookAt = new THREE.Vector3();
const secondOffsetVector = new THREE.Vector3();
const thirdOffsetVector = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);

  if (isAnimatingSnap) {
    const elapsed = performance.now() - snapAnimationStartTime;
    const t = Math.min(elapsed / SNAP_ANIMATION_DURATION_MS, 1);
    const eased = easeInOutQuint(t);
    scrollPosY = THREE.MathUtils.lerp(snapStartScrollPos, snapTargetScrollPos, eased);
    targetScrollPosY = scrollPosY;

    if (t >= 1) {
      isAnimatingSnap = false;
      scrollPosY = snapTargetScrollPos;
      targetScrollPosY = snapTargetScrollPos;
      const destinationDirection = snapTargetScrollPos >= 1 - SCROLL_SNAP_EPSILON ? "end" : "start";
      activeSnapDirection = destinationDirection;
      const source = snapAnimationSource;
      snapAnimationSource = null;
      applySnapToDom({ targetValue: snapTargetScrollPos, source });
    }
  } else if (Math.abs(targetScrollPosY - scrollPosY) > SCROLL_SNAP_EPSILON) {
    scrollPosY += (targetScrollPosY - scrollPosY) * SCROLL_SMOOTHING_ALPHA;
  } else {
    scrollPosY = targetScrollPosY;
  }

  const scrollFactor = THREE.MathUtils.clamp(scrollPosY, 0, 1);

  targetEarthPos.lerpVectors(EARTH_START_POSITION, EARTH_END_POSITION, scrollFactor);
  targetLookAt.lerpVectors(CAMERA_START_LOOK_TARGET, CAMERA_END_LOOK_TARGET, scrollFactor);
  const targetScale = THREE.MathUtils.lerp(EARTH_MAX_SCALE, EARTH_MIN_SCALE, scrollFactor);

  const targetStarsZ = scrollFactor * 8;
  const cloneFade = getLuxFadeFactor(scrollFactor);

  earthMeshSets.forEach((earthSet) => {
    const { earthMesh, lightsMesh, cloudsMesh, glowMesh } = earthSet;
    earthMesh.rotation.y += 0.002;
    lightsMesh.rotation.y += 0.002;
    cloudsMesh.rotation.y += 0.0023;
    glowMesh.rotation.y += 0.002;
    updateEarthSetFade(earthSet, cloneFade);
  });
  stars.rotation.y -= 0.0002;
  // Smoothly interpolate group position per axis to keep the globe centered
  earthGroup.position.x += (targetEarthPos.x - earthGroup.position.x) * rate;
  earthGroup.position.y += (targetEarthPos.y - earthGroup.position.y) * rate;
  earthGroup.position.z += (targetEarthPos.z - earthGroup.position.z) * rate;
  earthGroup.scale.x += (targetScale - earthGroup.scale.x) * rate;
  earthGroup.scale.y += (targetScale - earthGroup.scale.y) * rate;
  earthGroup.scale.z += (targetScale - earthGroup.scale.z) * rate;

  secondOffsetVector.set(CLONE_OFFSET_X, 0, 0);
  thirdOffsetVector.set(-CLONE_OFFSET_X, 0, 0);

  secondEarthGroup.position.copy(earthGroup.position).add(secondOffsetVector);
  secondEarthGroup.scale.copy(earthGroup.scale);

  thirdEarthGroup.position.copy(earthGroup.position).add(thirdOffsetVector);
  thirdEarthGroup.scale.copy(earthGroup.scale);


  controls.target.x += (targetLookAt.x - controls.target.x) * rate;
  controls.target.y += (targetLookAt.y - controls.target.y) * rate;
  controls.target.z += (targetLookAt.z - controls.target.z) * rate;
  controls.update();
  stars.position.z += (targetStarsZ - stars.position.z) * rate;
  renderer.clear();

  camera.layers.set(BLOOM_LAYER);
  bloomComposer.render();
  renderer.clearDepth();
  camera.layers.set(DEFAULT_LAYER);
  renderer.render(scene, camera);
}

animate();

function applySnapToDom({ targetValue, source } = {}) {
  if (isApplyingSnapToDom) return;
  isApplyingSnapToDom = true;

  const isSnappingToEnd = targetValue >= 1 - SCROLL_SNAP_EPSILON;
  const maxWindowScroll = getMaxWindowScroll();
  const overlayScrollRange = overlayContent ? overlayContent.scrollHeight - overlayContent.clientHeight : 0;

  if (overlayContent && overlayScrollRange > 0) {
    const targetOverlayScroll = isSnappingToEnd ? overlayScrollRange : 0;
    if (Math.abs(overlayContent.scrollTop - targetOverlayScroll) > 0.5) {
      overlayContent.scrollTop = targetOverlayScroll;
    }
    lastOverlayScrollTop = overlayContent.scrollTop;
  }

  if (isSnappingToEnd) {
    activeSnapDirection = "end";
  } else {
    activeSnapDirection = "start";
  }

  if (bidirectionalScrollSyncEnabled || source !== "overlay") {
    if (maxWindowScroll > 0) {
      const targetWindowScroll = isSnappingToEnd ? maxWindowScroll : 0;
      if (Math.abs(window.scrollY - targetWindowScroll) > 0.5) {
        window.scrollTo(0, targetWindowScroll);
      }
      lastWindowScrollY = targetWindowScroll;
    } else {
      lastWindowScrollY = window.scrollY;
    }
  } else {
    lastWindowScrollY = window.scrollY;
  }

  scrollPosY = targetValue;
  targetScrollPosY = targetValue;

  isApplyingSnapToDom = false;
}

function startSnapAnimation({ direction, source, startRatio } = {}) {
  if (isAnimatingSnap) return;

  const targetValue = direction === "start" ? 0 : 1;
  const startingRatio = THREE.MathUtils.clamp(
    typeof startRatio === "number" ? startRatio : targetScrollPosY,
    0,
    1
  );

  const distance = Math.abs(targetValue - startingRatio);
  if (distance <= SCROLL_SNAP_EPSILON) {
    applySnapToDom({ targetValue, source });
    return;
  }

  snapStartScrollPos = startingRatio;
  snapTargetScrollPos = targetValue;
  snapAnimationStartTime = performance.now();
  snapAnimationSource = source ?? null;
  scrollPosY = startingRatio;
  targetScrollPosY = startingRatio;
  isAnimatingSnap = true;
  activeSnapDirection = null;
}

function setScrollTarget(rawRatio) {
  const clamped = THREE.MathUtils.clamp(rawRatio, 0, 1);

  if (isAnimatingSnap) {
    return clamped;
  }

  if (activeSnapDirection === "end") {
    if (clamped < 1 - SCROLL_SNAP_RESET_THRESHOLD) {
      activeSnapDirection = null;
      targetScrollPosY = clamped;
      return clamped;
    }

    scrollPosY = 1;
    targetScrollPosY = 1;
    return 1;
  }

  if (activeSnapDirection === "start") {
    if (clamped > SCROLL_SNAP_RESET_THRESHOLD) {
      activeSnapDirection = null;
      targetScrollPosY = clamped;
      return clamped;
    }

    scrollPosY = 0;
    targetScrollPosY = 0;
    return 0;
  }

  targetScrollPosY = clamped;
  return clamped;
}

function getMaxWindowScroll() {
  return Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
}

function syncScrollFromWindow(event) {
  const maxWindowScroll = getMaxWindowScroll();
  const rawRatio = maxWindowScroll > 0 ? window.scrollY / maxWindowScroll : 0;

  const deltaY = window.scrollY - lastWindowScrollY;
  lastWindowScrollY = window.scrollY;

  if (isAnimatingSnap) {
    return;
  }

  if (event && event.isTrusted && !hasWindowScrollInteracted) {
    hasWindowScrollInteracted = true;
  }

  if (
    event &&
    event.isTrusted &&
    hasWindowScrollInteracted &&
    !hasOverlayScrollInteracted &&
    rawRatio < SCROLL_SNAP_ACTIVATE_END_THRESHOLD &&
    deltaY <= 0
  ) {
    // Ignore only the upward post-calibration scroll-to-top that occurs while overlay is syncing.
    hasWindowScrollInteracted = false;
    return;
  }

  if (
    SCROLL_SNAP_ENABLED &&
    event &&
    event.isTrusted &&
    hasWindowScrollInteracted
  ) {
    const shouldSnapToEnd =
      deltaY > SCROLL_DIRECTION_MIN_DELTA &&
      rawRatio > SCROLL_SNAP_ACTIVATE_END_THRESHOLD &&
      activeSnapDirection !== "end";

    const shouldSnapToStart =
      deltaY < -SCROLL_DIRECTION_MIN_DELTA &&
      rawRatio < 1 &&
      (activeSnapDirection === "end" || rawRatio > SCROLL_SNAP_ACTIVATE_START_THRESHOLD) &&
      activeSnapDirection !== "start";

    if (shouldSnapToEnd) {
      startSnapAnimation({ direction: "end", source: "window", startRatio: rawRatio });
      return;
    }

    if (shouldSnapToStart) {
      startSnapAnimation({ direction: "start", source: "window", startRatio: rawRatio });
      return;
    }
  }

  const effectiveRatio = setScrollTarget(rawRatio);

  if (!overlayContent) return;
  if (!bidirectionalScrollSyncEnabled) return;
  if (isSyncingFromOverlay) return;

  isSyncingFromWindow = true;

  const maxOverlayScroll = overlayContent.scrollHeight - overlayContent.clientHeight;
  if (maxOverlayScroll > 0) {
    const targetScrollTop = effectiveRatio * maxOverlayScroll;
    if (Math.abs(overlayContent.scrollTop - targetScrollTop) > 0.5) {
      overlayContent.scrollTop = targetScrollTop;
    }
  }

  isSyncingFromWindow = false;
}

function syncScrollFromOverlay(event) {
  if (!overlayContent) return;

  const maxOverlayScroll = overlayContent.scrollHeight - overlayContent.clientHeight;
  const rawRatio = maxOverlayScroll > 0 ? overlayContent.scrollTop / maxOverlayScroll : 0;

  const deltaY = overlayContent.scrollTop - lastOverlayScrollTop;
  lastOverlayScrollTop = overlayContent.scrollTop;

  if (isAnimatingSnap) {
    return;
  }

  if (event && event.isTrusted && !hasOverlayScrollInteracted) {
    hasOverlayScrollInteracted = true;
  }

  if (
    SCROLL_SNAP_ENABLED &&
    event &&
    event.isTrusted &&
    hasOverlayScrollInteracted
  ) {
    const shouldSnapToEnd =
      deltaY > SCROLL_DIRECTION_MIN_DELTA &&
      rawRatio > SCROLL_SNAP_ACTIVATE_END_THRESHOLD &&
      activeSnapDirection !== "end";

    const shouldSnapToStart =
      deltaY < -SCROLL_DIRECTION_MIN_DELTA &&
      rawRatio < 1 &&
      (activeSnapDirection === "end" || rawRatio > SCROLL_SNAP_ACTIVATE_START_THRESHOLD) &&
      activeSnapDirection !== "start";

    if (shouldSnapToEnd) {
      startSnapAnimation({ direction: "end", source: "overlay", startRatio: rawRatio });
      return;
    }

    if (shouldSnapToStart) {
      startSnapAnimation({ direction: "start", source: "overlay", startRatio: rawRatio });
      return;
    }
  }

  const effectiveRatio = setScrollTarget(rawRatio);

  if (!bidirectionalScrollSyncEnabled) return;
  if (isSyncingFromWindow) return;

  isSyncingFromOverlay = true;

  const maxWindowScroll = getMaxWindowScroll();
  if (maxWindowScroll > 0) {
    const targetScrollTop = effectiveRatio * maxWindowScroll;
    const currentScrollTop = window.scrollY || 0;
    const isScrollingDown = deltaY >= 0;

    if (
      (isScrollingDown && targetScrollTop > currentScrollTop + 0.5) ||
      (!isScrollingDown && targetScrollTop < currentScrollTop - 0.5)
    ) {
      window.scrollTo(0, targetScrollTop);
    }
  }

  isSyncingFromOverlay = false;
}

window.addEventListener("scroll", syncScrollFromWindow);
syncScrollFromWindow();

const attachOverlayScrollListener = () => {
  if (overlayContent) return true;

  overlayContent = document.querySelector(".overlay__content");
  if (!overlayContent) return false;

  lastOverlayScrollTop = overlayContent.scrollTop || 0;

  overlayContent.addEventListener("scroll", syncScrollFromOverlay, { passive: true });
  attachOverlayDragHandlers(overlayContent);
  initOverlayFadeAnimations();
  syncScrollFromWindow();
  return true;
};

if (!attachOverlayScrollListener()) {
  window.addEventListener("DOMContentLoaded", attachOverlayScrollListener, { once: true });
}

function handleWindowResize () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(getTargetPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  bloomComposer.setPixelRatio(getTargetPixelRatio());
  bloomComposer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.resolution.set(window.innerWidth, window.innerHeight);
  applyEarthScaleSettings();
  refreshScrollSyncMode();
  refreshActiveTextureSet();
  syncScrollFromWindow();
}
window.addEventListener('resize', handleWindowResize, false);