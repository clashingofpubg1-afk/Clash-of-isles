/* main.js - Clash of Isles Enhanced Prototype (final full version)
   Features:
   - Mobile-friendly "Tap to begin" unlock (strong resume fallbacks)
   - WebAudio calm ambient synth
   - Three.js scene with island, water, building placement & upgrades
   - Resource system, tide manager, mini-raid, save/load (localStorage)
*/

'use strict';

// Globals
let scene, camera, renderer, controls;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let island, water, topPlane;
let buildings = [];
let resources = { timber: 50 };
let resRate = 0.0;
let selectedBuildType = 'hut';
let isRaidActive = false;
let raidEndTime = 0;
let raidScore = 0;
const SAVE_KEY = 'clash_of_isles_save_v1';
let unlocked = false; // interaction unlocked flag

// AudioEngine - Calm synth via WebAudio
const AudioEngine = {
  ctx: null,
  masterGain: null,
  init: function(){
    if(this.ctx) return;
    try{
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.12;
      this.masterGain.connect(this.ctx.destination);
      this.playAmbient();
    }catch(e){
      console.warn('Audio init failed', e);
    }
  },
  playAmbient: function(){
    if(!this.ctx) return;
    // two pad oscillators
    const o1 = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const g1 = this.ctx.createGain();
    const g2 = this.ctx.createGain();
    o1.type = 'sine'; o2.type = 'triangle';
    o1.frequency.value = 110; o2.frequency.value = 220;
    g1.gain.value = 0.03; g2.gain.value = 0.02;
    o1.connect(g1); o2.connect(g2);
    g1.connect(this.masterGain); g2.connect(this.masterGain);
    o1.start(); o2.start();

    // slow LFO controlling a filter for movement
    const lfo = this.ctx.createOscillator();
    const flt = this.ctx.createBiquadFilter();
    lfo.frequency.value = 0.04;
    lfo.connect(flt.frequency);
    flt.type = 'lowpass'; flt.frequency.value = 800;
    this.masterGain.connect(flt);
    flt.connect(this.ctx.destination);
    lfo.start();
  }
};

// TideManager
const TideManager = {
  states: ['Low','Mid','High'],
  currentIndex: 0,
  current: 'Low',
  cycleSeconds: 40,
  init: function(){
    this.currentIndex = 0;
    this.current = this.states[this.currentIndex];
    setInterval(()=>{ this.next(); }, this.cycleSeconds * 1000);
  },
  next: function(){
    this.currentIndex = (this.currentIndex + 1) % this.states.length;
    this.current = this.states[this.currentIndex];
    recalcRates();
    updateUI();
  },
  updateVisual: function(mesh){
    if(!mesh) return;
    if(this.current === 'Low') mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, -1.5, 0.02);
    if(this.current === 'Mid') mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, 0.3, 0.02);
    if(this.current === 'High') mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, 1.8, 0.02);
  }
};

// Init function
function init(){
  // UI refs
  window.resCountEl = document.getElementById('resCount');
  window.resRateEl = document.getElementById('resRate');
  window.tideStateEl = document.getElementById('tideState');

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ad7ff);
  camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 1000);
  camera.position.set(0,28,40);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('canvas').appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0,2,0);
  controls.update();

  // Lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9); scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6); dir.position.set(-10,20,10); scene.add(dir);

  // Island
  const geom = new THREE.CylinderGeometry(22,24,6,40);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4b7a29, flatShading: true });
  island = new THREE.Mesh(geom, mat); island.position.y = 0; scene.add(island);

  // TopPlane for raycasting placement
  const planeGeom = new THREE.PlaneGeometry(40,40,1,1);
  const planeMat = new THREE.MeshBasicMaterial({ visible: false });
  topPlane = new THREE.Mesh(planeGeom, planeMat);
  topPlane.rotation.x = -Math.PI/2; topPlane.position.y = 3.1; topPlane.name = "topPlane";
  scene.add(topPlane);

  // Water
  const waterGeom = new THREE.CircleGeometry(70,64);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x1e90ff, transparent: true, opacity: 0.75 });
  water = new THREE.Mesh(waterGeom, waterMat);
  water.rotation.x = -Math.PI/2; water.position.y = -1.5; scene.add(water);

  // Events
  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  // Resource auto-increment every sec (fractional handled in openGame)
  setInterval(()=>{ resources.timber += Math.max(0, Math.floor(resRate)); updateUI(); }, 1000);

  // Tide
  TideManager.init();

  // UI binding & update
  bindUI();
  updateUI();
}

// UI binding
function bindUI(){
  document.querySelectorAll('.buildItem').forEach(el=>{
    el.addEventListener('click', ()=>{
      document.querySelectorAll('.buildItem').forEach(x=>x.style.border='1px solid rgba(255,255,255,0.02)');
      el.style.border='1px solid #1e90ff';
      selectedBuildType = el.dataset.type;
    });
  });

  document.getElementById('startBtn').addEventListener('click', ()=>{ openGame(); });
  document.getElementById('loadBtn').addEventListener('click', ()=>{ loadGame(); openGame(); });
  document.getElementById('howBtn').addEventListener('click', ()=>{ showModal('How to Play', document.getElementById('instructions').innerHTML); });
  document.getElementById('closeModal').addEventListener('click', ()=>{ closeModal(); });
  document.getElementById('saveBtn').addEventListener('click', ()=>{ saveGame(); alert('Saved!'); });
  document.getElementById('attackBtn').addEventListener('click', ()=>{ startRaid(); });
  document.get
