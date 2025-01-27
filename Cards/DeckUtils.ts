import { Deck } from './Deck';
import assert from 'node:assert/strict';
import * as GameConstants from '../GameConstants';
import { CardUtils } from './CardUtils';

export class DeckUtils {
    static getRandomDeck(): Deck {
        const deck: string[] = [];
        for (let i = 0; i < GameConstants.CARDS_PER_DECK; i++) {
            deck.push(CardUtils.getRandomCard());
        }
        return this.stringsToDeck(deck);
    }

    static stringsToDeck(deck: string[]): Deck {
        assert(deck.length == GameConstants.CARDS_PER_DECK, `Deck must have ${GameConstants.CARDS_PER_DECK} cards.`);
        deck.forEach(card => {
            assert(CardUtils.isValidCard(card), `Invalid card: ${card}`);
        });
        return {
            cards: deck
        }
    }
}