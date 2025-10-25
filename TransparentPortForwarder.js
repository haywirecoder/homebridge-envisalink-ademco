const net = require('net');
const MAXCLIENTS = 3; // Maximum number of clients that can be forwarded
const MAXRETRY = 5; // Maximum number of retry after failure

class TransparentPortForwarder {
    constructor(listenPort, targetHost, targetPort, log) {
        this.listenPort = listenPort || 4080;
        this.targetHost = targetHost;
        this.targetPort = targetPort || 80;
        this.timeout = 30000; // 30 seconds
        this.log = log || console;
        this.activeConnections = new Set();
        this.tcpFowardServer = null;
    }
    
    start(retryCount = 0) {
        if (this.tcpFowardServer) {
            this.log.warn('TransparentPortForwarder: Server already running');
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            this.tcpFowardServer = net.createServer((clientSocket) => {
            this.log.info(`EnvisaLink Web Forward: New connection from ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
            
            // Create connection to target server
            const targetSocket = net.createConnection({
                host: this.targetHost,
                port: this.targetPort
            }, () => {
                this.log.info(`EnvisaLink Web Forward: Forwarding to server ${this.targetHost}:${this.targetPort}`);
            });
            
            // Add client-target pair to active connections
            const connectionPair = { 
                clientSocket, 
                targetSocket,
                cleanedUp: false  // Guard flag
            };
            this.activeConnections.add(connectionPair);
            
            this.log.debug(`EnvisaLink Web Forward: Active connections: ${this.activeConnections.size}`);
            
            // Centralized cleanup with guard
            const cleanup = () => {
                if (connectionPair.cleanedUp) {
                    return; // Already cleaned up
                }
                connectionPair.cleanedUp = true;
                
                this.activeConnections.delete(connectionPair);
                
                // Destroy both sockets if not already destroyed
                if (!clientSocket.destroyed) {
                    clientSocket.destroy();
                }
                if (!targetSocket.destroyed) {
                    targetSocket.destroy();
                }
                
                this.log.debug(`EnvisaLink Web Forward: Connection cleaned up. Active connections: ${this.activeConnections.size}`);
            };
            
            // Handle connection errors
            clientSocket.on('error', (err) => {
                this.log.error('EnvisaLink Web Forward: Client socket error:', err.message);
                cleanup();
            });
            
            targetSocket.on('error', (err) => {
                this.log.error('EnvisaLink Web Forward: Target socket error:', err.message);
                cleanup();
            });
            
            // Handle connection close
            clientSocket.on('close', () => {
                this.log.debug('EnvisaLink Web Forward: Client connection closed');
                cleanup();
            });
            
            targetSocket.on('close', () => {
                this.log.debug('EnvisaLink Web Forward: Target connection closed');
                cleanup();
            });
            
            clientSocket.on('timeout', () => {
                this.log.debug(`EnvisaLink Web Forward: Client connection timeout`);
                cleanup();
            });
            
            targetSocket.on('timeout', () => {
                this.log.debug(`EnvisaLink Web Forward: Target connection timeout`);
                cleanup();
            });
            
            // Set timeouts
            clientSocket.setTimeout(this.timeout);
            targetSocket.setTimeout(this.timeout);
            
            // Pipe data bidirectionally with error handling
            clientSocket.pipe(targetSocket).on('error', (err) => {
                this.log.error('EnvisaLink Web Forward: Pipe error (client->target):', err.message);
                cleanup();
            });
            
            targetSocket.pipe(clientSocket).on('error', (err) => {
                this.log.error('EnvisaLink Web Forward: Pipe error (target->client):', err.message);
                cleanup();
            });
        });
        
        this.tcpFowardServer.maxConnections = MAXCLIENTS;
        
        // Set up listening event
        this.tcpFowardServer.on('listening', () => {
            this.log.info(`EnvisaLink Web Console forwarder listening on port ${this.listenPort}`);
            this.log.info(`Forwarding to ${this.targetHost}:${this.targetPort}`);
            resolve();
        });
        
        this.tcpFowardServer.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                this.log.warn(`TransparentPortForwarder: Port ${this.listenPort} in use, retrying...`);
                this.tcpFowardServer = null;
                
                if (retryCount < MAXRETRY) {
                    // Wait and retry
                    setTimeout(() => {
                        this.start(retryCount + 1)
                            .then(resolve)
                            .catch(reject);
                    }, 1000 * (retryCount + 1)); // Exponential backoff
                } else {
                    this.log.error(`TransparentPortForwarder: Failed to bind port after ${retryCount} retries`);
                    reject(err);
                }
            } else {
                this.log.error('EnvisaLink Web Forward: Server error:', err);
                this.tcpFowardServer = null;
                reject(err);
            }
        });

        this.tcpFowardServer.listen({
            port: this.listenPort,
            host: '0.0.0.0',
            exclusive: false
        });
        });
    }
    
    stop() {
        return new Promise((resolve) => {
            if (!this.tcpFowardServer) {
                this.log.debug('TransparentPortForwarder: No server to stop');
                resolve();
                return;
            }

            this.log.info('TransparentPortForwarder: Stopping server, closing active connections');
            
            // Close all active connections
            const connectionsArray = Array.from(this.activeConnections);
            for (const { clientSocket, targetSocket } of connectionsArray) {
                try {
                    if (!clientSocket.destroyed) {
                        clientSocket.destroy();
                    }
                    if (!targetSocket.destroyed) {
                        targetSocket.destroy();
                    }
                } catch (err) {
                    this.log.warn(`TransparentPortForwarder: Error destroying connection: ${err.message}`);
                }
            }
            this.activeConnections.clear();
            
            // Only close if server is listening
            if (this.tcpFowardServer.listening) {
                this.tcpFowardServer.close((err) => {
                    if (err) {
                        this.log.warn(`TransparentPortForwarder: Error closing server: ${err.message}`);
                    }
                    this.log.info('EnvisaLink Web Console forwarder stopped.');
                    this.tcpFowardServer = null;
                    resolve();
                });
                
                // Unref to allow process to exit if needed
                this.tcpFowardServer.unref();
            } else {
                // Server not listening, clean up immediately
                this.tcpFowardServer = null;
                resolve();
            }
        });
    }

    restart() {
        return this.stop().then(() => {
            // Add a small delay to ensure port is fully released
            return new Promise(resolve => setTimeout(resolve, 500));
        }).then(() => {
            this.log.info('TransparentPortForwarder: Restarting server...');
            return this.start();
        });
    }

    isRunning() {
        return this.tcpFowardServer !== null && this.tcpFowardServer.listening;
    }

    getActiveConnectionCount() {
        return this.activeConnections.size;
    }
}

// Export the class
module.exports = TransparentPortForwarder;