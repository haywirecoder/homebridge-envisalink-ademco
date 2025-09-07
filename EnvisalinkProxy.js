const net = require('net');
const TPILOGINTIMEOUT = 10000; // 10 seconds timeout for TPI login
const MAXCLIENTS = 2; // Maximum number of clients that can connect to the proxy

class EnvisalinkProxyShared {
    constructor(sharedSocket, proxyPort, password, log) {
        this.sharedSocket = sharedSocket;  // Already-connected socket to the real Envisalink
        this.password = password;
        this.log = log;
        this.clients = new Set();

        this.server = net.createServer(clientSocket => this.handleClient(clientSocket));

        this.server.maxConnections = MAXCLIENTS; // Limit the number of concurrent connections

        this.server.listen(proxyPort, () => {
            this.log.info(`Envisalink TPI proxy server listening on port ${proxyPort}`);
        });

        this.server.on('error', err => {
            this.log.error(`Envisalink TPI Proxy: Server error: ${err.message}`);
        });

        // Forward data from Envisalink to all connected proxy clients
        this.sharedSocket.on('data', data => {
            for (const client of this.clients) {
                if (client.authenticated) {
                    try {
                        client.write(data);
                    } catch (err) {
                        this.log.warn(`Envisalink TPI Proxy: Server client write failed ${err.message}`);
                        this.clients.delete(client);
                        client.destroy();
                    }
                }
            }
        });

        this.sharedSocket.on('error', err => {
            this.log.error(`Envisalink TPI Proxy: Server shared socket error ${err.message}`);
        });

        this.sharedSocket.on('close', () => {
            this.log.warn('Envisalink TPI Proxy: Server shared socket closed, disconnecting proxy clients');
            for (const client of this.clients) {
                client.destroy();
            }
            this.clients.clear();
        });
    }

    handleClient(clientSocket) {
       
        this.log.info(`Envisalink TPI Proxy: Client connected from ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
        clientSocket.authenticated = false;

        clientSocket.write("Login:\n"); // TPI login prompt

        clientSocket.setTimeout(TPILOGINTIMEOUT);
        let loginState = {
            step: 'awaitingPassword',
            buffer: ''
        };

        clientSocket.on('data', data => {
            
            const trimmed = data.toString('utf8').trim();

            if (loginState.step === 'awaitingPassword') {
    
                if (trimmed === this.password) {
                    clientSocket.setTimeout(0); // Disable timeout after successful login
                    clientSocket.authenticated = true;
                    clientSocket.write("OK\n");
                    this.log.info(`Envisalink TPI Proxy: Client authenticated`);
                    this.clients.add(clientSocket);
                    loginState.step = 'connected';

                } else {
                    this.log.warn(`Envisalink TPI Proxy: Client failed login from ${clientSocket.remoteAddress}`);
                    clientSocket.write("FAILED\n");
                    clientSocket.end();
                }
                return;
            }

            // Forward client data to the real Envisalink
            if (clientSocket.authenticated && this.sharedSocket && !this.sharedSocket.destroyed) {
                // Debug print client data 
                this.log.debug(`Envisalink TPI Proxy: Client sent data ${trimmed}`);
                
                // If client send none HEX value reject it, since command is not property formatted. 
                if (/^[0-9A-Fa-f\s,]+$/.test(trimmed)) {
                    this.sharedSocket.write(trimmed + "\n");
                } else {
                    this.log.warn(`Envisalink TPI Proxy: Invalid formated data from client ${clientSocket.remoteAddress}: "${trimmed}"`);
                }
            }
        });

        clientSocket.on('timeout', () => {
                this.log.info(`Envisalink TPI Proxy: Client Timeout from ${clientSocket.remoteAddress}`);
                clientSocket.write("Timed Out\n");
                clientSocket.end(); // Close the connection on timeout
        });

        clientSocket.on('end', () => {
            this.log.info(`Envisalink TPI Proxy: Client disconnected from ${clientSocket.remoteAddress}`);
            this.clients.delete(clientSocket);
        });

        clientSocket.on('error', err => {
            this.log.error(`Envisalink TPI Proxy: Client socket error ${err.message}`);
            this.clients.delete(clientSocket);
        });
    }
}

module.exports = EnvisalinkProxyShared;
