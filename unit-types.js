// Central definition of all unit stats / metadata

export const UNIT_TYPES = {
    miner: { 
        name: 'Miner', 
        health: 400, // 80 * 5
        speed: 1.5, 
        attackDamage: 10, 
        attackCooldown: 2000, 
        cost: 15, // Reduced from 25
        originalCost: 25, 
        color: 0xffaa00,
        description: 'Collects resources over time. Upgrades increase resource generation rate.',
        hotkey: '1',
        range: 0,
        spawnCooldown: 3000
    },
    grunt: { 
        name: 'Grunt', 
        health: 500, // 100 * 5
        speed: 2, 
        attackDamage: 20, 
        attackCooldown: 1000, 
        cost: 20, // Reduced from 30
        originalCost: 30,
        color: 0x0066ff,
        description: 'Basic melee infantry unit with decent health and damage.',
        hotkey: '2',
        range: 0,
        spawnCooldown: 1000
    },
    assault: { 
        name: 'Assault', 
        health: 600, // 120 * 5
        speed: 2.5, 
        attackDamage: 25, 
        attackCooldown: 800, 
        cost: 35, // Reduced from 50
        originalCost: 50,
        color: 0x0088ff,
        description: 'Medium-range assault rifle fighter with good mobility.',
        hotkey: '3',
        range: 15,
        spawnCooldown: 5000
    },
    medic: { 
        name: 'Medic', 
        health: 450, // 90 * 5
        speed: 1.8, 
        attackDamage: 15, 
        attackCooldown: 1500, 
        cost: 30, // Reduced from 40
        originalCost: 40,
        color: 0x00ff00,
        description: 'Heals nearby allied units continuously. Essential support unit.',
        hotkey: '4',
        range: 0,
        spawnCooldown: 8000
    },
    grenadier: { 
        name: 'Grenadier', 
        health: 550, // 110 * 5
        speed: 1.8, 
        attackDamage: 105,
        attackCooldown: 4000, 
        cost: 45, // Reduced from 60
        originalCost: 60,
        color: 0xff6600,
        description: 'Explosive area damage specialist with medium range grenades.',
        hotkey: '5',
        range: 25,
        spawnCooldown: 8000
    },
    sniper: { 
        name: 'Sniper', 
        health: 350, // 70 * 5
        speed: 1.5, 
        attackDamage: 50, 
        attackCooldown: 2000, 
        cost: 50, // Reduced from 70
        originalCost: 70,
        color: 0x9900ff,
        description: 'Long range high damage marksman. Excellent for picking off enemies.',
        hotkey: '6',
        range: 35,
        spawnCooldown: 10000
    },
    sergeant: { 
        name: 'Sergeant', 
        health: 750, // 150 * 5
        speed: 2, 
        attackDamage: 30, 
        attackCooldown: 1000, 
        cost: 60, // Reduced from 80
        originalCost: 80,
        color: 0x004499,
        description: 'Veteran soldier with balanced stats and medium range rifle.',
        hotkey: '7',
        range: 20,
        spawnCooldown: 12000
    },
    rocketeer: { 
        name: 'Rocketeer', 
        health: 475, // 95 * 5
        speed: 1.6, 
        attackDamage: 270,
        attackCooldown: 6000, 
        cost: 70, // Reduced from 90
        originalCost: 90,
        color: 0xff0088,
        description: 'Heavy weapons specialist with explosive rocket launcher.',
        hotkey: '8',
        range: 30,
        spawnCooldown: 15000
    },
    riot: { 
        name: 'Riot', 
        health: 1000, // 200 * 5
        speed: 1.2, 
        attackDamage: 25, 
        attackCooldown: 800, 
        cost: 75, // Reduced from 100
        originalCost: 100,
        color: 0x333333,
        description: 'Shield tank with stun capabilities and medium range weapons.',
        hotkey: '9',
        range: 18,
        spawnCooldown: 15000
    },
    surgeon: { 
        name: 'Surgeon', 
        health: 425, // 85 * 5
        speed: 1.7, 
        attackDamage: 12, 
        attackCooldown: 2000, 
        cost: 50, // Reduced from 65
        originalCost: 65,
        color: 0x00ffaa,
        description: 'Every 6s, revives a nearby fallen ally (or massively heals allies if none are down).',
        hotkey: '0',
        range: 20,
        spawnCooldown: 20000
    },
    colonel: { 
        name: 'Colonel', 
        health: 900, // 180 * 5
        speed: 2.2, 
        attackDamage: 40, 
        attackCooldown: 900, 
        cost: 120, // Reduced from 150
        originalCost: 150,
        color: 0xffff00,
        description: 'Every 10s, marks an enemy for focus fire. All allies target it. Gain 10 gold when target is eliminated.',
        hotkey: 'q',
        range: 25,
        spawnCooldown: 45000
    },
    commando: { 
        name: 'Commando', 
        health: 650, // 130 * 5
        speed: 3, 
        attackDamage: 70, // Increased from 55
        attackCooldown: 300, // Reduced from 400
        cost: 140, // Reduced from 200
        originalCost: 200,
        color: 0x660000,
        description: 'Elite fast shooter. At 20% health: berserker mode (2x fire rate, heal to 75% health once).',
        hotkey: 'w',
        range: 20,
        spawnCooldown: 55000
    }
};