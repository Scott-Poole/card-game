// GameEvents.ts

/**
 * A set of high-level events that can occur in the game,
 * which are communicated to players or other parts of the system.
 */
export enum GameEvent {
    // The game has officially started (e.g., after all players are ready)
    GAME_START = 'GAME_START',

    // A new turn is beginning; typically includes which player is active, turn number, etc.
    TURN_START = 'TURN_START',

    // A player played a card from their hand onto a location
    CARD_PLAYED = 'CARD_PLAYED',

    // A card that was previously hidden or face-down is now revealed
    CARD_REVEALED = 'CARD_REVEALED',

    // The game has ended (e.g., all turns are done or a win/loss condition is reached)
    GAME_OVER = 'GAME_OVER',

    // You can add more event types here...
    // e.g., DECK_SHUFFLED, CARD_DRAWN, ROUND_END, LOCATION_EFFECT_TRIGGERED, etc.
}
