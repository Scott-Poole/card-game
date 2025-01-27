import { Card } from "../Card";
import { Game } from "../../Game";

export class NoAbility2 extends Card {
    constructor(game: Game) {
        super(game, "NoAbility2", "This card has no ability.", 2, 3);
    }
}