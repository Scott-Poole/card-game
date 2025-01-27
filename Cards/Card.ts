import { Game } from "../Game";

export class Card {
    name: string;
    description: string;
    game: Game;
    baseCost: number;
    basePower: number;

    constructor(
        game: Game,
        name: string = "<name>",
        description: string = "<description>",
        baseCost: number = 0,
        basePower: number = 0,
    ) {
        this.name = name;
        this.description = description;
        this.game = game;
        this.baseCost = baseCost;
        this.basePower = basePower;
    }

    reveal(): void {
        // Default behavior for cards without a special "reveal" ability.
        console.log(`${this.name} has been revealed, but it has no on reveal ability.`);
    }

    destroy(): void {
        // Default behavior for cards without a special "destroy" ability.
        console.log(`${this.name} has been destroyed.`);
    }

    getCost(): number {
        // base card ignores ALL modifications to cost.
        return this.baseCost;
    }

    getPower(): number {
        // base card ignores ALL modifications to power.
        return this.basePower;
    }
}