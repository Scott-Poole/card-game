import { Card } from "../Card";
import { Game } from "../../Game";

export class NoAbility4 extends Card {
    constructor(game: Game) {
        super(game, "NoAbility4", "This card has no ability.", 4, 6);
    }
}