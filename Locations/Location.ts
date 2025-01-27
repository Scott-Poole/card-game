import { Game } from "../Game";
import { Card } from "../Cards/Card";

export class Location {
    name: string;
    description: string;
    game: Game;
    cards: Card[][];

    constructor(
        game: Game,
        name: string = "<name>",
        description: string = "<description>",
    ) {
        this.name = name;
        this.description = description;
        this.game = game;
        this.cards = [[], []];
    }

    addCard(card: Card, team: number): void {
        this.cards[team].push(card);
    }

    removeCard(card: Card, team: number): void {
        this.cards[team].filter((c) => c !== card);
    }

    reveal(): void {
        console.log(`Location ${this.name} has been revealed, but it has no on reveal ability.`);
    }

    destroy(): void {
        console.log(`Location ${this.name} has been destroyed.`);
        for (let i = 0; i < this.cards.length; i++) {
            this.cards[i].forEach((card) => card.destroy());
        }
    }

    getPower(team: number): number {
        return this.cards[team].reduce((acc, card) => acc + card.getPower(), 0);
    }
}