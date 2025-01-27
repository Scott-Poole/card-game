import { Card } from "../Card";
import { Game } from "../../Game";

export class NoAbility5 extends Card {
    constructor(game: Game) {
        super(game, "NoAbility5", "This card has no ability.", 5, 9);
    }
}