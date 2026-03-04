import { Unit, UNIT_TYPES } from './unit.js';
import * as THREE from 'three';

export class Army {
    constructor(team, scene, spawnPosition) {
        this.team = team;
        this.scene = scene;
        this.spawnPosition = spawnPosition.clone();
        this.units = [];
        this.spawnCooldown = this.team === 'player' ? 0 : 1000;
        this.lastSpawnTime = 0;
        this.maxUnits = 50;
    }
    
    update(deltaTime, enemyUnits, bases, gameInstance) {
        // Update all units
        this.units.forEach((unit, index) => {
            if (unit.alive || unit.isDying) {
                // Pass gameInstance so death animations and effects work
                unit.update(deltaTime, enemyUnits, bases, gameInstance);
            }
        });
        
        // Clean up dead units ONLY when they are finished dying (parent removed or opacity 0)
        // AND make sure we don't remove units that are just starting to die
        this.units = this.units.filter(unit => {
            if (unit.alive) return true;
            if (unit.isDying) return true;
            // If dead and not animating, ensure it's removed from scene
            if (unit.mesh && unit.mesh.parent) {
                // If opacity is low enough, consider it gone
                 if (unit.mesh.material && unit.mesh.material.opacity <= 0.05) {
                     unit.mesh.parent.remove(unit.mesh);
                     return false;
                 }
                 // If somehow still in scene but not dying/alive, keep it briefly? 
                 // No, just remove it if it's dead and not dying.
                 unit.mesh.parent.remove(unit.mesh);
                 return false;
            }
            return false;
        });
    }
    
    spawnUnit(unitType = 'grunt') {
        if (this.units.filter(u => u.alive).length >= this.maxUnits) return null;
        
        const now = Date.now();
        if (now - this.lastSpawnTime < this.spawnCooldown) return null;
        
        this.lastSpawnTime = now;
        
        // Random spawn position variation - adjusted for new battlefield size
        const spawnPos = this.spawnPosition.clone();
        spawnPos.z += (Math.random() - 0.5) * 4;
        
        // Adjust spawn position based on team for new battlefield size
        if (this.team === 'player') {
            spawnPos.x = -27; // Adjusted for new base position
        } else {
            spawnPos.x = 27; // Adjusted for new base position
        }
        
        const unit = new Unit(this.team, spawnPos, unitType);
        this.units.push(unit);
        this.scene.add(unit.mesh);
        
        return unit;
    }
    
    getAliveUnits() {
        return this.units.filter(unit => unit.alive);
    }
    
    getTotalUnits() {
        return this.units.length;
    }
}