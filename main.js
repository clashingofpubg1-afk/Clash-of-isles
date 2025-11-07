
/* main.js - Clash of Isles Enhanced Prototype (audio-unlock)
Adds a "tap to begin" overlay that unlocks WebAudio and UI interactions on mobile.
*/

// Globals (same as before, with unlocked flag)
let scene, camera, renderer, controls;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let island, water, topPlane;
let buildings = [];
let resources = { timber: 50 };
let baseResRate = 0.2; // per second base from huts
let resRate = 0.0;
let buildingCost = { hut:10, mill:30 };
let selectedBuildType = 'hut';
let isRaidActive = false;
let raidEndTime = 0;
let raidScore = 0;
let uiEls = {};
const SAVE_KEY = 'clash_of_isles_save_v1';
let unlocked = false; // interaction unlocked flag

// Audio (calm synth via WebAudio)
const AudioEngine = {
  ctx: null, masterGain: null, seq: null,
  init: function(){
    if(this.ctx) return;
    try{
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.12;
      this.masterGain.connect(this.ctx.destination);
      // start background ambient pads
      this.playAmbient();
    }catch(e){ console.log('Audio init fail', e); }
  },
  playAmbient: function(){
    if(!this.ctx) return;
    // create two slow oscillators for pads
    const o1 = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const g1 = this.ctx.createGain();
    const g2 = this.ctx.createGain();
    o1.type='sine'; o2.type='triangle';
    o1.frequency.value = 110; o2.frequency.value = 220;
    g1.gain.value = 0.03; g2.gain.value = 0.02;
    o1.connect(g1); o2.connect(g2);
    g1.connect(this.masterGain); g2.connect(this.masterGain);
    o1.start();
    o2.start();
    // gentle filter movement
    const lfo = this.ctx.createOscillator();
    const flt = this.ctx.createBiquadFilter();
    lfo.frequency.value = 0.05;
    lfo.connect(flt.frequency);
    flt.type = 'lowpass'; flt.frequency.value = 800;
    this.masterGain.connect(flt);
    flt.connect(this.ctx.destination);
  }
};

// Tide Manager (same)
const TideManager = {
  states: ['Low','Mid','High'],
  currentIndex: 0,
  current: 'Low',
  cycleSeconds: 40,
  init: function(){
    this.currentIndex = 0; this.current = this.states[0];
    setInterval(()=>{ this.next(); }, this.cycleSeconds*1000);
  },
  next: function(){
    this.currentIndex = (this.currentIndex+1) % this.states.length;
    this.current = this.states[this.currentIndex];
    updateUI();
  },
  updateVisual: function(waterMesh){
    if(!waterMesh) return;
    if(this.current === 'Low') waterMesh.position.y = THREE.MathUtils.lerp(waterMesh.position.y, -1.5, 0.02);
    if(this.current === 'Mid') waterMesh.position.y = THREE.MathUtils.lerp(waterMesh.position.y, 0.3, 0.02);
    if(this.current === 'High') waterMesh.position.y = THREE.MathUtils.lerp(waterMesh.position.y, 1.8, 0.02);
  }
};

// init scene
function init(){
  // basic DOM refs
  uiEls.resCount = document.getElementById('resCount');
  uiEls.resRate = document.getElementById('resRate');
  uiEls.tideState = document.getElementById('tideState');
  uiEls.bCount = document.getElementById('bCount');

  // Three scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ad7ff);
  camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 1000);
  camera.position.set(0, 28, 40);

  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('canvas').appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0,2,0); controls.update();

  // lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9); scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6); dir.position.set(-10,20,10); scene.add(dir);

  // island
  const geom = new THREE.CylinderGeometry(22,24,6,40);
  const mat = new THREE.MeshStandardMaterial({color:0x4b7a29, flatShading:true});
  island = new THREE.Mesh(geom, mat); island.position.y = 0; scene.add(island);

  // top plane for placement
  const planeGeom = new THREE.PlaneGeometry(40,40,1,1);
  const planeMat = new THREE.MeshBasicMaterial({visible:false});
  topPlane = new THREE.Mesh(planeGeom, planeMat);
  topPlane.rotation.x = -Math.PI/2; topPlane.position.y = 3.1; topPlane.name = "topPlane";
  scene.add(topPlane);

  // water
  const waterGeom = new THREE.CircleGeometry(70,64);
  const waterMat = new THREE.MeshStandardMaterial({color:0x1e90ff, transparent:true, opacity:0.75});
  water = new THREE.Mesh(waterGeom, waterMat); water.rotation.x = -Math.PI/2; water.position.y = -1.5; scene.add(water);

  // event listeners
  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  // resource loop
  setInterval(()=>{ resources.timber += Math.max(0, Math.floor(resRate)); updateUI(); }, 1000);

  // tide manager
  TideManager.init();

  // restore if auto-load
  // UI binding
  bindUI();
  updateUI();

  // start audio engine on first user gesture due to browser autoplay policies
  // moved to explicit unlock handler
  // window.addEventListener('pointerdown', ()=>{ AudioEngine.init(); }, {once:true});
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
  document.getElementById('settingsBtn').addEventListener('click', ()=>{ alert('Settings placeholder'); });
  window.addEventListener('keydown', (e)=>{ if(e.key==='r' || e.key==='R') removeLastBuilding(); });

  // overlay unlock touch
  const overlay = document.getElementById('startOverlay');
  overlay.addEventListener('pointerdown', (e)=>{ e.preventDefault(); unlockInteraction(); }, {passive:false});
}

// unlock interaction handler
function unlockInteraction(){
  if(unlocked) return;
  unlocked = true;
  // init audio
  AudioEngine.init();
  // hide overlay and show title UI
  const overlay = document.getElementById('startOverlay');
  overlay.classList.add('hidden');
  document.getElementById('titleScreen').classList.remove('hidden');
  // enable main title buttons
  document.getElementById('startBtn').disabled = false;
  document.getElementById('loadBtn').disabled = false;
  document.getElementById('howBtn').disabled = false;
}

// pointer down
function onPointerDown(e){
  if(!unlocked) return; // ignore until unlocked
  if(isRaidActive){
    // deploy squad click (increase raid score and tiny reward)
    raidScore += 1;
    resources.timber += 2;
    updateUI();
    return;
  }
  mouse.x = (e.clientX/window.innerWidth)*2 -1;
  mouse.y = - (e.clientY/window.innerHeight)*2 +1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);
  for(let it of intersects){
    if(it.object.name === 'topPlane'){
      placeBuilding(it.point);
      return;
    }
    // check building click for upgrade
    if(it.object.userData && it.object.userData.buildingId){
      upgradeBuilding(it.object.userData.buildingId);
      return;
    }
  }
}

// place building
function placeBuilding(pos){
  const type = selectedBuildType || 'hut';
  const cost = Number(document.querySelector('.buildItem[data-type="'+type+'"]').dataset.cost);
  if(resources.timber < cost){ alert('Not enough timber!'); return; }
  resources.timber -= cost;
  const bgeo = new THREE.BoxGeometry(2,2,2);
  const bmat = new THREE.MeshStandardMaterial({color: type==='hut' ? 0x8b4513 : 0xcccccc});
  const mesh = new THREE.Mesh(bgeo, bmat);
  mesh.position.set(Math.round(pos.x), 4.0, Math.round(pos.z));
  const id = Date.now() + '_' + Math.floor(Math.random()*9999);
  mesh.userData = { buildingId: id, type: type, level: 1 };
  buildings.push(mesh);
  scene.add(mesh);
  recalcRates();
  updateUI();
}

// upgrade building
function upgradeBuilding(buildingId){
  const idx = buildings.findIndex(b=>b.userData.buildingId===buildingId);
  if(idx===-1) return;
  const b = buildings[idx];
  const lvl = b.userData.level;
  const baseCost = b.userData.type === 'hut' ? 8 : 25;
  const cost = Math.floor(baseCost * Math.pow(1.7, lvl));
  if(resources.timber < cost){ alert('Not enough timber to upgrade! Need ' + cost); return; }
  resources.timber -= cost;
  b.userData.level += 1;
  // visual upgrade: scale and color shift
  b.scale.y = 1 + b.userData.level * 0.25;
  b.material.color.setHSL(0.07 - b.userData.level*0.02, 0.6, 0.3);
  recalcRates();
  updateUI();
}

// remove last building
function removeLastBuilding(){
  if(buildings.length===0) return;
  const last = buildings.pop();
  scene.remove(last);
  recalcRates();
  updateUI();
}

// recalc resource rates based on huts and mills and tide
function recalcRates(){
  let huts = buildings.filter(b=>b.userData.type==='hut').length;
  let mills = buildings.filter(b=>b.userData.type==='mill').length;
  // base rate per hut grows with level
  let hutRate = 0.2;
  for(let b of buildings.filter(x=>x.userData.type==='hut')) hutRate += (b.userData.level-1) * 0.05;
  resRate = huts * hutRate + mills * 0.6;
  // tide bonuses: low tide gives +10% resource, high tide -10% (example)
  if(TideManager.current==='Low') resRate *= 1.10;
  if(TideManager.current==='High') resRate *= 0.90;
  uiEls.resRate.innerText = resRate.toFixed(2);
}

// Raid mode
function startRaid(){
  if(isRaidActive) return;
  isRaidActive = true;
  raidScore = 0;
  raidEndTime = Date.now() + 20000; // 20s raid
  document.getElementById('attackBtn').innerText = 'Raid Active...';
  // camera shift: zoom in
  const from = { z: camera.position.z, y: camera.position.y };
  const to = { z: 18, y: 18 };
  // simple tween (no lib)
  let t0 = Date.now();
  const dur = 500;
  const iv = setInterval(()=>{
    let t = (Date.now()-t0)/dur; if(t>1) t=1;
    camera.position.z = from.z + (to.z-from.z)*t;
    camera.position.y = from.y + (to.y-from.y)*t;
    controls.update();
    if(t===1){ clearInterval(iv); }
  },16);
  // end raid after time
  const raidTick = setInterval(()=>{
    if(Date.now()>raidEndTime){
      clearInterval(raidTick); endRaid(); 
    }
  },200);
}

function endRaid(){
  isRaidActive = false;
  // reward based on raidScore and buildings
  const reward = Math.max(5, Math.floor(raidScore * 2 + buildings.length * 1));
  resources.timber += reward;
  alert('Raid finished! Score:' + raidScore + ' Reward Timber: ' + reward);
  document.getElementById('attackBtn').innerText = 'Start Raid';
  updateUI();
  // restore camera
  camera.position.set(0,28,40);
  controls.update();
}

// save/load
function saveGame(){
  const data = {
    resources: resources,
    buildings: buildings.map(b=>({id:b.userData.buildingId, pos:b.position.toArray(), type:b.userData.type, level:b.userData.level})),
    tideIndex: TideManager.currentIndex,
    timestamp: Date.now()
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function loadGame(){
  const raw = localStorage.getItem(SAVE_KEY);
  if(!raw){ alert('No save found'); return; }
  try{
    const data = JSON.parse(raw);
    // clear current
    buildings.forEach(b=>scene.remove(b));
    buildings = [];
    resources = data.resources || { timber:50 };
    // recreate buildings
    for(const bb of data.buildings || []){
      const bgeo = new THREE.BoxGeometry(2,2,2);
      const bmat = new THREE.MeshStandardMaterial({color: 0x8b4513});
      const mesh = new THREE.Mesh(bgeo, bmat);
      mesh.position.fromArray(bb.pos);
      mesh.userData = { buildingId: bb.id, type: bb.type, level: bb.level };
      mesh.scale.y = 1 + bb.level * 0.25;
      scene.add(mesh);
      buildings.push(mesh);
    }
    // tide index restore
    TideManager.currentIndex = data.tideIndex || 0;
    TideManager.current = TideManager.states[TideManager.currentIndex];
    recalcRates();
    updateUI();
    alert('Loaded save');
  }catch(e){ alert('Load failed'); console.error(e); }
}

// UI helpers
function updateUI(){
  uiEls.resCount.innerText = Math.floor(resources.timber);
  uiEls.tideState.innerText = TideManager.current;
  document.getElementById('tideState').innerText = TideManager.current;
  document.getElementById('resCount').innerText = Math.floor(resources.timber);
}

// game open
function openGame(){
  document.getElementById('titleScreen').classList.add('hidden');
  document.getElementById('ui').classList.remove('hidden');
  // auto start resource loop to add fractional rate
  setInterval(()=>{
    resources.timber += resRate;
    updateUI();
  }, 1000);
  recalcRates();
}

// modal
function showModal(title, html){ document.getElementById('modalTitle').innerText = title; document.getElementById('modalBody').innerHTML = html; document.getElementById('modal').classList.remove('hidden'); }
function closeModal(){ document.getElementById('modal').classList.add('hidden'); }

// init
window.addEventListener('load', ()=>{ init(); animate(); });
window.addEventListener('resize', onWindowResize);
