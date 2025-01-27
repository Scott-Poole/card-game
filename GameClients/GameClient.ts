import { Deck } from "../Cards/Deck";

export interface GameClient {
    deck: Deck;
    
    // readonly id: string;

    /**
     * Called once at the beginning of the game with any needed setup.
     */
    // initialize(): void;

    /**
     * Called when it is this player's turn.
     * The player can repeatedly ask the game for valid moves,
     * apply moves, and eventually return to indicate they are done.
     */
    takeTurn(gameController: GameController): Promise<void>;

    /**
     * (Optional) Called whenever the game state changes, or for final results.
     */
    onGameUpdate?(): void;
    // onGameOver?(): void;
}