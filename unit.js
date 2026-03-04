import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
// NEW: shared unit data / audio helpers
import { UNIT_TYPES } from './js/unit-types.js';
import { SFX, playSfx } from './js/audio-sfx.js';

// Re-export so existing imports from "./unit.js" keep working
export { UNIT_TYPES };

// CACHED GEOMETRIES AND ASSETS TO PREVENT LAG
const GEOMETRIES = {
    sphere_small: new THREE.SphereGeometry(0.15, 4, 4),
    sphere_medium: new THREE.SphereGeometry(0.3, 6, 6),
    sphere_large: new THREE.SphereGeometry(1, 8, 8),
    sphere_explosion_small: new THREE.SphereGeometry(1, 8, 8),
    sphere_explosion_medium: new THREE.SphereGeometry(2, 10, 10),
    sphere_explosion_large: new THREE.SphereGeometry(3, 12, 12),
    box_small: new THREE.BoxGeometry(0.1, 0.1, 0.2),
    cylinder_rocket: new THREE.CylinderGeometry(0.05, 0.1, 0.4, 6),
    bullet: new THREE.SphereGeometry(0.08, 4, 4),
    // Sleeker rocket body for Rocketeer projectiles
    rocket_body: new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8),
    // UI cached geometries
    healthBarBg: new THREE.PlaneGeometry(1.5, 0.2),
    shieldBarBg: new THREE.PlaneGeometry(1.5, 0.15),
    // Unit body geometries
    box_standard: new THREE.BoxGeometry(0.7, 1.4, 0.6),
    box_miner: new THREE.BoxGeometry(0.8, 1.2, 0.6),
    box_sniper: new THREE.BoxGeometry(0.6, 1.8, 0.6),
    box_rocketeer: new THREE.BoxGeometry(0.9, 1.6, 0.7),
    cylinder_colonel: new THREE.CylinderGeometry(0.5, 0.5, 1.6, 8)
};

// Preload revolver model logic
let REVOLVER_MODEL = null;
const loader = new GLTFLoader();
loader.load('/revolver_.38.glb', (gltf) => {
    REVOLVER_MODEL = gltf.scene;
    // Optimize model
    REVOLVER_MODEL.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = false;
            child.receiveShadow = false;
        }
    });
});

export class Unit {
    constructor(team, position, unitType = 'grunt') {
        this.team = team;
        this.unitType = unitType;
        this.stats = UNIT_TYPES[unitType];
        
        this.health = this.stats.health;
        this.maxHealth = this.stats.health;
        this.speed = this.stats.speed;
        this.attackDamage = this.stats.attackDamage;
        this.attackCooldown = this.stats.attackCooldown;
        // Normalize range usage
        this.range = this.getEffectiveRange();
        this.lastAttackTime = 0;
        this.target = null;
        this.alive = true;
        
        // NEW: death animation state
        this.isDying = false;
        this.deathStartTime = 0;
        
        // Visual attachments
        this.gun = null;
        this.recoilTime = 0;

        // NEW: limb & visual animation state
        this.leftArm = null;
        this.rightArm = null;
        this.leftLeg = null;
        this.rightLeg = null;
        this.head = null;
        this.eyeMeshes = [];
        this.eyeMaterials = [];
        this.walkTime = 0;
        this.eyeTime = 0;
        this.prevPosition = position.clone();
        this.isMoving = false;
        
        // Stun system
        this.isStunned = false;
        this.stunEndTime = 0;
        
        // Riot shield system
        if (this.unitType === 'riot') {
            this.hasShield = true;
            this.shieldHealth = 500;
            this.maxShieldHealth = 500;
        }
        
        // Enhanced movement and positioning system
        this.targetPosition = null;
        this.hasTarget = false;
        this.isPlayerControlled = false;
        this.enemyPosition = 'defend';
        this.moveStartTime = 0;
        this.defendPosition = null;
        this.attackPosition = null;
        this.stance = 'defend';
        
        // Add wandering system for defend/retreat
        this.wanderTimer = 0;
        this.wanderCooldown = 5000 + Math.random() * 3000;
        this.lastWanderTime = 0;
        
        // Miner-specific properties
        this.resourceCollectionRate = 1;
        this.lastResourceCollection = 0;
        
        // Medic properties
        this.healAmount = 30;
        this.healCooldown = 3000;
        this.lastHealTime = 0;
        
        // Colonel focus fire
        this.focusTarget = null;
        this.revolverIndicator = null;
        this.focusFireCooldown = 10000;
        this.lastFocusFireTime = 0;
        this.targetMarkEmoji = null;
        
        // Commando berserker mode
        this.berserkerActivated = false;
        this.originalAttackCooldown = this.attackCooldown;
        this.berserkerGlow = null;
        
        // Surgeon clutch-heal system (buffed support ability)
        this.reviveCooldown = 6000;   // 6s between revive attempts
        this.lastReviveTime = 0;
        this.reviveCount = 0;
        
        this.createMesh(position);
        this.createUI();
    }
    
    createMesh(position) {
        // Use cached geometries instead of creating new ones
        let geometry, material;
        
        if (this.unitType === 'colonel') {
            geometry = GEOMETRIES.cylinder_colonel;
            material = new THREE.MeshLambertMaterial({
                color: 0xffff00,
                emissive: 0xaa8800,
                emissiveIntensity: 0.3
            });
        } else {
            switch(this.unitType) {
                case 'miner':
                    geometry = GEOMETRIES.box_miner;
                    material = new THREE.MeshLambertMaterial({
                        color: this.team === 'player' ? 0xffaa00 : 0xff8800
                    });
                    break;
                case 'sniper':
                    geometry = GEOMETRIES.box_sniper;
                    material = new THREE.MeshLambertMaterial({
                        color: this.team === 'player' ? 0x9900ff : 0x880088
                    });
                    break;
                case 'rocketeer':
                    geometry = GEOMETRIES.box_rocketeer;
                    material = new THREE.MeshLambertMaterial({
                        color: this.team === 'player' ? 0xff0088 : 0xdd0066
                    });
                    break;
                case 'riot':
                    geometry = GEOMETRIES.box_standard;
                    material = new THREE.MeshLambertMaterial({
                        color: this.team === 'player' ? 0x111111 : 0x550000
                    });
                    break;
                default:
                    geometry = GEOMETRIES.box_standard;
                    material = new THREE.MeshLambertMaterial({
                        color: this.team === 'player' ? this.stats.color : 0xff3300
                    });
            }
        }
        
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);
        // Ground the unit so feet sit on the terrain
        this.mesh.position.y = 0;
        
        // Make the original torso invisible so the bot is just a head with legs
        // but keep the Colonel's yellow cylinder visible for its unique look
        if (this.unitType !== 'colonel' && this.mesh.material) {
            if (Array.isArray(this.mesh.material)) {
                this.mesh.material.forEach(m => {
                    m.transparent = true;
                    m.opacity = 0;
                });
            } else {
                this.mesh.material.transparent = true;
                this.mesh.material.opacity = 0;
            }
        }
        
        // NEW: make torso tiny so the "head" becomes the main body for a more bot-like feel
        // Upscaled overall unit size so units are easier to see
        // this.mesh.scale.set(1.2, 1.2, 1.2);
        
        // NEW: add stylized cube body parts (head, legs, face) - head is now the torso
        this.addBodyDetails();
        
        // Add simple arms & gun for ranged/elite units
        this.addEquipment();
        
        // Simplified neon glow - less intensive
        this.addSimpleGlow();
        
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
    }

    // NEW: extra body details to match stylized cube art
    addBodyDetails() {
        // Head cube (acts as main body/torso)
        let headColorPlayer;
        switch (this.unitType) {
            case 'miner':
                headColorPlayer = 0xffaa00; // strong orange-yellow
                break;
            case 'riot':
                headColorPlayer = 0x111111; // very dark / black
                break;
            case 'colonel':
                headColorPlayer = 0xfacc15; // bright yellow, matches colonel theme
                break;
            case 'sniper':
                headColorPlayer = 0x9900ff; // purple
                break;
            case 'rocketeer':
                headColorPlayer = 0xff0088; // magenta
                break;
            case 'medic':
                headColorPlayer = 0x00ff00; // green
                break;
            case 'commando':
                headColorPlayer = 0x660000; // dark red
                break;
            default:
                headColorPlayer = this.stats.color || 0xfacc15;
        }
        const headColorEnemy = 0xff3300; // enemy red/orange tint
        
        const headGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
        const headMat = new THREE.MeshLambertMaterial({
            color: this.team === 'player' ? headColorPlayer : headColorEnemy
        });
        const head = new THREE.Mesh(headGeo, headMat);
        // Slightly lower head so legs reach the ground nicely
        head.position.set(0, 0.9, 0);
        this.mesh.add(head);
        this.head = head;
        
        // Legs attached directly to the head to feel more robotic
        const legGeo = new THREE.BoxGeometry(0.24, 0.8, 0.24);
        const legMat = new THREE.MeshLambertMaterial({
            color: 0x111827
        });
        
        const leftLeg = new THREE.Mesh(legGeo, legMat);
        const rightLeg = new THREE.Mesh(legGeo, legMat);
        // Position legs so their bottoms sit right at ground level
        leftLeg.position.set(-0.22, -0.5, 0);
        rightLeg.position.set(0.22, -0.5, 0);
        this.head.add(leftLeg);
        this.head.add(rightLeg);
        this.leftLeg = leftLeg;
        this.rightLeg = rightLeg;
        
        // Remove bulky chest: no belt / torso accent anymore
        
        // Eyes on head front
        const eyeGeo = new THREE.PlaneGeometry(0.18, 0.18);
        const eyeColor = this.team === 'player' ? 0x7dd3fc : 0xfca5a5;
        
        const makeEye = (offsetX) => {
            const eyeCanvas = document.createElement('canvas');
            eyeCanvas.width = 64;
            eyeCanvas.height = 64;
            const ctx = eyeCanvas.getContext('2d');
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, 64, 64);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(32, 32, 20, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.arc(32, 32, 12, 0, Math.PI * 2);
            ctx.fill();
            const tex = new THREE.CanvasTexture(eyeCanvas);
            const eyeMat = new THREE.MeshBasicMaterial({
                map: tex,
                color: eyeColor,
                transparent: true
            });
            const eye = new THREE.Mesh(eyeGeo, eyeMat);
            eye.position.set(offsetX, 0.1, 0.46);
            this.head.add(eye);
            this.eyeMeshes.push(eye);
            this.eyeMaterials.push(eyeMat);
        };
        
        makeEye(-0.22);
        makeEye(0.22);
    }
    
    addEquipment() {
        const isRanged = this.range > 0;
        
        // Longer side "arms" so they reach the weapon better
        const armGeo = new THREE.BoxGeometry(0.16, 0.7, 0.16);
        const armMat = new THREE.MeshLambertMaterial({
            color: 0x222222
        });
        
        const leftArm = new THREE.Mesh(armGeo, armMat);
        const rightArm = new THREE.Mesh(armGeo, armMat);
        
        // Attach arms to the head (which acts as the torso)
        leftArm.position.set(-0.6, 0.0, 0);
        rightArm.position.set(0.6, 0.0, 0);
        
        this.head.add(leftArm);
        this.head.add(rightArm);
        
        // Store for animation
        this.leftArm = leftArm;
        this.rightArm = rightArm;
        
        if (isRanged || this.unitType === 'riot' || this.unitType === 'rocketeer' || this.unitType === 'grenadier') {
            // Simple gun / launcher block attached to the right hand
            const gunLength = this.unitType === 'rocketeer' ? 1.0 : 0.7;
            const gunGeo = new THREE.BoxGeometry(0.22, 0.22, gunLength);
            const gunColor = this.team === 'player' ? 0x1f2937 : 0x4b1010;
            const gunMat = new THREE.MeshLambertMaterial({ color: gunColor });
            const gun = new THREE.Mesh(gunGeo, gunMat);
            
            // Position gun in the right hand area
            gun.position.set(0, -0.5, 0.45);
            gun.rotation.x = 0;
            
            // Small muzzle highlight
            const muzzleGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 6);
            const muzzleMat = new THREE.MeshBasicMaterial({
                color: this.team === 'player' ? 0x60a5fa : 0xf97316,
                emissive: this.team === 'player' ? 0x60a5fa : 0xf97316,
                emissiveIntensity: 0.6
            });
            const muzzle = new THREE.Mesh(muzzleGeo, muzzleMat);
            muzzle.position.set(0, 0, gunLength / 2 + 0.06);
            muzzle.rotation.x = Math.PI / 2;
            gun.add(muzzle);
            
            // Attach gun to right arm so it truly sits in the hand
            rightArm.add(gun);
            this.gun = gun;
        }
    }
    
    addSimpleGlow() {
        // Simplified glow effect - single outline, no pulsing
        const outlineGeometry = this.mesh.geometry;
        const outlineMaterial = new THREE.MeshBasicMaterial({
            color: this.team === 'player' ? 0x00ffff : 0xff0040,
            transparent: true,
            opacity: 0.3,
            side: THREE.BackSide
        });
        
        this.neonOutline = new THREE.Mesh(outlineGeometry, outlineMaterial);
        this.neonOutline.scale.multiplyScalar(1.05);
        this.mesh.add(this.neonOutline);
    }
    
    createUI() {
        // Create overhead UI for unit name and health
        this.uiGroup = new THREE.Group();
        
        // Health bar background - use cached geometry
        const healthBgMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x333333, 
            transparent: true, 
            opacity: 0.8 
        });
        this.healthBarBg = new THREE.Mesh(GEOMETRIES.healthBarBg, healthBgMaterial);
        this.healthBarBg.position.y = 2.5;
        this.uiGroup.add(this.healthBarBg);
        
        // Health bar fill - use cached geometry
        const healthFillMaterial = new THREE.MeshBasicMaterial({ 
            color: this.team === 'player' ? 0x00ff00 : 0xff0000,
            transparent: true, 
            opacity: 0.9 
        });
        this.healthBarFill = new THREE.Mesh(GEOMETRIES.healthBarBg, healthFillMaterial);
        this.healthBarFill.position.y = 2.5;
        this.healthBarFill.position.z = 0.01;
        this.uiGroup.add(this.healthBarFill);
        
        // Shield bar for Riot units - use cached geometry
        if (this.unitType === 'riot') {
            const shieldBgMaterial = new THREE.MeshBasicMaterial({ 
                color: 0x222222, 
                transparent: true, 
                opacity: 0.8 
            });
            this.shieldBarBg = new THREE.Mesh(GEOMETRIES.shieldBarBg, shieldBgMaterial);
            this.shieldBarBg.position.y = 2.75;
            this.uiGroup.add(this.shieldBarBg);
            
            const shieldFillMaterial = new THREE.MeshBasicMaterial({ 
                color: 0x00ffff,
                transparent: true, 
                opacity: 0.9 
            });
            this.shieldBarFill = new THREE.Mesh(GEOMETRIES.shieldBarBg, shieldFillMaterial);
            this.shieldBarFill.position.y = 2.75;
            this.shieldBarFill.position.z = 0.01;
            this.uiGroup.add(this.shieldBarFill);
        }
        
        // Simplified name text
        this.createSimpleName();
        
        this.mesh.add(this.uiGroup);
    }
    
    createSimpleName() {
        // Simplified text creation - smaller canvas
        const canvas = document.createElement('canvas');
        canvas.width = 128; // Reduced from 256
        canvas.height = 32; // Reduced from 64
        const context = canvas.getContext('2d');
        context.fillStyle = this.team === 'player' ? '#00ffff' : '#ff4444';
        context.font = 'bold 16px Arial'; // Smaller font
        context.textAlign = 'center';
        context.fillText(this.stats.name.toUpperCase(), 64, 20);
        
        const texture = new THREE.CanvasTexture(canvas);
        const nameMaterial = new THREE.MeshBasicMaterial({ 
            map: texture, 
            transparent: true,
            alphaTest: 0.1
        });
        const nameGeometry = new THREE.PlaneGeometry(2, 0.5);
        this.nameText = new THREE.Mesh(nameGeometry, nameMaterial);
        this.nameText.position.y = 3.2;
        this.uiGroup.add(this.nameText);
    }
    
    update(deltaTime, enemies, bases, gameInstance = null) {
        if (!this.alive && !this.isDying) return;
        
        // NEW: no limb/eye animation while dying handled in death anim
        if (this.isDying) {
            this.updateDeathAnimation(deltaTime, gameInstance);
            return;
        }

        // Check stun status
        if (this.isStunned && Date.now() > this.stunEndTime) {
            this.isStunned = false;
        }
        
        // Skip most actions if stunned
        if (this.isStunned) {
            this.updateHealthBar();
            return;
        }

        // Commando berserker mode check
        if (this.unitType === 'commando' && !this.berserkerActivated && this.health <= this.maxHealth * 0.2) {
            this.activateBerserkerMode(gameInstance);
        }

        // Remove reference to non-existent neonEdges to avoid errors
        if (this.neonOutline) {
            if (!this.neonPulseTime) this.neonPulseTime = 0;
            this.neonPulseTime += deltaTime * 4;
            const pulseIntensity = 0.4 + Math.sin(this.neonPulseTime) * 0.3;
            this.neonOutline.material.opacity = pulseIntensity;
        }

        // Simple gun recoil animation
        if (this.gun && this.recoilTime > 0) {
            this.recoilTime -= deltaTime;
            const t = Math.max(this.recoilTime, 0);
            const offset = Math.sin(t * 20) * 0.06;
            this.gun.position.z = 0.45 - offset;
        }

        // Update UI to always face camera
        if (this.uiGroup && gameInstance && gameInstance.camera) {
            this.uiGroup.lookAt(gameInstance.camera.position);
            this.updateHealthBar();
        }

        // Ensure unit stays on ground level
        this.mesh.position.y = 0;
        
        // NEW: apply simple separation so units don't clump
        if (gameInstance && enemies && enemies.length > 0) {
            this.applySeparation(enemies, deltaTime);
        }

        // BOUNDARY ENFORCEMENT - prevent units from going too far
        const maxX = 40;
        const maxZ = 35;
        if (Math.abs(this.mesh.position.x) > maxX) {
            this.mesh.position.x = Math.sign(this.mesh.position.x) * maxX;
        }
        if (Math.abs(this.mesh.position.z) > maxZ) {
            this.mesh.position.z = Math.sign(this.mesh.position.z) * maxZ;
        }

        // Check for base collision if game instance available
        if (gameInstance && gameInstance.checkBaseCollision) {
            gameInstance.checkBaseCollision(this);
        }

        // COLONEL ABILITY - Focus Fire Marker
        if (this.unitType === 'colonel' && this.team === 'player') {
            this.handleColonelFocusFire(gameInstance, enemies);
        }

        // Handle wandering behavior for defend/retreat stances
        if (this.team === 'player' && (this.stance === 'defend' || this.stance === 'retreat')) {
            this.handleWandering(deltaTime, bases);
        }

        // PRIORITY 1: Handle player unit movement to target - BUT ALLOW COMBAT
        if (this.team === 'player' && this.hasTarget && this.targetPosition && this.isPlayerControlled) {
            // Check for nearby enemies first - if any within range, fight them
            const nearbyEnemies = enemies.filter(e => 
                e.alive && 
                e.team !== this.team && 
                e.unitType !== 'miner' &&
                this.mesh.position.distanceTo(e.mesh.position) < 15
            );
            
            if (nearbyEnemies.length > 0) {
                // Stop moving and fight
                this.findTarget(enemies, bases);
                if (this.target) {
                    const distance = this.mesh.position.distanceTo(this.target.mesh ? this.target.mesh.position : this.target.position);
                    // Use standardized range
                    const effectiveRange = this.range;
                    
                    if (effectiveRange > 0) {
                        if (distance <= effectiveRange) {
                            this.rangedAttack(gameInstance);
                            const targetPos = this.target.mesh ? this.target.mesh.position : this.target.position;
                            this.mesh.lookAt(targetPos);
                        } else {
                            this.moveTowardsTarget(deltaTime);
                        }
                    } else {
                        if (distance <= 2) {
                            this.attack();
                        } else {
                            this.moveTowardsTarget(deltaTime);
                        }
                    }
                    this.updateHealthBar();
                    return;
                }
            }
            
            // No enemies nearby - continue moving to target
            this.moveToTarget(deltaTime);
            this.updateHealthBar();
            
            // After reaching position, allow wandering to take over
            if (!this.hasTarget && (this.stance === 'defend' || this.stance === 'retreat')) {
                this.isPlayerControlled = false;
            }
            return;
        }
        
        // Handle enemy AI positioning
        if (this.team === 'enemy' && this.unitType !== 'miner') {
            this.handleEnemyPositioning(deltaTime, bases);
            this.mesh.position.y = 0;
        }
        
        // Miner behavior - NEVER CHASE ENEMIES
        if (this.unitType === 'miner') {
            this.collectResources(deltaTime, gameInstance);
            
            // Normal wandering behavior when safe - STAY NEAR BASE
            if (!this.isPlayerControlled) {
                if (!this.hasTarget && Math.random() < 0.001) {
                    const basePos = this.team === 'player' ? bases.player.position : bases.enemy.position;
                    const randomOffset = (Math.random() - 0.5) * 6;
                    this.targetPosition = new THREE.Vector3(
                        basePos.x + randomOffset,
                        0,
                        basePos.z + (Math.random() - 0.5) * 6
                    );
                    this.hasTarget = true;
                }
                if (this.hasTarget && this.targetPosition) {
                    this.moveToTarget(deltaTime);
                }
            }
            this.mesh.position.y = 0;
            return;
        }
        
        // Medic behavior - AOE BURST HEALING
        if (this.unitType === 'medic') {
            this.healAllies(enemies.filter(e => e.team === this.team), gameInstance);
        }

        // Surgeon revive behavior - ALWAYS ACTIVE FOR BOTH TEAMS
        if (this.unitType === 'surgeon') {
            this.handleSurgeonRevive(gameInstance);
        }
        
        // NEW SIMPLIFIED COMBAT LOGIC
        this.findTarget(enemies, bases, gameInstance);
        
        if (this.target) {
            const distance = this.mesh.position.distanceTo(this.target.mesh ? this.target.mesh.position : this.target.position);
            const effectiveRange = this.range;
            
            // Ranged combat
            if (effectiveRange > 0) {
                if (distance <= effectiveRange) {
                    // In range - attack
                    this.rangedAttack(gameInstance);
                    // Face target but don't move if in attack stance
                    if (this.stance === 'attack') {
                        const targetPos = this.target.mesh ? this.target.mesh.position : this.target.position;
                        this.mesh.lookAt(targetPos);
                    }
                } else {
                    // Out of range - move closer
                    this.moveTowardsTarget(deltaTime);
                }
            } else {
                // Melee combat
                if (distance <= 2) {
                    this.attack();
                } else {
                    this.moveTowardsTarget(deltaTime);
                }
            }
        } else {
            // No target - move based on stance
            if (this.stance === 'attack' && this.team === 'player') {
                // Attack stance with no target - move towards enemy territory
                const enemyPos = bases.enemy.position;
                const distanceToEnemy = this.mesh.position.distanceTo(enemyPos);
                if (distanceToEnemy > 15) {
                    this.moveForward(deltaTime);
                }
            } else if (this.stance === 'defend' && this.team === 'player') {
                // Stay near base
                const basePos = bases.player.position;
                const distanceToBase = this.mesh.position.distanceTo(basePos);
                if (distanceToBase > 12) {
                    const direction = new THREE.Vector3().subVectors(basePos, this.mesh.position).normalize();
                    this.mesh.position.add(direction.multiplyScalar(this.speed * deltaTime * 0.5));
                    this.mesh.position.y = 0;
                }
            } else if (this.team === 'enemy') {
                // Enemy AI - move towards player base
                this.moveForward(deltaTime);
            }
        }
        
        // Update health bar
        this.updateHealthBar();
        
        // Final position check
        this.mesh.position.y = Math.max(0, this.mesh.position.y);

        // NEW: animate limbs and eyes based on movement
        this.updateVisualAnimations(deltaTime);
    }
    
    handleColonelFocusFire(gameInstance, enemies) {
        const now = Date.now();
        
        // Check if it's time to mark a new target
        if (now - this.lastFocusFireTime >= this.focusFireCooldown) {
            this.lastFocusFireTime = now;
            
            // Find enemy units to mark
            const enemyUnits = enemies.filter(e => e.alive && e.team !== this.team && e.unitType !== 'miner');
            
            if (enemyUnits.length > 0) {
                // Prioritize high-value targets
                const unitValues = {
                    commando: 1000, colonel: 900, surgeon: 800, riot: 700, rocketeer: 600,
                    sergeant: 500, sniper: 400, grenadier: 300, assault: 200, medic: 150,
                    grunt: 100
                };
                
                let highestValue = -1;
                let targetToMark = null;
                
                enemyUnits.forEach(enemy => {
                    const value = unitValues[enemy.unitType] || 50;
                    if (value > highestValue) {
                        highestValue = value;
                        targetToMark = enemy;
                    }
                });
                
                if (targetToMark) {
                    this.focusTarget = targetToMark;
                    this.createFocusFireVisuals(targetToMark, gameInstance);
                    this.createFocusFireAura(gameInstance);
                }
            }
        }
        
        // Check if marked target is dead to award gold
        if (this.focusTarget && !this.focusTarget.alive && gameInstance) {
            // Award 10 gold
            if (gameInstance.addResources) {
                gameInstance.addResources(10);
            }
            // Clear the mark
            this.clearFocusTarget();
        }
    }
    
    createFocusFireVisuals(target, gameInstance) {
        if (!gameInstance || !gameInstance.scene) return;
        
        // Remove old marker if exists
        if (this.targetMarkEmoji && this.targetMarkEmoji.parent) {
            this.targetMarkEmoji.parent.remove(this.targetMarkEmoji);
        }
        
        // Create emoji marker (crosshair symbol)
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        context.font = 'bold 80px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('🎯', 64, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        this.targetMarkEmoji = new THREE.Sprite(material);
        this.targetMarkEmoji.scale.set(2, 2, 1);
        this.targetMarkEmoji.position.y = 5;
        
        target.mesh.add(this.targetMarkEmoji);
        
        // Add highlight glow to target
        if (target.mesh.material) {
            target.mesh.material.emissive = new THREE.Color(0xff0000);
            target.mesh.material.emissiveIntensity = 0.5;
        }
        
        // Animate marker
        const animateMarker = () => {
            if (this.targetMarkEmoji && this.targetMarkEmoji.parent && this.focusTarget === target) {
                this.targetMarkEmoji.position.y = 5 + Math.sin(Date.now() * 0.005) * 0.3;
                requestAnimationFrame(animateMarker);
            }
        };
        animateMarker();
    }
    
    createFocusFireAura(gameInstance) {
        if (!gameInstance || !gameInstance.scene) return;
        
        // Create expanding ring aura effect
        const ringGeometry = new THREE.RingGeometry(1, 1.5, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffff00, 
            transparent: true, 
            opacity: 0.8,
            side: THREE.DoubleSide 
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(this.mesh.position);
        ring.position.y = 0.5;
        gameInstance.scene.add(ring);
        
        // Animate ring expansion
        let scale = 1;
        let opacity = 0.8;
        const animateRing = () => {
            scale += 0.15;
            opacity -= 0.04;
            ring.scale.set(scale, scale, scale);
            ring.material.opacity = opacity;
            if (opacity <= 0) {
                gameInstance.scene.remove(ring);
                ringGeometry.dispose();
                ringMaterial.dispose();
            } else {
                requestAnimationFrame(animateRing);
            }
        };
        animateRing();
    }
    
    clearFocusTarget() {
        if (this.focusTarget && this.focusTarget.mesh && this.focusTarget.mesh.material) {
            this.focusTarget.mesh.material.emissive = new THREE.Color(0x000000);
            this.focusTarget.mesh.material.emissiveIntensity = 0;
        }
        if (this.targetMarkEmoji && this.targetMarkEmoji.parent) {
            this.targetMarkEmoji.parent.remove(this.targetMarkEmoji);
        }
        this.focusTarget = null;
        this.targetMarkEmoji = null;
    }
    
    activateBerserkerMode(gameInstance) {
        this.berserkerActivated = true;
        
        // Double fire rate
        this.attackCooldown = this.originalAttackCooldown * 0.5;
        
        // Heal to 75% health
        this.health = this.maxHealth * 0.75;
        this.updateHealthBar();
        
        // Create berserker glow effect
        if (gameInstance && gameInstance.scene) {
            const glowGeometry = new THREE.SphereGeometry(1.5, 16, 16);
            const glowMaterial = new THREE.MeshBasicMaterial({ 
                color: 0xff0000,
                transparent: true,
                opacity: 0.4,
                side: THREE.BackSide
            });
            this.berserkerGlow = new THREE.Mesh(glowGeometry, glowMaterial);
            this.mesh.add(this.berserkerGlow);
            
            // Pulsing animation
            const animateGlow = () => {
                if (this.berserkerGlow && this.alive) {
                    const scale = 1 + Math.sin(Date.now() * 0.01) * 0.2;
                    this.berserkerGlow.scale.set(scale, scale, scale);
                    requestAnimationFrame(animateGlow);
                }
            };
            animateGlow();
        }
    }
    
    // NEW: Surgeon revive ability – every 6s, revive a nearby fallen ally or big-heal if none are down
    handleSurgeonRevive(gameInstance) {
        if (!gameInstance) return;

        const now = Date.now();
        const cooldown = this.reviveCooldown || 6000;
        if (now - this.lastReviveTime < cooldown) return;

        const allyArmy = this.team === 'player' ? gameInstance.playerArmy : gameInstance.enemyArmy;
        if (!allyArmy || !allyArmy.units) return;

        // 1) Try to REVIVE a recently-dead ally whose death animation is still playing
        const REVIVE_RADIUS = 12;
        let reviveTarget = null;
        let closestDistSq = Infinity;

        allyArmy.units.forEach(ally => {
            if (!ally || !ally.mesh) return;
            // Candidate: not alive, currently in death animation, and still in the scene
            if (!ally.alive && ally.isDying && ally.mesh.parent) {
                const distSq = ally.mesh.position.distanceToSquared(this.mesh.position);
                if (distSq <= REVIVE_RADIUS * REVIVE_RADIUS && distSq < closestDistSq) {
                    closestDistSq = distSq;
                    reviveTarget = ally;
                }
            }
        });

        if (reviveTarget) {
            this.lastReviveTime = now;

            // Cancel their death and bring them back
            reviveTarget.alive = true;
            reviveTarget.isDying = false;
            reviveTarget.health = Math.floor(reviveTarget.maxHealth * 0.75);
            reviveTarget.updateHealthBar();

            // Reset visual fade/position
            if (reviveTarget.mesh) {
                reviveTarget.mesh.position.y = 0;
                reviveTarget.mesh.rotation.x = 0;
                reviveTarget.mesh.rotation.z = 0;
                reviveTarget.mesh.traverse(child => {
                    if (child.isMesh && child.material) {
                        child.material.transparent = true;
                        child.material.opacity = 1;
                    }
                });
                if (reviveTarget.uiGroup) reviveTarget.uiGroup.visible = true;
            }

            // Resurrection VFX
            this.createResurrectionEffect(gameInstance, reviveTarget.mesh.position);
            this.createBlinkingEffect(reviveTarget, gameInstance);
            return;
        }

        // 2) If no one to revive, do a chunky AoE heal as a fallback
        const allies = allyArmy.units.filter(u => u && u.mesh && u.alive && u.health > 0);
        const HEAL_RADIUS = 14;
        let healedSomeone = false;

        allies.forEach(ally => {
            const distSq = ally.mesh.position.distanceToSquared(this.mesh.position);
            if (distSq <= HEAL_RADIUS * HEAL_RADIUS && ally.health < ally.maxHealth) {
                const healAmount = Math.max(40, Math.floor(ally.maxHealth * 0.35));
                ally.health = Math.min(ally.maxHealth, ally.health + healAmount);
                ally.updateHealthBar();
                this.createHealingEffect(gameInstance, ally.mesh.position);
                healedSomeone = true;
            }
        });

        if (healedSomeone) {
            this.lastReviveTime = now;
            this.createRevivalEffect(gameInstance, this.mesh.position);
        }
    }
    
    createBlinkingEffect(unit, gameInstance) {
        if (!unit.mesh || !unit.mesh.material) return;
        
        let blinkCount = 0;
        const maxBlinks = 6;
        const originalColor = unit.mesh.material.color.clone();
        
        const blink = () => {
            if (blinkCount >= maxBlinks) {
                unit.mesh.material.color.copy(originalColor);
                return;
            }
            
            // Toggle between red and original
            if (blinkCount % 2 === 0) {
                unit.mesh.material.color.setHex(0xff0000);
            } else {
                unit.mesh.material.color.copy(originalColor);
            }
            
            blinkCount++;
            setTimeout(blink, 150);
        };
        
        blink();
    }
    
    createRevivalEffect(gameInstance, position) {
        if (!gameInstance || !gameInstance.scene) return;
        
        // Create green healing cross effect
        const crossGeometry = new THREE.BoxGeometry(0.5, 2, 0.2);
        const crossMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8
        });
        const cross1 = new THREE.Mesh(crossGeometry, crossMaterial);
        const cross2 = new THREE.Mesh(crossGeometry, crossMaterial);
        cross2.rotation.z = Math.PI / 2;
        
        const crossGroup = new THREE.Group();
        crossGroup.add(cross1);
        crossGroup.add(cross2);
        crossGroup.position.copy(position);
        crossGroup.position.y = 2;
        
        gameInstance.scene.add(crossGroup);
        
        // Animate
        let opacity = 0.8;
        let scale = 0.5;
        const animate = () => {
            scale += 0.05;
            opacity -= 0.05;
            crossGroup.scale.set(scale, scale, scale);
            cross1.material.opacity = opacity;
            cross2.material.opacity = opacity;
            
            if (opacity <= 0) {
                gameInstance.scene.remove(crossGroup);
                crossGeometry.dispose();
                crossMaterial.dispose();
            } else {
                requestAnimationFrame(animate);
            }
        };
        animate();
    }
    
    heal(amount) {
        this.health = Math.min(this.maxHealth, this.health + amount);
    }
    
    findTarget(enemies, bases, gameInstance) {
        // Clear any existing target first
        this.target = null;
        let closestDistance = Infinity;
        
        // Check if there's a colonel focus target for player units
        if (this.team === 'player' && this.unitType !== 'colonel') {
            const friendlyColonel = enemies.find(ally => 
                ally.team === this.team && 
                ally.unitType === 'colonel' && 
                ally.alive && 
                ally.focusTarget && 
                ally.focusTarget.alive
            );
            
            if (friendlyColonel && friendlyColonel.focusTarget) {
                // Override normal targeting - focus on colonel's marked target
                this.target = friendlyColonel.focusTarget;
                return;
            }
        }
        
        // MINERS NEVER TARGET ANYONE
        if (this.unitType === 'miner') {
            this.target = null;
            return;
        }
        
        // Get all potential enemy targets
        let potentialTargets = enemies.filter(enemy => 
            enemy.alive && 
            enemy.team !== this.team && 
            enemy.unitType !== 'miner'
        );
        
        // If no combat units found, allow targeting miners
        if (potentialTargets.length === 0) {
            potentialTargets = enemies.filter(enemy => 
                enemy.alive && 
                enemy.team !== this.team && 
                enemy.unitType === 'miner'
            );
        }
        
        const enemyBase = this.team === 'player' ? bases.enemy : bases.player;
        const myBase = this.team === 'player' ? bases.player : bases.enemy;
        
        // Filter out targets that are behind our own base
        potentialTargets = potentialTargets.filter(enemy => {
            const enemyX = enemy.mesh.position.x;
            const myBaseX = myBase.position.x;
            
            // If player team (left side), don't target enemies further left than our base
            if (this.team === 'player') {
                return enemyX > myBaseX - 5;
            } else {
                // If enemy team (right side), don't target enemies further right than our base
                return enemyX < myBaseX + 5;
            }
        });
        
        // PRIORITY TARGETING: Target closest enemy to MY OWN BASE (front-line targeting)
        potentialTargets.forEach(enemy => {
            const distanceToMyBase = enemy.mesh.position.distanceTo(myBase.position);
            if (distanceToMyBase < closestDistance) {
                closestDistance = distanceToMyBase;
                this.target = enemy;
            }
        });
        
        // DEFEND STANCE: Only target enemies within aggro range
        if (this.stance === 'defend' && this.team === 'player') {
            const DEFEND_AGGRO_RANGE = 18;
            
            // Check if current target is in range
            if (this.target) {
                const distance = this.mesh.position.distanceTo(this.target.mesh.position);
                if (distance > DEFEND_AGGRO_RANGE) {
                    this.target = null; // Lose aggro if too far
                }
            }
            return;
        }
        
        // ATTACK STANCE: Already have closest front-line target
        if (this.stance === 'attack' && this.team === 'player') {
            // Only target base if no enemy units and close enough
            if (!this.target) {
                const distanceToBase = this.mesh.position.distanceTo(enemyBase.position);
                if (distanceToBase < 40) {
                    this.target = enemyBase;
                }
            }
            return;
        }
        
        // RETREAT STANCE: Only target very close enemies
        if (this.stance === 'retreat' && this.team === 'player') {
            if (this.target) {
                const distance = this.mesh.position.distanceTo(this.target.mesh.position);
                if (distance > 8) {
                    this.target = null; // Only target very close enemies
                }
            }
            return;
        }
        
        // ENEMY AI: Already have closest front-line target
        if (this.team === 'enemy') {
            // If no units nearby, target base if close
            if (!this.target) {
                const distanceToBase = this.mesh.position.distanceTo(enemyBase.position);
                if (distanceToBase < 15) {
                    this.target = enemyBase;
                }
            }
        }
    }
    
    getEffectiveRange() {
        // Proper range values for each unit type
        const ranges = {
            grunt: 0,
            miner: 0,
            assault: 12, // Reduced scaling
            medic: 0,
            grenadier: 14, 
            sniper: 25, 
            sergeant: 14, 
            rocketeer: 18, 
            riot: 8, 
            surgeon: 10, 
            colonel: 15, 
            commando: 12 
        };
        return ranges[this.unitType] || 0;
    }
    
    moveToTarget(deltaTime) {
        if (!this.targetPosition) {
            console.log(`Unit ${this.unitType} has no target position!`);
            this.hasTarget = false;
            this.isPlayerControlled = false;
            return;
        }
        
        const direction = new THREE.Vector3();
        direction.subVectors(this.targetPosition, this.mesh.position);
        const distance = direction.length();
        direction.normalize();
        
        console.log(`Unit ${this.unitType} moving to target. Distance: ${distance.toFixed(2)}`);
        
        if (distance < 1.5) { // Reached target
            this.hasTarget = false;
            this.targetPosition = null;
            this.isPlayerControlled = false;
            console.log(`Unit ${this.unitType} reached target and stopped`);
        } else {
            const moveSpeed = this.speed * deltaTime * 1.2; // Slightly faster movement
            const moveVector = direction.multiplyScalar(moveSpeed);
            this.mesh.position.add(moveVector);
            
            // Maintain ground level during movement
            this.mesh.position.y = 0;
            
            // Make unit look towards target
            const lookTarget = this.targetPosition.clone();
            lookTarget.y = this.mesh.position.y;
            this.mesh.lookAt(lookTarget);
        }
    }
    
    handleEnemyPositioning(deltaTime, bases) {
        // SIMPLIFIED: Just move to attack or defend position based on enemyPosition
        // FIX: Use consistent speed without multipliers
        const moveSpeed = this.speed * deltaTime;
        
        if (this.enemyPosition === 'attack') {
            // Attack: move toward player base
            const targetPos = new THREE.Vector3(bases.player.position.x + 10, 0, bases.player.position.z);
            const distance = this.mesh.position.distanceTo(targetPos);
            
            if (distance > 3) {
                const direction = new THREE.Vector3();
                direction.subVectors(targetPos, this.mesh.position).normalize();
                this.mesh.position.add(direction.multiplyScalar(moveSpeed));
                this.mesh.position.y = 0;
            }
        } else if (this.enemyPosition === 'retreat') {
            // Retreat: move BEHIND enemy base (away from player)
            const targetPos = new THREE.Vector3(bases.enemy.position.x + 10, 0, bases.enemy.position.z);
            const distance = this.mesh.position.distanceTo(targetPos);
            
            if (distance > 2) {
                const direction = new THREE.Vector3();
                direction.subVectors(targetPos, this.mesh.position).normalize();
                this.mesh.position.add(direction.multiplyScalar(moveSpeed));
                this.mesh.position.y = 0;
                // Look at retreat target
                this.mesh.lookAt(targetPos);
            }
        } else {
            // Defend: stay in front of enemy base
            const targetPos = new THREE.Vector3(bases.enemy.position.x - 8, 0, bases.enemy.position.z);
            const distance = this.mesh.position.distanceTo(targetPos);
            
            if (distance > 5) {
                const direction = new THREE.Vector3();
                direction.subVectors(targetPos, this.mesh.position).normalize();
                this.mesh.position.add(direction.multiplyScalar(moveSpeed));
                this.mesh.position.y = 0;
            }
        }
    }
    
    collectResources(deltaTime, gameInstance) {
        const now = Date.now();
        if (now - this.lastResourceCollection >= 3000) {
            this.lastResourceCollection = now;
            if (gameInstance && gameInstance.addResources) {
                const upgradeLevel = gameInstance.getUnitUpgradeLevel ? gameInstance.getUnitUpgradeLevel(this.unitType) : 0;
                const baseAmount = 2;
                const bonusAmount = upgradeLevel * 2; // Increased from 5 - each upgrade adds +2 resources
                gameInstance.addResources(baseAmount + bonusAmount);
            }
            
            // Enemy miners also generate resources for enemy
            if (this.team === 'enemy' && gameInstance && gameInstance.enemyResources !== undefined) {
                gameInstance.enemyResources += 8;
            }
        }
    }
    
    // Simple gun recoil animation (attached to hand)
    update(deltaTime, enemies, bases, gameInstance = null) {
        if (!this.alive && !this.isDying) return;
        
        // NEW: no limb/eye animation while dying handled in death anim
        if (this.isDying) {
            this.updateDeathAnimation(deltaTime, gameInstance);
            return;
        }

        // Check stun status
        if (this.isStunned && Date.now() > this.stunEndTime) {
            this.isStunned = false;
        }
        
        // Skip most actions if stunned
        if (this.isStunned) {
            this.updateHealthBar();
            return;
        }

        // Commando berserker mode check
        if (this.unitType === 'commando' && !this.berserkerActivated && this.health <= this.maxHealth * 0.2) {
            this.activateBerserkerMode(gameInstance);
        }

        // Remove reference to non-existent neonEdges to avoid errors
        if (this.neonOutline) {
            if (!this.neonPulseTime) this.neonPulseTime = 0;
            this.neonPulseTime += deltaTime * 4;
            const pulseIntensity = 0.4 + Math.sin(this.neonPulseTime) * 0.3;
            this.neonOutline.material.opacity = pulseIntensity;
        }

        // Simple gun recoil animation
        if (this.gun && this.recoilTime > 0) {
            this.recoilTime -= deltaTime;
            const t = Math.max(this.recoilTime, 0);
            const offset = Math.sin(t * 20) * 0.06;
            this.gun.position.z = 0.45 - offset;
        }

        // Update UI to always face camera
        if (this.uiGroup && gameInstance && gameInstance.camera) {
            this.uiGroup.lookAt(gameInstance.camera.position);
            this.updateHealthBar();
        }

        // Ensure unit stays on ground level
        this.mesh.position.y = 0;
        
        // NEW: apply simple separation so units don't clump
        if (gameInstance && enemies && enemies.length > 0) {
            this.applySeparation(enemies, deltaTime);
        }

        // BOUNDARY ENFORCEMENT - prevent units from going too far
        const maxX = 40;
        const maxZ = 35;
        if (Math.abs(this.mesh.position.x) > maxX) {
            this.mesh.position.x = Math.sign(this.mesh.position.x) * maxX;
        }
        if (Math.abs(this.mesh.position.z) > maxZ) {
            this.mesh.position.z = Math.sign(this.mesh.position.z) * maxZ;
        }

        // Check for base collision if game instance available
        if (gameInstance && gameInstance.checkBaseCollision) {
            gameInstance.checkBaseCollision(this);
        }

        // COLONEL ABILITY - Focus Fire Marker
        if (this.unitType === 'colonel' && this.team === 'player') {
            this.handleColonelFocusFire(gameInstance, enemies);
        }

        // Handle wandering behavior for defend/retreat stances
        if (this.team === 'player' && (this.stance === 'defend' || this.stance === 'retreat')) {
            this.handleWandering(deltaTime, bases);
        }

        // PRIORITY 1: Handle player unit movement to target - BUT ALLOW COMBAT
        if (this.team === 'player' && this.hasTarget && this.targetPosition && this.isPlayerControlled) {
            // Check for nearby enemies first - if any within range, fight them
            const nearbyEnemies = enemies.filter(e => 
                e.alive && 
                e.team !== this.team && 
                e.unitType !== 'miner' &&
                this.mesh.position.distanceTo(e.mesh.position) < 15
            );
            
            if (nearbyEnemies.length > 0) {
                // Stop moving and fight
                this.findTarget(enemies, bases);
                if (this.target) {
                    const distance = this.mesh.position.distanceTo(this.target.mesh ? this.target.mesh.position : this.target.position);
                    // Use standardized range
                    const effectiveRange = this.range;
                    
                    if (effectiveRange > 0) {
                        if (distance <= effectiveRange) {
                            this.rangedAttack(gameInstance);
                            const targetPos = this.target.mesh ? this.target.mesh.position : this.target.position;
                            this.mesh.lookAt(targetPos);
                        } else {
                            this.moveTowardsTarget(deltaTime);
                        }
                    } else {
                        if (distance <= 2) {
                            this.attack();
                        } else {
                            this.moveTowardsTarget(deltaTime);
                        }
                    }
                    this.updateHealthBar();
                    return;
                }
            }
            
            // No enemies nearby - continue moving to target
            this.moveToTarget(deltaTime);
            this.updateHealthBar();
            
            // After reaching position, allow wandering to take over
            if (!this.hasTarget && (this.stance === 'defend' || this.stance === 'retreat')) {
                this.isPlayerControlled = false;
            }
            return;
        }
        
        // Handle enemy AI positioning
        if (this.team === 'enemy' && this.unitType !== 'miner') {
            this.handleEnemyPositioning(deltaTime, bases);
            this.mesh.position.y = 0;
        }
        
        // Miner behavior - NEVER CHASE ENEMIES
        if (this.unitType === 'miner') {
            this.collectResources(deltaTime, gameInstance);
            
            // Normal wandering behavior when safe - STAY NEAR BASE
            if (!this.isPlayerControlled) {
                if (!this.hasTarget && Math.random() < 0.001) {
                    const basePos = this.team === 'player' ? bases.player.position : bases.enemy.position;
                    const randomOffset = (Math.random() - 0.5) * 6;
                    this.targetPosition = new THREE.Vector3(
                        basePos.x + randomOffset,
                        0,
                        basePos.z + (Math.random() - 0.5) * 6
                    );
                    this.hasTarget = true;
                }
                if (this.hasTarget && this.targetPosition) {
                    this.moveToTarget(deltaTime);
                }
            }
            this.mesh.position.y = 0;
            return;
        }
        
        // Medic behavior - AOE BURST HEALING
        if (this.unitType === 'medic') {
            this.healAllies(enemies.filter(e => e.team === this.team), gameInstance);
        }

        // Surgeon revive behavior - ALWAYS ACTIVE FOR BOTH TEAMS
        if (this.unitType === 'surgeon') {
            this.handleSurgeonRevive(gameInstance);
        }
        
        // NEW SIMPLIFIED COMBAT LOGIC
        this.findTarget(enemies, bases, gameInstance);
        
        if (this.target) {
            const distance = this.mesh.position.distanceTo(this.target.mesh ? this.target.mesh.position : this.target.position);
            const effectiveRange = this.range;
            
            // Ranged combat
            if (effectiveRange > 0) {
                if (distance <= effectiveRange) {
                    // In range - attack
                    this.rangedAttack(gameInstance);
                    // Face target but don't move if in attack stance
                    if (this.stance === 'attack') {
                        const targetPos = this.target.mesh ? this.target.mesh.position : this.target.position;
                        this.mesh.lookAt(targetPos);
                    }
                } else {
                    // Out of range - move closer
                    this.moveTowardsTarget(deltaTime);
                }
            } else {
                // Melee combat
                if (distance <= 2) {
                    this.attack();
                } else {
                    this.moveTowardsTarget(deltaTime);
                }
            }
        } else {
            // No target - move based on stance
            if (this.stance === 'attack' && this.team === 'player') {
                // Attack stance with no target - move towards enemy territory
                const enemyPos = bases.enemy.position;
                const distanceToEnemy = this.mesh.position.distanceTo(enemyPos);
                if (distanceToEnemy > 15) {
                    this.moveForward(deltaTime);
                }
            } else if (this.stance === 'defend' && this.team === 'player') {
                // Stay near base
                const basePos = bases.player.position;
                const distanceToBase = this.mesh.position.distanceTo(basePos);
                if (distanceToBase > 12) {
                    const direction = new THREE.Vector3().subVectors(basePos, this.mesh.position).normalize();
                    this.mesh.position.add(direction.multiplyScalar(this.speed * deltaTime * 0.5));
                    this.mesh.position.y = 0;
                }
            } else if (this.team === 'enemy') {
                // Enemy AI - move towards player base
                this.moveForward(deltaTime);
            }
        }
        
        // Update health bar
        this.updateHealthBar();
        
        // Final position check
        this.mesh.position.y = Math.max(0, this.mesh.position.y);

        // NEW: animate limbs and eyes based on movement
        this.updateVisualAnimations(deltaTime);
    }
    
    handleColonelFocusFire(gameInstance, enemies) {
        const now = Date.now();
        
        // Check if it's time to mark a new target
        if (now - this.lastFocusFireTime >= this.focusFireCooldown) {
            this.lastFocusFireTime = now;
            
            // Find enemy units to mark
            const enemyUnits = enemies.filter(e => e.alive && e.team !== this.team && e.unitType !== 'miner');
            
            if (enemyUnits.length > 0) {
                // Prioritize high-value targets
                const unitValues = {
                    commando: 1000, colonel: 900, surgeon: 800, riot: 700, rocketeer: 600,
                    sergeant: 500, sniper: 400, grenadier: 300, assault: 200, medic: 150,
                    grunt: 100
                };
                
                let highestValue = -1;
                let targetToMark = null;
                
                enemyUnits.forEach(enemy => {
                    const value = unitValues[enemy.unitType] || 50;
                    if (value > highestValue) {
                        highestValue = value;
                        targetToMark = enemy;
                    }
                });
                
                if (targetToMark) {
                    this.focusTarget = targetToMark;
                    this.createFocusFireVisuals(targetToMark, gameInstance);
                    this.createFocusFireAura(gameInstance);
                }
            }
        }
        
        // Check if marked target is dead to award gold
        if (this.focusTarget && !this.focusTarget.alive && gameInstance) {
            // Award 10 gold
            if (gameInstance.addResources) {
                gameInstance.addResources(10);
            }
            // Clear the mark
            this.clearFocusTarget();
        }
    }
    
    createFocusFireVisuals(target, gameInstance) {
        if (!gameInstance || !gameInstance.scene) return;
        
        // Remove old marker if exists
        if (this.targetMarkEmoji && this.targetMarkEmoji.parent) {
            this.targetMarkEmoji.parent.remove(this.targetMarkEmoji);
        }
        
        // Create emoji marker (crosshair symbol)
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        context.font = 'bold 80px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('🎯', 64, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        this.targetMarkEmoji = new THREE.Sprite(material);
        this.targetMarkEmoji.scale.set(2, 2, 1);
        this.targetMarkEmoji.position.y = 5;
        
        target.mesh.add(this.targetMarkEmoji);
        
        // Add highlight glow to target
        if (target.mesh.material) {
            target.mesh.material.emissive = new THREE.Color(0xff0000);
            target.mesh.material.emissiveIntensity = 0.5;
        }
        
        // Animate marker
        const animateMarker = () => {
            if (this.targetMarkEmoji && this.targetMarkEmoji.parent && this.focusTarget === target) {
                this.targetMarkEmoji.position.y = 5 + Math.sin(Date.now() * 0.005) * 0.3;
                requestAnimationFrame(animateMarker);
            }
        };
        animateMarker();
    }
    
    createFocusFireAura(gameInstance) {
        if (!gameInstance || !gameInstance.scene) return;
        
        // Create expanding ring aura effect
        const ringGeometry = new THREE.RingGeometry(1, 1.5, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffff00, 
            transparent: true, 
            opacity: 0.8,
            side: THREE.DoubleSide 
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(this.mesh.position);
        ring.position.y = 0.5;
        gameInstance.scene.add(ring);
        
        // Animate ring expansion
        let scale = 1;
        let opacity = 0.8;
        const animateRing = () => {
            scale += 0.15;
            opacity -= 0.04;
            ring.scale.set(scale, scale, scale);
            ring.material.opacity = opacity;
            if (opacity <= 0) {
                gameInstance.scene.remove(ring);
                ringGeometry.dispose();
                ringMaterial.dispose();
            } else {
                requestAnimationFrame(animateRing);
            }
        };
        animateRing();
    }
    
    clearFocusTarget() {
        if (this.focusTarget && this.focusTarget.mesh && this.focusTarget.mesh.material) {
            this.focusTarget.mesh.material.emissive = new THREE.Color(0x000000);
            this.focusTarget.mesh.material.emissiveIntensity = 0;
        }
        if (this.targetMarkEmoji && this.targetMarkEmoji.parent) {
            this.targetMarkEmoji.parent.remove(this.targetMarkEmoji);
        }
        this.focusTarget = null;
        this.targetMarkEmoji = null;
    }
    
    activateBerserkerMode(gameInstance) {
        this.berserkerActivated = true;
        
        // Double fire rate
        this.attackCooldown = this.originalAttackCooldown * 0.5;
        
        // Heal to 75% health
        this.health = this.maxHealth * 0.75;
        this.updateHealthBar();
        
        // Create berserker glow effect
        if (gameInstance && gameInstance.scene) {
            const glowGeometry = new THREE.SphereGeometry(1.5, 16, 16);
            const glowMaterial = new THREE.MeshBasicMaterial({ 
                color: 0xff0000,
                transparent: true,
                opacity: 0.4,
                side: THREE.BackSide
            });
            this.berserkerGlow = new THREE.Mesh(glowGeometry, glowMaterial);
            this.mesh.add(this.berserkerGlow);
            
            // Pulsing animation
            const animateGlow = () => {
                if (this.berserkerGlow && this.alive) {
                    const scale = 1 + Math.sin(Date.now() * 0.01) * 0.2;
                    this.berserkerGlow.scale.set(scale, scale, scale);
                    requestAnimationFrame(animateGlow);
                }
            };
            animateGlow();
        }
    }
    
    // NEW: Surgeon revive ability – every 6s, revive a nearby fallen ally or big-heal if none are down
    handleSurgeonRevive(gameInstance) {
        if (!gameInstance) return;

        const now = Date.now();
        const cooldown = this.reviveCooldown || 6000;
        if (now - this.lastReviveTime < cooldown) return;

        const allyArmy = this.team === 'player' ? gameInstance.playerArmy : gameInstance.enemyArmy;
        if (!allyArmy || !allyArmy.units) return;

        // 1) Try to REVIVE a recently-dead ally whose death animation is still playing
        const REVIVE_RADIUS = 12;
        let reviveTarget = null;
        let closestDistSq = Infinity;

        allyArmy.units.forEach(ally => {
            if (!ally || !ally.mesh) return;
            // Candidate: not alive, currently in death animation, and still in the scene
            if (!ally.alive && ally.isDying && ally.mesh.parent) {
                const distSq = ally.mesh.position.distanceToSquared(this.mesh.position);
                if (distSq <= REVIVE_RADIUS * REVIVE_RADIUS && distSq < closestDistSq) {
                    closestDistSq = distSq;
                    reviveTarget = ally;
                }
            }
        });

        if (reviveTarget) {
            this.lastReviveTime = now;

            // Cancel their death and bring them back
            reviveTarget.alive = true;
            reviveTarget.isDying = false;
            reviveTarget.health = Math.floor(reviveTarget.maxHealth * 0.75);
            reviveTarget.updateHealthBar();

            // Reset visual fade/position
            if (reviveTarget.mesh) {
                reviveTarget.mesh.position.y = 0;
                reviveTarget.mesh.rotation.x = 0;
                reviveTarget.mesh.rotation.z = 0;
                reviveTarget.mesh.traverse(child => {
                    if (child.isMesh && child.material) {
                        child.material.transparent = true;
                        child.material.opacity = 1;
                    }
                });
                if (reviveTarget.uiGroup) reviveTarget.uiGroup.visible = true;
            }

            // Resurrection VFX
            this.createResurrectionEffect(gameInstance, reviveTarget.mesh.position);
            this.createBlinkingEffect(reviveTarget, gameInstance);
            return;
        }

        // 2) If no one to revive, do a chunky AoE heal as a fallback
        const allies = allyArmy.units.filter(u => u && u.mesh && u.alive && u.health > 0);
        const HEAL_RADIUS = 14;
        let healedSomeone = false;

        allies.forEach(ally => {
            const distSq = ally.mesh.position.distanceToSquared(this.mesh.position);
            if (distSq <= HEAL_RADIUS * HEAL_RADIUS && ally.health < ally.maxHealth) {
                const healAmount = Math.max(40, Math.floor(ally.maxHealth * 0.35));
                ally.health = Math.min(ally.maxHealth, ally.health + healAmount);
                ally.updateHealthBar();
                this.createHealingEffect(gameInstance, ally.mesh.position);
                healedSomeone = true;
            }
        });

        if (healedSomeone) {
            this.lastReviveTime = now;
            this.createRevivalEffect(gameInstance, this.mesh.position);
        }
    }
    
    createBlinkingEffect(unit, gameInstance) {
        if (!unit.mesh || !unit.mesh.material) return;
        
        let blinkCount = 0;
        const maxBlinks = 6;
        const originalColor = unit.mesh.material.color.clone();
        
        const blink = () => {
            if (blinkCount >= maxBlinks) {
                unit.mesh.material.color.copy(originalColor);
                return;
            }
            
            // Toggle between red and original
            if (blinkCount % 2 === 0) {
                unit.mesh.material.color.setHex(0xff0000);
            } else {
                unit.mesh.material.color.copy(originalColor);
            }
            
            blinkCount++;
            setTimeout(blink, 150);
        };
        
        blink();
    }
    
    createRevivalEffect(gameInstance, position) {
        if (!gameInstance || !gameInstance.scene) return;
        
        // Create green healing cross effect
        const crossGeometry = new THREE.BoxGeometry(0.5, 2, 0.2);
        const crossMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8
        });
        const cross1 = new THREE.Mesh(crossGeometry, crossMaterial);
        const cross2 = new THREE.Mesh(crossGeometry, crossMaterial);
        cross2.rotation.z = Math.PI / 2;
        
        const crossGroup = new THREE.Group();
        crossGroup.add(cross1);
        crossGroup.add(cross2);
        crossGroup.position.copy(position);
        crossGroup.position.y = 2;
        
        gameInstance.scene.add(crossGroup);
        
        // Animate
        let opacity = 0.8;
        let scale = 0.5;
        const animate = () => {
            scale += 0.05;
            opacity -= 0.05;
            crossGroup.scale.set(scale, scale, scale);
            cross1.material.opacity = opacity;
            cross2.material.opacity = opacity;
            
            if (opacity <= 0) {
                gameInstance.scene.remove(crossGroup);
                crossGeometry.dispose();
                crossMaterial.dispose();
            } else {
                requestAnimationFrame(animate);
            }
        };
        animate();
    }
    
    heal(amount) {
        this.health = Math.min(this.maxHealth, this.health + amount);
    }
    
    findTarget(enemies, bases, gameInstance) {
        // Clear any existing target first
        this.target = null;
        let closestDistance = Infinity;
        
        // Check if there's a colonel focus target for player units
        if (this.team === 'player' && this.unitType !== 'colonel') {
            const friendlyColonel = enemies.find(ally => 
                ally.team === this.team && 
                ally.unitType === 'colonel' && 
                ally.alive && 
                ally.focusTarget && 
                ally.focusTarget.alive
            );
            
            if (friendlyColonel && friendlyColonel.focusTarget) {
                // Override normal targeting - focus on colonel's marked target
                this.target = friendlyColonel.focusTarget;
                return;
            }
        }
        
        // MINERS NEVER TARGET ANYONE
        if (this.unitType === 'miner') {
            this.target = null;
            return;
        }
        
        // Get all potential enemy targets
        let potentialTargets = enemies.filter(enemy => 
            enemy.alive && 
            enemy.team !== this.team && 
            enemy.unitType !== 'miner'
        );
        
        // If no combat units found, allow targeting miners
        if (potentialTargets.length === 0) {
            potentialTargets = enemies.filter(enemy => 
                enemy.alive && 
                enemy.team !== this.team && 
                enemy.unitType === 'miner'
            );
        }
        
        const enemyBase = this.team === 'player' ? bases.enemy : bases.player;
        const myBase = this.team === 'player' ? bases.player : bases.enemy;
        
        // Filter out targets that are behind our own base
        potentialTargets = potentialTargets.filter(enemy => {
            const enemyX = enemy.mesh.position.x;
            const myBaseX = myBase.position.x;
            
            // If player team (left side), don't target enemies further left than our base
            if (this.team === 'player') {
                return enemyX > myBaseX - 5;
            } else {
                // If enemy team (right side), don't target enemies further right than our base
                return enemyX < myBaseX + 5;
            }
        });
        
        // PRIORITY TARGETING: Target closest enemy to MY OWN BASE (front-line targeting)
        potentialTargets.forEach(enemy => {
            const distanceToMyBase = enemy.mesh.position.distanceTo(myBase.position);
            if (distanceToMyBase < closestDistance) {
                closestDistance = distanceToMyBase;
                this.target = enemy;
            }
        });
        
        // DEFEND STANCE: Only target enemies within aggro range
        if (this.stance === 'defend' && this.team === 'player') {
            const DEFEND_AGGRO_RANGE = 18;
            
            // Check if current target is in range
            if (this.target) {
                const distance = this.mesh.position.distanceTo(this.target.mesh.position);
                if (distance > DEFEND_AGGRO_RANGE) {
                    this.target = null; // Lose aggro if too far
                }
            }
            return;
        }
        
        // ATTACK STANCE: Already have closest front-line target
        if (this.stance === 'attack' && this.team === 'player') {
            // Only target base if no enemy units and close enough
            if (!this.target) {
                const distanceToBase = this.mesh.position.distanceTo(enemyBase.position);
                if (distanceToBase < 40) {
                    this.target = enemyBase;
                }
            }
            return;
        }
        
        // RETREAT STANCE: Only target very close enemies
        if (this.stance === 'retreat' && this.team === 'player') {
            if (this.target) {
                const distance = this.mesh.position.distanceTo(this.target.mesh.position);
                if (distance > 8) {
                    this.target = null; // Only target very close enemies
                }
            }
            return;
        }
        
        // ENEMY AI: Already have closest front-line target
        if (this.team === 'enemy') {
            // If no units nearby, target base if close
            if (!this.target) {
                const distanceToBase = this.mesh.position.distanceTo(enemyBase.position);
                if (distanceToBase < 15) {
                    this.target = enemyBase;
                }
            }
        }
    }
    
    getEffectiveRange() {
        // Proper range values for each unit type
        const ranges = {
            grunt: 0,
            miner: 0,
            assault: 12, // Reduced scaling
            medic: 0,
            grenadier: 14, 
            sniper: 25, 
            sergeant: 14, 
            rocketeer: 18, 
            riot: 8, 
            surgeon: 10, 
            colonel: 15, 
            commando: 12 
        };
        return ranges[this.unitType] || 0;
    }
    
    moveToTarget(deltaTime) {
        if (!this.targetPosition) {
            console.log(`Unit ${this.unitType} has no target position!`);
            this.hasTarget = false;
            this.isPlayerControlled = false;
            return;
        }
        
        const direction = new THREE.Vector3();
        direction.subVectors(this.targetPosition, this.mesh.position);
        const distance = direction.length();
        direction.normalize();
        
        console.log(`Unit ${this.unitType} moving to target. Distance: ${distance.toFixed(2)}`);
        
        if (distance < 1.5) { // Reached target
            this.hasTarget = false;
            this.targetPosition = null;
            this.isPlayerControlled = false;
            console.log(`Unit ${this.unitType} reached target and stopped`);
        } else {
            const moveSpeed = this.speed * deltaTime * 1.2; // Slightly faster movement
            const moveVector = direction.multiplyScalar(moveSpeed);
            this.mesh.position.add(moveVector);
            
            // Maintain ground level during movement
            this.mesh.position.y = 0;
            
            // Make unit look towards target
            const lookTarget = this.targetPosition.clone();
            lookTarget.y = this.mesh.position.y;
            this.mesh.lookAt(lookTarget);
        }
    }
    
    handleEnemyPositioning(deltaTime, bases) {
        // SIMPLIFIED: Just move to attack or defend position based on enemyPosition
        // FIX: Use consistent speed without multipliers
        const moveSpeed = this.speed * deltaTime;
        
        if (this.enemyPosition === 'attack') {
            // Attack: move toward player base
            const targetPos = new THREE.Vector3(bases.player.position.x + 10, 0, bases.player.position.z);
            const distance = this.mesh.position.distanceTo(targetPos);
            
            if (distance > 3) {
                const direction = new THREE.Vector3();
                direction.subVectors(targetPos, this.mesh.position).normalize();
                this.mesh.position.add(direction.multiplyScalar(moveSpeed));
                this.mesh.position.y = 0;
            }
        } else if (this.enemyPosition === 'retreat') {
            // Retreat: move BEHIND enemy base (away from player)
            const targetPos = new THREE.Vector3(bases.enemy.position.x + 10, 0, bases.enemy.position.z);
            const distance = this.mesh.position.distanceTo(targetPos);
            
            if (distance > 2) {
                const direction = new THREE.Vector3();
                direction.subVectors(targetPos, this.mesh.position).normalize();
                this.mesh.position.add(direction.multiplyScalar(moveSpeed));
                this.mesh.position.y = 0;
                // Look at retreat target
                this.mesh.lookAt(targetPos);
            }
        } else {
            // Defend: stay in front of enemy base
            const targetPos = new THREE.Vector3(bases.enemy.position.x - 8, 0, bases.enemy.position.z);
            const distance = this.mesh.position.distanceTo(targetPos);
            
            if (distance > 5) {
                const direction = new THREE.Vector3();
                direction.subVectors(targetPos, this.mesh.position).normalize();
                this.mesh.position.add(direction.multiplyScalar(moveSpeed));
                this.mesh.position.y = 0;
            }
        }
    }
    
    collectResources(deltaTime, gameInstance) {
        const now = Date.now();
        if (now - this.lastResourceCollection >= 3000) {
            this.lastResourceCollection = now;
            if (gameInstance && gameInstance.addResources) {
                const upgradeLevel = gameInstance.getUnitUpgradeLevel ? gameInstance.getUnitUpgradeLevel(this.unitType) : 0;
                const baseAmount = 2;
                const bonusAmount = upgradeLevel * 2; // Increased from 5 - each upgrade adds +2 resources
                gameInstance.addResources(baseAmount + bonusAmount);
            }
            
            // Enemy miners also generate resources for enemy
            if (this.team === 'enemy' && gameInstance && gameInstance.enemyResources !== undefined) {
                gameInstance.enemyResources += 8;
            }
        }
    }
    
    rangedAttack(gameInstance) {
        if (!this.target) return;
        
        // Strict range check to prevent Colonel infinite range exploit
        const targetPos = this.target.mesh ? this.target.mesh.position : this.target.position;
        const distance = this.mesh.position.distanceTo(targetPos);
        const maxRange = this.range + 2; // Allow small buffer
        
        if (distance > maxRange) {
             // Out of range, cannot attack even if cooldown is ready
             return;
        }

        const now = Date.now();
        if (now - this.lastAttackTime < this.attackCooldown) return;
        
        this.lastAttackTime = now;
        
        // Start recoil animation if gun exists
        if (this.gun) {
            this.recoilTime = 0.15;
        }

        // PLAY FIRE SFX: explosive launcher vs normal gun
        if (this.unitType === 'rocketeer' || this.unitType === 'grenadier' || this.unitType === 'riot') {
            playSfx(SFX.grenadeShot);
        } else {
            playSfx(SFX.gunshot);
        }
        
        if (!gameInstance || !gameInstance.scene) {
            return; // Can't create visual effects without game instance
        }
        
        // Create different projectiles based on unit type
        let projectileGeometry, projectileMaterial, projectileSpeed, trailType;
        
        // USE CACHED GEOMETRIES TO PREVENT LAG
        switch(this.unitType) {
            case 'grenadier':
                projectileGeometry = GEOMETRIES.sphere_small;
                projectileMaterial = new THREE.MeshBasicMaterial({ color: 0x808080 });
                projectileSpeed = 0.8; 
                trailType = 'smoke';
                break;
                
            case 'rocketeer':
                // Sleek rocket with brighter body
                projectileGeometry = GEOMETRIES.rocket_body;
                projectileMaterial = new THREE.MeshBasicMaterial({ color: 0xffdd55 });
                projectileSpeed = 0.375; 
                trailType = 'fire';
                break;
                
            case 'riot':
                projectileGeometry = GEOMETRIES.box_small;
                projectileMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff });
                projectileSpeed = 1.0; 
                trailType = 'smoke';
                break;
                
            default:
                projectileGeometry = GEOMETRIES.bullet;
                projectileMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
                projectileSpeed = 2.5;
                trailType = 'none';
        }
        
        const projectile = new THREE.Mesh(projectileGeometry, projectileMaterial);
        projectile.position.copy(this.mesh.position);
        projectile.position.y += 0.9;
        
        const direction = new THREE.Vector3().subVectors(targetPos, projectile.position).normalize();
        
        // Let the rocket cylinder travel along the direction vector; no odd lookAt twist needed.
        
        gameInstance.scene.add(projectile);
        
        // Projectile animation with trails
        const animateProjectile = () => {
            if (!projectile.parent) return;
            
            projectile.position.add(direction.clone().multiplyScalar(projectileSpeed));
            
            // Create trail particles - OPTIMIZED and prettier smoke
            if (Math.random() > 0.4) {
                this.createTrail(gameInstance, projectile.position, trailType);
            }
            
            // Check if reached target
            const distanceToTarget = projectile.position.distanceTo(targetPos);
            if (distanceToTarget < 1.5) {
                // Only explosive units create explosions
                if (this.unitType === 'rocketeer' || this.unitType === 'grenadier' || this.unitType === 'riot') {
                    this.createExplosion(gameInstance, projectile.position, this.unitType);
                } else {
                    // Regular bullet hit - deal damage directly to target
                    if (this.target && this.target.takeDamage) {
                        this.target.takeDamage(this.attackDamage);
                    } else if (this.target && this.target.health !== undefined) {
                        // Attacking base
                        this.target.health -= this.attackDamage;
                        if (this.target.health < 0) this.target.health = 0;
                    }
                }
                
                // CLEANUP
                gameInstance.scene.remove(projectile);
                projectileMaterial.dispose(); // Dispose material since it's unique instance
                // Geometry is cached, do not dispose
            } else {
                requestAnimationFrame(animateProjectile);
            }
        };
        
        requestAnimationFrame(animateProjectile);
    }
    
    createTrail(gameInstance, position, trailType) {
        if (trailType === 'none') return;
        
        let trailColor;
        let geometry = GEOMETRIES.sphere_small; // Use cached geometry
        
        switch(trailType) {
            case 'fire': trailColor = 0xff7a1a; break;
            case 'smoke': trailColor = 0x555555; break;
            default: return;
        }
        
        const trailMaterial = new THREE.MeshBasicMaterial({ 
            color: trailColor,
            transparent: true,
            opacity: 0.7
        });
        
        const trailParticle = new THREE.Mesh(geometry, trailMaterial);
        const scaleBase = trailType === 'smoke' ? 0.7 : 0.4;
        trailParticle.scale.set(scaleBase, scaleBase, scaleBase);
        trailParticle.position.copy(position);
        trailParticle.position.y += trailType === 'smoke' ? 0.2 : 0;
        gameInstance.scene.add(trailParticle);
        
        // Fade out & expand smoke a bit
        let opacity = 0.7;
        let scale = scaleBase;
        const fadeTrail = () => {
            opacity -= 0.08;
            scale += 0.05;
            
            if (trailParticle && trailParticle.parent) {
                trailParticle.material.opacity = opacity;
                trailParticle.scale.set(scale, scale, scale);
                trailParticle.position.y += trailType === 'smoke' ? 0.01 : 0;
                
                if (opacity <= 0) {
                    gameInstance.scene.remove(trailParticle);
                    trailMaterial.dispose();
                } else {
                    requestAnimationFrame(fadeTrail);
                }
            }
        };
        requestAnimationFrame(fadeTrail);
    }
    
    createExplosion(gameInstance, position, unitType) {
        // Optimized explosion - pre-filter units by team
        const enemyUnits = this.team === 'player' ? 
            gameInstance.enemyArmy.units.filter(u => u.alive) : 
            gameInstance.playerArmy.units.filter(u => u.alive);
        
        let explosionRadius, stunDuration, geometry, baseDamage = 0;
        
        switch(unitType) {
            case 'rocketeer':
                explosionRadius = 10;
                stunDuration = 2000;
                geometry = GEOMETRIES.sphere_explosion_large;
                baseDamage = this.attackDamage;
                break;
            case 'grenadier':
                explosionRadius = 3;
                stunDuration = 1000;
                geometry = GEOMETRIES.sphere_explosion_medium;
                baseDamage = this.attackDamage;
                break;
            case 'riot':
                explosionRadius = 3;
                stunDuration = 3000;
                geometry = GEOMETRIES.sphere_explosion_medium;
                baseDamage = this.attackDamage;
                break;
            default:
                explosionRadius = 1;
                stunDuration = 0;
                geometry = GEOMETRIES.sphere_explosion_small;
        }
        
        // Explosion SFX (once per explosion impact)
        playSfx(SFX.explosion);
        // Camera screenshake on impact (stronger for big blasts)
        if (gameInstance && typeof gameInstance.shakeCamera === 'function') {
            const intensity = unitType === 'rocketeer' ? 0.6 : 0.35;
            const duration = unitType === 'rocketeer' ? 0.4 : 0.25;
            gameInstance.shakeCamera(intensity, duration);
        }
        
        // Optimized damage calculation - only check enemy units
        const radiusSq = explosionRadius * explosionRadius;
        
        for (let i = 0; i < enemyUnits.length; i++) {
            const unit = enemyUnits[i];
            const distSq = unit.mesh.position.distanceToSquared(position);
            if (distSq < radiusSq) {
                const distance = Math.sqrt(distSq);
                const damageAmount = this.attackDamage * (1 - distance / explosionRadius);
                if (unit.takeDamage) {
                    unit.takeDamage(damageAmount);
                }
                if (stunDuration > 0) {
                    unit.isStunned = true;
                    unit.stunEndTime = Date.now() + stunDuration;
                }
            }
        }
        
        // Check if explosion hits enemy base
        const enemyBase = this.team === 'player' ? gameInstance.bases.enemy : gameInstance.bases.player;
        const distToBase = Math.sqrt(enemyBase.position.distanceToSquared(position));
        
        if (distToBase < explosionRadius && baseDamage > 0) {
            const baseDamageAmount = baseDamage * (1 - distToBase / explosionRadius);
            enemyBase.health -= baseDamageAmount;
            if (enemyBase.health < 0) enemyBase.health = 0;
        }
        
        // Simplified visual explosion effect
        const explosionMaterial = new THREE.MeshBasicMaterial({ 
            color: unitType === 'rocketeer' ? 0xff4400 : 0xffaa00,
            transparent: true,
            opacity: 0.6
        });
        
        const explosion = new THREE.Mesh(geometry, explosionMaterial);
        explosion.position.copy(position);
        explosion.position.y = Math.max(0.5, position.y);
        
        gameInstance.scene.add(explosion);
        
        // Faster explosion animation
        let scale = 0.5;
        let opacity = 0.6;
        const animateExplosion = () => {
            scale += 0.3;
            opacity -= 0.15;
            
            explosion.scale.set(scale, scale, scale);
            explosion.material.opacity = Math.max(0, opacity);
            
            if (opacity <= 0) {
                gameInstance.scene.remove(explosion);
                explosionMaterial.dispose();
            } else {
                requestAnimationFrame(animateExplosion);
            }
        };
        requestAnimationFrame(animateExplosion);
    }
    
    healAllies(allies, gameInstance) {
        const now = Date.now();
        if (now - this.lastHealTime < this.healCooldown) return;
        
        this.lastHealTime = now;
        
        // AOE BURST HEALING - heal ALL nearby allies
        const HEAL_RADIUS = 8;
        let healedCount = 0;
        
        allies.forEach(ally => {
            if (ally !== this && 
                ally.alive && 
                ally.health < ally.maxHealth && 
                this.mesh.position.distanceTo(ally.mesh.position) < HEAL_RADIUS) {
                
                ally.heal(this.healAmount);
                healedCount++;
                
                // Create healing effect for each healed unit
                this.createHealingEffect(gameInstance, ally.mesh.position);
            }
        });
        
        // Create burst effect if healed anyone
        if (healedCount > 0 && gameInstance && gameInstance.scene) {
            // Create expanding healing wave
            const waveGeometry = new THREE.RingGeometry(0.5, 1, 32);
            const waveMaterial = new THREE.MeshBasicMaterial({ 
                color: 0x00ff00,
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide
            });
            const wave = new THREE.Mesh(waveGeometry, waveMaterial);
            wave.rotation.x = -Math.PI / 2;
            wave.position.copy(this.mesh.position);
            wave.position.y = 0.5;
            
            gameInstance.scene.add(wave);
            
            // Animate wave expansion
            let scale = 1;
            let opacity = 0.8;
            const animateWave = () => {
                scale += 0.3;
                opacity -= 0.08;
                
                wave.scale.set(scale, scale, scale);
                wave.material.opacity = Math.max(0, opacity);
                
                if (opacity <= 0) {
                    gameInstance.scene.remove(wave);
                    waveGeometry.dispose();
                    waveMaterial.dispose();
                } else {
                    requestAnimationFrame(animateWave);
                }
            };
            animateWave();
        }
    }
    
    createHealingEffect(gameInstance, position) {
        if (!gameInstance || !gameInstance.scene) return;
        
        const healGeometry = new THREE.SphereGeometry(0.3, 8, 8);
        const healMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8
        });
        const healEffect = new THREE.Mesh(healGeometry, healMaterial);
        healEffect.position.copy(position);
        healEffect.position.y += 1;
        
        gameInstance.scene.add(healEffect);
        
        // Animate healing effect
        let scale = 0.1;
        let opacity = 0.8;
        const animateHeal = () => {
            scale += 0.1;
            opacity -= 0.05;
            
            healEffect.scale.set(scale, scale, scale);
            healEffect.material.opacity = Math.max(0, opacity);
            
            if (opacity <= 0) {
                gameInstance.scene.remove(healEffect);
            } else {
                requestAnimationFrame(animateHeal);
            }
        };
        requestAnimationFrame(animateHeal);
    }
    
    handleResurrection(allies, gameInstance) {
        const now = Date.now();
        if (!this.lastResurrectionTime) this.lastResurrectionTime = 0;
        
        // Check cooldown
        if (now - this.lastResurrectionTime < 5000) return;
        
        // Find recently dead allies that can be resurrected
        if (!gameInstance || !gameInstance.playerArmy) return;
        
        const deadUnits = gameInstance.playerArmy.units.filter(unit => 
            !unit.alive && 
            unit.mesh && 
            unit.mesh.parent && 
            unit.mesh.material.opacity <= 0.5 && // Recently dead
            this.mesh.position.distanceTo(unit.mesh.position) < 10 // Within range
        );
        
        if (deadUnits.length > 0 && Math.random() < 0.25) { // 25% chance
            const unitToRevive = deadUnits[0];
            this.lastResurrectionTime = now;
            
            // Revive the unit
            unitToRevive.alive = true;
            unitToRevive.health = Math.floor(unitToRevive.maxHealth * 0.75); // 75% health
            unitToRevive.mesh.material.opacity = 1.0;
            
            // Create resurrection effect
            this.createResurrectionEffect(gameInstance, unitToRevive.mesh.position);
            
            // Move surgeon towards the revived unit
            this.targetPosition = unitToRevive.mesh.position.clone();
            this.hasTarget = true;
            this.isPlayerControlled = true;
        }
    }
    
    createResurrectionEffect(gameInstance, position) {
        if (!gameInstance || !gameInstance.scene) return;
        
        const resEffect = new THREE.Group();
        
        // Golden glow
        const glowGeometry = new THREE.SphereGeometry(2, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffd700,
            transparent: true,
            opacity: 0.6
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        resEffect.add(glow);
        
        // Sparkles
        for (let i = 0; i < 10; i++) {
            const sparkleGeometry = new THREE.SphereGeometry(0.1, 4, 4);
            const sparkleMaterial = new THREE.MeshBasicMaterial({ 
                color: 0xffffff,
                transparent: true,
                opacity: 1.0
            });
            const sparkle = new THREE.Mesh(sparkleGeometry, sparkleMaterial);
            sparkle.position.set(
                (Math.random() - 0.5) * 4,
                Math.random() * 3,
                (Math.random() - 0.5) * 4
            );
            resEffect.add(sparkle);
        }
        
        resEffect.position.copy(position);
        gameInstance.scene.add(resEffect);
        
        // Animate resurrection effect
        let scale = 0.1;
        let opacity = 0.6;
        const animateRes = () => {
            scale += 0.1;
            opacity -= 0.03;
            
            resEffect.scale.set(scale, scale, scale);
            resEffect.children.forEach(child => {
                if (child.material) child.material.opacity = Math.max(0, opacity);
            });
            
            if (opacity <= 0) {
                gameInstance.scene.remove(resEffect);
            } else {
                requestAnimationFrame(animateRes);
            }
        };
        requestAnimationFrame(animateRes);
    }
    
    takeDamage(damage) {
        // Riot shield system
        if (this.unitType === 'riot' && this.hasShield && this.shieldHealth > 0) {
            this.shieldHealth -= damage;

            // Riot shield hit SFX
            playSfx(SFX.hitShield);

            if (this.shieldHealth <= 0) {
                this.hasShield = false;
                this.shieldHealth = 0;
                // Visual effect for shield break
                this.createShieldBreakEffect();
                // Hide shield bar
                if (this.shieldBarBg) this.shieldBarBg.visible = false;
                if (this.shieldBarFill) this.shieldBarFill.visible = false;
            }
            this.updateHealthBar();
            return; // Shield absorbed the damage
        }
        
        this.health -= damage;
        this.updateHealthBar(); // Force health bar update
        
        // Fix death trigger
        if (this.health <= 0 && !this.isDying && this.alive) {
            this.health = 0;

            // 40% chance to play death sound on any unit death
            if (Math.random() < 0.4) {
                playSfx(SFX.death);
            }

            this.startDeathAnimation();
        }
    }
    
    createShieldBreakEffect() {
        // Create shield break visual effect
        const breakGeometry = new THREE.SphereGeometry(1.5, 12, 12);
        const breakMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00ffff,
            transparent: true,
            opacity: 0.8,
            wireframe: true
        });
        const breakEffect = new THREE.Mesh(breakGeometry, breakMaterial);
        breakEffect.position.copy(this.mesh.position);
        breakEffect.position.y += 1;
        
        if (this.mesh.parent) {
            this.mesh.parent.add(breakEffect);
            
            // Animate shield break
            let scale = 1;
            let opacity = 0.8;
            const animateBreak = () => {
                scale += 0.2;
                opacity -= 0.1;
                
                breakEffect.scale.set(scale, scale, scale);
                breakEffect.material.opacity = opacity;
                
                if (opacity <= 0) {
                    this.mesh.parent.remove(breakEffect);
                } else {
                    requestAnimationFrame(animateBreak);
                }
            };
            requestAnimationFrame(animateBreak);
        }
    }
    
    die() {
        // REPLACED by animated death; keep as fallback no-op
        this.alive = false;
    }
    
    // NEW: start and update death animation
    startDeathAnimation() {
        this.isDying = true;
        this.deathStartTime = performance.now() / 1000;
        // Do not set alive = false yet, wait until animation finishes or Army class might clean it up too early if logic is flawed
        // Actually Army check relies on opacity, so keeping alive=true during dying is risky if logic uses it for targeting.
        // Let's set alive=false so enemies stop targeting it, but Army.update keeps it for animation.
        this.alive = false; 
        
        // Disable collision/targeting
        if (this.uiGroup) this.uiGroup.visible = false;
        
        // Slight upward pop for impact
        this.mesh.position.y = 1.1;
        
        // Dim neon outline
        if (this.neonOutline) {
            this.neonOutline.material.opacity = 0.15;
        }
    }
    
    updateDeathAnimation(deltaTime, gameInstance) {
        const now = performance.now() / 1000;
        const t = now - this.deathStartTime;
        const duration = 1.0; // Faster death
        const progress = Math.min(1, t / duration);
        
        // Fall over and sink
        const fallAmount = Math.min(Math.PI / 2, progress * Math.PI * 2);
        this.mesh.rotation.x = -fallAmount * 0.5; // Fall backward/forward
        this.mesh.rotation.z = (this.team === 'player' ? 1 : -1) * fallAmount * 0.3;
        
        // Sink into the ground
        this.mesh.position.y = 0.85 - progress * 1.5;
        
        // Fade out completely by the end of the animation
        if (this.mesh.material) {
            this.mesh.material.transparent = true;
            this.mesh.material.opacity = 1 - progress; // goes to 0 when progress === 1
            
            // Handle array materials if any
            if (Array.isArray(this.mesh.material)) {
                this.mesh.material.forEach(m => {
                    m.transparent = true;
                    m.opacity = 1 - progress;
                });
            }
        }
        
        // Also fade children
        this.mesh.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.transparent = true;
                child.material.opacity = 1 - progress;
            }
        });
        
        // Small dust puff at the moment of impact
        if (progress > 0.4 && !this.spawnedDeathDust && gameInstance && gameInstance.scene) {
            this.spawnedDeathDust = true;
            this.createDeathDust(gameInstance);
        }
        
        if (progress >= 1) {
            this.isDying = false;
            // Force removal from scene
            if (gameInstance && gameInstance.scene) {
                gameInstance.scene.remove(this.mesh);
            }
            if (this.mesh && this.mesh.parent) {
                this.mesh.parent.remove(this.mesh);
            }
        }
    }
    
    createDeathDust(gameInstance) {
        const puffCount = 6;
        for (let i = 0; i < puffCount; i++) {
            const geo = GEOMETRIES.sphere_small;
            const mat = new THREE.MeshBasicMaterial({
                color: 0x444444,
                transparent: true,
                opacity: 0.7
            });
            const puff = new THREE.Mesh(geo, mat);
            puff.position.copy(this.mesh.position);
            puff.position.y = 0.4 + Math.random() * 0.3;
            gameInstance.scene.add(puff);
            
            const dir = new THREE.Vector3(
                (Math.random() - 0.5) * 1.4,
                0.4 + Math.random() * 0.4,
                (Math.random() - 0.5) * 1.4
            );
            let life = 0;
            const lifeMax = 0.5 + Math.random() * 0.3;
            
            const animate = () => {
                life += 0.03;
                puff.position.addScaledVector(dir, 0.04);
                puff.material.opacity = Math.max(0, 0.7 * (1 - life / lifeMax));
                const s = 0.4 + life;
                puff.scale.set(s, s, s);
                
                if (life >= lifeMax || !puff.parent) {
                    if (puff.parent) puff.parent.remove(puff);
                    mat.dispose();
                } else {
                    requestAnimationFrame(animate);
                }
            };
            requestAnimationFrame(animate);
        }
    }
    
    // NEW: simple separation so units don't all stack on one spot
    applySeparation(allUnits, deltaTime) {
        const separationRadius = 2.2;
        const separationRadiusSq = separationRadius * separationRadius;
        const strength = 3.5;
        
        const force = new THREE.Vector3(0, 0, 0);
        let neighbors = 0;
        
        for (let i = 0; i < allUnits.length; i++) {
            const other = allUnits[i];
            if (other === this || !other.mesh || other.team !== this.team) continue;
            
            const distSq = this.mesh.position.distanceToSquared(other.mesh.position);
            if (distSq > 0 && distSq < separationRadiusSq) {
                const dir = new THREE.Vector3().subVectors(this.mesh.position, other.mesh.position);
                dir.normalize();
                const weight = 1 - distSq / separationRadiusSq;
                force.addScaledVector(dir, weight);
                neighbors++;
            }
        }
        
        if (neighbors > 0) {
            force.multiplyScalar(strength / neighbors);
            this.mesh.position.addScaledVector(force, deltaTime);
        }
    }
    
    updateHealthBar() {
        if (this.healthBarFill) {
            const healthPercent = this.health / this.maxHealth;
            this.healthBarFill.scale.x = Math.max(0, healthPercent);
            this.healthBarFill.position.x = -(1 - healthPercent) * 0.75;
            
            // Update health bar color based on health percentage
            if (healthPercent > 0.6) {
                this.healthBarFill.material.color.setHex(0x00ff00); // Green
            } else if (healthPercent > 0.3) {
                this.healthBarFill.material.color.setHex(0xffff00); // Yellow
            } else {
                this.healthBarFill.material.color.setHex(0xff0000); // Red
            }
        }
        
        // Update shield bar for riot units
        if (this.unitType === 'riot' && this.shieldBarFill && this.hasShield) {
            const shieldPercent = this.shieldHealth / this.maxShieldHealth;
            this.shieldBarFill.scale.x = Math.max(0, shieldPercent);
            this.shieldBarFill.position.x = -(1 - shieldPercent) * 0.75;
        }
    }
    
    handleWandering(deltaTime, bases) {
        const now = Date.now();
        
        // Check if it's time to pick a new wander target
        if (now - this.lastWanderTime >= this.wanderCooldown) {
            this.lastWanderTime = now;
            this.wanderCooldown = 5000 + Math.random() * 3000; // 5-8 seconds
            
            const basePos = this.team === 'player' ? bases.player.position : bases.enemy.position;
            
            if (this.stance === 'defend') {
                // Wander around in front of base
                this.targetPosition = new THREE.Vector3(
                    basePos.x + 8 + Math.random() * 6,
                    0,
                    basePos.z + (Math.random() - 0.5) * 8
                );
            } else if (this.stance === 'retreat') {
                // Wander around behind base
                this.targetPosition = new THREE.Vector3(
                    basePos.x - 8 - Math.random() * 6,
                    0,
                    basePos.z + (Math.random() - 0.5) * 8
                );
            }
            
            this.hasTarget = true;
            this.isPlayerControlled = true;
        }
    }
    
    moveForward(deltaTime) {
        // Move unit forward in their team's attack direction
        const direction = this.team === 'player' ? 1 : -1;
        this.mesh.position.x += direction * this.speed * deltaTime;
        this.mesh.position.y = 0; // Keep on ground
    }
    
    moveTowardsTarget(deltaTime) {
        if (!this.target) return;
        
        const targetPos = this.target.mesh ? this.target.mesh.position : this.target.position;
        const direction = new THREE.Vector3();
        direction.subVectors(targetPos, this.mesh.position).normalize();
        
        this.mesh.position.add(direction.multiplyScalar(this.speed * deltaTime));
        this.mesh.position.y = 0;
        
        // Face the target
        this.mesh.lookAt(targetPos);
    }
    
    attack() {
        const now = Date.now();
        if (now - this.lastAttackTime < this.attackCooldown) return;
        
        this.lastAttackTime = now;
        
        // Deal damage to target
        if (this.target && this.target.takeDamage) {
            this.target.takeDamage(this.attackDamage);
        } else if (this.target && this.target.health !== undefined) {
            // Attacking base
            this.target.health -= this.attackDamage;
            if (this.target.health < 0) this.target.health = 0;
        }
    }

    // NEW: movement + face animation
    updateVisualAnimations(deltaTime) {
        if (!this.mesh) return;
        
        // Track movement
        const currentPos = this.mesh.position.clone();
        const moveDelta = this.prevPosition ? currentPos.distanceTo(this.prevPosition) : 0;
        this.isMoving = moveDelta > 0.02;
        
        if (this.isMoving) {
            this.walkTime += deltaTime * 6;
        } else {
            // Ease walkTime back towards 0 for smooth stop
            this.walkTime = Math.max(0, this.walkTime - deltaTime * 6);
        }
        
        // Leg swing (from the head-based legs)
        if (this.leftLeg && this.rightLeg) {
            if (this.isMoving) {
                const angle = Math.sin(this.walkTime * 4) * 0.6;
                this.leftLeg.rotation.x = angle;
                this.rightLeg.rotation.x = -angle;
            } else {
                this.leftLeg.rotation.x *= 0.8;
                this.rightLeg.rotation.x *= 0.8;
            }
        }
        
        // Arm swing (subtle, arms attached to head)
        if (this.leftArm && this.rightArm) {
            if (this.isMoving) {
                const armAngle = Math.sin(this.walkTime * 4 + Math.PI / 2) * 0.35;
                this.leftArm.rotation.x = -armAngle * 0.7;
                this.rightArm.rotation.x = armAngle * 0.7;
            } else {
                this.leftArm.rotation.x *= 0.8;
                this.rightArm.rotation.x *= 0.8;
            }
        }
        
        // Eye blinking / glow
        if (this.eyeMeshes.length > 0) {
            this.eyeTime += deltaTime;
            const blinkCycle = 3.2; // seconds
            const t = this.eyeTime % blinkCycle;
            const blinking = t < 0.12; // short blink window
            
            this.eyeMeshes.forEach((eye, idx) => {
                if (!eye.scale) return;
                const targetScaleY = blinking ? 0.15 : 1;
                eye.scale.y += (targetScaleY - eye.scale.y) * 0.4;
                
                // subtle "angry" tilt for enemies
                if (this.team === 'enemy') {
                    eye.rotation.z = idx === 0 ? 0.08 : -0.08;
                } else {
                    eye.rotation.z = 0;
                }
            });
            
            // gentle brightness pulse
            this.eyeMaterials.forEach(mat => {
                if (!mat) return;
                const pulse = 0.7 + Math.sin(this.eyeTime * 2) * 0.2;
                mat.opacity = pulse;
            });
        }
        
        // Store position for next frame
        if (!this.prevPosition) {
            this.prevPosition = currentPos.clone();
        } else {
            this.prevPosition.copy(currentPos);
        }
    }
}