import { Card } from "../Card";
import { Game } from "../../Game";

export class NoAbility6 extends Card {
    constructor(game: Game) {
        super(game, "NoAbility6", "This card has no ability.", 6, 12);
    }
}