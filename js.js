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
+
+        // PLAY FIRE SFX: explosive launcher vs normal gun
+        if (this.unitType === 'rocketeer' || this.unitType === 'grenadier' || this.unitType === 'riot') {
+            playSfx(SFX.grenadeShot);
+        } else {
+            playSfx(SFX.gunshot);
+        }
        
        if (!gameInstance || !gameInstance.scene) {
            return; // Can't create visual effects without game instance
        }
        
        // Create different projectiles based on unit type
        // ... existing code ...

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
+
+        // Explosion SFX (once per explosion impact)
+        playSfx(SFX.explosion);
        
        // Optimized damage calculation - only check enemy units
        const radiusSq = explosionRadius * explosionRadius;
        
        // ... existing code ...

    takeDamage(damage) {
        // Riot shield system
        if (this.unitType === 'riot' && this.hasShield && this.shieldHealth > 0) {
            this.shieldHealth -= damage;
+            // Riot shield hit SFX
+            playSfx(SFX.hitShield);
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
-            this.startDeathAnimation();
+            // 40% chance to play death sound on any unit death
+            if (Math.random() < 0.4) {
+                playSfx(SFX.death);
+            }
+            this.startDeathAnimation();
        }
    }

    update(deltaTime) {
        if (this.gameOver) return;
        
        // Update target pulse animation - ENHANCED
        // ... existing code ...
        
        // Automatic resource generation (10 every 10 seconds) - INCREASED
        const now = Date.now();
        if (now - this.lastResourceTime >= 10000) {
            this.resources += 10; // Increased from 5
            this.lastResourceTime = now;
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
-            this.updateSimplifiedEnemyAI();
+            this.updateSimplifiedEnemyAI();
        }
        
        // Update armies with game instance reference
        // ... existing code ...
    }

    // NEW: tutorial progression checks (miners count, stance usage)
    updateTutorialProgress() {
-        const miners = this.playerArmy.getAliveUnits().filter(u => u.unitType === 'miner');
-        if (this.tutorialStep === 5) {
-            if (miners.length >= 3) {
-                // Player spawned 2 more miners
-                this.setTutorialStep(6);
-            }
-        }
+        if (this.tutorialStep === 5) {
+            const grunts = this.playerArmy.getAliveUnits().filter(u => u.unitType === 'grunt').length;
+            const commandos = this.playerArmy.getAliveUnits().filter(u => u.unitType === 'commando').length;
+            const colonels = this.playerArmy.getAliveUnits().filter(u => u.unitType === 'colonel').length;
+            // We already spawned 1 grunt earlier in the tutorial, so require total >=3
+            if (grunts >= 3 && commandos >= 1 && colonels >= 1) {
+                // Unpause enemy and move to attack stance step
+                this.enemyPausedForTutorialArmy = false;
+                this.setTutorialStep(6);
+            }
+        }
 
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
+        // Pause enemy completely during the tutorial army-build step
+        if (this.isTutorial && this.enemyPausedForTutorialArmy) {
+            return;
+        }
+
        const enemyUnits = this.enemyArmy.getAliveUnits().filter(u => u.unitType !== 'miner');
        
        // STEP 1: Generate enemy resources
        // ... existing code ...
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
+            // During the army-build step (step 5), only allow grunts, commando, and colonel
+            if (this.tutorialStep === 5) {
+                const allowed = ['grunt', 'commando', 'colonel'];
+                if (!allowed.includes(unitType)) return;
+            }
        }

        // Check cooldown
        // ... existing code ...

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

