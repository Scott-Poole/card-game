import { Player } from './Player';

export interface Move {
  cardId: string;
  location: number;
  // ... any other needed properties ...
}

export interface GameController {
  /** Return the current valid moves for the specified player. */
  getValidMoves(player: Player): Move[];

  /**
   * Attempt to apply a move for the given player.
   * Return true if the move was successful, or false if it was invalid.
   */
  applyMove(player: Player, move: Move): boolean;

  /**
   * (Optional) A method to check if the game is over,
   * or any other relevant queries the player might need.
   */
  isGameOver(): boolean;
}