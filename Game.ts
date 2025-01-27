import { GameClient } from "./GameClients/GameClient";
import { Location } from "./Locations/Location";
import { Player } from "./Player";
import * as GameConstants from "./GameConstants";
import assert from 'node:assert/strict';
import { LocationUtils } from "./Locations/LocationUtils";

export class Game {
    private players: Player[]; // internal store of game's players
    private locations: Location[]; // locations for this game

    private round: number;
    private numberOfRounds: number;

    constructor(gameClients: GameClient[], locationNames?: string[]) {
        assert(gameClients.length === 2, "A standard game must have exactly 2 players");
        assert(!locationNames || locationNames.length === 3, "If you are passing locations to a game, there must be exactly 3");
        locationNames = locationNames || [LocationUtils.getRandomLocation(), LocationUtils.getRandomLocation(), LocationUtils.getRandomLocation()];
        this.players = gameClients.map((gameClient) => new Player(gameClient, this));
        this.locations = locationNames.map((locationName) => LocationUtils.getLocation(locationName, this));
        this.round = 0;
        this.numberOfRounds = GameConstants.ROUNDS_PER_GAME;
    }

    // Start the game loop
    public async start(): Promise<void> {
        console.log("Game started!");

        // just do in player initialization
        // for (const player of this.players) {
        //     player.drawTo(GameConstants.STARTING_HAND_SIZE);

        while (this.round < this.numberOfRounds) {
            console.log(`Starting round ${this.round}`);
            if (this.round < this.locations.length) {
                let location = this.locations[this.round];
                console.log(`Revealing location[${this.round}] ${location.name}`);
                location.reveal();
            }

            let turnPromises: Promise<void>[] = [];
            for (const player of this.players) {
                player.addEnergy((this.round + 1) * GameConstants.ENERGY_PER_TURN);
                player.drawCard(GameConstants.CARDS_DRAWN_PER_TURN);
                turnPromises.push(player.takeTurn());
            }

            await Promise.all(turnPromises);

            // resolve plays (reveal cards, etc)
            this.round++;
        }

        // TODO get count for each player and notify of winner
        console.log(`Game over!`);
    }
}