import { Location } from "../Location";
import { Game } from "../../Game";

export class Empty extends Location {
    constructor(game: Game) {
        super(game, "Empty", "This Location has no ability.");
    }
}