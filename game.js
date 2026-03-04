import * as THREE from 'three';
import { Army } from './army.js';
import { UNIT_TYPES } from './unit.js';

class Game {
    constructor(selectedUnits = null, level = null, levelIndex = -1, isTutorial = false) {
        console.log('Game constructor received selectedUnits:', selectedUnits); // Debug log
        
        this.levelIndex = levelIndex; // Store the index of the level being played
        this.isTutorial = !!isTutorial; // NEW: tutorial mode flag
        this.enemyPausedForTutorialArmy = false; // NEW: pause enemy during tutorial army build
        // NEW: extra tutorial-only economy helpers
        this.tutorialExtraIncomeActive = false;
        this.tutorialExtraIncomeLastTime = 0;
        this.tutorialBonusMinersSpawned = false;
        // NEW: battle start flag - campaign battles begin only after START BATTLE is pressed
        this.battleStarted = this.isTutorial ? true : false;
        
        // Ensure canvas element exists before creating the game - FIXED NULL CHECK
        const canvas = document.getElementById('game-canvas');
        if (!canvas) {
            console.error('Game canvas not found! Cannot start game.');
            return;
        }
        
        // Simple canvas reset without aggressive context clearing
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        // Initialize Three.js components with better error handling
        try {
            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            this.renderer = new THREE.WebGLRenderer({ 
                canvas: canvas, 
                antialias: true,
                alpha: false,
                premultipliedAlpha: false,
                preserveDrawingBuffer: false
            });
            
            if (!this.renderer || !this.renderer.domElement) {
                throw new Error('WebGL renderer failed to initialize');
            }
            
            console.log('WebGL renderer initialized successfully');
        } catch (error) {
            console.error('Failed to initialize WebGL:', error);
            alert('Failed to initialize 3D graphics. Please try refreshing the page.');
            return;
        }
        
        // Slightly higher and further back camera for a better valley overview
        this.cameraBasePosition = { x: 0, y: 12, z: 22 };
        this.cameraOffset = 0;
        this.cameraSpeed = 10;
        
        this.keys = {};
        this.lastTime = 0;
        this.score = 0;
        this.gameOver = false;

        // Camera screenshake state
        this.shakeTime = 0;
        this.shakeDuration = 0;
        this.shakeIntensity = 0;
        // NEW: tutorial state
        this.isTutorialScriptedEncounterActive = false;
        this.tutorialStep = 0;
        this.tutorialOverlay = null;
        
        // Level configuration
        this.level = level || { difficulty: 1, enemyUnits: 5, rewards: { coins: 10, xp: 5 } };
        
        // Music system - for tutorial we start immediately, for campaign we wait for START BATTLE
        if (this.isTutorial) {
            this.setupMusic();
        }
        
        // Fog & warzone effects
        this.scene.fog = new THREE.FogExp2(0x050816, 0.012);
        
        // Fix start time for enemy economy
        this.gameStartTime = Date.now();
        
        // Fix: Ensure selected units are used properly and always include miner if not in selection
        if (selectedUnits && selectedUnits.length > 0) {
            this.availableUnits = [...selectedUnits];
            // Always ensure miner is available in battle for economy
            if (!this.availableUnits.includes('miner')) {
                this.availableUnits.push('miner');
            }
        } else {
            this.availableUnits = ['grunt', 'assault', 'miner'];
        }
        
        console.log('Game initialized with available units:', this.availableUnits); // Debug log
        
        this.bases = {
            player: { health: 10000, maxHealth: 10000, position: new THREE.Vector3(-15, 0, 0) }, // 5x health
            enemy: { health: 10000, maxHealth: 10000, position: new THREE.Vector3(15, 0, 0) } // 5x health
        };
        
        this.resources = 100; // Increased starting resources
        
        // REVISED Enemy Economy System
        this.enemyResources = 100; // Start with 100 resources
        this.enemyResourceGeneration = 5;
        this.enemyResourceInterval = 6000;
        this.enemyLastResourceGen = Date.now();
        
        // REVISED Enemy Spawning System
        this.enemySpawnInterval = 3000; // Start fast - 3 seconds
        this.enemyLastSpawn = Date.now();
        this.enemyMinersSpawned = 0;
        this.enemyMaxMiners = 1;
        this.enemySpawnPhase = 'initial_rush'; // New phase
        this.enemyPhaseStartTime = Date.now();
        this.enemyBuildupDuration = 60000;
        this.enemyAttackDuration = 45000;
        this.enemyUnitsThisPhase = 0;
        this.enemyTotalWaves = 0; // Track total waves for progressive difficulty
        
        // Enemy spawn cooldown system
        this.enemyUnitCooldown = 0;
        this.enemyLastUnitSpawn = Date.now();
        
        // Unit Selection System
        this.selectedUnits = [];
        this.selectionBox = null;
        this.isSelecting = false;
        this.selectionStart = { x: 0, y: 0 };
        this.moveTarget = null;
        this.moveTargetMesh = null;
        this.moveTargetGlow = null;
        this.targetPulseTime = 0;
        
        // Unit stance system
        this.currentStance = 'defend';

        // Spawn Cooldown System
        this.unitCooldowns = {}; // { unitType: timestamp }

        this.init();
    }
    
    // NEW: simple camera screenshake helper
    shakeCamera(intensity = 0.4, durationSeconds = 0.3) {
        // If another stronger shake is already active, keep it
        if (this.shakeTime > 0 && this.shakeIntensity > intensity) return;
        this.shakeIntensity = intensity;
        this.shakeDuration = durationSeconds;
        this.shakeTime = durationSeconds;
    }
    
    // NEW: explicit battle start for campaign (called after START BATTLE on VS screen)
    startBattle() {
        if (this.battleStarted) return;
        this.battleStarted = true;

        // Reset timers so build-up doesn't count the VS screen time
        const now = Date.now();
        this.gameStartTime = now;
        this.lastResourceTime = now;
        this.enemyLastResourceGen = now;
        this.enemyLastSpawn = now;
        this.enemyPhaseStartTime = now;

        // Start battle music now
        this.setupMusic();
    }
    
    setupMusic() {
        // Stop all music first
        document.querySelectorAll('audio').forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });
        
        // Play battle music based on level difficulty
        let musicId;
        if (this.level.difficulty <= 2) {
            // 50/50 chance between star 0-2 songs
            musicId = Math.random() < 0.5 ? 'battle-music-1' : 'battle-music-2';
        } else if (this.level.difficulty <= 4) {
            // 50/50 chance between star 3-4 songs
            musicId = Math.random() < 0.5 ? 'battle-music-3' : 'battle-music-4';
        } else {
            // Star 5 song
            musicId = 'battle-music-5';
        }
        
        const battleMusic = document.getElementById(musicId);
        if (battleMusic) {
            battleMusic.volume = 0.3;
            battleMusic.play().catch(e => console.log('Music autoplay blocked:', e));
        }
    }
    
    init() {
        // Setup renderer with proper initialization and error handling
        try {
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            // Dark, smoky sky color for warzone
            this.renderer.setClearColor(0x050816);
            
            // Add context loss handler
            const canvas = this.renderer.domElement;
            canvas.addEventListener('webglcontextlost', (event) => {
                event.preventDefault();
                console.error('WebGL context lost!');
                alert('Graphics error occurred. Returning to menu...');
                this.cleanup();
                setTimeout(() => window.showMainMenu(), 1000);
            });
            
            canvas.addEventListener('webglcontextrestored', () => {
                console.log('WebGL context restored');
                this.init();
            });
            
            console.log('Renderer setup complete');
        } catch (error) {
            console.error('Failed to setup renderer:', error);
            alert('Failed to initialize graphics. Returning to menu...');
            setTimeout(() => window.showMainMenu(), 1000);
            return;
        }
        
        // Setup camera
        this.camera.position.set(this.cameraBasePosition.x, this.cameraBasePosition.y, this.cameraBasePosition.z);
        // Look slightly down into the valley center
        this.camera.lookAt(0, -2, 0);
        
        // Setup scene
        this.setupLighting();
        this.setupTerrain();
        this.setupBases();
        this.setupScenery();
        
        // Setup armies
        this.playerArmy = new Army('player', this.scene, new THREE.Vector3(-12, 0, 0));
        this.enemyArmy = new Army('enemy', this.scene, new THREE.Vector3(12, 0, 0));
        
        // Initialize enemy with more starting resources
        this.enemyResources = 100; // Increased starting resources
        this.spawnInitialEnemyMiners();
        
        // Setup base collision hitboxes
        this.setupBaseHitboxes();
        
        // Setup controls
        this.setupControls();
        this.setupSelectionSystem();
        
        // Setup unit shop
        this.setupUnitShop();
        
        // Hide main menu and show game
        this.showGame();

        // NEW: tutorial-specific UI setup
        if (this.isTutorial) {
            this.setupTutorialUI();
        }
        
        // Force initial render to ensure scene is visible
        try {
            this.renderer.render(this.scene, this.camera);
            console.log('Initial render complete');
        } catch (error) {
            console.error('Failed to render scene:', error);
        }
        
        // Start game loop
        this.animate();
        
        // Update UI
        this.updateUI();
        
        // Initialize resource timer
        this.lastResourceTime = Date.now();
    }

    // NEW: tutorial overlay and initial guidance
    setupTutorialUI() {
        // Initially hide stance buttons and some UI pieces
        const stances = document.getElementById('unit-stances');
        const healthBars = document.getElementById('health-bars');
        const controls = document.getElementById('controls');
        if (stances) stances.classList.add('hidden');
        if (healthBars) healthBars.classList.add('hidden');
        if (controls) controls.classList.add('hidden');

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'tutorial-overlay';
        overlay.innerHTML = `
            <div class="tutorial-panel">
                <div class="tutorial-text" id="tutorial-text"></div>
                <div class="tutorial-tip" id="tutorial-subtext"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        this.tutorialOverlay = overlay;

        this.setTutorialStep(0);
    }

    // NEW: advance tutorial steps and update messaging/highlights
    setTutorialStep(step) {
        this.tutorialStep = step;
        const textEl = document.getElementById('tutorial-text');
        const subEl = document.getElementById('tutorial-subtext');

        // Clear highlights
        document.querySelectorAll('.unit-button').forEach(b => b.classList.remove('tutorial-highlight'));
        document.querySelectorAll('.stance-btn').forEach(b => b.classList.remove('tutorial-highlight'));

        if (!textEl || !subEl) return;

        if (step === 0) {
            textEl.textContent = 'Step 1: Build your economy.';
            subEl.textContent = 'Use A/D to look around the battlefield, then tap the Miner card to spawn a miner and start generating resources.';
            const minerBtn = document.getElementById('unit-miner');
            if (minerBtn) minerBtn.classList.add('tutorial-highlight');
        } else if (step === 1) {
            textEl.textContent = 'Step 2: Choose a strong defender.';
            subEl.textContent = 'Now tap the Rocketeer card to add a powerful backline unit.';
            const rocketeerBtn = document.getElementById('unit-rocketeer');
            if (rocketeerBtn) rocketeerBtn.classList.add('tutorial-highlight');
        } else if (step === 2) {
            textEl.textContent = 'Step 3: Add a frontline fighter.';
            subEl.textContent = 'Tap the Grunt card to spawn a basic frontline unit.';
            const gruntBtn = document.getElementById('unit-grunt');
            if (gruntBtn) gruntBtn.classList.add('tutorial-highlight');
        } else if (step === 3) {
            textEl.textContent = 'Incoming enemy units!';
            subEl.textContent = 'Watch how your squad defends automatically.';
            // Start scripted encounter once
            if (!this.isTutorialScriptedEncounterActive) {
                this.startScriptedEncounter();
            }
        } else if (step === 4) {
            textEl.textContent = 'Stances unlocked.';
            subEl.textContent = 'Use Defend, Attack, and Retreat to command all your units.';
            const stances = document.getElementById('unit-stances');
            if (stances) stances.classList.remove('hidden');
            // NEW: auto-advance after 6 seconds if still on this step
            if (this.isTutorial) {
                setTimeout(() => {
                    if (this.isTutorial && this.tutorialStep === 4) {
                        this.setTutorialStep(5);
                    }
                }, 6000);
            }
        } else if (step === 5) {
            textEl.textContent = 'Step 4: Build a real strike squad.';
            subEl.textContent = 'Spawn 2 more Grunts, a Commando, and a Colonel while the enemy pauses.';

            // Pause enemy activity during this army-build step
            if (this.isTutorial) {
                this.enemyPausedForTutorialArmy = true;
            }

            // Start tutorial-only secret extra income (10 resources / 5s)
            if (this.isTutorial) {
                this.tutorialExtraIncomeActive = true;
                this.tutorialExtraIncomeLastTime = Date.now();
            }

            // Secretly spawn 3 extra miners once to speed up this step
            if (this.isTutorial && !this.tutorialBonusMinersSpawned && this.playerArmy) {
                for (let i = 0; i < 3; i++) {
                    this.playerArmy.spawnUnit('miner');
                }
                this.tutorialBonusMinersSpawned = true;
            }

            const gruntBtn = document.getElementById('unit-grunt');
            const commandoBtn = document.getElementById('unit-commando');
            const colonelBtn = document.getElementById('unit-colonel');
            if (gruntBtn) gruntBtn.classList.add('tutorial-highlight');
            if (commandoBtn) commandoBtn.classList.add('tutorial-highlight');
            if (colonelBtn) colonelBtn.classList.add('tutorial-highlight');
        } else if (step === 6) {
            textEl.textContent = 'Final Step: Go on the offensive.';
            subEl.textContent = 'When you feel ready, switch to Attack stance and push toward the enemy base.';
            const healthBars = document.getElementById('health-bars');
            const controls = document.getElementById('controls');
            if (healthBars) healthBars.classList.remove('hidden');
            if (controls) controls.classList.remove('hidden');
            const attackBtn = document.getElementById('attack-stance');
            if (attackBtn) attackBtn.classList.add('tutorial-highlight');
        } else if (step === 7) {
            textEl.textContent = 'Now fight like in a real battle.';
            subEl.textContent = 'Defeat the enemy using what you just learned!';
            document.querySelectorAll('.unit-button').forEach(b => b.classList.remove('tutorial-highlight'));
            document.querySelectorAll('.stance-btn').forEach(b => b.classList.remove('tutorial-highlight'));
        }
    }

    // NEW: scripted encounter with 1 grunt and 1 assault
    startScriptedEncounter() {
        this.isTutorialScriptedEncounterActive = true;

        // Spawn one enemy grunt and one assault in front of enemy base
        const grunt = this.enemyArmy.spawnUnit('grunt');
        if (grunt && grunt.mesh) {
            grunt.mesh.position.set(10, 0, -2);
            // Ensure scripted grunt actually moves toward the player
            grunt.enemyPosition = 'attack';
            grunt.target = null;
            grunt.hasTarget = false;
            grunt.targetPosition = null;
        }

        // Reset enemy spawn cooldown so assault spawns immediately after grunt
        if (this.enemyArmy && typeof this.enemyArmy.spawnCooldown === 'number') {
            this.enemyArmy.lastSpawnTime = Date.now() - this.enemyArmy.spawnCooldown;
        }

        const assault = this.enemyArmy.spawnUnit('assault');
        if (assault && assault.mesh) {
            assault.mesh.position.set(10, 0, 2);
            // Ensure scripted assault also charges into battle
            assault.enemyPosition = 'attack';
            assault.target = null;
            assault.hasTarget = false;
            assault.targetPosition = null;
        }
    }
    
    setupBaseHitboxes() {
        // Create invisible collision boxes for bases
        const hitboxGeometry = new THREE.BoxGeometry(6, 8, 6);
        const hitboxMaterial = new THREE.MeshBasicMaterial({ 
            transparent: true, 
            opacity: 0,
            visible: false 
        });
        
        // Player base hitbox
        this.playerBaseHitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
        this.playerBaseHitbox.position.copy(this.bases.player.position);
        this.playerBaseHitbox.position.y = 4;
        this.scene.add(this.playerBaseHitbox);
        
        // Enemy base hitbox
        this.enemyBaseHitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
        this.enemyBaseHitbox.position.copy(this.bases.enemy.position);
        this.enemyBaseHitbox.position.y = 4;
        this.scene.add(this.enemyBaseHitbox);
    }
    
    checkBaseCollision(unit) {
        const enemyBase = unit.team === 'player' ? this.enemyBaseHitbox : this.playerBaseHitbox;
        const basePosition = unit.team === 'player' ? this.bases.enemy.position : this.bases.player.position;
        
        // Check if unit is trying to walk past the base
        const distanceToBase = unit.mesh.position.distanceTo(basePosition);
        
        // If unit is very close to base, stop them from walking past
        if (distanceToBase < 4) {
            // Force unit to target the base directly
            unit.target = unit.team === 'player' ? this.bases.enemy : this.bases.player;
            return true;
        }
        
        return false;
    }
    
    showGame() {
        // Ensure all other screens are hidden first
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('campaign-map').classList.add('hidden');
        document.getElementById('unit-selection').classList.add('hidden');
        document.getElementById('game-container').style.display = 'block';
    }
    
    setupLighting() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);
        
        // Directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 10, 5);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);
    }
    
    setupTerrain() {
        // Ground: broad plane, deformed into a shallow valley in the center
        const width = 600;
        const depth = 220;
        const segments = 80;
        const groundGeometry = new THREE.PlaneGeometry(width, depth, segments, segments);

        // Deform geometry so that the middle is lower and the far sides are raised
        const pos = groundGeometry.attributes.position;
        const halfW = width / 2;
        const halfD = depth / 2;
        const rimHeight = 6;   // how high the outer “walls” rise
        const valleySoftness = 1.4; // controls how gently it curves

        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i); // original plane X
            const y = pos.getY(i); // original plane Y (will become Z after rotation)

            const nx = x / halfW;   // -1..1 across
            const nz = y / halfD;   // -1..1 along

            // radial distance from center in X/Z, clamped 0..1
            const r = Math.min(1, Math.sqrt(nx * nx + nz * nz));

            // Height rises toward the edges, stays low in the middle (valley)
            const height = rimHeight * Math.pow(r, valleySoftness);

            // After rotation -Math.PI/2 about X, original Z becomes world Y,
            // so we store our height in original Z.
            pos.setZ(i, height);
        }
        pos.needsUpdate = true;
        groundGeometry.computeVertexNormals();

        // More grounded dirt/grass mix
        const groundMaterial = new THREE.MeshLambertMaterial({
            color: 0x3f7d3a,      // deeper green
            emissive: 0x1b4332,
            emissiveIntensity: 0.08
        });

        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
    }
    
    setupBases() {
        // Enhanced Player base
        const playerBaseGroup = new THREE.Group();
        
        // Main structure
        const baseGeometry = new THREE.BoxGeometry(3, 4, 3);
        const baseMaterial = new THREE.MeshLambertMaterial({ color: 0x0066ff });
        const playerBase = new THREE.Mesh(baseGeometry, baseMaterial);
        playerBase.position.y = 2;
        playerBaseGroup.add(playerBase);
        
        // Add towers
        for (let i = 0; i < 4; i++) {
            const towerGeometry = new THREE.CylinderGeometry(0.4, 0.6, 2, 8);
            const towerMaterial = new THREE.MeshLambertMaterial({ color: 0x004499 });
            const tower = new THREE.Mesh(towerGeometry, towerMaterial);
            const angle = (i / 4) * Math.PI * 2;
            tower.position.set(Math.cos(angle) * 2, 3, Math.sin(angle) * 2);
            playerBaseGroup.add(tower);
        }
        
        // Add flag
        const flagPoleGeometry = new THREE.CylinderGeometry(0.05, 0.05, 3, 8);
        const flagPoleMaterial = new THREE.MeshLambertMaterial({ color: 0x888888 });
        const flagPole = new THREE.Mesh(flagPoleGeometry, flagPoleMaterial);
        flagPole.position.set(0, 5.5, 0);
        playerBaseGroup.add(flagPole);
        
        const flagGeometry = new THREE.PlaneGeometry(1.5, 1);
        const flagMaterial = new THREE.MeshLambertMaterial({ color: 0x0066ff });
        const flag = new THREE.Mesh(flagGeometry, flagMaterial);
        flag.position.set(0.75, 6, 0);
        playerBaseGroup.add(flag);
        
        playerBaseGroup.position.copy(this.bases.player.position);
        playerBaseGroup.position.x = -34.5;
        playerBaseGroup.castShadow = true;
        this.scene.add(playerBaseGroup);
        this.bases.player.mesh = playerBaseGroup;
        this.bases.player.position.x = -34.5;
        
        // Enhanced Enemy base (similar structure but red)
        const enemyBaseGroup = new THREE.Group();
        
        // Replace simple blocks with detailed bases
        this.createDetailedBase(enemyBaseGroup, 'enemy');

        enemyBaseGroup.position.copy(this.bases.enemy.position);
        enemyBaseGroup.position.x = 34.5;
        enemyBaseGroup.castShadow = true;
        this.scene.add(enemyBaseGroup);
        this.bases.enemy.mesh = enemyBaseGroup;
        this.bases.enemy.position.x = 34.5;
    }

    createDetailedBase(group, team) {
        const color = team === 'player' ? 0x0066ff : 0xff3300;
        const secondaryColor = team === 'player' ? 0x004499 : 0xcc2200;
        const detailColor = 0x888888;

        // Main Keep
        const keepGeo = new THREE.BoxGeometry(5, 6, 5);
        const keepMat = new THREE.MeshLambertMaterial({ color: color });
        const keep = new THREE.Mesh(keepGeo, keepMat);
        keep.position.y = 3;
        group.add(keep);

        // Defensive Walls
        const wallGeo = new THREE.BoxGeometry(2, 4, 8);
        const wallMat = new THREE.MeshLambertMaterial({ color: secondaryColor });
        const leftWall = new THREE.Mesh(wallGeo, wallMat);
        leftWall.position.set(0, 2, -4);
        group.add(leftWall);
        const rightWall = new THREE.Mesh(wallGeo, wallMat);
        rightWall.position.set(0, 2, 4);
        group.add(rightWall);

        // Turrets (Visual only)
        const turretBaseGeo = new THREE.CylinderGeometry(1, 1.2, 3, 6);
        const turretMat = new THREE.MeshLambertMaterial({ color: detailColor });
        const turret1 = new THREE.Mesh(turretBaseGeo, turretMat);
        turret1.position.set(-3, 1.5, 3);
        group.add(turret1);
        const turret2 = new THREE.Mesh(turretBaseGeo, turretMat);
        turret2.position.set(-3, 1.5, -3);
        group.add(turret2);

        // Roof details
        const roofGeo = new THREE.ConeGeometry(4, 3, 4);
        const roofMat = new THREE.MeshLambertMaterial({ color: secondaryColor });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(0, 7.5, 0);
        roof.rotation.y = Math.PI / 4;
        group.add(roof);

        // Flag
        const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 6);
        const pole = new THREE.Mesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0xcccccc }));
        pole.position.set(0, 8, 0);
        group.add(pole);

        const flagGeo = new THREE.PlaneGeometry(2, 1.2);
        const flag = new THREE.Mesh(flagGeo, new THREE.MeshLambertMaterial({ color: color, side: THREE.DoubleSide }));
        flag.position.set(1, 10.4, 0);
        group.add(flag);
    }
    
    setupScenery() {
        // Add mountains in the background
        this.createMountains();
        
        // Add MANY more trees around the battlefield
        this.createTrees();
        
        // Add grass elements
        this.createGrass();
        
        // Add decorative clouds
        this.createClouds();
        
        // NEW: warzone vehicles and background explosions
        this.vehicles = [];
        this.backgroundExplosionCooldown = 0;
        this.createWarVehicles();
        
        // NEW: muddy patches along the valley floor for extra detail
        this.createMudPatches();
    }
    
    createClouds() {
        for(let i=0; i<15; i++) {
            const cloudGeo = new THREE.SphereGeometry(4 + Math.random()*3, 8, 8);
            const cloudMat = new THREE.MeshBasicMaterial({ 
                color: 0xffffff, 
                transparent: true, 
                opacity: 0.4 
            });
            const cloud = new THREE.Mesh(cloudGeo, cloudMat);
            
            cloud.position.set(
                (Math.random()-0.5) * 200,
                25 + Math.random() * 10,
                -40 + (Math.random()-0.5) * 60
            );
            
            // Add a few puffs to make it fluffy
            const puff1 = cloud.clone();
            puff1.position.x += 3;
            puff1.scale.set(0.7, 0.7, 0.7);
            cloud.add(puff1);
            
            const puff2 = cloud.clone();
            puff2.position.x -= 3;
            puff2.scale.set(0.7, 0.7, 0.7);
            cloud.add(puff2);
            
            this.scene.add(cloud);
            
            // Animate clouds (slower to keep sky more static under fog)
            const speed = 0.2 + Math.random() * 0.4;
            const animateCloud = () => {
                if(!this.scene) return;
                cloud.position.x += speed * 0.016;
                if(cloud.position.x > 150) cloud.position.x = -150;
                requestAnimationFrame(animateCloud);
            };
            animateCloud();
        }
    }
    
    createMountains() {
        // Create mountain silhouettes in the background
        for (let i = 0; i < 36; i++) { 
            const mountainGeometry = new THREE.ConeGeometry(
                Math.random() * 15 + 10, 
                Math.random() * 20 + 25, 
                8
            );
            // Greyscale mountain colors as requested
            const mountainColors = [0x4b5563, 0x6b7280, 0x9ca3af];
            const mountainColor = mountainColors[Math.floor(Math.random() * mountainColors.length)];
            const mountainMaterial = new THREE.MeshLambertMaterial({ color: mountainColor });
            const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);
            
            // Position mountains far in background
            mountain.position.x = (Math.random() - 0.5) * 600; // Spread wider
            mountain.position.z = -80 - Math.random() * 60; // Far behind battlefield
            mountain.position.y = 12.5; // Half height above ground
            
            // Add some snow caps to tall mountains
            if (mountain.geometry.parameters.height > 35 && Math.random() < 0.3) {
                const snowCapGeometry = new THREE.ConeGeometry(
                    mountain.geometry.parameters.radiusTop,
                    mountain.geometry.parameters.height * 0.3,
                    8
                );
                const snowCapMaterial = new THREE.MeshLambertMaterial({ color: 0xFFFAFA });
                const snowCap = new THREE.Mesh(snowCapGeometry, snowCapMaterial);
                snowCap.position.y = mountain.geometry.parameters.height * 0.35;
                mountain.add(snowCap);
            }
            
            mountain.castShadow = true;
            this.scene.add(mountain);
        }
        
        // Add more mountains in the foreground background
        for (let i = 0; i < 24; i++) {
            const mountainGeometry = new THREE.ConeGeometry(
                Math.random() * 12 + 8,
                Math.random() * 18 + 20,
                8
            );
            const mountainColors = [0x374151, 0x4b5563];
            const mountainColor = mountainColors[Math.floor(Math.random() * mountainColors.length)];
            const mountainMaterial = new THREE.MeshLambertMaterial({ color: mountainColor });
            const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);
            
            mountain.position.x = (Math.random() - 0.5) * 500; // Spread wider
            mountain.position.z = 50 + Math.random() * 50; // Behind but closer
            mountain.position.y = 10;
            
            mountain.castShadow = true;
            this.scene.add(mountain);
        }
        
        // Add side mountains
        for (let i = 0; i < 18; i++) { 
            const mountainGeometry = new THREE.ConeGeometry(
                Math.random() * 10 + 6,
                Math.random() * 16 + 18,
                8
            );
            const mountainColors = [0x1f2937, 0x374151];
            const mountainColor = mountainColors[Math.floor(Math.random() * mountainColors.length)];
            const mountainMaterial = new THREE.MeshLambertMaterial({ color: mountainColor });
            const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);
            
            mountain.position.x = (Math.random() < 0.5 ? -1 : 1) * (200 + Math.random() * 80);
            mountain.position.z = (Math.random() - 0.5) * 120;
            mountain.position.y = 9;
            
            mountain.castShadow = true;
            this.scene.add(mountain);
        }
    }
    
    createTrees() {
        const treePositions = [];
        
        // Background trees - MUCH MORE EXTENSIVE COVERAGE
        for (let x = -230; x <= 230; x += 4) {
            for (let z = -50; z <= -30; z += 4) {
                if (Math.random() > 0.15) {
                    treePositions.push([x + (Math.random() - 0.5) * 3, 0, z + (Math.random() - 0.5) * 3]);
                }
            }
        }
        
        // Foreground trees - MUCH MORE EXTENSIVE COVERAGE
        for (let x = -230; x <= 230; x += 4) {
            for (let z = 30; z <= 50; z += 4) {
                if (Math.random() > 0.15) {
                    treePositions.push([x + (Math.random() - 0.5) * 3, 0, z + (Math.random() - 0.5) * 3]);
                }
            }
        }
        
        // Far background trees
        for (let x = -300; x <= 300; x += 8) {
            for (let z = -80; z <= -55; z += 6) {
                if (Math.random() > 0.3) {
                    treePositions.push([x + (Math.random() - 0.5) * 6, 0, z + (Math.random() - 0.5) * 4]);
                }
            }
        }
        
        // Far foreground trees
        for (let x = -300; x <= 300; x += 8) {
            for (let z = 55; z <= 80; z += 6) {
                if (Math.random() > 0.3) {
                    treePositions.push([x + (Math.random() - 0.5) * 6, 0, z + (Math.random() - 0.5) * 4]);
                }
            }
        }
        
        // Side trees - left side
        for (let x = -120; x <= -50; x += 5) {
            for (let z = -25; z <= 25; z += 5) {
                if (Math.random() > 0.25) {
                    treePositions.push([x + (Math.random() - 0.5) * 3, 0, z + (Math.random() - 0.5) * 4]);
                }
            }
        }
        
        // Side trees - right side
        for (let x = 50; x <= 120; x += 5) {
            for (let z = -25; z <= 25; z += 5) {
                if (Math.random() > 0.25) {
                    treePositions.push([x + (Math.random() - 0.5) * 3, 0, z + (Math.random() - 0.5) * 4]);
                }
            }
        }
        
        treePositions.forEach(pos => {
            this.createDetailedTree(new THREE.Vector3(...pos));
        });
        
        // Add rocks
        this.createRocks();
        
        // Add bushes
        this.createBushes();
    }
    
    createDetailedTree(position) {
        const treeGroup = new THREE.Group();
        
        // Trunk 
        const trunkGeometry = new THREE.CylinderGeometry(0.25, 0.4, 3, 8);
        const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x78350f }); // Richer brown
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = 1.5;
        trunk.castShadow = true;
        treeGroup.add(trunk);
        
        // Add visible roots
        for (let i = 0; i < 4; i++) {
            const rootGeometry = new THREE.CylinderGeometry(0.1, 0.15, 0.8, 6);
            const root = new THREE.Mesh(rootGeometry, trunkMaterial);
            const angle = (i / 4) * Math.PI * 2;
            root.position.x = Math.cos(angle) * 0.3;
            root.position.z = Math.sin(angle) * 0.3;
            root.position.y = 0.2;
            root.rotation.z = Math.cos(angle) * 0.4;
            root.rotation.x = Math.sin(angle) * 0.4;
            treeGroup.add(root);
        }
        
        // Multiple layers of leaves for fullness
        // Vibrant greens
        const greenShades = [0x16a34a, 0x22c55e, 0x15803d, 0x4ade80];
        
        // Main canopy
        const canopyGeometry = new THREE.SphereGeometry(1.8, 8, 8);
        const canopyColor = greenShades[Math.floor(Math.random() * greenShades.length)];
        const canopyMaterial = new THREE.MeshLambertMaterial({ color: canopyColor });
        const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
        canopy.position.y = 3.8;
        canopy.castShadow = true;
        treeGroup.add(canopy);
        
        // Additional leaf clusters
        for (let i = 0; i < 3; i++) {
            const clusterGeometry = new THREE.SphereGeometry(0.8 + Math.random() * 0.4, 6, 6);
            const clusterColor = greenShades[Math.floor(Math.random() * greenShades.length)];
            const clusterMaterial = new THREE.MeshLambertMaterial({ color: clusterColor });
            const cluster = new THREE.Mesh(clusterGeometry, clusterMaterial);
            const angle = (i / 3) * Math.PI * 2;
            cluster.position.x = Math.cos(angle) * 1.2;
            cluster.position.z = Math.sin(angle) * 1.2;
            cluster.position.y = 3.5 + (Math.random() * 0.5);
            cluster.castShadow = true;
            treeGroup.add(cluster);
        }
        
        // Branches sticking out
        for (let i = 0; i < 5; i++) {
            const branchGeometry = new THREE.CylinderGeometry(0.08, 0.12, 1.2, 6);
            const branch = new THREE.Mesh(branchGeometry, trunkMaterial);
            const angle = (i / 5) * Math.PI * 2;
            branch.position.x = Math.cos(angle) * 0.3;
            branch.position.z = Math.sin(angle) * 0.3;
            branch.position.y = 2.5 + (Math.random() * 0.5);
            branch.rotation.z = Math.cos(angle) * 0.6;
            branch.rotation.x = Math.sin(angle) * 0.6;
            treeGroup.add(branch);
            
            // Small leaf cluster at end of branch
            const leafClusterGeometry = new THREE.SphereGeometry(0.4, 6, 6);
            const leafClusterColor = greenShades[Math.floor(Math.random() * greenShades.length)];
            const leafCluster = new THREE.Mesh(leafClusterGeometry, new THREE.MeshLambertMaterial({ color: leafClusterColor }));
            leafCluster.position.x = Math.cos(angle) * 0.9;
            leafCluster.position.z = Math.sin(angle) * 0.9;
            leafCluster.position.y = 2.8 + (Math.random() * 0.3);
            treeGroup.add(leafCluster);
        }
        
        treeGroup.position.copy(position);
        
        // Gently lift trees in the distant background so they sit up on the raised rim
        if (Math.abs(position.z) > 35) {
            treeGroup.position.y += 2.5;
        }
        
        // Slightly upscale trees so they feel more substantial in the scene
        treeGroup.scale.set(1.15, 1.15, 1.15);
        this.scene.add(treeGroup);
        
        // NEW: some trees are on fire for stronger warzone vibes
        if (Math.random() < 0.08 && position.z < 0) {
            this.addTreeFire(treeGroup);
        }
    }

    addTreeFire(treeGroup) {
        // Enhanced fire: layered flames, smoke plume, and flying embers
        const fireGroup = new THREE.Group();

        // Core flame (inner, bright)
        const innerGeo = new THREE.ConeGeometry(0.45, 1.4, 10);
        const innerMat = new THREE.MeshBasicMaterial({
            color: 0xfff5a1,
            transparent: true,
            opacity: 0.95
        });
        const innerFlame = new THREE.Mesh(innerGeo, innerMat);
        innerFlame.position.set(0, 2.1, 0);
        fireGroup.add(innerFlame);

        // Mid flame (orange)
        const midGeo = new THREE.ConeGeometry(0.7, 2.0, 10);
        const midMat = new THREE.MeshBasicMaterial({
            color: 0xff7a1a,
            transparent: true,
            opacity: 0.85
        });
        const midFlame = new THREE.Mesh(midGeo, midMat);
        midFlame.position.set(0.05, 2.0, 0.05);
        fireGroup.add(midFlame);

        // Outer flame (dark red glow)
        const outerGeo = new THREE.ConeGeometry(0.95, 2.4, 10);
        const outerMat = new THREE.MeshBasicMaterial({
            color: 0xcc3300,
            transparent: true,
            opacity: 0.6
        });
        const outerFlame = new THREE.Mesh(outerGeo, outerMat);
        outerFlame.position.set(-0.05, 1.9, -0.05);
        fireGroup.add(outerFlame);

        // Flame glow sphere
        const glowGeo = new THREE.SphereGeometry(1.4, 12, 12);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xffe066,
            transparent: true,
            opacity: 0.35
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.set(0, 2.0, 0);
        fireGroup.add(glow);

        // Smoke plume (stacked faded spheres)
        const smokeColor = 0x444444;
        for (let i = 0; i < 5; i++) {
            const smokeGeo = new THREE.SphereGeometry(0.5 + i * 0.15, 8, 8);
            const smokeMat = new THREE.MeshBasicMaterial({
                color: smokeColor,
                transparent: true,
                opacity: 0.4 - i * 0.05
            });
            const smoke = new THREE.Mesh(smokeGeo, smokeMat);
            smoke.position.set(
                (Math.random() - 0.5) * 0.4,
                2.4 + i * 0.35,
                (Math.random() - 0.5) * 0.4
            );
            fireGroup.add(smoke);
        }

        // Embers (small glowing particles)
        const emberGeo = new THREE.SphereGeometry(0.05, 6, 6);
        const emberMat = new THREE.MeshBasicMaterial({
            color: 0xfff1b2,
            transparent: true,
            opacity: 0.9
        });
        const embers = [];
        for (let i = 0; i < 10; i++) {
            const ember = new THREE.Mesh(emberGeo, emberMat.clone());
            ember.position.set(
                (Math.random() - 0.5) * 0.5,
                2.0 + Math.random() * 0.5,
                (Math.random() - 0.5) * 0.5
            );
            fireGroup.add(ember);
            embers.push(ember);
        }

        treeGroup.add(fireGroup);

        // Animated flicker / movement
        const startTime = performance.now();
        const animateFire = () => {
            if (!treeGroup.parent || !this.scene) return;

            const t = (performance.now() - startTime) * 0.002;

            // Vertical jitter for flames
            innerFlame.scale.y = 0.9 + Math.sin(t * 8) * 0.15;
            midFlame.scale.y = 0.9 + Math.cos(t * 6.5) * 0.15;
            outerFlame.scale.y = 0.95 + Math.sin(t * 5.5) * 0.1;

            innerMat.opacity = 0.85 + Math.sin(t * 10) * 0.1;
            midMat.opacity = 0.75 + Math.cos(t * 9) * 0.1;
            outerMat.opacity = 0.55 + Math.sin(t * 7) * 0.08;
            glow.material.opacity = 0.3 + Math.sin(t * 4) * 0.05;

            // Slowly drift smoke upward
            fireGroup.children.forEach(child => {
                if (child !== innerFlame && child !== midFlame && child !== outerFlame && child !== glow) {
                    child.position.y += 0.002;
                }
            });

            // Ember drift upwards with fade + slight sideways motion
            embers.forEach((ember, idx) => {
                ember.position.y += 0.01 + Math.random() * 0.005;
                ember.position.x += (Math.random() - 0.5) * 0.005;
                ember.position.z += (Math.random() - 0.5) * 0.005;
                const baseOpacity = 0.6 + Math.sin(t * 5 + idx) * 0.2;
                ember.material.opacity = Math.max(0, baseOpacity);
                if (ember.position.y > 4.5) {
                    ember.position.y = 2.1 + Math.random() * 0.5;
                }
            });

            requestAnimationFrame(animateFire);
        };
        animateFire();
    }
    
    createRocks() {
        // Add rocks scattered around the battlefield and bigger boulders on the raised rim
        for (let i = 0; i < 110; i++) {
            const rockSize = 0.3 + Math.random() * 0.8;
            
            // Create irregular rock shape
            const rockGeometry = new THREE.SphereGeometry(rockSize, 6, 5);
            
            // Deform vertices for irregular shape
            const positions = rockGeometry.attributes.position;
            for (let j = 0; j < positions.count; j++) {
                const x = positions.getX(j);
                const y = positions.getY(j);
                const z = positions.getZ(j);
                
                const deform = 0.7 + Math.random() * 0.6;
                positions.setXYZ(j, x * deform, y * deform, z * deform);
            }
            rockGeometry.computeVertexNormals();
            
            // Lighter grey rocks for valley floor, darker for rim
            const rockColors = [0x94a3b8, 0x64748b, 0x475569];
            const rockColor = rockColors[Math.floor(Math.random() * rockColors.length)];
            const rockMaterial = new THREE.MeshLambertMaterial({ color: rockColor });
            const rock = new THREE.Mesh(rockGeometry, rockMaterial);
            
            // Position rocks around battlefield avoiding center combat zone
            rock.position.x = (Math.random() - 0.5) * 200;
            rock.position.z = (Math.random() - 0.5) * 60;
            rock.position.y = rockSize * 0.6;
            
            // Avoid placing in center combat area
            if (Math.abs(rock.position.x) < 40 && Math.abs(rock.position.z) < 15) {
                continue;
            }
            
            // If placed farther out in Z, treat as large background boulders and lift them
            if (Math.abs(rock.position.z) > 35) {
                rock.scale.multiplyScalar(1.8);
                rock.position.y += 2.5;
                rock.material.color.offsetHSL(0, 0, -0.15); // darken a bit
            }
            
            // Random rotation for variety
            rock.rotation.x = Math.random() * Math.PI;
            rock.rotation.y = Math.random() * Math.PI;
            rock.rotation.z = Math.random() * Math.PI;
            
            rock.castShadow = true;
            this.scene.add(rock);
        }
    }
    
    createBushes() {
        // Add bushes around the battlefield
        for (let i = 0; i < 60; i++) {
            const bushSize = 0.5 + Math.random() * 0.7;
            const bushGeometry = new THREE.SphereGeometry(bushSize, 8, 6);
            const bushColors = [0x228B22, 0x006400, 0x2E8B57];
            const bushColor = bushColors[Math.floor(Math.random() * bushColors.length)];
            const bushMaterial = new THREE.MeshLambertMaterial({ color: bushColor });
            const bush = new THREE.Mesh(bushGeometry, bushMaterial);
            
            bush.position.x = (Math.random() - 0.5) * 180;
            bush.position.z = (Math.random() - 0.5) * 50;
            bush.position.y = bushSize * 0.8;
            
            // Avoid center combat area
            if (Math.abs(bush.position.x) < 45 && Math.abs(bush.position.z) < 20) {
                continue;
            }
            
            bush.castShadow = true;
            this.scene.add(bush);
        }
    }
    
    createGrass() {
        // Create varied grass patches
        const grassColors = [0x22c55e, 0x4ade80, 0x86efac];
        
        for (let i = 0; i < 300; i++) {
            const grassType = Math.random();
            let grassGeometry, grassMaterial;
            
            if (grassType < 0.4) {
                // Blade style grass
                grassGeometry = new THREE.PlaneGeometry(0.3, 0.6);
                grassMaterial = new THREE.MeshLambertMaterial({ 
                    color: grassColors[Math.floor(Math.random() * grassColors.length)],
                    transparent: true,
                    opacity: 0.85,
                    side: THREE.DoubleSide
                });
            } else if (grassType < 0.7) {
                // Wider patch grass
                grassGeometry = new THREE.PlaneGeometry(0.8, 0.5);
                grassMaterial = new THREE.MeshLambertMaterial({ 
                    color: grassColors[Math.floor(Math.random() * grassColors.length)],
                    transparent: true,
                    opacity: 0.75,
                    side: THREE.DoubleSide
                });
            } else {
                // Small cluster
                grassGeometry = new THREE.PlaneGeometry(0.4, 0.9);
                grassMaterial = new THREE.MeshLambertMaterial({ 
                    color: grassColors[Math.floor(Math.random() * grassColors.length)],
                    transparent: true,
                    opacity: 0.8,
                    side: THREE.DoubleSide
                });
            }
            
            const grass = new THREE.Mesh(grassGeometry, grassMaterial);
            
            // EXPANDED grass coverage
            grass.position.x = (Math.random() - 0.5) * 140;
            grass.position.z = (Math.random() - 0.5) * 36;
            grass.position.y = 0.01;
            grass.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.3;
            grass.rotation.z = Math.random() * Math.PI * 2;
            
            this.scene.add(grass);
        }
        
        // Add some 3D grass tufts for variety
        for (let i = 0; i < 100; i++) {
            const tuftGeometry = new THREE.ConeGeometry(0.15, 0.6, 4);
            const tuftColor = grassColors[Math.floor(Math.random() * grassColors.length)];
            const tuftMaterial = new THREE.MeshLambertMaterial({ color: tuftColor });
            const tuft = new THREE.Mesh(tuftGeometry, tuftMaterial);
            
            tuft.position.x = (Math.random() - 0.5) * 140;
            tuft.position.z = (Math.random() - 0.5) * 36;
            tuft.position.y = 0.3;
            tuft.rotation.z = (Math.random() - 0.5) * 0.3;
            
            this.scene.add(tuft);
        }
    }
    
    // NEW: muddy patches along the central valley floor
    createMudPatches() {
        if (!this.scene) return;

        const patchCount = 16;
        for (let i = 0; i < patchCount; i++) {
            // Keep mud near the main combat valley (center in Z)
            const x = (Math.random() - 0.5) * 80;
            const z = (Math.random() - 0.5) * 18;

            const radiusX = 4 + Math.random() * 4;
            const radiusZ = 2 + Math.random() * 3;

            const geo = new THREE.PlaneGeometry(radiusX, radiusZ, 1, 1);
            const mat = new THREE.MeshLambertMaterial({
                color: 0x5b4636,
                transparent: true,
                opacity: 0.9,
                side: THREE.DoubleSide
            });
            const patch = new THREE.Mesh(geo, mat);
            patch.rotation.x = -Math.PI / 2;

            // Slight random tilt so it doesn’t look perfectly flat
            patch.rotation.z = (Math.random() - 0.5) * 0.25;

            patch.position.set(x, 0.05, z);
            this.scene.add(patch);
        }
    }
    
    // NEW: simple background war vehicles moving across the horizon
    createWarVehicles() {
        if (!this.scene) return;
        
        const vehicles = [];
        
        const createTank = (startX, z, dir) => {
            const group = new THREE.Group();
            
            // Body
            const bodyGeo = new THREE.BoxGeometry(4, 1.2, 2.2);
            const bodyMat = new THREE.MeshLambertMaterial({ color: 0x374151 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 1;
            group.add(body);
            
            // Turret
            const turretGeo = new THREE.BoxGeometry(2, 0.8, 1.6);
            const turretMat = new THREE.MeshLambertMaterial({ color: 0x1f2937 });
            const turret = new THREE.Mesh(turretGeo, turretMat);
            turret.position.y = 1.7;
            group.add(turret);
            
            // Barrel
            const barrelGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.6, 8);
            const barrelMat = new THREE.MeshLambertMaterial({ color: 0x111827 });
            const barrel = new THREE.Mesh(barrelGeo, barrelMat);
            barrel.rotation.z = Math.PI / 2;
            barrel.position.set(1.7, 1.8, 0);
            group.add(barrel);
            
            // Wheels
            const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.8, 8);
            const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111827 });
            for (let i = -1; i <= 1; i++) {
                const leftWheel = new THREE.Mesh(wheelGeo, wheelMat);
                leftWheel.rotation.z = Math.PI / 2;
                leftWheel.position.set(-1.2 + i * 1.2, 0.4, -1.0);
                group.add(leftWheel);
                
                const rightWheel = leftWheel.clone();
                rightWheel.position.z = 1.0;
                group.add(rightWheel);
            }
            
            group.position.set(startX, 0, z);
            // Upscale tanks so they read better compared to units and environment
            group.scale.set(1.5, 1.5, 1.5);
            this.scene.add(group);
            
            vehicles.push({
                group,
                speed: dir * (6 + Math.random() * 4)
            });
        };
        
        const createTruck = (startX, z, dir) => {
            const group = new THREE.Group();
            
            // Cab
            const cabGeo = new THREE.BoxGeometry(2, 1.4, 1.8);
            const cabMat = new THREE.MeshLambertMaterial({ color: 0x9ca3af });
            const cab = new THREE.Mesh(cabGeo, cabMat);
            cab.position.set(-1.2, 1.1, 0);
            group.add(cab);
            
            // Trailer
            const trailerGeo = new THREE.BoxGeometry(4, 1.3, 1.9);
            const trailerMat = new THREE.MeshLambertMaterial({ color: 0x6b7280 });
            const trailer = new THREE.Mesh(trailerGeo, trailerMat);
            trailer.position.set(1.7, 1.0, 0);
            group.add(trailer);
            
            // Wheels
            const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.7, 8);
            const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111827 });
            for (let i = -1; i <= 1; i++) {
                const wheelFront = new THREE.Mesh(wheelGeo, wheelMat);
                wheelFront.rotation.z = Math.PI / 2;
                wheelFront.position.set(-1.4 + i * 1.2, 0.4, -1.0);
                group.add(wheelFront);
                
                const wheelBack = wheelFront.clone();
                wheelBack.position.z = 1.0;
                group.add(wheelBack);
            }
            
            group.position.set(startX, 0, z);
            // Upscale trucks as well to match tanks and make them visible
            group.scale.set(1.5, 1.5, 1.5);
            this.scene.add(group);
            
            vehicles.push({
                group,
                speed: dir * (5 + Math.random() * 3)
            });
        };
        
        // Place a few vehicles on far background lanes
        for (let i = 0; i < 3; i++) {
            createTank(-120 - i * 40, -35 - Math.random() * 10, 1);
            createTruck(120 + i * 40, 35 + Math.random() * 10, -1);
        }
        
        this.vehicles = vehicles;
    }
    
    setupSelectionSystem() {
        // Replace mouse selection with stance system
        const defendBtn = document.getElementById('defend-stance');
        const attackBtn = document.getElementById('attack-stance');
        const retreatBtn = document.getElementById('retreat-stance');
        
        defendBtn.addEventListener('click', () => {
            this.setAllUnitsStance('defend');
            this.updateStanceButtons('defend');
        });
        
        attackBtn.addEventListener('click', () => {
            this.setAllUnitsStance('attack');
            this.updateStanceButtons('attack');
        });
        
        retreatBtn.addEventListener('click', () => {
            this.setAllUnitsStance('retreat');
            this.updateStanceButtons('retreat');
        });
    }
    
    setAllUnitsStance(stance) {
        this.currentStance = stance;
        this.playerArmy.getAliveUnits().forEach(unit => {
            unit.stance = stance;
            unit.hasTarget = false;
            unit.targetPosition = null;
            unit.isPlayerControlled = false;
            unit.defendPosition = null;
            unit.attackPosition = null;
            
            // Reset wandering timer so units immediately move to new positions
            unit.lastWanderTime = 0;
            
            // Set immediate target positions based on stance
            if (stance === 'defend') {
                if (unit.unitType !== 'miner') {
                    const basePos = this.bases.player.position;
                    unit.targetPosition = new THREE.Vector3(
                        basePos.x + 8 + Math.random() * 6, // In front of base
                        0,
                        basePos.z + (Math.random() - 0.5) * 8
                    );
                    unit.hasTarget = true;
                    unit.isPlayerControlled = true;
                }
            } else if (stance === 'attack') {
                if (unit.unitType !== 'miner') {
                    const enemyPos = this.bases.enemy.position;
                    unit.targetPosition = new THREE.Vector3(
                        enemyPos.x - 12 + (Math.random() - 0.5) * 6,
                        0,
                        enemyPos.z + (Math.random() - 0.5) * 8
                    );
                    unit.hasTarget = true;
                    unit.isPlayerControlled = true;
                    unit.attackPosition = unit.targetPosition.clone();
                }
            } else if (stance === 'retreat') {
                // All units including miners retreat behind base
                const basePos = this.bases.player.position;
                unit.targetPosition = new THREE.Vector3(
                    basePos.x - 8 - Math.random() * 6, // Behind base
                    0,
                    basePos.z + (Math.random() - 0.5) * 8
                );
                unit.hasTarget = true;
                unit.isPlayerControlled = true;
            }
        });
        
        console.log(`Set all units to ${stance} stance with wandering behavior`);
    }
    
    updateStanceButtons(activeStance) {
        document.querySelectorAll('.stance-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`${activeStance}-stance`).classList.add('active');
    }
    
    startSelection(e) {
        this.isSelecting = true;
        this.selectionStart = { x: e.clientX, y: e.clientY };
        this.selectionBox.style.left = e.clientX + 'px';
        this.selectionBox.style.top = e.clientY + 'px';
        this.selectionBox.style.width = '0px';
        this.selectionBox.style.height = 'px';
        this.selectionBox.style.display = 'block';
    }
    
    updateSelection(e) {
        if (!this.isSelecting) return;
        
        const width = Math.abs(e.clientX - this.selectionStart.x);
        const height = Math.abs(e.clientY - this.selectionStart.y);
        const left = Math.min(e.clientX, this.selectionStart.x);
        const top = Math.min(e.clientY, this.selectionStart.y);
        
        this.selectionBox.style.left = left + 'px';
        this.selectionBox.style.top = top + 'px';
        this.selectionBox.style.width = width + 'px';
        this.selectionBox.style.height = height + 'px';
    }
    
    endSelection(e) {
        if (!this.isSelecting) return;
        
        this.isSelecting = false;
        this.selectionBox.style.display = 'none';
        
        // Clear previous selection
        this.selectedUnits.forEach(unit => {
            if (unit.mesh) unit.mesh.material.emissive.setHex(0x000000);
        });
        this.selectedUnits = [];
        
        // Select units within selection box
        const rect = {
            left: Math.min(e.clientX, this.selectionStart.x),
            top: Math.min(e.clientY, this.selectionStart.y),
            right: Math.max(e.clientX, this.selectionStart.x),
            bottom: Math.max(e.clientY, this.selectionStart.y)
        };
        
        this.playerArmy.getAliveUnits().forEach(unit => {
            const screenPos = this.worldToScreen(unit.mesh.position);
            if (screenPos.x >= rect.left && screenPos.x <= rect.right &&
                screenPos.y >= rect.top && screenPos.y <= rect.bottom) {
                this.selectedUnits.push(unit);
                unit.mesh.material.emissive.setHex(0x004400);
            }
        });
    }
    
    moveSelectedUnits(e) {
        if (this.selectedUnits.length === 0) return;
        
        e.preventDefault(); // Prevent context menu
        
        const mouse = new THREE.Vector2();
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);
        
        // Create a ground plane for intersection
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersectPoint = new THREE.Vector3();
        
        if (raycaster.ray.intersectPlane(groundPlane, intersectPoint)) {
            console.log('Moving', this.selectedUnits.length, 'units to:', intersectPoint); // Debug log
            
            // Show movement target indicator - IMPROVED VISIBILITY
            this.moveTargetMesh.position.copy(intersectPoint);
            this.moveTargetMesh.position.y = 2.0; // Raised higher for visibility
            this.moveTargetMesh.visible = true;
            
            this.moveTargetGlow.position.copy(intersectPoint);
            this.moveTargetGlow.position.y = 1.8;
            this.moveTargetGlow.visible = true;
            
            this.targetPulseTime = 0;
            
            // Hide target after 12 seconds
            setTimeout(() => {
                if (this.moveTargetMesh) {
                    this.moveTargetMesh.visible = false;
                    this.moveTargetGlow.visible = false;
                }
            }, 12000);
            
            // Move selected units to target position with formation - FIXED WITH DEBUG
            this.selectedUnits.forEach((unit, index) => {
                if (unit && unit.mesh && unit.alive) {
                    const offsetX = (index % 4 - 1.5) * 4; // 4 units per row, wider spacing
                    const offsetZ = (Math.floor(index / 4) - 1) * 4;
                    const targetPos = new THREE.Vector3(
                        intersectPoint.x + offsetX,
                        0,
                        intersectPoint.z + offsetZ
                    );
                    
                    // FORCE CLEAR ANY EXISTING AI BEHAVIOR
                    unit.enemyPosition = null;
                    unit.target = null;
                    unit.hasTarget = false; // Clear first
                    unit.targetPosition = null; // Clear first
                    unit.isPlayerControlled = false; // Clear first
                    
                    // SET MOVEMENT TARGET WITH DEBUG - SET IN CORRECT ORDER
                    setTimeout(() => {
                        unit.targetPosition = targetPos.clone();
                        unit.hasTarget = true;
                        unit.isPlayerControlled = true; // Flag to prevent AI override
                        
                        console.log(`Unit ${index} (${unit.unitType}) at`, unit.mesh.position, 'moving to:', targetPos, 'isPlayerControlled:', unit.isPlayerControlled);
                    }, 50); // Small delay to ensure clearing happens first
                }
            });
        }
    }
    
    worldToScreen(worldPos) {
        const vector = worldPos.clone();
        vector.project(this.camera);
        
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;
        
        vector.x = (vector.x * widthHalf) + widthHalf;
        vector.y = -(vector.y * heightHalf) + heightHalf;
        
        return vector;
    }
    
    setupUnitShop() {
        const unitGrid = document.getElementById('unit-grid');
        
        // Clear existing unit buttons to prevent duplicates
        unitGrid.innerHTML = '';
        
        // Only show available units for this battle
        this.availableUnits.forEach(unitType => {
            const stats = UNIT_TYPES[unitType];
            const button = document.createElement('div');
            button.className = 'unit-button';
            
            // Get detailed unit information
            const unitInfo = this.getUnitDetailedInfo(unitType);
            
            button.innerHTML = `
                <div class="name">${stats.name}</div>
                <div class="cost">$${stats.cost}</div>
                <div class="hotkey">Key: ${stats.hotkey.toUpperCase()}</div>
                <div class="stats">
                    <div>HP: ${stats.health}</div>
                    <div>DMG: ${stats.attackDamage}</div>
                    <div>SPD: ${stats.speed.toFixed(1)}</div>
                    ${unitInfo.range > 0 ? `<div>RNG: ${unitInfo.range}</div>` : ''}
                </div>
                <div class="ability">${unitInfo.ability}</div>
                <div class="description">${unitInfo.description}</div>
            `;
            
            button.addEventListener('click', () => this.buyUnit(unitType));
            button.id = `unit-${unitType}`;
            unitGrid.appendChild(button);
        });
    }
    
    getUnitDetailedInfo(type) {
        const unitDetails = {
            miner: {
                ability: "Resource Generation",
                description: "Generates resources over time. Essential for economy.",
                range: 0
            },
            grunt: {
                ability: "Basic Infantry",
                description: "Reliable melee fighter. Good for frontline combat.",
                range: 0
            },
            assault: {
                ability: "Assault Rifle",
                description: "Medium-range fighter with balanced stats.",
                range: 120
            },
            medic: {
                ability: "Healing Aura",
                description: "Heals nearby friendly units continuously.",
                range: 80
            },
            grenadier: {
                ability: "Explosive Grenades",
                description: "Area damage specialist. Devastates grouped enemies.",
                range: 130
            },
            sniper: {
                ability: "Long Range Precision",
                description: "High damage, long range. 70% accuracy but deadly.",
                range: 250
            },
            sergeant: {
                ability: "Combat Veteran",
                description: "Tough leader with good range and damage.",
                range: 160
            },
            rocketeer: {
                ability: "Rocket Launcher", 
                description: "Massive area damage with splash effect.",
                range: 200
            },
            riot: {
                ability: "Shield & Stun",
                description: "Tank unit with shield protection and stun grenades.",
                range: 110
            },
            surgeon: {
                ability: "Battlefield Resurrection",
                description: "Every 6s, brings back a nearby fallen ally; if no one is down, it unleashes a huge AoE heal instead.",
                range: 150
            },
            colonel: {
                ability: "Unit Commander",
                description: "Elite leader that buffs nearby units and focuses fire.",
                range: 210
            },
            commando: {
                ability: "Elite Operative", 
                description: "Fast, deadly special forces unit with high mobility.",
                range: 160
            }
        };
        
        return unitDetails[type] || { ability: "Unknown", description: "No information available", range: 0 };
    }
    
    getUnitUpgradeLevel(unitType) {
        // Get upgrade level from player profile if available
        if (window.playerProfile && window.playerProfile.upgrades) {
            return window.playerProfile.upgrades[unitType] || 0;
        }
        return 0;
    }
    
    setupControls() {
        document.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
            
            if (e.key === ' ') {
                e.preventDefault();
                return;
            }
            
            // Unit hotkeys - only for available units
            this.availableUnits.forEach(unitType => {
                const stats = UNIT_TYPES[unitType];
                if (e.key === stats.hotkey) {
                    e.preventDefault();
                    this.buyUnit(unitType);
                }
            });
        });
        
        document.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }
    
    resetUnitsToDefend() {
        // Clear all unit targets and set them to defend
        this.playerArmy.getAliveUnits().forEach(unit => {
            unit.hasTarget = false;
            unit.targetPosition = null;
            unit.stance = 'defend';
        });
        document.querySelectorAll('.control-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById('defend-btn')?.classList.add('active');
    }
    
    setAllUnitsAttack() {
        // Clear all unit targets and set them to attack
        this.playerArmy.getAliveUnits().forEach(unit => {
            unit.hasTarget = false;
            unit.targetPosition = null;
            unit.stance = 'attack';
        });
        document.querySelectorAll('.control-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById('attack-btn')?.classList.add('active');
    }
    
    setAllUnitsRetreat() {
        // Clear all unit targets and set them to retreat
        this.playerArmy.getAliveUnits().forEach(unit => {
            unit.hasTarget = false;
            unit.targetPosition = null;
            unit.stance = 'retreat';
        });
        document.querySelectorAll('.control-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById('retreat-btn')?.classList.add('active');
    }
    
    buyUnit(unitType) {
        // Check if unit type is available for this battle
        if (!this.availableUnits.includes(unitType)) {
            return; // Unit not available in this battle
        }

        // Tutorial gating: force certain clicks in order
        if (this.isTutorial) {
            if (this.tutorialStep === 0 && unitType !== 'miner') {
                return;
            }
            if (this.tutorialStep === 1 && unitType !== 'rocketeer') {
                return;
            }
            if (this.tutorialStep === 2 && unitType !== 'grunt') {
                return;
            }
            // During the army-build step (step 5), only allow grunts, commando, and colonel
            if (this.tutorialStep === 5) {
                const allowed = ['grunt', 'commando', 'colonel'];
                if (!allowed.includes(unitType)) return;
            }
        }

        // Check cooldown
        const now = Date.now();
        if (this.unitCooldowns[unitType] && now < this.unitCooldowns[unitType]) {
            return; // On cooldown
        }
        
        const stats = UNIT_TYPES[unitType];
        if (!stats) return;
        
        const cost = stats.cost;
        
        if (this.resources >= cost) {
            const unit = this.playerArmy.spawnUnit(unitType);
            if (unit) {
                this.resources -= cost;
                
                // Set cooldown
                this.unitCooldowns[unitType] = now + stats.spawnCooldown;
                
                // Apply current stance to new unit
                unit.stance = this.currentStance;
                this.applyStanceToUnit(unit);
                this.updateUI();

                // Tutorial step progression based on correct clicks
                if (this.isTutorial) {
                    if (this.tutorialStep === 0 && unitType === 'miner') {
                        this.setTutorialStep(1);
                    } else if (this.tutorialStep === 1 && unitType === 'rocketeer') {
                        this.setTutorialStep(2);
                    } else if (this.tutorialStep === 2 && unitType === 'grunt') {
                        this.setTutorialStep(3);
                    }
                }
            }
        }
    }
    
    applyStanceToUnit(unit) {
        if (unit.stance === 'defend' && unit.unitType !== 'miner') {
            const basePos = this.bases.player.position;
            unit.targetPosition = new THREE.Vector3(
                basePos.x + 8 + Math.random() * 6, // In front of base
                0,
                basePos.z + (Math.random() - 0.5) * 8
            );
            unit.hasTarget = true;
            unit.isPlayerControlled = true;
        } else if (unit.stance === 'attack' && unit.unitType !== 'miner') {
            const enemyPos = this.bases.enemy.position;
            unit.targetPosition = new THREE.Vector3(
                enemyPos.x - 12 + (Math.random() - 0.5) * 6,
                0,
                enemyPos.z + (Math.random() - 0.5) * 8
            );
            unit.hasTarget = true;
            unit.isPlayerControlled = true;
            unit.attackPosition = unit.targetPosition.clone();
        } else if (unit.stance === 'retreat') {
            const basePos = this.bases.player.position;
            unit.targetPosition = new THREE.Vector3(
                basePos.x - 8 - Math.random() * 6, // Behind base
                0,
                basePos.z + (Math.random() - 0.5) * 8
            );
            unit.hasTarget = true;
            unit.isPlayerControlled = true;
        }
    }

    getBaseCount(unitType) {
        return 1;
    }
    
    getBaseCost(unitType) {
        return UNIT_TYPES[unitType]?.cost || 30;
    }

    summonUnits(type, count, baseCost) {
        // Remove this method as it's replaced by simplified buyUnit
    }
    
    spawnInitialEnemyMiners() {
        // Spawn 1 initial miner for economy
        if (this.enemyResources >= UNIT_TYPES.miner.cost) {
            const unit = this.enemyArmy.spawnUnit('miner');
            if (unit) {
                this.enemyResources -= UNIT_TYPES.miner.cost;
                unit.lastResourceCollection = Date.now();
                this.enemyMinerCount++;
            }
        }
        console.log('Enemy started with', this.enemyMinerCount, 'miners and', this.enemyResources, 'resources');
    }
    
    update(deltaTime) {
        if (this.gameOver) return;
        
        // Allow camera panning and background ambience BEFORE battle actually starts
        if (!this.battleStarted) {
            // Camera controls while waiting on VS screen
            if (this.keys['a']) {
                this.cameraOffset -= this.cameraSpeed * deltaTime;
            }
            if (this.keys['d']) {
                this.cameraOffset += this.cameraSpeed * deltaTime;
            }

            // Clamp camera offset
            this.cameraOffset = Math.max(-45, Math.min(45, this.cameraOffset));
            this.camera.position.x = this.cameraBasePosition.x + this.cameraOffset;

            // Apply subtle screenshake if any is active
            if (this.shakeTime > 0) {
                this.shakeTime = Math.max(0, this.shakeTime - deltaTime);
                const progress = this.shakeDuration > 0 ? (this.shakeTime / this.shakeDuration) : 0;
                const falloff = progress * progress; // fade out quickly
                const intensity = this.shakeIntensity * falloff;
                this.camera.position.x += (Math.random() - 0.5) * intensity;
                this.camera.position.y += (Math.random() - 0.5) * intensity * 0.6;
                this.camera.position.z += (Math.random() - 0.5) * intensity * 0.4;
            }

            // Animate background vehicles and random explosions even while paused
            if (this.vehicles && this.vehicles.length > 0) {
                this.vehicles.forEach(v => {
                    v.group.position.x += v.speed * deltaTime;
                    if (v.group.position.x > 120) {
                        v.group.position.x = -120;
                    } else if (v.group.position.x < -120) {
                        v.group.position.x = 120;
                    }
                });
            }
            return; // Do not run AI, spawning, or win checks until battle starts
        }
        
        // Update target pulse animation - ENHANCED
        if (this.moveTargetMesh && this.moveTargetMesh.visible) {
            this.targetPulseTime += deltaTime * 6;
            const scale = 1 + Math.sin(this.targetPulseTime) * 0.4;
            this.moveTargetMesh.scale.set(scale, 1, scale);
            this.moveTargetGlow.scale.set(scale * 0.8, 1, scale * 0.8);
            
            // Rotate for extra visibility
            this.moveTargetMesh.rotation.z += deltaTime * 2;
            this.moveTargetGlow.rotation.z -= deltaTime * 1.5;
        }
        
        // Camera controls - EXPANDED RANGE for larger battlefield
        if (this.keys['a']) {
            this.cameraOffset -= this.cameraSpeed * deltaTime;
        }
        if (this.keys['d']) {
            this.cameraOffset += this.cameraSpeed * deltaTime;
        }
        
        // Clamp camera offset - MUCH WIDER RANGE to see bases
        this.cameraOffset = Math.max(-45, Math.min(45, this.cameraOffset)); // Expanded from -35,35
        
        // Update camera position
        this.camera.position.x = this.cameraBasePosition.x + this.cameraOffset;
        this.camera.position.y = this.cameraBasePosition.y;
        this.camera.position.z = this.cameraBasePosition.z;
        
        // Apply screenshake during battle if active
        if (this.shakeTime > 0) {
            this.shakeTime = Math.max(0, this.shakeTime - deltaTime);
            const progress = this.shakeDuration > 0 ? (this.shakeTime / this.shakeDuration) : 0;
            const falloff = progress * progress;
            const intensity = this.shakeIntensity * falloff;
            this.camera.position.x += (Math.random() - 0.5) * intensity;
            this.camera.position.y += (Math.random() - 0.5) * intensity * 0.6;
            this.camera.position.z += (Math.random() - 0.5) * intensity * 0.4;
        }
        
        // Automatic resource generation (10 every 10 seconds) - INCREASED
        const now = Date.now();
        if (now - this.lastResourceTime >= 10000) {
            this.resources += 10; // Increased from 5
            this.lastResourceTime = now;
        }

        // Tutorial-only secret extra income during the army-build step (step 5)
        if (this.isTutorial && this.tutorialExtraIncomeActive) {
            if (now - this.tutorialExtraIncomeLastTime >= 5000) {
                this.resources += 10;
                this.tutorialExtraIncomeLastTime = now;
            }
        }
        
        // Update enemy economy and AI
        if (this.isTutorial && this.isTutorialScriptedEncounterActive) {
            // During scripted encounter, do NOT run full AI or spawning;
            // just wait for those two units to die, then continue.
            const liveEnemies = this.enemyArmy
                .getAliveUnits()
                .filter(u => u.unitType !== 'miner'); // ignore miners for scripted encounter progress
            if (liveEnemies.length === 0) {
                this.isTutorialScriptedEncounterActive = false;
                this.setTutorialStep(4); // Stances unlocked after win
            }
        } else {
            this.updateSimplifiedEnemyAI();
        }
        
        // Update armies with game instance reference
        const allUnits = [...this.playerArmy.getAliveUnits(), ...this.enemyArmy.getAliveUnits()];
        this.playerArmy.update(deltaTime, allUnits, this.bases, this);
        this.enemyArmy.update(deltaTime, allUnits, this.bases, this);
        
        // Tutorial-specific checks
        if (this.isTutorial) {
            this.updateTutorialProgress();
        }

        // Check win conditions
        this.checkWinConditions();
        
        // Update UI
        this.updateUI();
        
        // NEW: animate background vehicles and random explosions
        if (this.vehicles && this.vehicles.length > 0) {
            this.vehicles.forEach(v => {
                v.group.position.x += v.speed * deltaTime;
                if (v.group.position.x > 120) {
                    v.group.position.x = -120;
                } else if (v.group.position.x < -120) {
                    v.group.position.x = 120;
                }
            });
            
            this.backgroundExplosionCooldown -= deltaTime;
            if (this.backgroundExplosionCooldown <= 0) {
                this.spawnBackgroundExplosion();
                this.backgroundExplosionCooldown = 4 + Math.random() * 6;
            }
        }
    }

    // NEW: tutorial progression checks (miners count, stance usage)
    updateTutorialProgress() {
        if (this.tutorialStep === 5) {
            const grunts = this.playerArmy.getAliveUnits().filter(u => u.unitType === 'grunt').length;
            const commandos = this.playerArmy.getAliveUnits().filter(u => u.unitType === 'commando').length;
            const colonels = this.playerArmy.getAliveUnits().filter(u => u.unitType === 'colonel').length;
            // We already spawned 1 grunt earlier in the tutorial, so require total >=3
            if (grunts >= 3 && commandos >= 1 && colonels >= 1) {
                // Unpause enemy and move to attack stance step
                this.enemyPausedForTutorialArmy = false;
                this.tutorialExtraIncomeActive = false; // stop secret income
                this.setTutorialStep(6);
            }
        }

        if (this.tutorialStep === 6) {
            // Once player uses Attack stance at least once, unlock "real" fight
            const attackBtn = document.getElementById('attack-stance');
            if (attackBtn && attackBtn.classList.contains('active')) {
                this.setTutorialStep(7);
            }
        }
    }
    
    updateSimplifiedEnemyAI() {
        const now = Date.now();
        // Pause enemy completely during the tutorial army-build step
        if (this.isTutorial && this.enemyPausedForTutorialArmy) {
            return;
        }
        
        const enemyUnits = this.enemyArmy.getAliveUnits().filter(u => u.unitType !== 'miner');
        
        // STEP 1: Generate enemy resources
        if (now - this.enemyLastResourceGen >= this.enemyResourceInterval) {
            const gameTimeMinutes = (now - (this.gameStartTime || now)) / 60000;
            const bonusIncome = Math.floor(gameTimeMinutes * 3) + 5;
            this.enemyResources += (this.enemyResourceGeneration + bonusIncome);
            this.enemyLastResourceGen = now;
        }
        
        // STEP 2: Progressive spawn interval (very slight increase per wave)
        const baseInterval = 3000; // Start at 3 seconds
        const waveBonus = this.enemyTotalWaves * 50; // Each wave adds 50ms (very slight)
        this.enemySpawnInterval = Math.min(12000, baseInterval + waveBonus); // Cap at 12 seconds
        
        // STEP 3: Spawn units based on phase
        const timeSinceLastSpawn = now - this.enemyLastUnitSpawn;
        let currentInterval = this.enemySpawnInterval;
        
        // Phase-based spawn rate adjustments
        if (this.enemySpawnPhase === 'initial_rush') {
            currentInterval = 2000; // Very fast initial spawning
            
            // Switch to buildup after 20 seconds or 8 units
            const phaseElapsed = now - this.enemyPhaseStartTime;
            if (phaseElapsed > 20000 || this.enemyUnitsThisPhase >= 8) {
                this.enemySpawnPhase = 'buildup';
                this.enemyPhaseStartTime = now;
                this.enemyUnitsThisPhase = 0;
                this.enemyTotalWaves++;
            }
        } else if (this.enemySpawnPhase === 'buildup') {
            currentInterval = 8000; // Slower buildup
            
            const phaseElapsed = now - this.enemyPhaseStartTime;
            // LONGER BUILDUP and LARGER WAVES as requested
            // Increase time from 60s default (in constructor) to ~80s, and units from 6 to ~10+ depending on difficulty
            const waveUnitCap = 10 + (this.level.difficulty * 2); 
            const waveDuration = 80000; // 80 seconds waiting time
            
            if (phaseElapsed > waveDuration || enemyUnits.length >= waveUnitCap) {
                this.enemySpawnPhase = 'attack';
                this.enemyPhaseStartTime = now;
                this.enemyUnitsThisPhase = 0;
                
                this.enemyArmy.getAliveUnits().forEach(unit => {
                   if (unit.unitType !== 'miner') {
                       unit.enemyPosition = 'retreat';
                       unit.target = null;
                       unit.targetPosition = null; 
                   }
                });
                return;
            }
        }
        
        if (timeSinceLastSpawn >= currentInterval && timeSinceLastSpawn >= this.enemyUnitCooldown) {
            this.spawnEnemyUnit();
            this.enemyLastUnitSpawn = now;
            this.enemyUnitCooldown = 6000;
        }
        
        // STEP 4: Handle phase transitions for unit positioning
        const phaseElapsed = now - this.enemyPhaseStartTime;
        
        if (this.enemySpawnPhase === 'buildup') {
            this.enemyArmy.getAliveUnits().forEach(unit => {
                if (unit.unitType !== 'miner') {
                    unit.enemyPosition = 'defend';
                }
            });
        } else if (this.enemySpawnPhase === 'attack') {
            this.enemyArmy.getAliveUnits().forEach(unit => {
                if (unit.unitType !== 'miner') {
                    unit.enemyPosition = 'attack';
                }
            });
            
            // Safety retreat
            if (enemyUnits.length < 2 && this.enemyUnitsThisPhase > 3) {
                this.enemySpawnPhase = 'buildup';
                this.enemyPhaseStartTime = now;
                this.enemyUnitsThisPhase = 0;
                
                this.enemyArmy.getAliveUnits().forEach(unit => {
                   if (unit.unitType !== 'miner') {
                       unit.enemyPosition = 'retreat';
                       unit.target = null;
                       unit.targetPosition = null; 
                   }
                });
                return;
            }
        }
    }

    spawnEnemyUnit() {
        // Priority 1: Ensure we have miners
        if (this.enemyMinersSpawned < this.enemyMaxMiners) {
            if (this.enemyResources >= UNIT_TYPES.miner.cost) {
                const unit = this.enemyArmy.spawnUnit('miner');
                if (unit) {
                    this.enemyResources -= UNIT_TYPES.miner.cost;
                    this.enemyMinersSpawned++;
                    unit.lastResourceCollection = Date.now();
                    console.log('Enemy spawned miner', this.enemyMinersSpawned, '/', this.enemyMaxMiner);
                    return;
                }
            }
        }
        
        // Priority 2: Spawn combat units - REDUCED MAX UNITS
        const maxUnits = 5 + (this.level.difficulty * 1); // Reduced significantly
        const currentUnits = this.enemyArmy.getAliveUnits().filter(u => u.unitType !== 'miner').length;
        
        if (currentUnits >= maxUnits) {
            return;
        }
        
        // Choose unit type based on difficulty and available resources
        let unitType = this.chooseEnemyUnitType();
        const cost = UNIT_TYPES[unitType].cost;
        
        if (this.enemyResources >= cost) {
            const unit = this.enemyArmy.spawnUnit(unitType);
            if (unit) {
                this.enemyResources -= cost;
                this.enemyUnitsThisPhase++;
                unit.enemyPosition = this.enemySpawnPhase === 'buildup' ? 'defend' : 'attack';
                console.log(`Enemy spawned ${unitType} (${this.enemySpawnPhase} phase, ${this.enemyResources} resources remaining)`);
            }
        } else {
            console.log(`Enemy cannot afford ${unitType} (cost: ${cost}, has: ${this.enemyResources})`);
        }
    }

    chooseEnemyUnitType() {
        // Tutorial: restrict enemy AI to miner, grunt, assault, grenadier
        if (this.isTutorial) {
            const pool = ['grunt', 'grunt', 'assault', 'assault', 'grenadier'];
            return pool[Math.floor(Math.random() * pool.length)];
        }

        const difficulty = this.level.difficulty;
        
        // Prefer basic units, avoid explosives at low difficulty
        if (difficulty <= 1) {
            const pool = ['grunt', 'grunt', 'grunt', 'assault'];
            return pool[Math.floor(Math.random() * pool.length)];
        } else if (difficulty <= 2) {
            const pool = ['grunt', 'grunt', 'assault', 'assault', 'medic'];
            return pool[Math.floor(Math.random() * pool.length)];
        } else if (difficulty <= 3) {
            const pool = ['grunt', 'assault', 'assault', 'medic', 'grenadier'];
            return pool[Math.floor(Math.random() * pool.length)];
        } else if (difficulty <= 4) {
            const pool = ['assault', 'medic', 'sergeant', 'sniper', 'grenadier'];
            return pool[Math.floor(Math.random() * pool.length)];
        } else {
            const pool = ['assault', 'sergeant', 'sniper', 'grenadier', 'rocketeer'];
            return pool[Math.floor(Math.random() * pool.length)];
        }
    }

    updateEnemyPositioning() {
        const now = Date.now();
        const enemyCombatUnits = this.enemyArmy.getAliveUnits().filter(unit => unit.unitType !== 'miner');
        const playerCombatUnits = this.playerArmy.getAliveUnits().filter(unit => unit.unitType !== 'miner');
        
        // Calculate current wave buildup time
        const currentWaveBuildupTime = Math.min(
            this.enemyBaseBuildupTime + (this.enemyCurrentWaveNumber * this.enemyBuildupTimeIncrease),
            this.enemyMaxBuildupTime
        );
        
        const waveElapsedTime = now - this.enemyWaveStartTime;
        
        if (this.enemyWaveState === 'buildup') {
            // BUILDUP PHASE: Keep all units at base
            enemyCombatUnits.forEach(unit => {
                unit.enemyPosition = 'defend';
            });
            
            // Check if it's time to attack
            const hasEnoughUnits = enemyCombatUnits.length >= this.enemyMinUnitsPerWave;
            const buildupTimeComplete = waveElapsedTime >= currentWaveBuildupTime;
            const hasGoodArmy = enemyCombatUnits.length >= 4 + this.enemyCurrentWaveNumber;
            
            if (buildupTimeComplete && hasEnoughUnits) {
                // START WAVE ATTACK
                this.enemyWaveState = 'attacking';
                this.enemyCurrentWaveNumber++;
                this.enemyUnitsBuiltThisWave = 0;
                
                console.log(`Enemy Wave ${this.enemyCurrentWaveNumber} ATTACKING with ${enemyCombatUnits.length} units after ${(waveElapsedTime/1000).toFixed(1)}s buildup!`);
                
                // Send all current units to attack
                enemyCombatUnits.forEach(unit => {
                    unit.enemyPosition = 'attack';
                });
            } else {
                // Still building up
                const timeRemaining = (currentWaveBuildupTime - waveElapsedTime) / 1000;
                if (Math.floor(timeRemaining) % 10 === 0 && waveElapsedTime % 1000 < 100) {
                    console.log(`Enemy buildup phase: ${enemyCombatUnits.length} units, ${timeRemaining.toFixed(0)}s remaining`);
                }
            }
            
        } else if (this.enemyWaveState === 'attacking') {
            // ATTACK PHASE: All units attack
            enemyCombatUnits.forEach(unit => {
                unit.enemyPosition = 'attack';
            });
            
            // Check if wave is depleted or should retreat
            const waveAttackTime = waveElapsedTime - currentWaveBuildupTime;
            const unitsLeft = enemyCombatUnits.length;
            const severelyOutnumbered = playerCombatUnits.length > unitsLeft * 3;
            const waveLastedLongEnough = waveAttackTime > 45000; // 45 seconds minimum attack
            
            // Start new buildup phase if wave is mostly destroyed or lasted long enough
            if ((unitsLeft <= 1 && waveLastedLongEnough) || (severelyOutnumbered && waveAttackTime > 20000)) {
                this.enemyWaveState = 'buildup';
                this.enemyWaveStartTime = now;
                this.enemyUnitsBuiltThisWave = 0;
                
                const nextBuildupTime = Math.min(
                    this.enemyBaseBuildupTime + (this.enemyCurrentWaveNumber * this.enemyBuildupTimeIncrease),
                    this.enemyMaxBuildupTime
                );
                
                console.log(`Enemy wave depleted. Starting buildup phase ${this.enemyCurrentWaveNumber + 1} for ${(nextBuildupTime/1000).toFixed(0)}s`);
                
                // Any remaining units retreat to defend
                enemyCombatUnits.forEach(unit => {
                    unit.enemyPosition = 'defend';
                });
            }
        }
    }
    
    checkWinConditions() {
        if (this.bases.player.health <= 0) {
            this.endGame('DEFEAT!');
        } else if (this.bases.enemy.health <= 0) {
            this.endGame('VICTORY!');
        }
    }
    
    endGame(result) {
        this.gameOver = true;
        
        // Stop battle music
        document.querySelectorAll('audio').forEach(audio => {
            if (audio.id.includes('battle-music')) {
                audio.pause();
            }
        });
        
        document.getElementById('result-text').textContent = result;
        
        // Play defeat fanfare on non-tutorial losses
        if (!this.isTutorial && result.includes('DEFEAT')) {
            const defeatAudio = document.getElementById('sfx-defeat');
            if (defeatAudio) {
                try {
                    const clone = defeatAudio.cloneNode(true);
                    clone.currentTime = 0;
                    clone.volume = (defeatAudio.volume ?? 1) * 0.65;
                    clone.play().catch(() => {});
                } catch (e) {
                    // ignore audio errors
                }
            }
        }
        
        // Tutorial: no campaign rewards, just finish tutorial sequence
        if (this.isTutorial) {
            document.getElementById('result-text').textContent = result;
            document.getElementById('game-over').classList.remove('hidden');

            setTimeout(() => {
                this.cleanup();
                document.getElementById('game-container').style.display = 'none';
                document.getElementById('game-over').classList.add('hidden');
                if (window.finishTutorial) {
                    window.finishTutorial();
                } else {
                    window.showMainMenu();
                }
            }, 2500);
            return;
        }

        // Award rewards based on result and level
        if (result.includes('VICTORY')) {
            const coins = this.level.rewards.coins;
            const xp = this.level.rewards.xp;
            
            if (window.addCampaignCoins) window.addCampaignCoins(coins);
            if (window.addXP) window.addXP(xp);
            
            // Mark level as complete for campaign map (fade out and track progress)
            if (window.completeLevel && this.levelIndex !== -1) {
                window.completeLevel(this.levelIndex);
            }
            
            // Award shard rewards - moved to function call
            const shardRewards = window.awardShardRewards ? window.awardShardRewards() : [];
            
            let rewardText = `
                ${result}<br>
                <div style="font-size: 0.6em; margin-top: 10px;">
                    Rewards: +${coins} Coins, +${xp} XP
            `;
            
            if (shardRewards.length > 0) {
                rewardText += `<br>✨ Shards: ${shardRewards.join(', ')}`;
            }
            
            rewardText += `</div>`;
            
            document.getElementById('result-text').innerHTML = rewardText;
        }
        
        document.getElementById('game-over').classList.remove('hidden');
        
        // Auto-return to main menu after 3 seconds
        setTimeout(() => {
            this.cleanup();
            document.getElementById('game-container').style.display = 'none';
            document.getElementById('game-over').classList.add('hidden');
            setTimeout(() => {
                window.showMainMenu();
            }, 500);
        }, 3000);
    }
    
    cleanup() {
        // Stop battle music
        document.querySelectorAll('audio').forEach(audio => {
            if (audio.id.includes('battle-music')) {
                audio.pause();
            }
        });

        // Remove any tutorial overlays/end screens that might still exist
        const tutorialOverlay = document.querySelector('.tutorial-overlay');
        if (tutorialOverlay && tutorialOverlay.parentNode) {
            tutorialOverlay.parentNode.removeChild(tutorialOverlay);
        }
        const tutorialEndScreen = document.querySelector('.tutorial-end-screen');
        if (tutorialEndScreen && tutorialEndScreen.parentNode) {
            tutorialEndScreen.parentNode.removeChild(tutorialEndScreen);
        }

        // Proper cleanup without aggressive disposal
        if (this.scene) {
            this.scene.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(material => {
                            if (material.map) material.map.dispose();
                            material.dispose();
                        });
                    } else {
                        if (child.material.map) child.material.map.dispose();
                        child.material.dispose();
                    }
                }
            });
            while (this.scene.children.length > 0) {
                this.scene.remove(this.scene.children[0]);
            }
        }

        // Clean renderer without forcing context loss
        if (this.renderer) {
            this.renderer.dispose();
        }

        // Clear references
        this.camera = null;
        this.scene = null;
        this.renderer = null;

        window.currentGame = null;

        console.log('Game cleanup complete');
    }
    
    addResources(amount) {
        this.resources += amount;
    }
    
    updateUI() {
        // Update health bars
        const playerHealthPercent = (this.bases.player.health / this.bases.player.maxHealth) * 100;
        const enemyHealthPercent = (this.bases.enemy.health / this.bases.enemy.maxHealth) * 100;
        
        document.getElementById('player-health').style.width = playerHealthPercent + '%';
        document.getElementById('enemy-health').style.width = enemyHealthPercent + '%';
        
        // Update unit count and score
        const aliveUnits = this.playerArmy.getAliveUnits().length;
        document.getElementById('unit-count').textContent = aliveUnits;
        
        this.score = Math.max(0, (this.bases.enemy.maxHealth - this.bases.enemy.health) + 
                     (this.enemyArmy.getTotalUnits() - this.enemyArmy.getAliveUnits().length) * 10);
        document.getElementById('score').textContent = this.score;
        
        // Update resources
        document.getElementById('resource-count').textContent = this.resources;
        
        // Update unit shop buttons - only for available units
        const now = Date.now();
        this.availableUnits.forEach(unitType => {
            const stats = UNIT_TYPES[unitType];
            const button = document.getElementById(`unit-${unitType}`);
            if (button) {
                const cooldownEnd = this.unitCooldowns[unitType] || 0;
                const isOnCooldown = now < cooldownEnd;
                const remainingSeconds = Math.ceil((cooldownEnd - now) / 1000);
                
                button.disabled = (this.resources < stats.cost) || isOnCooldown;
                
                if (isOnCooldown) {
                    button.classList.add('cooldown');
                    // Update or create timer display
                    let timerDisplay = button.querySelector('.cooldown-timer');
                    if (!timerDisplay) {
                        timerDisplay = document.createElement('div');
                        timerDisplay.className = 'cooldown-timer';
                        button.appendChild(timerDisplay);
                    }
                    timerDisplay.textContent = remainingSeconds;
                } else {
                    button.classList.remove('cooldown');
                    const timerDisplay = button.querySelector('.cooldown-timer');
                    if (timerDisplay) timerDisplay.remove();
                }
            }
        });
    }
    
    animate() {
        if (!this.renderer || !this.scene || !this.camera) {
            console.error('Missing renderer, scene, or camera - stopping animation');
            return;
        }
        
        requestAnimationFrame(() => this.animate());
        
        const currentTime = performance.now() / 1000;
        const deltaTime = currentTime - this.lastTime;
        this.lastTime = currentTime;
        
        this.update(deltaTime);
        
        try {
            this.renderer.render(this.scene, this.camera);
        } catch (error) {
            console.error('Render error:', error);
        }
    }
    
    spawnBackgroundExplosion() {
        // Pick a random vehicle or background spot
        let pos;
        if (this.vehicles && this.vehicles.length > 0 && Math.random() < 0.7) {
            const v = this.vehicles[Math.floor(Math.random() * this.vehicles.length)];
            pos = v.group.position.clone();
            pos.x += (Math.random() - 0.5) * 5;
            pos.z += (Math.random() - 0.5) * 3;
            pos.y = 2 + Math.random() * 1.5;
        } else {
            pos = new THREE.Vector3(
                (Math.random() - 0.5) * 160,
                2 + Math.random() * 2,
                -40 - Math.random() * 20
            );
        }
        
        const geo = new THREE.SphereGeometry(3, 16, 16);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xff5500,
            transparent: true,
            opacity: 0.8
        });
        const explosion = new THREE.Mesh(geo, mat);
        explosion.position.copy(pos);
        this.scene.add(explosion);
        
        // Quick flash and fade
        let t = 0;
        const animate = () => {
            t += 0.05;
            explosion.scale.set(1 + t * 2, 1 + t * 2, 1 + t * 2);
            explosion.material.opacity = Math.max(0, 0.8 - t);
            if (explosion.material.opacity <= 0 || !this.scene) {
                if (this.scene) this.scene.remove(explosion);
                return;
            }
            requestAnimationFrame(animate);
        };
        animate();
    }
}

// Global restart function - FIXED
window.restartGame = function() {
    // Clean up the current game immediately
    document.getElementById('game-over').classList.add('hidden');
    
    if (window.currentGame) {
        window.currentGame.cleanup();
    }
    
    document.getElementById('game-container').style.display = 'none';
    
    // Go to campaign map instead of main menu
    setTimeout(() => {
        window.showCampaignMap();
    }, 300);
};

function showMainMenu() {
    // Clear any game instance completely
    if (window.currentGame) {
        // Clear the scene
        if (window.currentGame.scene) {
            // Properly dispose of all objects
            window.currentGame.scene.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(material => {
                            if (material.map) material.map.dispose();
                            material.dispose();
                        });
                    } else {
                        if (child.material.map) child.material.map.dispose();
                        child.material.dispose();
                    }
                }
            });
            while (window.currentGame.scene.children.length > 0) {
                window.currentGame.scene.remove(window.currentGame.scene.children[0]);
            }
        }
        // Clear the renderer
        if (window.currentGame.renderer) {
            window.currentGame.renderer.dispose();
        }
        window.currentGame = null;
    }
    
    // Reset canvas
    const canvas = document.getElementById('game-canvas');
    if (canvas) {
        const context = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (context && context.clear) {
            context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);
        }
    }
    
    // Force hide game container first
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('game-over').classList.add('hidden');
    
    // Small delay to ensure cleanup, then show menu
    setTimeout(() => {
        document.getElementById('main-menu').classList.remove('hidden');
        document.getElementById('campaign-map').classList.add('hidden');
        document.getElementById('unit-shop-screen').classList.add('hidden');
        document.getElementById('unit-selection').classList.add('hidden');
        
        // Force refresh the profile display
        updateProfileDisplay();
    }, 100);
}

export { Game };

