// Centralized SFX registry and helper for playing sound effects

// Look up audio elements once on load
const SFX = {
    gunshot: null,
    hitShield: null,
    explosion: null,
    grenadeShot: null,
    death: null
};

if (typeof document !== 'undefined') {
    SFX.gunshot = document.getElementById('sfx-gunshot') || null;
    SFX.hitShield = document.getElementById('sfx-hit-shield') || null;
    SFX.explosion = document.getElementById('sfx-explosion') || null;
    SFX.grenadeShot = document.getElementById('sfx-grenade-shot') || null;
    SFX.death = document.getElementById('sfx-death') || null;
}

function playSfx(audioEl) {
    if (!audioEl) return;
    try {
        // Use a cloned audio node so volume doesn't get compounded
        // and multiple instances can play at once
        const clone = audioEl.cloneNode(true);
        clone.volume = 0.65;
        clone.currentTime = 0;
        clone.play().catch(() => {});
    } catch (e) {
        // ignore audio errors
    }
}

export { SFX, playSfx };