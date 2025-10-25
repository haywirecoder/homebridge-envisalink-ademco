const net = require('net');
const TPILOGINTIMEOUT = 10000; // 10 seconds timeout for TPI login
const MAXCLIENTS = 3; // Maximum number of clients that can connect to the proxy
const MAXRETRY = 5; // Maximum number of retry after failure


class EnvisalinkProxyShared {
    constructor(proxyPort, password, validationFilter, log) {
        this.proxyPort = proxyPort;
        this.password = password;
        this.log = log;
        this.validationRegex = validationFilter || null;
        this.clients = new Set();
        this.proxyServer = null;
        this.sharedSocket = null;
    }

    start(sharedSocket, retryCount = 0) {
        if (this.proxyServer) {
            this.log.warn('Envisalink TPI Proxy: Server already running');
            return Promise.resolve();
        }

        if (!sharedSocket) {
            this.log.error('Envisalink TPI Proxy: Cannot start without a shared socket');
            return Promise.reject(new Error('No shared socket provided'));
        }

        this.sharedSocket = sharedSocket;

        return new Promise((resolve, reject) => {
            this.proxyServer = net.createServer(clientSocket => this.handleClient(clientSocket));
            this.proxyServer.maxConnections = MAXCLIENTS;

            // Set SO_REUSEADDR to allow faster port reuse
            this.proxyServer.on('listening', () => {
                this.log.info(`Envisalink TPI proxy server listening on port ${this.proxyPort}`);
                resolve();
            });

            this.proxyServer.on('error', err => {
                if (err.code === 'EADDRINUSE') {
                    this.log.warn(`Envisalink TPI Proxy: Port ${this.proxyPort} in use, retrying...`);
                    this.proxyServer = null;
                    
                    if (retryCount < MAXRETRY) {
                        // Wait and retry
                        setTimeout(() => {
                            this.start(sharedSocket, retryCount + 1)
                                .then(resolve)
                                .catch(reject);
                        }, 1000 * (retryCount + 1)); // Exponential backoff
                    } else {
                        this.log.error(`Envisalink TPI Proxy: Failed to bind port after ${retryCount} retries`);
                        reject(err);
                    }
                } else {
                    this.log.error(`Envisalink TPI Proxy server error: ${err.message}`);
                    this.proxyServer = null;
                    reject(err);
                }
            });

            this.proxyServer.listen({
                port: this.proxyPort,
                host: '0.0.0.0',
                exclusive: false
            });
        });
    }

    handleClient(clientSocket) {
        this.log.info(`Envisalink TPI Proxy: Client connected from ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
        clientSocket.authenticated = false;
        clientSocket.cleanedUp = false; // Flag to prevent multiple cleanup calls
        clientSocket.ready = false;

        clientSocket.write("Login:\n");
        clientSocket.setTimeout(TPILOGINTIMEOUT);
        
        let loginState = {
            step: 'awaitingPassword',
            buffer: ''
        };

        // Add cleanup helper with guard against multiple calls
        const cleanup = () => {
            if (clientSocket.cleanedUp) {
                return; // Already cleaned up, skip
            }
            clientSocket.cleanedUp = true;
            
            this.clients.delete(clientSocket);
            
            if (!clientSocket.destroyed) {
                clientSocket.destroy();
            }
            this.log.debug(`Envisalink TPI Proxy: Client cleanup complete. Active clients: ${this.clients.size}`);
        };

        clientSocket.on('data', data => {
            const trimmed = data.toString('utf8').trim();

            if (loginState.step === 'awaitingPassword') {
                if (trimmed === this.password) {
                    clientSocket.setTimeout(0);
                    clientSocket.authenticated = true;
                    clientSocket.write("OK\n");
                    this.log.info(`Envisalink TPI Proxy: ${clientSocket.remoteAddress} authenticated`);
                    this.clients.add(clientSocket);

                    // Add small delay before marking ready and adding to clients
                    setTimeout(() => {
                        if (!clientSocket.destroyed && clientSocket.authenticated) {
                            this.clients.add(clientSocket);
                            clientSocket.ready = true;
                            this.log.info(`Envisalink TPI Proxy: Starting communication with ${clientSocket.remoteAddress}`);
                        }
                    }, 100); // 100ms grace period
                    loginState.step = 'connected';

                } else {
                    this.log.warn(`Envisalink TPI Proxy: Client failed login from ${clientSocket.remoteAddress}`);
                    clientSocket.write("FAILED\n");
                    cleanup();
                }
                return;
            }

            if (clientSocket.authenticated && this.sharedSocket && !this.sharedSocket.destroyed) {
                this.log.debug(`Envisalink TPI Proxy: Client sent data ${trimmed}`);
                
                if (!this.validationRegex || this.validationRegex.test(trimmed)) {
                    this.sharedSocket.write(trimmed + "\n");
                } else {
                    this.log.warn(`Envisalink TPI Proxy: Invalid formatted data from client ${clientSocket.remoteAddress}: "${trimmed}" ignoring.`);
                }
            }
        });

        clientSocket.on('timeout', () => {
            this.log.info(`Envisalink TPI Proxy: Client Timeout from ${clientSocket.remoteAddress}`);
            clientSocket.write("Timed Out\n");
            cleanup();
        });

        clientSocket.on('end', () => {
            cleanup();
            this.log.info(`Envisalink TPI Proxy: Client disconnected from ${clientSocket.remoteAddress}. Active clients: ${this.clients.size}`);
        });

        clientSocket.on('close', () => {
            // Ensure cleanup even if 'end' wasn't called
            cleanup();
        });

        clientSocket.on('error', err => {
            this.log.error(`Envisalink TPI Proxy: Client socket error ${err.message}, code: ${err.code}`);
            cleanup();
        });
    }

    // Forward data from Envisalink to all connected proxy clients
    writeToClients(data) {
        // Create array copy to avoid issues if Set is modified during iteration
        const clientsArray = Array.from(this.clients);
        this.log.debug(`Envisalink TPI Proxy: Broadcasting to ${clientsArray.length} clients: ${data.toString().trim()}`);
        
        for (const client of clientsArray) {
            if (client.authenticated && client.ready && !client.destroyed && !client.cleanedUp) {
                try {
                    client.write(data);
                } catch (err) {
                    this.log.warn(`Envisalink TPI Proxy: Server client write failed ${err.message}`);
                    // The error event handler will call cleanup
                    client.destroy();
                }
            }
        }
    }

    stop() {
        return new Promise((resolve) => {
            if (!this.proxyServer) {
                this.log.debug('Envisalink TPI Proxy: No server to stop');
                resolve();
                return;
            }

            this.log.info('Envisalink TPI Proxy: Closing, disconnecting proxy clients.');
            
            // Disconnect all clients first
            const clientsArray = Array.from(this.clients);
            for (const client of clientsArray) {
                if (!client.destroyed) {
                    try {
                        client.destroy();
                    } catch (err) {
                        this.log.warn(`Envisalink TPI Proxy: Error destroying client: ${err.message}`);
                    }
                }
            }
            this.clients.clear();

            // Force close the server if it's not already closing
            if (this.proxyServer.listening) {
                this.proxyServer.close((err) => {
                    if (err) {
                        this.log.warn(`Envisalink TPI Proxy: Error closing server: ${err.message}`);
                    }
                    this.log.info('Envisalink TPI Proxy: Server stopped.');
                    this.proxyServer = null;
                    this.sharedSocket = null;
                    resolve();
                });
                
                // Unref to allow process to exit
                this.proxyServer.unref();
            } else {
                // Server not listening, clean up immediately
                this.proxyServer = null;
                this.sharedSocket = null;
                resolve();
            }
        });
    }

    restart(sharedSocket) {
        return this.stop().then(() => {
            // Add a small delay to ensure port is fully released
            return new Promise(resolve => setTimeout(resolve, 500));
        }).then(() => {
            this.log.info('Envisalink TPI Proxy: Restarting server...');
            return this.start(sharedSocket);
        });
    }

    isRunning() {
        return this.proxyServer !== null && this.proxyServer.listening;
    }

    updateSharedSocket(sharedSocket) {
        if (sharedSocket) {
            this.sharedSocket = sharedSocket;
            this.log.info('Envisalink TPI Proxy: Shared socket updated');
        }
    }
}

// Export the class
module.exports = EnvisalinkProxyShared;