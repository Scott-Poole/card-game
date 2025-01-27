import { Card } from "../Card";
import { Game } from "../../Game";

export class NoAbility3 extends Card {
    constructor(game: Game) {
        super(game, "NoAbility3", "This card has no ability.", 3, 4);
    }
}