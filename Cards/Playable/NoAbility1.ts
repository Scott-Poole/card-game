import { Card } from "../Card";
import { Game } from "../../Game";

export class NoAbility1 extends Card {
    constructor(game: Game) {
        super(game, "NoAbility1", "This card has no ability.", 1, 2);
    }
}