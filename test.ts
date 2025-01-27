
import {Game} from './Game';

import { RandomGameClient } from './GameClients/RandomGameClient';

let c1 = new RandomGameClient();
let c2 = new RandomGameClient();

let game = new Game([c1, c2]);

(async () => {
    try {
        await game.start();
    } catch (e) {
        console.error(e);
    }
})();