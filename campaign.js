import { UNIT_TYPES } from './unit.js';
import { Game } from './game.js';

// Campaign and progression system
let playerProfile = {
    level: 1,
    xp: 0,
    campaignCoins: 0,
    unlockedUnits: ['grunt', 'assault', 'miner'], // Ensure miner is always included
    rentedUnits: {}, // unitType: battlesRemaining
    upgrades: {}, // unitType: upgradeLevel (0-5)
    crates: {
        lastFreeCommonCrate: 0 // Timestamp for free daily crate
    },
    shards: {}, // Initialize shards so shard-based unlocks always work
    levelStatus: [false, false, false], // Track completion of the 3 current levels
    elitePityCounter: 0, // Track elite crates opened without unit
    tutorialCompleted: false // NEW: track if onboarding tutorial has been completed
};

// Load player profile from localStorage
function loadPlayerProfile() {
    const saved = localStorage.getItem('battleLineProfile');
    if (saved) {
        const loadedProfile = JSON.parse(saved);
        playerProfile = { ...playerProfile, ...loadedProfile };
        
        // Ensure miner is always unlocked for existing saves
        if (!playerProfile.unlockedUnits.includes('miner')) {
            playerProfile.unlockedUnits.push('miner');
        }
        
        // Initialize shards if not present
        if (!playerProfile.shards) {
            playerProfile.shards = {};
        }
        
        // Initialize level status if not present
        if (!playerProfile.levelStatus || playerProfile.levelStatus.length !== 3) {
            playerProfile.levelStatus = [false, false, false];
        }
        
        // Initialize elite pity if not present
        if (playerProfile.elitePityCounter === undefined) {
            playerProfile.elitePityCounter = 0;
        }

        // Ensure tutorialCompleted flag exists
        if (playerProfile.tutorialCompleted === undefined) {
            playerProfile.tutorialCompleted = false;
        }
    }
}

// XP Curve configuration
function getXPNeeded(level) {
    // Custom curve requested by user
    // Lv 1->2: ~30
    // Lv 2->3: ~60
    // Lv 3->4: ~100...
    // Formula: Base 30, increasing roughly by 1.5x - 2x scale
    if (level === 1) return 30;
    if (level === 2) return 60;
    if (level === 3) return 100;
    if (level === 4) return 150;
    
    // For higher levels, use a formula: 50 * level^1.6
    return Math.floor(50 * Math.pow(level, 1.6));
}

// Unit unlock configuration
function getUnlockLevel(unitType) {
    const unlockLevels = {
        'miner': 1,
        'grunt': 1,
        'assault': 2, // Moved to lvl 2
        'medic': 2,
        'grenadier': 3, // Moved to lvl 3
        'sniper': 4,
        'sergeant': 5,
        'rocketeer': 8,
        'riot': 12,
        'surgeon': 15,
        'colonel': 20,
        'commando': 30
    };
    return unlockLevels[unitType] || 1;
}

// Shard system configuration
const SHARD_CONFIG = {
    miner: { required: 0, cost: 0, dropChance: 0 }, // Always unlocked
    grunt: { required: 0, cost: 0, dropChance: 0 }, // Always unlocked
    assault: { required: 3, cost: 30, dropChance: 0.35 },
    medic: { required: 3, cost: 30, dropChance: 0.35 },
    grenadier: { required: 4, cost: 60, dropChance: 0.25 },
    sniper: { required: 5, cost: 90, dropChance: 0.20 },
    sergeant: { required: 5, cost: 100, dropChance: 0.18 },
    rocketeer: { required: 6, cost: 180, dropChance: 0.12 },
    riot: { required: 7, cost: 250, dropChance: 0.08 },
    surgeon: { required: 8, cost: 350, dropChance: 0.05 },
    colonel: { required: 9, cost: 500, dropChance: 0.03 },
    commando: { required: 10, cost: 670, dropChance: 0.005 }
};

// Save player profile to localStorage
function savePlayerProfile() {
    localStorage.setItem('battleLineProfile', JSON.stringify(playerProfile));
}

function addCampaignCoins(amount) {
    playerProfile.campaignCoins += amount;
    savePlayerProfile();
}

function addXP(amount) {
    playerProfile.xp += amount;
    
    // Check for level up loop (in case of massive XP gain)
    let leveledUp = false;
    let xpNeeded = getXPNeeded(playerProfile.level);
    
    while (playerProfile.xp >= xpNeeded && playerProfile.level < 100) {
        playerProfile.level++;
        playerProfile.xp -= xpNeeded;
        leveledUp = true;
        
        // Update requirements for next level loop
        xpNeeded = getXPNeeded(playerProfile.level);
    }
    
    if (leveledUp) {
        alert(`Level Up! You are now level ${playerProfile.level}! Check the shop for new units.`);
    }
    
    savePlayerProfile();
}

let currentLevels = [];
let refreshTimer = 1200; // 20 minutes
let selectedLevel = null;
let selectedLevelIndex = -1;
let selectedArmy = [];

// Setup campaign map functionality
export function setupCampaignMap() {
    loadPlayerProfile();
    
    // Event listeners (guarded to avoid null element errors)
    const el = id => document.getElementById(id);
    const bindIfExists = (id, evt, fn) => {
        const node = el(id);
        if (node) node.addEventListener(evt, fn);
    };

    bindIfExists('campaign-btn', 'click', showCampaignMap);
    bindIfExists('shop-btn', 'click', showUnitShop);
    // tip-btn may not exist in some layouts — bind only if present
    bindIfExists('tip-btn', 'click', showTipScreen);
    bindIfExists('crates-btn', 'click', showCratesScreen);
    bindIfExists('back-to-menu', 'click', showMainMenu);
    bindIfExists('shop-back-to-menu', 'click', showMainMenu);
    bindIfExists('tip-back-to-menu', 'click', showMainMenu);
    bindIfExists('crates-back-to-menu', 'click', showMainMenu);
    bindIfExists('selection-back', 'click', showCampaignMap);
    bindIfExists('start-battle', 'click', startSelectedBattle);
    bindIfExists('reset-progress-btn', 'click', resetProgress);
    bindIfExists('convert-credits', 'click', convertCredits);
    
    // Crate button listeners
    document.getElementById('open-common-crate').addEventListener('click', () => openCrate('common'));
    document.getElementById('open-uncommon-crate').addEventListener('click', () => openCrate('uncommon'));
    document.getElementById('open-rare-crate').addEventListener('click', () => openCrate('rare'));
    document.getElementById('open-epic-crate').addEventListener('click', () => openCrate('epic'));
    document.getElementById('open-elite-crate').addEventListener('click', () => openCrate('elite'));
    
    // Secret lock listener
    const secretLock = document.getElementById('secret-lock');
    if (secretLock) {
        secretLock.addEventListener('click', showSecretPrompt);
    }
    
    // Tip amount input listener
    document.getElementById('tip-amount').addEventListener('input', updateTipPreview);
    
    generateNewLevels();
    startRefreshTimer();
    updateProfileDisplay();
}

function resetProgress() {
    const confirmed = confirm('Are you sure you want to reset ALL progress? This cannot be undone!');
    if (confirmed) {
        const doubleConfirm = confirm('This will delete all your coins, XP, unlocked units, and upgrades. Are you absolutely sure?');
        if (doubleConfirm) {
            // Clear localStorage
            localStorage.removeItem('battleLineProfile');
            
            // Reset player profile to default
            playerProfile = {
                level: 1,
                xp: 0,
                campaignCoins: 0,
                unlockedUnits: ['grunt', 'assault', 'miner'],
                rentedUnits: {},
                upgrades: {},
                crates: {
                    lastFreeCommonCrate: 0
                },
                shards: {},
                levelStatus: [false, false, false],
                elitePityCounter: 0,
                tutorialCompleted: false
            };
            
            savePlayerProfile();
            updateProfileDisplay();
            alert('Progress has been reset to default!');
        }
    }
}

function showSecretPrompt() {
    const code = prompt('Enter secret code:');
    if (code === 'supermonke1324') {
        const bonusCoins = 1000;
        const bonusXP = 10000; // Increased to 10000 as requested
        
        playerProfile.campaignCoins += bonusCoins;
        playerProfile.xp += bonusXP;
        
        // Check for level up after bonus XP
        let xpNeeded = getXPNeeded(playerProfile.level);
        while (playerProfile.xp >= xpNeeded) {
            playerProfile.level++;
            playerProfile.xp -= xpNeeded;
            xpNeeded = getXPNeeded(playerProfile.level);
        }
        
        alert(`Secret code redeemed! +${bonusCoins} Coins, +${bonusXP} XP!`);
        
        savePlayerProfile();
        updateProfileDisplay();
    } else if (code === '1325isagoodnumber') {
        // Free Elite Crate (no coin cost)
        alert('Secret code redeemed! Enjoy a FREE Elite Crate!');
        openCrateFree('elite');
    } else if (code === 'nexrorunsgift') {
        const bonusCoins = 1269;
        playerProfile.campaignCoins += bonusCoins;
        alert(`Secret code redeemed! +${bonusCoins} Coins!\n\nHint: remember the number 1269 – it pairs nicely with another secret number.`);
        savePlayerProfile();
        updateProfileDisplay();
    } else if (code === 'muck') {
        const bonusXP = 2459;
        playerProfile.xp += bonusXP;

        // Handle potential level ups from this XP
        let xpNeeded = getXPNeeded(playerProfile.level);
        while (playerProfile.xp >= xpNeeded) {
            playerProfile.level++;
            playerProfile.xp -= xpNeeded;
            xpNeeded = getXPNeeded(playerProfile.level);
        }

        alert(`Secret code redeemed! +${bonusXP} XP!\n\nHint: combine 2459 with that other gift number for a clue toward an even stronger secret code.`);
        savePlayerProfile();
        updateProfileDisplay();
    } else if (code !== null && code !== '') {
        alert('Incorrect code!');
    }
}

function showMainMenu() {
    // Start main menu music
    document.querySelectorAll('audio').forEach(audio => audio.pause());
    const mainMenuMusic = document.getElementById('main-menu-music');
    if (mainMenuMusic) {
        mainMenuMusic.volume = 0.2;
        mainMenuMusic.play().catch(e => console.log('Music autoplay blocked:', e));
    }
    
    // Clear any game instance completely
    if (window.currentGame) {
        window.currentGame.cleanup();
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
    
    // Force hide all screens first
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('game-over').classList.add('hidden');
    document.getElementById('campaign-map').classList.add('hidden');
    document.getElementById('unit-shop-screen').classList.add('hidden');
    document.getElementById('unit-selection').classList.add('hidden');
    document.getElementById('tip-screen').classList.add('hidden');
    document.getElementById('crates-screen').classList.add('hidden');
    
    // Small delay to ensure cleanup, then show menu with proper positioning
    setTimeout(() => {
        const mainMenu = document.getElementById('main-menu');
        mainMenu.style.display = 'flex'; // Ensure flex display
        mainMenu.style.position = 'fixed';
        mainMenu.style.top = '0';
        mainMenu.style.left = '0';
        mainMenu.style.width = '100vw';
        mainMenu.style.height = '100vh';
        mainMenu.classList.remove('hidden');
        
        // Force refresh the profile display
        updateProfileDisplay();
    }, 200);
}

function showCampaignMap() {
    // Continue main menu music (same for campaign map)
    const mainMenuMusic = document.getElementById('main-menu-music');
    if (mainMenuMusic && mainMenuMusic.paused) {
        mainMenuMusic.play().catch(e => console.log('Music autoplay blocked:', e));
    }
    
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('campaign-map').classList.remove('hidden');
    document.getElementById('unit-shop-screen').classList.add('hidden');
    document.getElementById('unit-selection').classList.add('hidden');
    populateLevelsGrid();
}

function showUnitShop() {
    // Continue main menu music (same for unit shop)
    const mainMenuMusic = document.getElementById('main-menu-music');
    if (mainMenuMusic && mainMenuMusic.paused) {
        mainMenuMusic.play().catch(e => console.log('Music autoplay blocked:', e));
    }
    
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('campaign-map').classList.add('hidden');
    document.getElementById('unit-shop-screen').classList.remove('hidden');
    document.getElementById('unit-selection').classList.add('hidden');
    populateShopGrid();
}

function showUnitSelection(level) {
    selectedLevel = level;
    // Find index of selected level
    selectedLevelIndex = currentLevels.indexOf(level);
    
    selectedArmy = [];
    document.getElementById('campaign-map').classList.add('hidden');
    document.getElementById('unit-selection').classList.remove('hidden');
    populateUnitSelection();
}

function generateNewLevels() {
    currentLevels = [];
    playerProfile.levelStatus = [false, false, false]; // Reset completion status
    savePlayerProfile();
    
    // Generate levels based on player level - ONLY 3 LEVELS
    const playerLevel = playerProfile.level;
    const numberOfLevels = 3; 
    
    for (let i = 0; i < numberOfLevels; i++) {
        // Determine star rating based on player level and some randomness
        let stars;
        if (playerLevel <= 2) {
            // Low level players get mostly 1-2 star levels
            stars = Math.random() < 0.7 ? 1 : 2;
        } else if (playerLevel <= 5) {
            // Mid level players get 1-3 star levels
            const rand = Math.random();
            stars = rand < 0.4 ? 1 : rand < 0.7 ? 2 : 3;
        } else if (playerLevel <= 8) {
            // Higher level players get 2-4 star levels
            const rand = Math.random();
            stars = rand < 0.3 ? 2 : rand < 0.6 ? 3 : 4;
        } else {
            // High level players get 3-5 star levels
            const rand = Math.random();
            stars = rand < 0.3 ? 3 : rand < 0.6 ? 4 : 5;
        }
        
        const levelNames = [
            ['Scout Mission', 'Patrol Duty', 'Recon Route'],
            ['Forward Outpost', 'Supply Escort', 'Border Patrol'],
            ['Enemy Outpost', 'Supply Raid', 'Defensive Line'],
            ['Command Center', 'Heavy Assault', 'Strategic Point'],
            ['Fortress Siege', 'Final Assault', 'Last Stand']
        ];
        
        // FIXED: Generate more varied enemy units for each level
        let enemyUnitTypes;
        const enemyVariations = [
            // 1-star variations
            [
                ['Grunt', 'Assault'],
                ['Grunt', 'Grunt', 'Assault'],
                ['Assault', 'Assault']
            ],
            // 2-star variations  
            [
                ['Grunt', 'Assault', 'Medic'],
                ['Grunt', 'Grunt', 'Medic'],
                ['Assault', 'Assault', 'Medic']
            ],
            // 3-star variations
            [
                ['Grunt', 'Assault', 'Medic', 'Grenadier'],
                ['Assault', 'Medic', 'Grenadier', 'Grenadier'],
                ['Grunt', 'Grunt', 'Assault', 'Grenadier']
            ],
            // 4-star variations
            [
                ['Grunt', 'Assault', 'Medic', 'Grenadier', 'Sniper'],
                ['Assault', 'Medic', 'Grenadier', 'Sniper', 'Sergeant'],
                ['Grunt', 'Assault', 'Grenadier', 'Sergeant', 'Sniper']
            ],
            // 5-star variations
            [
                ['Assault', 'Medic', 'Grenadier', 'Sniper', 'Sergeant', 'Rocketeer'],
                ['Grunt', 'Grenadier', 'Sniper', 'Sergeant', 'Rocketeer', 'Rocketeer'],
                ['Medic', 'Grenadier', 'Sergeant', 'Rocketeer', 'Riot']
            ]
        ];
        
        const variations = enemyVariations[stars - 1];
        enemyUnitTypes = variations[Math.floor(Math.random() * variations.length)];
        
        const randomName = levelNames[stars-1][Math.floor(Math.random() * levelNames[stars-1].length)];
        
        // Reduced XP rewards by half
        let xpRewardBase, coinRewardBase;

        switch(stars) {
            case 1: 
                xpRewardBase = 25; // Halved from 50
                coinRewardBase = 15;
                break;
            case 2:
                xpRewardBase = 75; // Halved from 150
                coinRewardBase = 30;
                break;
            case 3:
                xpRewardBase = 225; // Halved from 450
                coinRewardBase = 50;
                break;
            case 4:
                xpRewardBase = 600; // Halved from 1200
                coinRewardBase = 80;
                break;
            case 5:
                xpRewardBase = 1500; // Halved from 3000
                coinRewardBase = 150;
                break;
            default:
                xpRewardBase = 10;
                coinRewardBase = 5;
        }

        const xpVariation = Math.floor(Math.random() * (xpRewardBase * 0.2)); // 20% variance
        
        currentLevels.push({
            stars: stars,
            difficulty: stars,
            enemyUnits: stars * 2 + Math.floor(Math.random() * 4), 
            enemyUnitTypes: enemyUnitTypes,
            rewards: {
                coins: coinRewardBase + Math.floor(Math.random() * 10), 
                xp: xpRewardBase + xpVariation 
            },
            name: randomName,
            description: `${stars}⭐ - Enemy: ${enemyUnitTypes.join(', ')}`
        });
    }
}

function populateLevelsGrid() {
    const grid = document.getElementById('levels-grid');
    grid.innerHTML = '';
    
    currentLevels.forEach((level, index) => {
        const isCompleted = playerProfile.levelStatus[index];
        const levelCard = document.createElement('div');
        levelCard.className = `level-card ${isCompleted ? 'completed' : ''}`;
        
        let content = `
            <div class="level-stars">${'⭐'.repeat(level.stars)}</div>
            <h3 class="level-name">${level.name}</h3>
            <p class="level-description">${level.description}</p>
            <div class="level-rewards">
                <div>💰 ${level.rewards.coins} Coins</div>
                <div>⭐ ${level.rewards.xp} XP</div>
            </div>
        `;
        
        if (isCompleted) {
            content += `<div class="completed-overlay">✅ COMPLETED</div>`;
        }
        
        levelCard.innerHTML = content;
        
        if (!isCompleted) {
            levelCard.addEventListener('click', () => {
                document.querySelectorAll('.level-card').forEach(card => card.classList.remove('selected'));
                levelCard.classList.add('selected');
                setTimeout(() => showUnitSelection(level), 300);
            });
        }
        
        grid.appendChild(levelCard);
    });
}

// NEW: render the currently selected army list
function updateArmyDisplay() {
    const armyDisplay = document.getElementById('army-display');
    if (!armyDisplay) return;

    armyDisplay.innerHTML = '';

    if (selectedArmy.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No units selected yet.';
        armyDisplay.appendChild(empty);
        return;
    }

    selectedArmy.forEach((unitType, index) => {
        const stats = UNIT_TYPES[unitType];
        const row = document.createElement('div');
        row.className = 'army-unit';
        row.innerHTML = `
            <span>${stats ? stats.name : unitType}</span>
            <button onclick="removeFromArmy(${index})">Remove</button>
        `;
        armyDisplay.appendChild(row);
    });
}

function populateUnitSelection() {
    const availableGrid = document.getElementById('available-units');
    const armyDisplay = document.getElementById('army-display');
    
    availableGrid.innerHTML = '';
    armyDisplay.innerHTML = '';
    
    // Get ONLY unlocked units (not rented ones for selection)
    const availableUnits = [...playerProfile.unlockedUnits];
    
    console.log('Available units for selection:', availableUnits); // Debug log
    
    availableUnits.forEach(unitType => {
        const stats = UNIT_TYPES[unitType];
        const upgradeLevel = playerProfile.upgrades[unitType] || 0;
        
        const unitCard = document.createElement('div');
        unitCard.className = 'unit-selection-card';
        unitCard.innerHTML = `
            <div class="unit-name">${stats.name}</div>
            <div class="unit-upgrade">Upgrade: ${upgradeLevel}/5</div>
            <div class="unit-stats">
                HP: ${Math.floor(stats.health * (1 + upgradeLevel * 0.1))}
                DMG: ${Math.floor(stats.attackDamage * (1 + upgradeLevel * 0.1))}
            </div>
        `;
        
        unitCard.addEventListener('click', () => {
            if (selectedArmy.length < 6 && !selectedArmy.includes(unitType)) {
                selectedArmy.push(unitType);
                updateArmyDisplay();
                updateStartButton();
            }
        });
        
        availableGrid.appendChild(unitCard);
    });
    
    updateArmyDisplay();
}

window.removeFromArmy = function(index) {
    selectedArmy.splice(index, 1);
    updateArmyDisplay();
    updateStartButton();
};

function updateStartButton() {
    const startBtn = document.getElementById('start-battle');
    if (selectedArmy.length > 0) {
        startBtn.classList.remove('disabled');
        startBtn.disabled = false;
    } else {
        startBtn.classList.add('disabled');
        startBtn.disabled = true;
    }
}

function startSelectedBattle() {
    if (selectedArmy.length === 0) return;
    
    console.log('Starting battle with selected army:', selectedArmy);
    
    // Consume rental battles
    selectedArmy.forEach(unitType => {
        if (playerProfile.rentedUnits[unitType] > 0) {
            playerProfile.rentedUnits[unitType]--;
            if (playerProfile.rentedUnits[unitType] === 0) {
                delete playerProfile.rentedUnits[unitType];
            }
        }
    });
    
    savePlayerProfile();
    
    // Show VS screen over a live game background
    showVSScreen(selectedArmy, selectedLevel, selectedLevelIndex);
}

async function showVSScreen(army, level, levelIndex) {
    // Get current user info
    let playerName = 'Player';
    try {
        const currentUser = await websim.getCurrentUser();
        if (currentUser && currentUser.username) {
            playerName = currentUser.username;
        }
    } catch (e) {
        console.log('Could not get user info:', e);
    }
    
    const enemyName = level.name;
    
    // Hide selection screen and show game container
    document.getElementById('unit-selection').classList.add('hidden');
    document.getElementById('game-container').style.display = 'block';
    
    // Create the game immediately so the canvas is the background
    window.currentGame = new Game([...army], level, levelIndex);
    
    // Point camera at the distant mountains / extended plain for intro view
    if (window.currentGame && window.currentGame.camera) {
        window.currentGame.camera.position.set(0, 15, -50);
        window.currentGame.camera.lookAt(0, 10, -80);
    }

    // HIDE ALL BATTLE UI DURING VS SCREEN
    const uiRoot = document.getElementById('ui');
    const unitShop = document.getElementById('unit-shop');
    if (uiRoot) uiRoot.style.display = 'none';
    if (unitShop) unitShop.style.display = 'none';
    
    // Create VS overlay on top of the live game view
    const vsScreen = document.createElement('div');
    vsScreen.className = 'vs-screen';
    vsScreen.innerHTML = `
        <div class="vs-container">
            <div class="vs-players">
                <div class="vs-player">${playerName}</div>
                <div class="vs-text">VS</div>
                <div class="vs-enemy">${enemyName}</div>
            </div>
            <button class="vs-start-btn" id="vs-start-battle">START BATTLE</button>
        </div>
    `;
    
    document.body.appendChild(vsScreen);
    
    const startBtn = document.getElementById('vs-start-battle');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            // Fade out the VS overlay while the camera zooms into battle
            vsScreen.classList.add('fade-out');
            
            // Start camera animation into the main battlefield
            if (window.currentGame) {
                animateCameraToStart(window.currentGame, () => {
                    // After zoom completes, SHOW UI and START the actual battle
                    const uiRootAfter = document.getElementById('ui');
                    const unitShopAfter = document.getElementById('unit-shop');
                    if (uiRootAfter) uiRootAfter.style.display = '';
                    if (unitShopAfter) unitShopAfter.style.display = '';

                    if (window.currentGame && typeof window.currentGame.startBattle === 'function') {
                        window.currentGame.startBattle();
                    }
                });
            }
            
            // Remove overlay after fade-out
            setTimeout(() => {
                if (vsScreen.parentNode) {
                    vsScreen.parentNode.removeChild(vsScreen);
                }
            }, 400);
        });
    }
}

function animateCameraToStart(game, onComplete) {
    const startPos = { x: 0, y: 15, z: -50 };
    const endPos = { x: 0, y: 8, z: 15 };
    const startLook = { x: 0, y: 10, z: -80 };
    const endLook = { x: 0, y: 0, z: 0 };
    
    let progress = 0;
    const duration = 2000; // 2 seconds
    const startTime = Date.now();
    
    function animate() {
        const elapsed = Date.now() - startTime;
        progress = Math.min(elapsed / duration, 1);
        
        // Smooth easing
        const eased = 1 - Math.pow(1 - progress, 3);
        
        // Interpolate camera position
        game.camera.position.x = startPos.x + (endPos.x - startPos.x) * eased;
        game.camera.position.y = startPos.y + (endPos.y - startPos.y) * eased;
        game.camera.position.z = startPos.z + (endPos.z - startPos.z) * eased;
        
        // Interpolate look target
        const lookX = startLook.x + (endLook.x - startLook.x) * eased;
        const lookY = startLook.y + (endLook.y - startLook.y) * eased;
        const lookZ = startLook.z + (endLook.z - startLook.z) * eased;
        game.camera.lookAt(lookX, lookY, lookZ);
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Set final camera position
            game.camera.position.set(endPos.x, endPos.y, endPos.z);
            game.camera.lookAt(endLook.x, endLook.y, endLook.z);

            // Call completion callback if provided
            if (typeof onComplete === 'function') {
                onComplete();
            }
        }
    }
    
    animate();
}

function populateShopGrid() {
    const grid = document.getElementById('shop-units-grid');
    const coinsDisplay = document.getElementById('shop-coins');
    const xpDisplay = document.getElementById('shop-xp');
    
    coinsDisplay.textContent = playerProfile.campaignCoins;
    xpDisplay.textContent = playerProfile.xp;
    
    grid.innerHTML = '';
    
    Object.entries(UNIT_TYPES).forEach(([unitType, stats]) => {
        const isUnlocked = playerProfile.unlockedUnits.includes(unitType);
        const upgradeLevel = playerProfile.upgrades[unitType] || 0;
        const canUpgrade = upgradeLevel < 5 && isUnlocked;
        
        const purchasePrice = stats.originalCost * 3; 
        const upgradePrice = (upgradeLevel + 1) * 35; 
        
        const requiredLevel = getUnlockLevel(unitType);
        const shardConfig = SHARD_CONFIG[unitType];
        const currentShards = playerProfile.shards[unitType] || 0;
        const shardsNeeded = shardConfig.required;
        const hasEnoughShards = currentShards >= shardsNeeded;
        const hasEnoughLevel = playerProfile.level >= requiredLevel;
        
        const canUnlock = hasEnoughLevel && hasEnoughShards && !isUnlocked;
        
        const shopCard = document.createElement('div');
        shopCard.className = `shop-unit-card ${!isUnlocked && !canUnlock ? 'locked' : ''}`;
        shopCard.innerHTML = `
            <div class="shop-unit-name">${stats.name}</div>
            <div class="shop-unit-stats">
                HP: ${Math.floor(stats.health * (1 + upgradeLevel * 0.1))}
                DMG: ${Math.floor(stats.attackDamage * (1 + upgradeLevel * 0.1))}
                SPD: ${(stats.speed * (1 + upgradeLevel * 0.05)).toFixed(1)}
            </div>
            <div class="shop-upgrade">Upgrade: ${upgradeLevel}/5</div>
            
            ${shardsNeeded > 0 ? `
                <div class="shard-progress">
                    ✨ Shards: ${currentShards}/${shardsNeeded}
                    <div class="shard-bar">
                        <div class="shard-fill" style="width: ${Math.min(100, (currentShards / shardsNeeded) * 100)}%"></div>
                    </div>
                </div>
            ` : ''}
            
            <div class="shop-actions">
                ${!isUnlocked && !hasEnoughLevel ? `
                    <div class="unlock-info">🔒 Unlock at Level ${requiredLevel}</div>
                ` : !isUnlocked && !hasEnoughShards ? `
                    <div class="unlock-info">Need ${shardsNeeded - currentShards} more shard${shardsNeeded - currentShards > 1 ? 's' : ''}</div>
                    <button class="shop-btn shard-btn ${playerProfile.campaignCoins >= shardConfig.cost ? '' : 'disabled'}" 
                            onclick="buyShard('${unitType}', ${shardConfig.cost})">
                        Buy Shard: ${shardConfig.cost} 💰
                    </button>
                ` : canUnlock ? `
                    <button class="shop-btn unlock-btn" 
                            onclick="unlockUnit('${unitType}')">
                        ✅ UNLOCK UNIT
                    </button>
                ` : isUnlocked ? `
                    <div class="unlock-info">✅ Owned</div>
                    ${canUpgrade ? `
                        <button class="shop-btn upgrade-btn ${playerProfile.campaignCoins >= upgradePrice ? '' : 'disabled'}" 
                                onclick="upgradeUnit('${unitType}', ${upgradePrice})">
                            Upgrade: ${upgradePrice} 💰
                        </button>
                    ` : ''}
                ` : ''}
            </div>
        `;
        
        // Add click event to open detailed book panel
        shopCard.addEventListener('click', (e) => {
            // Prevent opening if clicking on buttons
            if (e.target.tagName === 'BUTTON') return;
            openUnitDetailBook(unitType);
        });
        
        grid.appendChild(shopCard);
    });
}

function openUnitDetailBook(unitType) {
    const stats = UNIT_TYPES[unitType];
    const isUnlocked = playerProfile.unlockedUnits.includes(unitType);
    const upgradeLevel = playerProfile.upgrades[unitType] || 0;
    const shardConfig = SHARD_CONFIG[unitType];
    const currentShards = playerProfile.shards[unitType] || 0;
    const shardsNeeded = shardConfig.required;
    const hasEnoughShards = currentShards >= shardsNeeded;
    const requiredLevel = getUnlockLevel(unitType);
    const hasEnoughLevel = playerProfile.level >= requiredLevel;
    const canUnlock = hasEnoughLevel && hasEnoughShards && !isUnlocked;
    const upgradePrice = (upgradeLevel + 1) * 35;
    
    // Unit detailed information database
    const unitDetails = {
        miner: {
            quote: "Another day, another dollar... or in this case, resources!",
            physicalDesc: "Sturdy build with mining equipment attached. Wears a bright yellow hard hat and carries a pickaxe.",
            personality: "Meet Marcus, the optimist of the battlefield. He's here for the paycheck, not the glory. Loves his lunch breaks and always brings extra sandwiches to share.",
            ability: "Generates resources over time. Each upgrade increases generation rate by 2 resources per cycle."
        },
        grunt: {
            quote: "I didn't sign up for this... oh wait, I did.",
            physicalDesc: "Standard infantry build with basic armor plating. Carries a combat knife and determination.",
            personality: "This is Jake. He's the everyman soldier - reliable, steady, and always complaining about cafeteria food. Don't let his grumbling fool you; he's got your back.",
            ability: "Frontline melee fighter with balanced stats. The backbone of any army."
        },
        assault: {
            quote: "Spray and pray? More like aim and slay.",
            physicalDesc: "Lean and agile with tactical vest. Equipped with an advanced assault rifle.",
            personality: "Sarah here is all business. She's got a tattoo of every mission she's completed. Listens to metal music before battles. Very particular about weapon maintenance.",
            ability: "Medium-range assault rifle with good mobility and fire rate. Effective at suppressing enemies."
        },
        medic: {
            quote: "I'm here to save lives... mostly.",
            physicalDesc: "Compact frame with medical insignia. Carries a field medkit and a sidearm for protection.",
            personality: "Dr. Chen is the team mom/dad. Always has bandaids, always has snacks. Gets genuinely upset when teammates take unnecessary risks.",
            ability: "Heals all nearby allies in a burst every 3 seconds. Essential support unit for sustained battles."
        },
        grenadier: {
            quote: "I solve problems. Explosive problems.",
            physicalDesc: "Bulky build with reinforced blast armor. Carries multiple grenades and wears a confident smirk.",
            personality: "Call him Boom. Just Boom. He's a simple guy with simple solutions. Problem? Grenade. Bigger problem? Bigger grenade. Surprisingly, he's very safety-conscious.",
            ability: "Throws grenades dealing area damage and stunning enemies briefly. Excels at breaking enemy formations."
        },
        sniper: {
            quote: "I never miss. Well, technically 30% of the time I do, but who's counting?",
            physicalDesc: "Slim profile with ghillie suit elements. Equipped with a high-powered rifle and scope.",
            personality: "This is Ghost. Actually, her name is Emma, but everyone calls her Ghost. She's quiet, calculating, and has an encyclopedic knowledge of wind patterns.",
            ability: "Long-range precision shots with high damage. 70% accuracy but devastating when hits connect."
        },
        sergeant: {
            quote: "I've seen things you wouldn't believe. Most of them were paperwork.",
            physicalDesc: "Battle-scarred veteran with rank insignia. Carries a reliable service rifle and years of experience.",
            personality: "Sergeant Rodriguez has three rules: show up on time, maintain your gear, and don't die. He's been through 47 battles and just wants to retire with his dog.",
            ability: "Experienced combat veteran with balanced stats and medium range. Reliable in any situation."
        },
        rocketeer: {
            quote: "Stand back, I'm about to science the heck out of this!",
            physicalDesc: "Heavy weapons specialist with reinforced shoulders. Wields a massive rocket launcher with ease.",
            personality: "Big Joe loves two things: rockets and rockets. He names each rocket. His favorite is 'Betty'. He's surprisingly gentle off the battlefield and volunteers at animal shelters.",
            ability: "Fires devastating rockets with massive area damage and extended stun duration. Slow fire rate but game-changing impact."
        },
        riot: {
            quote: "What are they gonna do, shoot me? I have a shield!",
            physicalDesc: "Tank-like build with full riot gear. Carries a massive shield and stun weaponry.",
            personality: "Officer Stone is the definition of 'confidence'. Some call it overconfidence. He calls it 'being right'. Loves chess and strategy games. Always brings board games to barracks.",
            ability: "Shield absorbs 500 damage before breaking. Fires stun rounds that disable enemies for 3 seconds. The ultimate tank unit."
        },
        surgeon: {
            quote: "Death is just a minor setback in my professional opinion.",
            physicalDesc: "Medical specialist with advanced equipment. Wears pristine white coat even in combat (somehow).",
            personality: "Dr. Alexander believes no one should die on his watch. He's eccentric, brilliant, and has memorized every soldier's medical history. Drinks way too much coffee.",
            ability: "Every 6 seconds, Dr. Alexander scans the battlefield and yanks a nearby dying ally back from the brink—or blasts a huge heal if no one is down.",
        },
        colonel: {
            quote: "Shoot the enemy, shoot again, keep shooting. You're getting there soldier!",
            physicalDesc: "Distinguished officer with command insignia and tactical headset. Carries a sidearm and commanding presence.",
            personality: "Colonel Winters runs a tight ship. She's fair, strategic, and has a photographic memory for tactics. Off duty, she secretly loves romantic comedies.",
            ability: "Every 10s, marks a high-value enemy for focus fire. All allies prioritize this target. Grants 10 gold on elimination."
        },
        commando: {
            quote: "I work better when I'm angry. And I'm always angry.",
            physicalDesc: "Elite operative in tactical black gear. Moves like a shadow, fights like a hurricane.",
            personality: "Nobody knows Reaper's real name. He's fast, deadly, and has exactly one friend (it's the medic). At 20% health, something snaps and he becomes unstoppable.",
            ability: "Elite fast shooter. At 20% health: berserker mode (2x fire rate, heal to 75% once)."
        }
    };
    
    const detail = unitDetails[unitType];
    
    // Create book modal
    const bookModal = document.createElement('div');
    bookModal.className = 'unit-detail-book';
    bookModal.innerHTML = `
        <div class="book-panel">
            <span class="book-close">&times;</span>
            <h2 class="book-title">${stats.name}</h2>
            <div class="book-subtitle">Unit Dossier & Combat Profile</div>
            
            <div class="book-section">
                <h3>📊 Combat Statistics</h3>
                <div class="book-stats-grid">
                    <div class="stat-item">
                        <div class="stat-label">Health</div>
                        <div class="stat-value">${Math.floor(stats.health * (1 + upgradeLevel * 0.1))}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Damage</div>
                        <div class="stat-value">${Math.floor(stats.attackDamage * (1 + upgradeLevel * 0.1))}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Speed</div>
                        <div class="stat-value">${(stats.speed * (1 + upgradeLevel * 0.05)).toFixed(1)}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Range</div>
                        <div class="stat-value">${stats.range > 0 ? stats.range : 'Melee'}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Attack Speed</div>
                        <div class="stat-value">${(1000 / stats.attackCooldown).toFixed(2)}/s</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Cost</div>
                        <div class="stat-value">${stats.cost} 💰</div>
                    </div>
                </div>
            </div>
            
            <div class="book-section">
                <h3>⚔️ Special Ability</h3>
                <p class="book-description">${detail.ability}</p>
            </div>
            
            <div class="book-quote">
                "${detail.quote}"
            </div>
            
            <div class="book-section">
                <h3>👤 Physical Description</h3>
                <p class="book-description">${detail.physicalDesc}</p>
            </div>
            
            <div class="book-section">
                <h3>💭 Personality Profile</h3>
                <p class="book-description">${detail.personality}</p>
            </div>
            
            <div class="book-section">
                <h3>📈 Upgrade Level</h3>
                <p class="book-description">Current Level: ${upgradeLevel}/5</p>
                <p class="book-description">Each upgrade increases stats by 10% (5% for speed).</p>
            </div>
            
            ${shardsNeeded > 0 ? `
                <div class="shard-display">
                    <div class="shard-progress-text">✨ Shards Collected: ${currentShards}/${shardsNeeded}</div>
                    <div class="shard-bar">
                        <div class="shard-fill" style="width: ${Math.min(100, (currentShards / shardsNeeded) * 100)}%"></div>
                    </div>
                </div>
            ` : ''}
            
            <div class="book-actions">
                ${!isUnlocked && !hasEnoughLevel ? `
                    <div style="text-align: center; color: #8b6f47;">
                        🔒 Unlocks at Level ${requiredLevel}
                    </div>
                ` : !isUnlocked && !hasEnoughShards ? `
                    <button class="book-btn book-shard-btn ${playerProfile.campaignCoins >= shardConfig.cost ? '' : 'disabled'}" 
                            onclick="buyShard('${unitType}', ${shardConfig.cost}); closeUnitDetailBook();">
                        Buy Shard: ${shardConfig.cost} 💰
                    </button>
                    <div style="text-align: center; color: #8b6f47; margin-top: 10px;">
                        Need ${shardsNeeded - currentShards} more shard${shardsNeeded - currentShards > 1 ? 's' : ''} to unlock
                    </div>
                ` : canUnlock ? `
                    <button class="book-btn book-unlock-btn" 
                            onclick="unlockUnit('${unitType}'); closeUnitDetailBook();">
                        ✅ UNLOCK UNIT
                    </button>
                ` : isUnlocked ? `
                    <div style="text-align: center; color: #10b981; font-size: 1.2em; margin-bottom: 15px;">
                        ✅ Unit Unlocked & Ready for Combat
                    </div>
                    ${upgradeLevel < 5 ? `
                        <button class="book-btn book-upgrade-btn ${playerProfile.campaignCoins >= upgradePrice ? '' : 'disabled'}" 
                                onclick="upgradeUnit('${unitType}', ${upgradePrice}); closeUnitDetailBook();">
                            Upgrade to Level ${upgradeLevel + 1}: ${upgradePrice} 💰
                        </button>
                    ` : `
                        <div style="text-align: center; color: #fbbf24; font-size: 1.2em;">
                            ⭐ Maximum Upgrade Level Reached ⭐
                        </div>
                    `}
                ` : ''}
            </div>
        </div>
    `;
    
    document.body.appendChild(bookModal);
    
    // Close button functionality
    const closeBtn = bookModal.querySelector('.book-close');
    closeBtn.addEventListener('click', () => {
        document.body.removeChild(bookModal);
    });
    
    // Click outside to close
    bookModal.addEventListener('click', (e) => {
        if (e.target === bookModal) {
            document.body.removeChild(bookModal);
        }
    });
}

window.closeUnitDetailBook = function() {
    const bookModal = document.querySelector('.unit-detail-book');
    if (bookModal) {
        document.body.removeChild(bookModal);
        // Refresh shop to show updated values
        populateShopGrid();
    }
};

function buyShard(unitType, cost) {
    if (playerProfile.campaignCoins >= cost) {
        playerProfile.campaignCoins -= cost;
        if (!playerProfile.shards[unitType]) {
            playerProfile.shards[unitType] = 0;
        }
        playerProfile.shards[unitType]++;
        savePlayerProfile();
        populateShopGrid();
        updateProfileDisplay();
    }
}

function unlockUnit(unitType) {
    const shardConfig = SHARD_CONFIG[unitType];
    const currentShards = playerProfile.shards[unitType] || 0;
    
    if (currentShards >= shardConfig.required) {
        playerProfile.unlockedUnits.push(unitType);
        playerProfile.shards[unitType] -= shardConfig.required;
        savePlayerProfile();
        populateShopGrid();
        alert(`${UNIT_TYPES[unitType].name} unlocked! You can now use it in battles.`);
        
        // NEW: Show special unlock celebration screen
        showUnitUnlockCelebration(unitType);
    }
}

function purchaseUnit(unitType, price) {
    if (playerProfile.campaignCoins >= price) {
        playerProfile.campaignCoins -= price;
        playerProfile.unlockedUnits.push(unitType);
        savePlayerProfile();
        populateShopGrid();
        alert(`${UNIT_TYPES[unitType].name} purchased! You can now use it in battles.`);
    }
}

function rentUnit(unitType, price) {
    if (playerProfile.campaignCoins >= price) {
        playerProfile.campaignCoins -= price;
        playerProfile.rentedUnits[unitType] = (playerProfile.rentedUnits[unitType] || 0) + 3;
        savePlayerProfile();
        populateShopGrid();
    }
}

function upgradeUnit(unitType, price) {
    if (playerProfile.campaignCoins >= price) {
        const currentLevel = playerProfile.upgrades[unitType] || 0;
        if (currentLevel < 5) {
            playerProfile.campaignCoins -= price;
            playerProfile.upgrades[unitType] = currentLevel + 1;
            savePlayerProfile();
            populateShopGrid();
        }
    }
}

// Award shard rewards function - called from game.js
window.awardShardRewards = function() {
    const shardRewards = [];
    const playerProfile = getPlayerProfile();
    
    Object.entries(SHARD_CONFIG).forEach(([unitType, config]) => {
        if (config.dropChance > 0 && Math.random() < config.dropChance) {
            if (!playerProfile.shards[unitType]) {
                playerProfile.shards[unitType] = 0;
            }
            playerProfile.shards[unitType]++;
            shardRewards.push(UNIT_TYPES[unitType].name);
        }
    });
    
    savePlayerProfile();
    return shardRewards;
};

// Expose player profile getter
function getPlayerProfile() {
    return playerProfile;
}

window.getPlayerProfile = getPlayerProfile;

// NEW: Unit unlock celebration
function showUnitUnlockCelebration(unitType) {
    const stats = UNIT_TYPES[unitType];
    if (!stats) return;
    
    const detail = getUnitDetailedInfo(unitType);
    
    const modal = document.createElement('div');
    modal.className = 'unit-unlock-modal';
    modal.innerHTML = `
        <div class="unit-unlock-card">
            <div class="unit-unlock-glow"></div>
            <div class="unit-unlock-header">NEW UNIT UNLOCKED!</div>
            <div class="unit-unlock-name">${stats.name}</div>
            <div class="unit-unlock-tagline">${detail.ability || 'Ready for battle.'}</div>
            <div class="unit-unlock-stats">
                <div class="unit-unlock-stat">
                    <span>Health</span>
                    <strong>${stats.health}</strong>
                </div>
                <div class="unit-unlock-stat">
                    <span>Damage</span>
                    <strong>${stats.attackDamage}</strong>
                </div>
                <div class="unit-unlock-stat">
                    <span>Speed</span>
                    <strong>${stats.speed.toFixed(1)}</strong>
                </div>
                <div class="unit-unlock-stat">
                    <span>Cost</span>
                    <strong>${stats.cost}</strong>
                </div>
            </div>
            <div class="unit-unlock-flavor">
                ${detail.description || 'A new force has joined your Battle Line.'}
            </div>
            <button class="unit-unlock-close-btn">Add to Army</button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const close = () => {
        modal.classList.add('closing');
        setTimeout(() => {
            if (modal.parentNode) modal.parentNode.removeChild(modal);
        }, 250);
    };
    
    modal.querySelector('.unit-unlock-close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        close();
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            close();
        }
    });
}

function startRefreshTimer() {
    setInterval(() => {
        refreshTimer--;
        const minutes = Math.floor(refreshTimer / 60);
        const seconds = refreshTimer % 60;
        document.getElementById('refresh-countdown').textContent = 
            `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        if (refreshTimer <= 0) {
            refreshTimer = 1200; // Reset to 20 minutes
            generateNewLevels();
            if (!document.getElementById('campaign-map').classList.contains('hidden')) {
                populateLevelsGrid();
            }
        }
    }, 1000);
}

// Function to handle level completion
window.completeLevel = function(levelIndex) {
    if (levelIndex >= 0 && levelIndex < 3) {
        playerProfile.levelStatus[levelIndex] = true;
        savePlayerProfile();
        
        // Check if all 3 levels are completed
        if (playerProfile.levelStatus.every(status => status === true)) {
            setTimeout(() => {
                claimCampaignCompletionReward();
            }, 1000); // Small delay
        }
    }
};

function claimCampaignCompletionReward() {
    const level = playerProfile.level;
    let rewardCoins = 0;
    
    if (level <= 5) rewardCoins = 30;
    else if (level <= 12) rewardCoins = 45;
    else if (level <= 20) rewardCoins = 70;
    else if (level <= 29) rewardCoins = 100;
    else if (level <= 40) rewardCoins = 150;
    else if (level <= 59) rewardCoins = 220;
    else if (level <= 99) rewardCoins = 300;
    else rewardCoins = 450; // Level 100+
    
    playerProfile.campaignCoins += rewardCoins;
    savePlayerProfile();
    updateProfileDisplay();
    
    alert(`🎉 CAMPAIGN CLEARED! 🎉\n\nYou defeated all 3 missions!\nReward: +${rewardCoins} Coins\n\nNew missions are being generated...`);
    
    // Auto reset levels
    refreshTimer = 1200;
    generateNewLevels();
    if (!document.getElementById('campaign-map').classList.contains('hidden')) {
        populateLevelsGrid();
    }
}

function updateProfileDisplay() {
    const xpNeeded = getXPNeeded(playerProfile.level);
    
    document.getElementById('player-level').textContent = playerProfile.level;
    document.getElementById('player-xp').textContent = playerProfile.xp;
    document.getElementById('xp-needed').textContent = xpNeeded;
    document.getElementById('player-coins').textContent = playerProfile.campaignCoins;
    
    // Update XP bar width
    const xpPercent = Math.min(100, Math.max(0, (playerProfile.xp / xpNeeded) * 100));
    const xpBar = document.getElementById('xp-bar-fill');
    if (xpBar) {
        xpBar.style.width = `${xpPercent}%`;
    }
}

function showTipScreen() {
    // Continue main menu music
    const mainMenuMusic = document.getElementById('main-menu-music');
    if (mainMenuMusic && mainMenuMusic.paused) {
        mainMenuMusic.play().catch(e => console.log('Music autoplay blocked:', e));
    }
    
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('campaign-map').classList.add('hidden');
    document.getElementById('unit-shop-screen').classList.add('hidden');
    document.getElementById('unit-selection').classList.add('hidden');
    document.getElementById('tip-screen').classList.remove('hidden');
}

function updateTipPreview() {
    const tipAmount = parseInt(document.getElementById('tip-amount').value) || 0;
    const coinsToReceive = Math.floor(tipAmount / 3);
    document.getElementById('coins-preview').textContent = coinsToReceive;
}

async function convertCredits() {
    const tipAmount = parseInt(document.getElementById('tip-amount').value) || 0;
    
    if (tipAmount < 3) {
        alert('Minimum tip amount is 3 credits!');
        return;
    }
    
    if (tipAmount % 3 !== 0) {
        alert('Tip amount must be divisible by 3!');
        return;
    }
    
    try {
        // Use websim's postComment to handle the credit transaction
        const result = await websim.postComment({
            content: `Converting ${tipAmount} credits to ${Math.floor(tipAmount / 3)} campaign coins. Thank you for supporting Battle Line!`,
            credits: tipAmount
        });
        
        // Only proceed if the comment was actually posted successfully
        if (!result || result.error) {
            alert('Tip failed: Credits not processed. Please try again.');
            return;
        }
        
        // Listen for the actual comment creation event to confirm the tip went through
        let tipProcessed = false;
        const commentHandler = (event) => {
            if (event.comment && event.comment.card_data && event.comment.card_data.type === 'tip_comment') {
                const actualCreditsSpent = event.comment.card_data.credits_spent;
                
                // Award campaign coins based on actual credits spent
                const coinsToAdd = Math.floor(actualCreditsSpent / 3);
                playerProfile.campaignCoins += coinsToAdd;
                
                tipProcessed = true;
                window.websim.removeEventListener('comment:created', commentHandler);
                
                // Check for bonus riot unit
                if (actualCreditsSpent >= 1500) {
                    if (playerProfile.unlockedUnits.includes('riot')) {
                        // Give extra coins equivalent to a riot unit purchase
                        playerProfile.campaignCoins += 200;
                        alert(`Thank you for your generous tip! You received ${coinsToAdd} campaign coins and a FREE Riot unit bonus (200 coins)!`);
                    } else {
                        // Unlock riot unit if not already unlocked
                        playerProfile.unlockedUnits.push('riot');
                        alert(`Thank you for your generous tip! You received ${coinsToAdd} campaign coins and unlocked the Riot unit!`);
                    }
                } else {
                    alert(`Thank you for your tip! You received ${coinsToAdd} campaign coins!`);
                }
                
                savePlayerProfile();
                updateProfileDisplay();
                
                // Reset tip form
                document.getElementById('tip-amount').value = '';
                updateTipPreview();
                
                // Go back to main menu
                showMainMenu();
            }
        };
        
        window.websim.addEventListener('comment:created', commentHandler);
        
        // Set timeout to check if tip was processed
        setTimeout(() => {
            if (!tipProcessed) {
                window.websim.removeEventListener('comment:created', commentHandler);
                alert('Tip verification timeout. Please check if your tip went through and contact support if coins were not awarded.');
            }
        }, 10000); // 10 second timeout
        
    } catch (error) {
        alert('Tip failed: ' + error.message);
    }
}

function showCratesScreen() {
    // Continue main menu music
    const mainMenuMusic = document.getElementById('main-menu-music');
    if (mainMenuMusic && mainMenuMusic.paused) {
        mainMenuMusic.play().catch(e => console.log('Music autoplay blocked:', e));
    }
    
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('campaign-map').classList.add('hidden');
    document.getElementById('unit-shop-screen').classList.add('hidden');
    document.getElementById('unit-selection').classList.add('hidden');
    document.getElementById('tip-screen').classList.add('hidden');
    document.getElementById('crates-screen').classList.remove('hidden');
    
    updateCratesDisplay();
}

function updateCratesDisplay() {
    document.getElementById('crates-coins').textContent = playerProfile.campaignCoins;
    
    // Update button states based on coins
    const cratePrices = {
        common: 50,
        uncommon: 150,
        rare: 400,
        epic: 1000,
        elite: 2500
    };
    
    Object.entries(cratePrices).forEach(([type, price]) => {
        const button = document.getElementById(`open-${type}-crate`);
        if (playerProfile.campaignCoins >= price) {
            button.classList.remove('disabled');
            button.disabled = false;
        } else {
            button.classList.add('disabled');
            button.disabled = true;
        }
    });
}

function openCrate(crateType) {
    const cratePrices = {
        common: 50,
        uncommon: 150,
        rare: 400,
        epic: 1000,
        elite: 2500
    };
    
    const price = cratePrices[crateType];
    
    if (playerProfile.campaignCoins < price) {
        alert('Not enough coins!');
        return;
    }
    
    // Deduct coins
    playerProfile.campaignCoins -= price;
    
    // Determine number of items
    const itemCount = crateType === 'elite' ? 4 : 3;
    
    // Generate rewards
    const rewards = [];
    
    // Handle Elite Pity System
    let guaranteedUnit = false;
    if (crateType === 'elite') {
        playerProfile.elitePityCounter++;
        if (playerProfile.elitePityCounter >= 3) {
            guaranteedUnit = true;
            playerProfile.elitePityCounter = 0; // Reset
        }
    }
    
    for (let i = 0; i < itemCount; i++) {
        // Force last item of elite crate to be unit if pity active
        if (guaranteedUnit && i === itemCount - 1) {
            rewards.push(generateUnitReward(crateType)); // Force unit reward
        } else {
            const reward = generateCrateReward(crateType);
            // If we naturally got a unit, reset pity counter
            if (crateType === 'elite' && (reward.type === 'unit' || reward.type === 'duplicate_unit')) {
                playerProfile.elitePityCounter = 0;
            }
            rewards.push(reward);
        }
    }
    
    // Apply rewards and show results
    displayCrateRewards(crateType, rewards);
    
    savePlayerProfile();
    updateCratesDisplay();
}

// Helper: open a crate for free (used by secret codes, no coin cost)
function openCrateFree(crateType) {
    // Determine number of items
    const itemCount = crateType === 'elite' ? 4 : 3;

    const rewards = [];

    // For free crates, we skip the elite pity counter so it doesn't affect paid crates
    for (let i = 0; i < itemCount; i++) {
        rewards.push(generateCrateReward(crateType));
    }

    // Apply rewards and show results (coins are modified only via rewards)
    displayCrateRewards(crateType, rewards);

    savePlayerProfile();
    updateCratesDisplay();
}

function generateCrateReward(crateType) {
    // Define drop rates for each crate type - SIGNIFICANTLY IMPROVED
    const dropTables = {
        common: {
            xp: 0.40,
            coins: 0.40,
            battle: 0.18,
            unit: 0.00,
            shard: 0.02
        },
        uncommon: {
            xp: 0.30,
            coins: 0.35,
            battle: 0.25,
            unit: 0.00,
            shard: 0.10
        },
        rare: {
            xp: 0.20,
            coins: 0.30,
            battle: 0.30,
            unit: 0.00,
            shard: 0.20
        },
        epic: {
            xp: 0.15,
            coins: 0.25,
            battle: 0.30,
            unit: 0.012,
            shard: 0.288
        },
        elite: {
            xp: 0.10,
            coins: 0.20,
            battle: 0.25,
            unit: 0.06,
            shard: 0.39
        }
    };
    
    const table = dropTables[crateType];
    const roll = Math.random();
    
    let rewardType;
    let cumulative = 0;
    
    for (const [type, chance] of Object.entries(table)) {
        cumulative += chance;
        if (roll < cumulative) {
            rewardType = type;
            break;
        }
    }
    
    // Generate specific reward based on type
    switch (rewardType) {
        case 'xp':
            return generateXPReward(crateType);
        case 'coins':
            return generateCoinsReward(crateType);
        case 'battle':
            return generateBattleReward(crateType);
        case 'unit':
            return generateUnitReward(crateType);
        case 'shard':
            return generateShardReward(crateType);
        default:
            return generateCoinsReward(crateType);
    }
}

function generateXPReward(crateType) {
    const xpAmounts = {
        common: [40, 100],
        uncommon: [120, 300],
        rare: [400, 800],
        epic: [2000, 4000], // Increased significantly
        elite: [5000, 10000] // Increased significantly
    };
    
    const [min, max] = xpAmounts[crateType];
    const amount = Math.floor(Math.random() * (max - min + 1)) + min;
    
    return {
        type: 'xp',
        amount: amount,
        display: `⭐ ${amount} XP`
    };
}

function generateCoinsReward(crateType) {
    const coinAmounts = {
        common: [20, 60],
        uncommon: [70, 160],
        rare: [200, 400],
        epic: [800, 1600], // Increased significantly
        elite: [2000, 4000] // Increased significantly
    };
    
    const [min, max] = coinAmounts[crateType];
    const amount = Math.floor(Math.random() * (max - min + 1)) + min;
    
    return {
        type: 'coins',
        amount: amount,
        display: `💰 ${amount} Coins`
    };
}

function generateBattleReward(crateType) {
    const rewardMultipliers = {
        common: 1.5,
        uncommon: 2.0,
        rare: 2.5,
        epic: 3.0,
        elite: 4.0
    };
    
    const multiplier = rewardMultipliers[crateType];
    
    return {
        type: 'battle',
        multiplier: multiplier,
        display: `⚔️ Boosted Battle (${multiplier}x rewards)`
    };
}

function generateUnitReward(crateType) {
    // Define unit pools for each crate type
    const unitPools = {
        epic: ['medic', 'grenadier', 'sniper', 'assault'],
        elite: ['sergeant', 'rocketeer', 'riot', 'surgeon', 'medic', 'grenadier', 'sniper', 'colonel', 'commando']
    };
    
    const pool = unitPools[crateType];
    const unitType = pool[Math.floor(Math.random() * pool.length)];
    
    // Check if player already owns this unit
    const alreadyOwned = playerProfile.unlockedUnits.includes(unitType);
    
    if (alreadyOwned) {
        // Convert to coins
        const unitValues = {
            medic: 100,
            assault: 120,
            grenadier: 150,
            sniper: 200,
            sergeant: 250,
            rocketeer: 300,
            riot: 400,
            surgeon: 500,
            colonel: 800,
            commando: 1200
        };
        
        const coinValue = unitValues[unitType] || 100;
        
        return {
            type: 'duplicate_unit',
            unitType: unitType,
            coinValue: coinValue,
            display: `🔄 Duplicate ${UNIT_TYPES[unitType].name} → ${coinValue} Coins`
        };
    } else {
        return {
            type: 'unit',
            unitType: unitType,
            display: `🎖️ ${UNIT_TYPES[unitType].name} (NEW!)`
        };
    }
}

function generateShardReward(crateType) {
    // Define shard pools based on crate rarity
    const shardPools = {
        common: ['assault', 'medic'],
        uncommon: ['assault', 'medic', 'grenadier'],
        rare: ['medic', 'grenadier', 'sniper', 'sergeant'],
        epic: ['grenadier', 'sniper', 'sergeant', 'rocketeer', 'riot'],
        elite: ['sergeant', 'rocketeer', 'riot', 'surgeon', 'colonel', 'commando']
    };
    
    const pool = shardPools[crateType];
    const unitType = pool[Math.floor(Math.random() * pool.length)];
    
    // Determine number of shards (1-3 for common/uncommon, 1-5 for rare+)
    let shardCount;
    if (crateType === 'common' || crateType === 'uncommon') {
        shardCount = Math.floor(Math.random() * 3) + 1;
    } else if (crateType === 'rare') {
        shardCount = Math.floor(Math.random() * 5) + 1;
    } else {
        shardCount = Math.floor(Math.random() * 7) + 2;
    }
    
    return {
        type: 'shard',
        unitType: unitType,
        amount: shardCount,
        display: `✨ ${shardCount}x ${UNIT_TYPES[unitType].name} Shard${shardCount > 1 ? 's' : ''}`
    };
}

function getUnitDetailedInfo(type) {
    const unitDetails = {
        miner: {
            ability: "Resource Generation",
            description: "Generates resources over time. Upgrades increase resource generation rate.",
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
            description: "Every 6 seconds, revives a nearby fallen ally within range. If no one is down, he instead sends out a powerful heal pulse.",
            range: 150
        },
        colonel: {
            ability: "Focus Fire Command",
            description: "Every 10s, marks a high-value enemy for focus fire. All allies prioritize this target. Grants 10 gold on elimination.",
            range: 210
        },
        commando: {
            ability: "Berserker Rage", 
            description: "Fast shooter. At 20% health: berserker mode (2x fire rate, heal to 75% once).",
            range: 160
        }
    };
    
    return unitDetails[type] || { ability: "Unknown", description: "No information available", range: 0 };
}

function displayCrateRewards(crateType, rewards) {
    const modal = document.createElement('div');
    modal.className = 'crate-reward-modal';
    modal.innerHTML = `
        <div class="crate-rewards-content">
            <h2>🎁 ${crateType.toUpperCase()} CRATE REWARDS 🎁</h2>
            <div class="crate-rewards-list">
                ${rewards.map(reward => `<div class="reward-item">${reward.display}</div>`).join('')}
            </div>
            <button class="collect-rewards-btn">Collect Rewards</button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Apply rewards
    modal.querySelector('.collect-rewards-btn').addEventListener('click', () => {
        rewards.forEach(reward => {
            switch (reward.type) {
                case 'xp':
                    addXP(reward.amount);
                    break;
                case 'coins':
                    playerProfile.campaignCoins += reward.amount;
                    break;
                case 'battle':
                    // Store boosted battle for next battle
                    if (!playerProfile.boostedBattles) playerProfile.boostedBattles = [];
                    playerProfile.boostedBattles.push(reward.multiplier);
                    break;
                case 'unit':
                    playerProfile.unlockedUnits.push(reward.unitType);
                    break;
                case 'duplicate_unit':
                    playerProfile.campaignCoins += reward.coinValue;
                    break;
                case 'shard':
                    if (!playerProfile.shards[reward.unitType]) {
                        playerProfile.shards[reward.unitType] = 0;
                    }
                    playerProfile.shards[reward.unitType] += reward.amount;
                    break;
            }
        });
        
        savePlayerProfile();
        updateProfileDisplay();
        updateCratesDisplay();
        
        document.body.removeChild(modal);
    });
}

// NEW: start tutorial battle for brand new players
function startTutorialBattle() {
    // Hide menus and show game container
    const mainMenu = document.getElementById('main-menu');
    if (mainMenu) mainMenu.classList.add('hidden');
    document.getElementById('campaign-map').classList.add('hidden');
    document.getElementById('unit-selection').classList.add('hidden');
    document.getElementById('game-over').classList.add('hidden');
    document.getElementById('game-container').style.display = 'block';

    // Stop main menu music (battle music will start from Game)
    document.querySelectorAll('audio').forEach(audio => {
        if (audio.id === 'main-menu-music') {
            audio.pause();
        }
    });

    const tutorialUnits = ['miner', 'grunt', 'medic', 'colonel', 'commando', 'rocketeer'];
    const tutorialLevel = {
        stars: 1,
        difficulty: 1,
        enemyUnits: 6,
        rewards: { coins: 0, xp: 0 },
        name: 'Tutorial Engagement',
        description: 'Learn the basics of Battle Line.'
    };

    // Create tutorial game instance (levelIndex -1 so campaign progress is untouched)
    window.currentGame = new Game(tutorialUnits, tutorialLevel, -1, true);
}

// NEW: finish tutorial, show white "dream" screen then go back to menu
function finishTutorial() {
    playerProfile.tutorialCompleted = true;
    savePlayerProfile();

    // Remove the in‑battle tutorial overlay so its text does not follow you
    const existingOverlay = document.querySelector('.tutorial-overlay');
    if (existingOverlay && existingOverlay.parentNode) {
        existingOverlay.parentNode.removeChild(existingOverlay);
    }

    // Create full black overlay screen
    const overlay = document.createElement('div');
    overlay.className = 'tutorial-end-screen';
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 1s ease';

    overlay.innerHTML = `
        <div class="tutorial-end-content">
            <h2>That power you felt was a dream.</h2>
            <p>It can come true, but you gotta work for it.</p>
        </div>
    `;
    document.body.appendChild(overlay);

    // Fade in to black with text
    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
    });

    // After ~5 seconds, fade out the text and then return to main menu
    setTimeout(() => {
        const content = overlay.querySelector('.tutorial-end-content');
        if (content) {
            content.style.opacity = '1';
            content.style.transition = 'opacity 1s ease';
            content.style.opacity = '0';
        }

        // Fade the black screen away back to the main menu
        setTimeout(() => {
            overlay.style.opacity = '0';

            setTimeout(() => {
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
                showMainMenu();
            }, 1000);
        }, 1000);
    }, 5000);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('game-container').style.display = 'none';
    
    // Setup guide modal functionality
    const guideItems = document.querySelectorAll('.guide-item');
    const modal = document.getElementById('guide-modal');
    const modalTitle = document.getElementById('guide-modal-title');
    const modalText = document.getElementById('guide-modal-text');
    const closeBtn = document.querySelector('.guide-close');
    
    const guideInfo = {
        defend: {
            title: "🛡️ Defend Strategy",
            text: "Units stay near your base to completely protect it. Your units will attack any enemies that come close while staying in defensive positions. This strategy provides maximum base protection."
        },
        attack: {
            title: "⚔️ Attack Strategy", 
            text: "Units advance toward the enemy base aggressively. This puts pressure on the enemy but leaves your own base more vulnerable. Use this when you have a strong army or need to break through enemy defenses."
        },
        retreat: {
            title: "🏃 Retreat Strategy",
            text: "Units fall back behind your base for maximum protection. This keeps your units very safe and makes your base absorb all incoming damage. Good for defensive play when outnumbered or building up resources."
        },
        miners: {
            title: "💰 Miners",
            text: "Essential economic units that generate resources over time. They don't fight but are crucial for building your army. Protect them well as losing miners hurts your economy significantly."
        }
    };
    
    guideItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const infoType = item.getAttribute('data-info');
            const info = guideInfo[infoType];
            if (info) {
                modalTitle.textContent = info.title;
                modalText.textContent = info.text;
                modal.classList.remove('hidden');
            }
        });
    });
    
    closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });
    
    setTimeout(() => {
        document.getElementById('loading-screen').style.display = 'none';
        setupCampaignMap();
        
        // Decide whether to show tutorial or main menu
        const profile = window.getPlayerProfile ? window.getPlayerProfile() : null;
        if (profile && profile.tutorialCompleted === false) {
            // Go straight into tutorial battle
            startTutorialBattle();
        } else {
            // Normal flow: show main menu and start music
            document.getElementById('main-menu').classList.remove('hidden');
            const mainMenuMusic = document.getElementById('main-menu-music');
            if (mainMenuMusic) {
                mainMenuMusic.volume = 0.2;
                mainMenuMusic.play().catch(e => console.log('Music autoplay blocked:', e));
            }
        }
    }, 4000);
});

// Make shard/unlock/upgrade helpers globally accessible for inline onclick handlers
window.buyShard = buyShard;
window.unlockUnit = unlockUnit;
window.upgradeUnit = upgradeUnit;

// Export functions for use in other modules
window.addCampaignCoins = addCampaignCoins;
window.addXP = addXP;
window.showCampaignMap = showCampaignMap;
window.showMainMenu = showMainMenu;
window.setupCampaignMap = setupCampaignMap;
window.resetProgress = resetProgress;
window.SHARD_CONFIG = SHARD_CONFIG;

// NEW: expose tutorial completion so Game can call it safely
window.finishTutorial = finishTutorial;