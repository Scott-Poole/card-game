import { Card } from "../Card";
import { Game } from "../../Game";

export class NoAbility0 extends Card {
    constructor(game: Game) {
        super(game, "NoAbility0", "This card has no ability.", 0, 1);
    }
}