

// Define the effect interface
class Effect {
    constructor(source, apply, revert = null) {
        this.source = source;  // The card or zone causing the effect
        this.apply = apply;    // Function to apply the effect
        this.revert = revert;  // Optional function to revert the effect
    }
}

// Define the zone interface
class Zone {
    constructor(id, ownerId) {
        this.id = id;                  // Unique zone ID
        this.ownerId = ownerId;        // Player who controls this zone
        this.cards = [];               // Cards currently in the zone
        this.ongoingEffects = [];      // Active ongoing effects in the zone
    }

    // Add a card to the zone
    addCard(card, gameState) {
        this.cards.push(card);
        // Apply ongoing effects to the new card
        this.ongoingEffects.forEach(effect => {
            card.applyEffect(effect);
        });
    }

    // Remove a card from the zone
    removeCard(card) {
        this.cards = this.cards.filter(c => c.id !== card.id);
        // Remove effects tied to this card
        this.ongoingEffects = this.ongoingEffects.filter(effect => effect.source !== card);
    }

    // Add an ongoing effect to the zone
    addOngoingEffect(effect, gameState) {
        this.ongoingEffects.push(effect);
        // Apply the effect to all cards in the zone
        this.cards.forEach(card => {
            card.applyEffect(effect);
        });
    }

    // Remove an ongoing effect from the zone
    removeOngoingEffect(effect) {
        this.ongoingEffects = this.ongoingEffects.filter(e => e !== effect);
        // Revert the effect for all cards in the zone
        this.cards.forEach(card => {
            card.removeEffect(effect);
        });
    }
}

// Define the game state
class GameState {
    constructor() {
        this.zones = [];                // All zones in the game
        this.activeEffects = new Map(); // Map of effect sources to their targets
    }

    // Add a zone to the game state
    addZone(zone) {
        this.zones.push(zone);
    }

    // Get zones controlled by a specific player
    getZonesByPlayer(playerId) {
        return this.zones.filter(zone => zone.ownerId === playerId);
    }
}



// Example: Initialize the game
const gameState = new GameState();
const zone1 = new Zone("zone1", "player1");
const zone2 = new Zone("zone2", "player2");
gameState.addZone(zone1);
gameState.addZone(zone2);

// Play Blue Marvel in zone1
zone1.addCard(blueMarvel, gameState);

console.log(zone1);
