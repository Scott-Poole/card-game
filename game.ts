type ModifiableValue = {
    baseValue: number;
    currentValue: number;
    modifiers: ValueModification[];
    getValue: () => number; // Function to apply the modification
};

class Game {
    private players: Player[]; // a game has two players
    private locations: Location[]; // a game has three locations

    private currentTurn: number;
    private currentEndTurn: number;

    constructor(player1: Player, player2: Player, locations: Location[]) {
        this.players = [player1, player2];
        this.locations = locations;
        this.currentTurn = 0;
        this.currentEndTurn = 5;
    }

    // Start the game loop
    public start(): void {
        console.log("Game started!");
        
        // before turn 1
        // deal 3 cards to each player

        while (this.currentTurn <= this.currentEndTurn) {
            if (this.currentTurn < this.locations.length) {
                // reveal location[this.currentTurn]
            }
            
            // give each player their energy for the turn
            // each player draws a card
            // wait for each player to end their play
            // resolve plays (reveal cards, etc)
            this.currentTurn++;
        }

        // get count for each player and notify of winner
        console.log(`Game over!`);
    }
}