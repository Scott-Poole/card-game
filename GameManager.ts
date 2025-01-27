import uWS from 'uWebSockets.js';
import { Command, Option } from 'commander';

interface ClientMessage {
  type: string;
  [key: string]: any; // extra fields depending on the message type
}

interface WebSocketWithId extends uWS.WebSocket {
  userId?: string;
}

interface Game {
  id: string;
  players: {
    [userId: string]: {
      deck: string[];
      ws: WebSocketWithId;
    }
  };
}

export class GameServer {
  private port: number;
  private users: Map<string, WebSocketWithId>;
  private waitingPlayers: Array<{
    userId: string;
    deck: string[];
    ws: WebSocketWithId;
  }>;
  private games: Map<string, Game>;
  private cardList: string[];

  constructor() {
    const program = new Command();
    program
      .version('0.0.1', '-v, --version', 'output the current version')
      .addOption(new Option('-p, --port <number>', 'server port number').default(8000))
      .parse();

    const options = program.opts();
    this.port = parseInt(options.port, 10);

    this.users = new Map();
    this.waitingPlayers = [];
    this.games = new Map();

    // In a real app, you might load card data from a database or file
    this.cardList = [
      'Iron Man',
      'Captain America',
      'Spider-Man',
      'Black Widow',
      'Hulk',
      // ... etc ...
    ];
  }

  public start(): void {
    uWS.App()
      .ws('/game', {
        compression: uWS.SHARED_COMPRESSOR,
        maxPayloadLength: 16 * 1024,
        idleTimeout: 60,

        // Handle new WebSocket connections
        open: (ws: WebSocketWithId, req) => {
          // In case no parameter was passed in the URL, generate a unique ID
          // E.g., you could parse from the query string or path in a real app:
          const userId = req.getParameter(0) || this.generateUniqueId();
          this.users.set(userId, ws);
          ws.userId = userId;

          console.log(`User connected: ${userId}`);
          ws.send(JSON.stringify({ type: 'welcome', userId }));
        },

        // Handle incoming messages
        message: (ws: WebSocketWithId, message: ArrayBuffer, isBinary: boolean) => {
          const decodedMessage = isBinary 
            ? Buffer.from(message)
            : Buffer.from(message).toString('utf-8');

          try {
            const data = JSON.parse(decodedMessage) as ClientMessage;
            this.handleMessage(ws, data);
          } catch (error) {
            console.error('Failed to parse message:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format.' }));
          }
        },

        // Handle WebSocket disconnections
        close: (ws: WebSocketWithId, code: number, message: ArrayBuffer) => {
          const userId = ws.userId;
          if (userId) {
            this.users.delete(userId);
            console.log(`User disconnected: ${userId}`);
          }
        },
      })
      .listen(this.port, (listenSocket) => {
        if (listenSocket) {
          console.log(`GameServer listening on port ${this.port}`);
        } else {
          console.error('Failed to start the GameServer.');
        }
      });
  }

  /**
   * Handle the different message types from clients.
   */
  private handleMessage(ws: WebSocketWithId, data: ClientMessage): void {
    switch (data.type) {
      case 'getCards': {
        // Client requests the list of available cards
        const response = {
          type: 'cardList',
          cards: this.cardList,
        };
        ws.send(JSON.stringify(response));
        break;
      }

      case 'startGame': {
        // Client is indicating they want to start a game with a selected deck
        if (!data.deck || !Array.isArray(data.deck)) {
          ws.send(JSON.stringify({ type: 'error', message: 'No deck provided or invalid format.' }));
          return;
        }
        const userId = ws.userId;
        if (!userId) {
          ws.send(JSON.stringify({ type: 'error', message: 'User ID not found.' }));
          return;
        }

        // Add this player to the waiting queue
        this.waitingPlayers.push({ userId, deck: data.deck, ws });

        // Check if we have at least 2 players waiting
        if (this.waitingPlayers.length >= 2) {
          this.matchPlayers();
        }
        break;
      }

      default:
        // Unknown or unimplemented message type
        ws.send(JSON.stringify({
          type: 'error',
          message: `Unrecognized message type: ${data.type}`
        }));
        break;
    }
  }

  /**
   * Matches two waiting players, creates a new Game, and notifies them.
   */
  private matchPlayers(): void {
    // Take the first two in the queue for a simple match (you might want a smarter queue)
    const player1 = this.waitingPlayers.shift();
    const player2 = this.waitingPlayers.shift();
    if (!player1 || !player2) return;

    const gameId = this.generateUniqueId();
    const newGame: Game = {
      id: gameId,
      players: {
        [player1.userId]: {
          deck: player1.deck,
          ws: player1.ws,
        },
        [player2.userId]: {
          deck: player2.deck,
          ws: player2.ws,
        }
      }
    };

    this.games.set(gameId, newGame);

    // Notify both players that the game has started
    const startMessage = {
      type: 'gameStarted',
      gameId,
      opponents: [player1.userId, player2.userId]
    };

    player1.ws.send(JSON.stringify(startMessage));
    player2.ws.send(JSON.stringify(startMessage));

    console.log(`New game started with ID: ${gameId}`);
  }

  /**
   * Generate a simple unique ID. In production, you might use a proper UUID library.
   */
  private generateUniqueId(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

// If running this file directly, you can create and start the server:
if (require.main === module) {
  const server = new GameServer();
  server.start();
}
