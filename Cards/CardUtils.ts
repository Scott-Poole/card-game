import {PlayableCards} from '../Cards/Playable';
import { Card } from './Card';
import { Game } from '../Game';
import assert from 'node:assert/strict';

export class CardUtils {

    static getCards(): string[] {
        return Object.keys(PlayableCards);
    }

    /**
     * Returns a random card name from the list of available cards.
     * @returns A random card name.
     */
    static getRandomCard(): string {
        const cards = this.getCards();
        assert(cards.length > 0, 'No cards found?');

        const randomIndex = Math.floor(Math.random() * cards.length);
        return cards[randomIndex];
    }

    static isValidCard(cardName: string): boolean {
        return this.getCards().includes(cardName);
    }

    /**
     * This is the card factory method.
     *
     * @returns new Card with the given name.
     */
    static getCard(cardName: string, game: Game): Card {
        assert(this.isValidCard(cardName), `Invalid card: ${cardName}`);
        return new PlayableCards[cardName](game);
    }
}
