class Card {
    constructor(id, name, energyCost, power, abilities, effect = null) {
        this.id = id;               // Unique card ID
        this.name = name;           // Card name
        this.energyCost = energyCost; // Energy cost to play the card
        this.power = power;         // Power of the card
        this.abilities = abilities; // List of abilities (e.g., "Ongoing", "On Reveal")
        this.effect = effect;       // Optional effect logic (callback function)
        this.activeEffects = [];    // Effects currently influencing this card
    }

    // Apply an effect to this card
    applyEffect(effect) {
        this.activeEffects.push(effect);
        if (effect.apply) {
            effect.apply(this);
        }
    }

    // Remove an effect from this card
    removeEffect(effect) {
        this.activeEffects = this.activeEffects.filter(e => e !== effect);
        if (effect.revert) {
            effect.revert(this);
        }
    }
}