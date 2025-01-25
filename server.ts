import uWS from 'uWebSockets.js';
import { Command, Option } from 'commander';

const program = new Command();
program
.version('0.0.1', '-v, --version', 'output the current version')
.addOption(new Option('-p, --port <number>', 'server port number').default(8000))
.parse();
const options = program.opts();

uWS.App()
    .ws('/game', {
        compression: uWS.SHARED_COMPRESSOR,
        maxPayloadLength: 16 * 1024,
        idleTimeout: 60,

        // Handle new WebSocket connections
        open: (ws, req) => {
            const userId = req.getParameter(0) || this.generateUniqueId();
            this.users.set(userId, ws);
            ws.userId = userId; // Attach the userId to the WebSocket instance

            console.log(`User connected: ${userId}`);
            ws.send(JSON.stringify({ type: 'welcome', userId }));
        },

        // Handle incoming messages
        message: (ws, message, isBinary) => {
            const decodedMessage = isBinary ? message : Buffer.from(message).toString('utf-8');

            try {
                const data = JSON.parse(decodedMessage);
                this.handleMessage(ws, data);
            } catch (error) {
                console.error('Failed to parse message:', error);
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format.' }));
            }
        },

        // Handle WebSocket disconnections
        close: (ws, code, message) => {
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