import { PlayableLocations } from './Playable';
import { Location } from './Location';
import { Game } from '../Game';
import assert from 'node:assert/strict';

export class LocationUtils {

    static getLocations(): string[] {
        return Object.keys(PlayableLocations);
    }

    /**
     * Returns a random card name from the list of available cards.
     * @returns A random card name.
     */
    static getRandomLocation(): string {
        const locations = this.getLocations();
        assert(locations.length > 0, 'No locations found?');

        const randomIndex = Math.floor(Math.random() * locations.length);
        return locations[randomIndex];
    }

    static isValidLocation(locationName: string): boolean {
        return this.getLocations().includes(locationName);
    }

    /**
     * This is the location factory method.
     *
     * @returns new Location with the given name.
     */
    static getLocation(locationName: string, game: Game): Location {
        assert(this.isValidLocation(locationName), `Invalid location name: ${locationName}`);
        return new PlayableLocations[locationName](game);
    }
}
