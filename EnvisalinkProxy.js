const net = require('net');
const crypto = require('crypto');

const TPILOGINTIMEOUT = 30000; // 30 seconds timeout for TPI login
const MAXCLIENTS = 3; // Maximum number of connections (including clients still logging in) the proxy accepts
const MAXRETRY = 5; // Maximum number of retries after a failed bind
const MAXLINELENGTH = 1024; // Maximum bytes buffered from a client without a line terminator
const READYDELAY = 100; // Grace period (ms) between authentication and receiving broadcasts

// Constant-time comparison so the password check does not leak timing information
function safeEqual(a, b) {
    const hashA = crypto.createHash('sha256').update(String(a)).digest();
    const hashB = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(hashA, hashB);
}

class EnvisalinkProxyShared {
    constructor(proxyPort, password, validationFilter, log) {
        this.proxyPort = proxyPort;
        this.password = password;
        this.log = log;
        this.validationRegex = validationFilter || null;
        this.clients = new Set();
        this.proxyServer = null;
        this.sharedSocket = null;
        this.retryTimer = null;
        this.cancelPendingStart = null;
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
            const server = net.createServer(clientSocket => this.handleClient(clientSocket));
            this.proxyServer = server;
            server.maxConnections = MAXCLIENTS;

            server.on('listening', () => {
                this.log.info(`Envisalink TPI proxy server listening on port ${this.proxyPort}`);
                resolve();
            });

            server.on('error', err => {
                // An error after the server is listening is logged, but the server keeps running
                if (server.listening) {
                    this.log.error(`Envisalink TPI Proxy server error: ${err.message}`);
                    return;
                }

                this.proxyServer = null;

                if (err.code === 'EADDRINUSE') {
                    this.log.warn(`Envisalink TPI Proxy: Port ${this.proxyPort} in use, retrying...`);

                    if (retryCount < MAXRETRY) {
                        // Wait and retry (linear backoff: 1s, 2s, 3s, ...)
                        this.cancelPendingStart = () => reject(new Error('Proxy stopped before it could start'));
                        this.retryTimer = setTimeout(() => {
                            this.retryTimer = null;
                            this.cancelPendingStart = null;
                            this.start(sharedSocket, retryCount + 1)
                                .then(resolve)
                                .catch(reject);
                        }, 1000 * (retryCount + 1));
                    } else {
                        this.log.error(`Envisalink TPI Proxy: Failed to bind port after ${retryCount} retries`);
                        reject(err);
                    }
                } else {
                    this.log.error(`Envisalink TPI Proxy server error: ${err.message}`);
                    reject(err);
                }
            });

            server.listen({
                port: this.proxyPort,
                host: '0.0.0.0',
                exclusive: false
            });
        });
    }

    handleClient(clientSocket) {
        const remote = clientSocket.remoteAddress; // Captured now; undefined once the socket is destroyed
        this.log.info(`Envisalink TPI Proxy: Client connected from ${remote}:${clientSocket.remotePort}`);
        clientSocket.authenticated = false;
        clientSocket.cleanedUp = false; // Flag to prevent multiple cleanup calls
        clientSocket.ready = false;

        let closing = false; // Set once the proxy has decided to close this client
        let buffer = ''; // Holds partial lines between 'data' events

        clientSocket.write("Login:\r\n");
        clientSocket.setTimeout(TPILOGINTIMEOUT);

        // Cleanup helper with guard against multiple calls
        const cleanup = () => {
            if (clientSocket.cleanedUp) {
                return; // Already cleaned up, skip
            }
            clientSocket.cleanedUp = true;
            closing = true;

            this.clients.delete(clientSocket);

            if (!clientSocket.destroyed) {
                clientSocket.destroy();
            }
            this.log.debug(`Envisalink TPI Proxy: Client cleanup complete. Active clients: ${this.clients.size}`);
        };

        // Send a final message, let it flush, then close the connection
        const closeClient = message => {
            if (closing) {
                return;
            }
            closing = true;
            if (clientSocket.writable) {
                clientSocket.end(`${message}\r\n`, cleanup);
            } else {
                cleanup();
            }
        };

        const handleLine = line => {
            if (!clientSocket.authenticated) {
                // Never log the login line: it contains the password
                if (safeEqual(line, this.password)) {
                    clientSocket.setTimeout(0);
                    clientSocket.authenticated = true;
                    clientSocket.write("OK\r\n");
                    this.log.info(`Envisalink TPI Proxy: ${remote} authenticated`);

                    // Add small delay before marking ready and adding to clients
                    setTimeout(() => {
                        if (!clientSocket.destroyed && !clientSocket.cleanedUp && clientSocket.authenticated) {
                            this.clients.add(clientSocket);
                            clientSocket.ready = true;
                            this.log.info(`Envisalink TPI Proxy: Starting communication with ${remote}`);
                        }
                    }, READYDELAY);
                } else {
                    this.log.warn(`Envisalink TPI Proxy: Client failed login from ${remote}`);
                    closeClient("FAILED");
                }
                return;
            }

            this.log.debug(`Envisalink TPI Proxy: Client sent data ${line}`);
            this.forwardCommand(remote, line);
        };

        clientSocket.on('data', data => {
            if (closing) {
                return;
            }

            // TCP does not preserve message boundaries: a chunk can hold several commands
            // or only part of one, so split on line terminators and keep the remainder.
            buffer += data.toString('utf8');
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop();

            for (const rawLine of lines) {
                if (closing) {
                    return;
                }
                const line = rawLine.trim();
                if (line) {
                    handleLine(line);
                }
            }

            if (!closing && buffer.length > MAXLINELENGTH) {
                this.log.warn(`Envisalink TPI Proxy: Client ${remote} exceeded maximum line length, disconnecting.`);
                closeClient("FAILED");
            }
        });

        clientSocket.on('timeout', () => {
            this.log.info(`Envisalink TPI Proxy: Client Timeout from ${remote}`);
            closeClient("Timed Out");
        });

        clientSocket.on('end', () => {
            cleanup();
            this.log.info(`Envisalink TPI Proxy: Client disconnected from ${remote}. Active clients: ${this.clients.size}`);
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

    // Validate a single command from a proxy client and forward it to Envisalink
    forwardCommand(remote, command) {
        if (!this.sharedSocket || this.sharedSocket.destroyed || !this.sharedSocket.writable) {
            this.log.debug(`Envisalink TPI Proxy: Shared socket unavailable, dropping command from ${remote}`);
            return;
        }

        if (this.validationRegex) {
            this.validationRegex.lastIndex = 0; // Avoid stateful results if the regex has the g or y flag
            if (!this.validationRegex.test(command)) {
                this.log.warn(`Envisalink TPI Proxy: Invalid formatted data from client ${remote}: "${command}" ignoring.`);
                return;
            }
        }

        this.sharedSocket.write(command + "\r\n");
    }

    // Forward one complete Envisalink message to all connected proxy clients.
    // The proxy owns the wire framing: a single \r\n terminator is always sent, whether or not
    // the caller included one. Callers must pass one complete message per call, never a raw chunk.
    writeToClients(message) {
        const text = message.toString().replace(/[\r\n]+$/, '');
        const data = text + '\r\n';
        // Create array copy to avoid issues if Set is modified during iteration
        const clientsArray = Array.from(this.clients);
        this.log.debug(`Envisalink TPI Proxy: Broadcasting to ${clientsArray.length} clients: ${text}`);
        for (const client of clientsArray) {
            if (client.authenticated && client.ready && client.writable && !client.destroyed && !client.cleanedUp) {
                try {
                    client.write(data);
                } catch (err) {
                    this.log.warn(`Envisalink TPI Proxy: Server client write failed ${err.message}`);
                    // The close/error handlers will call cleanup
                    client.destroy();
                }
            }
        }
    }

    stop() {
        // Cancel any pending bind retry so the server cannot start after stop() is called
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        if (this.cancelPendingStart) {
            this.cancelPendingStart();
            this.cancelPendingStart = null;
        }

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
