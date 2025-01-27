import { GameClient } from "./GameClients/GameClient";
import { Deck } from "./Cards/Deck";
import { Game } from "./Game";
import * as GameConstants from "./GameConstants";
import assert from 'node:assert/strict';
import { DeckUtils } from "./Cards/DeckUtils";
import { CardUtils } from "./Cards/CardUtils";
import { Card } from "./Cards/Card";
import { resolve } from "node:path";

export class Player {
    private gameClient: GameClient; // entity that will make player decisions
    private game: Game; // reference to the game object

    private drawPile: Card[]; // player's deck
    private hand: Card[]; // player's hand
    private energy: number; // player's energy

    constructor(gameClient: GameClient, game: Game) {
        this.gameClient = gameClient;
        this.game = game;
        this.drawPile = gameClient.deck.cards.map(cardName => { return CardUtils.getCard(cardName, game) });
        this.hand = [];
        this.energy = 0;
    }

    shuffleDrawPile() {
        this.drawPile = this.drawPile.sort(() => Math.random() - 0.5);
    }

    takeTurn(): Promise<void> {
        // TODO enforce turn timeout here and call GameClient.takeTurn
        return new Promise((resolve) => {
            console.log("Player: doing nothing");
            resolve();
        });
    }
    drawCard(numCards: number) {
        for (let i = 0; i < numCards; i++) {
            if (this.drawPile.length === 0) {
                console.log("Player: No cards left in draw pile.");
                continue;
            }
            let drawCard = this.drawPile.pop();
            if (drawCard !== undefined) {
                this.hand.push(drawCard);
            }
        }
    }
    addEnergy(numEnergy: number) {
        this.energy += numEnergy;
    }
}