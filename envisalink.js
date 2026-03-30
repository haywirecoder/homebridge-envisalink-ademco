// 'use strict'
const MAXPARTITIONS = 16;
const MAXZONES = 128;
const MAXALARMUSERS = 47;
var net = require('net')

var EventEmitter = require('events');
var tpidefs = require('./tpi.js')
var ciddefs = require('./cid.js');
// Removed: unused 'isUndefined' import from 'util'
var EnvisalinkProxyShared = require('./EnvisalinkProxy');
var EnvisaPortForwarder = require('./TransparentPortForwarder');

// tpiserverSocket remains module-level — it is a single TCP connection handle
// and is referenced by endSession() and sendCommand() which are class methods.
// It is reassigned on every startSession() call so stale socket risk is managed
// by the existing destroyed/isConnected guards in sendCommand() and endSession().
var tpiserverSocket;

const RF_LOW_BATTERY = 384;
const ZONE_BYPASS = 570;
const SESSION_TIMEOUT = 5000;
// Removed: SENDCMDTIMEOUT — defined but never used anywhere in the file.

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))


class EnvisaLink extends EventEmitter {

  isProcessingBypass;
  isProcessingUnBypass;
  isProcessingAlarm;
  processingBypassqueue;
  processingUnBypassqueue;
  targetUnbypassZoneNumber;
  isConnected;
  commandreferral;
  alarmSystemMode;
  tpiproxyServer;
  wcForwardServer;
  bypassScanInProgress;
  bypassScanZones;
  bypassScanTimeout;
  bypassScanNoResponseTimeout;
  bypassProbeZone;
  bypassScanRequested;
  

  constructor(log, config) {
    super();
    this.log = log;
    this.options = {
      host: config.host,
      port: config.port ? config.port : 4025,
      password: config.password ? config.password : "user",
      // Envisalink Proxy server settings
      proxyEnabled: config.proxyEnabled ? config.proxyEnabled : false, 
      proxyPort: config.proxyPort ? config.proxyPort : 4026,
      proxyValidationFilter: config.validationFilter ? config.validationFilter : null,
      // Envisalink Web console port settings
      wcForwardPort: config.wcForwardPort ? config.wcForwardPort : 4080,
      wcPort: config.wcPort ? config.wcPort : 80
    };

    if (config.sessionWatcher == undefined)
    {  
      // If session watcher is enabled, auto-reconnection is also enabled.
      this.options.sessionwatcher = true;
      this.options.autoreconnect = true;
    }
    else
    {
      this.options.sessionwatcher = config.sessionWatcher;
      // Only use autoReconnect if session watcher is not enabled, otherwise default to auto connect to true.
      if ((config.autoReconnect == undefined) || (this.options.sessionwatcher))
        this.options.autoreconnect = true;
      else
        this.options.autoreconnect = config.autoReconnect;
    }

    // Are we in maintenance mode?
    this.isMaintenanceMode = config.maintenanceMode ? config.maintenanceMode : false;

    // Set interval for testing connection and how long a zone should be considered without any update.
    this.options.heartbeatInterval = Math.min(600, Math.max(10, config.heartbeatInterval));  
    this.options.openZoneTimeout = Math.min(120, Math.max(5, config.openZoneTimeout));  
    
    this.zones = {};
    this.lastmessage = new Date();
    this.lastsentcommand = "";
    this.isProcessingBypass = false;
    this.isProcessingAlarm = false;
    this.isProcessingUnBypass = false;
    this.processingBypassqueue = 0;
    this.processingUnBypassqueue = 0;
    this.targetUnbypassZoneNumber = 0;
    this.alarmSystemMode = 'READY';
    this.commandreferral = "";
    this.bypassScanInProgress = false;
    this.bypassScanZones = new Set();
    this.bypassScanTimeout = undefined;
    this.bypassScanNoResponseTimeout = undefined;
    this.bypassProbeZone = 99; // overridden by index.js if configured
    this.bypassScanRequested = false;

    // Instance-level state for zone tracking and session trouble flag.
    // Previously module-level variables, which caused stale state to persist
    // across reconnects and would be shared across multiple EnvisaLink instances.
    this.activezones = [];
    this.activeZoneTimeOut = undefined;
    this.inTrouble = false;
  }

  
  startSession() {

    // 'var self = this' has been removed throughout startSession().
    // All socket event handlers and inner functions are now arrow functions,
    // which inherit 'this' lexically from startSession()'s class method context.
    // This eliminates the self/this inconsistency that previously caused
    // cidEvent and zoneTimerDump to use the wrong context.

    this.shouldReconnect = this.options.autoreconnect;
    this.isConnected = false;
    this.lastmessage = Date.now();
    this.isConnectionIdleHandle = undefined;

    // Reset per-session zone tracking state so stale zone faults from a
    // previous session do not carry over into the new session on reconnect.
    this.activezones = [];
    this.activeZoneTimeOut = undefined;

    // Display starting of connection.
    this.log.info(`Starting connection to envisalink module at: ${this.options.host}, port: ${this.options.port}`);
   
    tpiserverSocket = net.createConnection({
      port: this.options.port,
      host: this.options.host
    });

    if (this.options.proxyEnabled) {
      if (!this.tpiproxyServer) {
        this.tpiproxyServer = new EnvisalinkProxyShared(this.options.proxyPort, this.options.password, this.options.proxyValidationFilter, this.log);
      }
      if (!this.wcForwardServer) {
        this.wcForwardServer = new EnvisaPortForwarder(this.options.wcForwardPort, this.options.host, this.options.wcPort, this.log);
      }
    }  

    // --- Socket event handlers ---
    // All converted to arrow functions so 'this' refers to the EnvisaLink instance.

    tpiserverSocket.on('error', (ex) => {
      this.log.error("EnvisaLink Network Error: ", ex);
      this.isConnected = false;
      if (!this.inTrouble) {
        this.emit('envisalinkupdate', {
          source: "session_connect_status",
          qualifier: 1
        });
        this.inTrouble = true;
      }
      // Stop proxy services
      if (this.options.proxyEnabled) {
        if (this.tpiproxyServer) this.tpiproxyServer.stop();
        if (this.wcForwardServer) this.wcForwardServer.stop();
      }
    });

    tpiserverSocket.on('close', (hadError) => {
      if (hadError) this.log.error("EnvisaLink server connection closed due to a transmission error.");
      this.isConnected = false;
      if (!this.inTrouble) {
        this.emit('envisalinkupdate', {
          source: "session_connect_status",
          qualifier: 1
        });
        this.inTrouble = true;
      }
      // Stop proxy services
      if (this.options.proxyEnabled) {
        if (this.tpiproxyServer) this.tpiproxyServer.stop();
        if (this.wcForwardServer) this.wcForwardServer.stop();
      }
      // This may be a problem at startup if the auto-restart timer hasn't been started yet.
      // Start it now and attempt to connect.
      if (this.shouldReconnect && this.isConnectionIdleHandle === undefined) { 
        this.log.info(`Re-attempting server connection every: ${this.options.heartbeatInterval} seconds.`);
        this.isConnectionIdleHandle = setTimeout(isConnectionIdle, (this.options.heartbeatInterval * 1000));
      }
    });

    tpiserverSocket.on('end', () => {
      this.log.info('TPI session disconnected.');
      this.isConnected = false;
      // Stop proxy services
      if (this.options.proxyEnabled) {
        if (this.tpiproxyServer) this.tpiproxyServer.stop();
        if (this.wcForwardServer) this.wcForwardServer.stop();
      }
    });

    tpiserverSocket.on('data', async (data) => {
      var dataslice = data.toString().replace(/[\n\r]/g, '|').split('|');
      var source = "session_connect_status";

      this.log.debug("TPI Data stream: " + dataslice);
      this.lastmessage = Date.now(); // Every time a message comes in, reset the lastmessage timer

      for (var i = 0; i < dataslice.length; i++) {
        var datapacket = dataslice[i];
        if (datapacket !== '') {
          if (datapacket.substring(0, 5) === 'Login') {
            this.log.debug("Login requested. Sending response " + this.options.password);
            this.isConnected = true;
            this.sendCommand(this.options.password);
          } else if ((datapacket.substring(0, 6) === 'FAILED') || (datapacket.substring(0, 9) === 'Timed Out')) {
            this.log.error("EnvisaLink: Login failed.");
            this.isConnected = false;
          } else if (datapacket.substring(0, 2) === 'OK') {
            this.log.info(`Successful TPI session established.`);
            if (this.options.proxyEnabled) {
              this.log.info(`Starting TPI proxy server and Console Forwarder...`);
              if (this.tpiproxyServer.isRunning()) await this.tpiproxyServer.restart(tpiserverSocket);
              else await this.tpiproxyServer.start(tpiserverSocket);
              if (this.wcForwardServer.isRunning()) await this.wcForwardServer.restart();
              else await this.wcForwardServer.start();
            }
            // If connection had issue prior, clear and generate restore event.
            // Qualifier: 1 = Event, 3 = Restore
            if (this.inTrouble) {
              this.emit('envisalinkupdate', {
                source: source,
                qualifier: 3
              });
              this.inTrouble = false;
            }
            // Determine if option to monitor connection is enabled.
            if (this.shouldReconnect && this.options.sessionwatcher) {
              this.log.info(`Checking for disconnected session every: ${this.options.heartbeatInterval} seconds.`);
              this.isConnectionIdleHandle = setTimeout(isConnectionIdle, (this.options.heartbeatInterval * 1000));
            } else {
              this.log.warn("Warning: Session monitoring is disabled. Envisalink-Ademco will not watch for hung sessions.");
            }
          } else {
            if (this.options.proxyEnabled) {
              this.tpiproxyServer.writeToClients(data); // Forward data to all connected proxy clients.
            }
            var tpi_str = datapacket.match(/^%(.+)\$/); // pull out everything between the % and $
            if (tpi_str == null) {
              tpi_str = datapacket.match(/\^(.+)\$/); // module command string — could be result of previous command
              if (tpi_str == null) {
                this.log.warn("Envisalink data steam format invalid. Packets must be encapsulated within the % and $ sentinels: " + datapacket + ". Ignoring update.");
              } else {
                if (this.lastsentcommand == tpi_str[1].split(',')[0])
                  this.log.info(`Envisakit module command return: ${tpidefs.command_response_codes[tpi_str[1].split(',')[1]]}`);
              }
            } else {
              var data_array = tpi_str[1].split(','); // everything between % and $
              var command = data_array[0]; // The first element is the command.
              var tpi = tpidefs.tpicommands[command];
              if (tpi) {
                // tpi.bytes === '' or === 0 means this command carries no data payload —
                // log a warning and skip dispatch rather than calling handlers with empty data.
                if (tpi.bytes === '' || tpi.bytes === 0) {
                  this.log.warn(tpi.pre + ' - ' + tpi.post);
                } else {
                  this.log.debug(tpi.pre + ' | ' + tpi_str + ' | ' + tpi.post);
                  this.log.debug('Envisakit Operation: ' + tpi.action);
                  switch (tpi.action) {
                    case 'updatezone':
                      updateZone(tpi, data_array);
                      break;
                    case 'updatepartition':
                      updatePartition(tpi, data_array);
                      break;
                    case 'updatekeypad':
                      updateKeypad(tpi, data_array);
                      break;
                    case 'cidEvent':
                      cidEvent(tpi, data_array);
                      break;
                    case 'zonetimerdump':
                      zoneTimerDump(tpi, data_array);
                      break;
                  }
                }
              }
            }
          }
        }
      }
    });

    // --- Inner functions ---
    // All converted to arrow functions so 'this' is inherited from startSession()
    // and refers to the EnvisaLink instance throughout. No 'self' alias needed.

    const isConnectionIdle = () => {
      // We didn't receive any messages for greater than heartbeatInterval seconds.
      // Assume the session dropped and re-connect.
      clearTimeout(this.isConnectionIdleHandle);

      var millis = Date.now() - this.lastmessage;
      var deltaTime = Math.floor(millis / 1000);

      this.log.debug("Checking for Heartbeat and connection status...");
      if (deltaTime > (this.options.heartbeatInterval) || !this.isConnected || tpiserverSocket === undefined || tpiserverSocket.destroyed) {
        this.log.warn(`Heartbeat time drift is: ${deltaTime}, connection is active: ${this.isConnected} and the data stream object defined: ${tpiserverSocket !== undefined}. Trying to re-connect session...`);
        this.endSession();
        if (!this.inTrouble) {
          this.emit('envisalinkupdate', {
            source: "session_connect_status",
            qualifier: 1
          });
          this.inTrouble = true;
        }
        setTimeout(() => { this.startSession(); }, SESSION_TIMEOUT);
      } else {
        // Connection not idle. Check again after heartbeatInterval seconds.
        this.log.debug("Heartbeat check successful and session is valid. Last message time: " + this.lastmessage);
        this.isConnectionIdleHandle = setTimeout(isConnectionIdle, (this.options.heartbeatInterval * 1000)); 
      }
    };

    const updateZone = (tpi, data) => {
      // Parse the data packet: one 8-byte HEX string, little-endian, each bit represents a zone.
      // If a bit is 1 the zone is active, 0 means not active.
      var zone_bits = data[1];
      var zone_array = [];
      for (var i = 0; i < zone_bits.length; i = i + 2) {
        var byte = parseInt(zone_bits.substr(i, 2), 16);
        var position = (i * 4) + 1;
        for (var n = byte; n > 0; n = n >> 1) {
          if ((n & 0x01) == 1) {
            zone_array.push(position);
          }
          position++;
        }
      }
      this.log.debug("Zone updated");
      var z_list = [];
      zone_array.forEach((z) => {
        z_list.push(z);
        this.zones[z] = {
          send: tpi.send,
          name: tpi.name,
          code: z
        };
        zoneTimerOpen(tpi, z);
      });
      this.emit('zoneupdate', {
        zone: z_list,
        code: data[0],
        status: tpi.name
      });
    };

    const updatePartition = (tpi, data) => {
      // The panel sends an array of bytes, each representing a partition and its state.
      // See section 3.4 of the EnvisaLink Vista TPI programmer's document for state values.
      var partition_string = data[1];
      for (var i = 0; i < partition_string.length; i = i + 2) {
        var byte = parseInt(partition_string.substr(i, 2), 10);
        var partition = (i / 2) + 1;
        var mode = modeToHumanReadable(byte);
        this.emit('updatepartition', {
          partition: partition,
          mode: mode,
          code: byte,
          status: tpi.name
        });
      }
    };

    const findZone = (zonelist, zone) => {
      for (var i = 0; i < zonelist.length; i++) {
        if (zone == zonelist[i].zonetimername) {
          this.log.debug("Found zone - ", zone);
          return i;
        }
      }
      this.log.debug("Not Found zone - ", zone);
      return undefined;
    };

    const zoneTimerOpen = (tpi, zone, eventtype = "fault.") => {
      var triggerZoneEvent = false;
      var triggerLowbatteryEvent = false;
      var triggerBypassedEvent = false;
      var triggerCheckEvent = false;
      var numZone = parseInt(zone, 10);

      // Zone event is not a number — return early.
      if (isNaN(numZone)) return;

      var zoneid = findZone(this.activezones, eventtype + numZone);
      if (Number.isInteger(zoneid)) {
        this.log.debug("Zone found in active zone list index - ", zoneid);
        this.activezones[zoneid].eventepoch = Math.floor(Date.now() / 1000);
      } else {
        this.log.debug("Adding new zone - ", numZone);
        this.activezones.push({
          zonetimername: eventtype + numZone,
          zone: numZone,
          source: tpi.name,
          eventepoch: Math.floor(Date.now() / 1000),
          eventtype: eventtype
        });
        if (eventtype == "fault.")    triggerZoneEvent = true;
        if (eventtype == "lowbatt.")  triggerLowbatteryEvent = true;
        if (eventtype == "bypassed.") triggerBypassedEvent = true;
        if (eventtype == "check.")    triggerCheckEvent = true;
      }

      if (this.activezones.length > 0) {
        if (this.activeZoneTimeOut == undefined) {
          this.log.debug("Activating zone timer");
          this.activeZoneTimeOut = setTimeout(zoneTimerClose, this.options.openZoneTimeout * 1000);
        }
      }

      if (triggerZoneEvent) {
        this.emit('zoneevent', {
          zone: numZone,
          mode: "open",
          source: tpi.name + " Zone fault"
        });
      }
      if (triggerCheckEvent) {
        this.emit('zoneevent', {
          zone: numZone,
          mode: "check",
          source: tpi.name + " Check fault"
        });
      }
      if (triggerLowbatteryEvent) {
        this.emit('cidupdate', {
          type: "zone",
          zone: numZone,
          code: RF_LOW_BATTERY,
          name: tpi.name,
          qualifier: 1,
          source: tpi.name + " Low Batt"
        });
      }
      if (triggerBypassedEvent) {
        this.emit('cidupdate', {
          type: "zone",
          zone: numZone,
          code: ZONE_BYPASS,
          name: tpi.name,
          qualifier: 1,
          source: tpi.name + " Bypassed"
        });
      }
    };

    const zoneTimerClose = () => {
      var z = this.activezones.length;
      var l_zonetimeout = this.options.openZoneTimeout;
      var minZoneTime = l_zonetimeout;
      var currZoneTime = l_zonetimeout;

      if (this.activeZoneTimeOut) clearTimeout(this.activeZoneTimeOut);
      while (z--) {
        currZoneTime = Math.floor(Date.now() / 1000) - this.activezones[z].eventepoch;
        if (currZoneTime >= l_zonetimeout) {
          if (this.activezones[z].eventtype == "fault." || this.activezones[z].eventtype == "check.") {
            this.emit('zoneevent', {
              zone: this.activezones[z].zone,
              mode: "close",
              source: this.activezones[z].source + " Zone Time Out"
            });
          }
          // Synthetic low battery signal: the keypad has stopped reporting this zone as
          // low battery for openZoneTimeout seconds, meaning the panel cleared the low battery condition.
          if (this.activezones[z].eventtype == "lowbatt.") {
            this.emit('cidupdate', {
              type: "zone",
              code: RF_LOW_BATTERY,
              zone: this.activezones[z].zone,
              name: this.activezones[z].source,
              qualifier: 3,
              source: this.activezones[z].source + " Low Batt Resolved."
            });
          }
          this.activezones.splice(z, 1);
        } else {
          currZoneTime = l_zonetimeout - currZoneTime;
          if (minZoneTime > currZoneTime) minZoneTime = currZoneTime;
        }
      }
      if (this.activezones.length == 0) {
        this.activeZoneTimeOut = undefined;
      } else {
        this.activeZoneTimeOut = setTimeout(zoneTimerClose, minZoneTime * 1000);
      }
    };

  
    const modeToHumanReadable = (mode) => {
      const modeMap = {
          0: 'ARMED_AWAY',
          1: 'READY',
          2: 'READY_BYPASS',
          3: 'NOT_READY',
          4: 'ARMED_STAY',
          5: 'ARMED_AWAY',
          6: 'ARMED_NIGHT',
          7: 'EXIT_DELAY',
          8: 'ALARM',
          9: 'ALARM_MEMORY'
      };
      const result = modeMap[mode];
      if (result === undefined) {
          this.log.warn(`modeToHumanReadable: Unrecognised partition mode code ${mode}, defaulting to ARMED_AWAY.`);
          return 'ARMED_AWAY';
      }
        return result;
    };

    const getKeyPadLedStatus = (keypadled) => {
      var mode = {};
      var modeInt = parseInt(keypadled, 16);
      for (var key in tpidefs.led_status) {
        mode[key] = Boolean(tpidefs.led_status[key] & modeInt);
      }
      return mode;
    };

    const keyPadToHumanReadable = (mode, extraInfo) => {
      // Priority-ordered rules array. Each entry is a [condition, result] pair.
      // Rules are evaluated top-to-bottom and the first match wins — making the
      // priority order explicit rather than encoded implicitly in else-if nesting.
      // This makes it safe to add, remove, or reorder rules without accidentally
      // breaking fall-through behaviour.
      const rules = [
          // --- Alarm states — highest priority, checked first ---
          [() => mode.alarm || mode.alarm_fire_zone,          'ALARM'],
          [() => mode.alarm_in_memory,                        'ALARM_MEMORY'],

          // --- Trouble states ---
          [() => mode.fire && mode.ready,                     'READY_FIRE_TROUBLE'],
          [() => mode.system_trouble && mode.ready,           'READY_SYSTEM_TROUBLE'],

          // --- Armed + bypass combinations (must precede plain armed checks) ---
          [() => mode.bypass && mode.armed_stay,
              () => extraInfo.includes('NIGHT-STAY') ? 'ARMED_NIGHT_BYPASS' : 'ARMED_STAY_BYPASS'],
          [() => mode.bypass && mode.armed_away,              'ARMED_AWAY_BYPASS'],
          [() => mode.bypass && mode.armed_zero_entry_delay,  'ARMED_NIGHT_BYPASS'],

          // --- Ready + bypass ---
          [() => mode.bypass && mode.ready,                   'READY_BYPASS'],

          // --- Plain ready ---
          [() => mode.ready,                                  'READY'],

          // --- Plain armed (must follow bypass+armed checks above) ---
          [() => mode.armed_stay,
              () => extraInfo.includes('NIGHT-STAY') ? 'ARMED_NIGHT' : 'ARMED_STAY'],
          [() => mode.armed_away,                             'ARMED_AWAY'],
          [() => mode.armed_zero_entry_delay,                 'ARMED_NIGHT'],

          // --- Not ready + bypass ---
          [() => mode.bypass && !mode.ready,                  'NOT_READY_BYPASS'],

          // --- Explicit not ready (handles 'Hit * for faults') ---
          [() => mode.not_used2 && mode.not_used3,            'NOT_READY'],
      ];

      for (const [condition, result] of rules) {
          if (condition()) {
              // result can be a string or a function — call it if it is a function
              // so that extraInfo-dependent results are only evaluated when needed.
              return typeof result === 'function' ? result() : result;
          }
      }
      // Default — panel is not ready, no specific condition matched.
      return 'NOT_READY';
    };

    const updateKeypad = (tpi, data) => {
      var partition = data[1];
      // ICON bit field:
      // 15: ARMED STAY  14: LOW BATTERY  13: FIRE        12: READY
      // 11: not used    10: not used     09: CHECK ICON  08: ALARM (FIRE ZONE)
      // 07: ARMED (ZERO ENTRY DELAY)     06: not used    05: CHIME
      // 04: BYPASS      03: AC PRESENT   02: ARMED AWAY  01: ALARM IN MEMORY
      // 00: ALARM (System is in Alarm)
      var ICON = data[2];
      var keypadledstatus = getKeyPadLedStatus(data[2]);
      var userOrZone = data[3];
      var beep = tpidefs.virtual_keypad_beep[data[4]];
      var keypad_txt = data[5];
      var icon_array = [];
      var position = 0;
      var mode = keyPadToHumanReadable(keypadledstatus, keypad_txt);
      
      for (var n = parseInt(ICON, 16); n > 0; n = n >> 1) {
        if ((n & 0x01) == 1) {
          icon_array.push(position);
        }
        position++;
      }

      this.alarmSystemMode = mode;
      this.log.debug(`Keypad update received. Mode: ${mode}, Text: ${keypad_txt}, Beep: ${beep}, Icon Array: ${icon_array}, Keypad LED Status: ${JSON.stringify(keypadledstatus)}`);
      
      if ((mode.substring(0, 9) == 'NOT_READY') && (keypad_txt.includes('FAULT'))) {
        zoneTimerOpen(tpi, userOrZone);
      }
      if ((mode.substring(0, 9) == 'NOT_READY') && (keypad_txt.includes('CHECK'))) {
        zoneTimerOpen(tpi, userOrZone, "check.");
      }
      if ((keypadledstatus.low_battery) && (keypad_txt.includes('LOBAT'))) {
        zoneTimerOpen(tpi, userOrZone, "lowbatt.");
      }
      if ((keypad_txt.substring(0, 5) == 'BYPAS') &&
          (!keypadledstatus.not_used2) &&
          ((mode == 'NOT_READY_BYPASS') || (mode == 'READY_BYPASS') || (mode == 'READY') || (mode == 'NOT_READY'))) {

          // Keep activezones tracking for existing display logic. Surpress synthetic CID, 
          // if this was result of bypass scan probe command to avoid duplicate events for the same zone 
          // the bypass scan event will be the source of truth for bypass status of all zones during a scan.
          if(!this.bypassScanRequested) zoneTimerOpen(tpi, userOrZone, "bypassed.");

          // Only collect into the bypass scan if syncBypassedZones() requested it.
          // This prevents reestablishZoneBypass() BYPAS confirmations from being
          // mistaken for a probe scan response and corrupting bypassedZones.
          if (this.bypassScanRequested) {
              const zoneNum = parseInt(userOrZone, 10);
              if (!isNaN(zoneNum) && zoneNum > 0 && zoneNum !== this.bypassProbeZone) {
                  this.bypassScanZones.add(zoneNum);
                  this.bypassScanInProgress = true;
              }

              // Cancel no-response timeout — panel confirmed it has bypassed zones.
              if (this.bypassScanNoResponseTimeout) {
                  clearTimeout(this.bypassScanNoResponseTimeout);
                  this.bypassScanNoResponseTimeout = undefined;
              }

              // Reset settling timer — fires when no new BYPAS arrives for settlingMs.
              const settlingMs = 3000;
              if (this.bypassScanTimeout) clearTimeout(this.bypassScanTimeout);
              this.bypassScanTimeout = setTimeout(() => {
                  if (this.bypassScanInProgress) {
                      this.log.debug(`updateKeypad: Bypass scan complete — zones: ${Array.from(this.bypassScanZones)}`);
                      this.emit('bypassscan', {
                          zones: new Set(this.bypassScanZones),
                          partition: parseInt(partition, 10)
                      });
                      this.bypassScanZones.clear();
                      this.bypassScanInProgress = false;
                      this.bypassScanRequested = false;  // ← clear flag on completion
                      this.bypassScanTimeout = undefined;
                  }
              }, settlingMs);
          }
      }
      this.emit('keypadupdate', {
        partition: partition,
        code: {
          icon: icon_array,
          zone: userOrZone,
          beep: beep,
          txt: keypad_txt
        },
        status: tpi.name,
        keypadledstatus: keypadledstatus,
        mode: mode
      });
    };

    const zoneTimeToHumanReadable = (duration) => {
      var hours = Math.floor(duration / 60 / 60);
      var minutes = Math.floor(duration / 60) - (hours * 60);
      var seconds = duration % 60; 
      return hours.toString().padStart(2, '0') + 'h:' + minutes.toString().padStart(2, '0') + 'm:' + seconds.toString().padStart(2, '0') + 's';
    };

    const zoneTimerDump = (tpi, data) => {
      // Raw zone timers used inside the Envisalink.
      // The dump is a 256 character packed HEX string representing 64 UINT16
      // (little endian) zone timers. Zone timers count down from 0xFFFF (zone is open)
      // to 0x0000 (zone is closed too long ago to remember). Each "tick" is 5 seconds
      // so a zone timer of 0xFFFE means "5 seconds ago".
      // Zone timers are LITTLE ENDIAN so 0xFFFE is transmitted as FEFF.
      const MAXINT = 0xFFFF;
      const zone_time = Date.now();
      var zonenum = 0;
      const aHexStringInt = data[1];
      var swappedBits = '';
      const zonesDumpData = [];
      let beHexStr = '';
      var zoneClosedTimeCountDown;
      var byte;
      for (var i = 0; i < aHexStringInt.length; i = i + 4) {
        byte = aHexStringInt.substring(i, i + 4);
        zonenum += 1;
        swappedBits = '';
        swappedBits = byte.substring(2, 6);
        swappedBits += byte.substring(0, 2);
        beHexStr += swappedBits;
        zoneClosedTimeCountDown = (MAXINT - parseInt(swappedBits.toString(), 16)) * 5;
        if (swappedBits === "FFFF") {
          zonesDumpData.push({
            zone: zonenum,
            zonestatus: 'open',
            ClosedTimeCount: 0,
            zone_txt: 'Currently Open'
          });
          zoneTimerOpen(tpi, zonenum);
        } else if (swappedBits === "0000") {
          zonesDumpData.push({
            zone: zonenum,
            zonestatus: 'close',
            ClosedTimeCount: MAXINT,
            zone_txt: 'Last Closed longer than I can remember'
          });
        } else {
          zonesDumpData.push({
            zone: zonenum,
            zonestatus: 'close',
            ClosedTimeCount: zoneClosedTimeCountDown,
            zone_txt: "Last Closed " + zoneTimeToHumanReadable(zoneClosedTimeCountDown)
          });
        }
      }
      // Bug fix: was 'this.emit' in the original arrow function — now consistent
      // with all other inner functions which use the instance via 'this'.
      this.emit('zonetimerdump', {
        zonedump: zone_time,
        status: tpi.name,
        zoneTimerStatus: zonesDumpData,
        zoneHexData: beHexStr
      });
    };

    const cidEvent = (tpi, data) => {
      // CID event format — binary coded decimal, not HEX:
      // QXXXPPZZZ0
      //   Q   = Qualifier: 1 = New Event/Opening, 3 = Restore/Closing, 6 = Repeat/Still Present
      //   XXX = 3-digit CID code
      //   PP  = 2-digit partition number
      //   ZZZ = zone or user number (context-dependent)
      //   0   = always 0 (padding)
      // Example: 3441010020 → qualifier=3 (restore), code=441 (armed stay), partition=01, user=002

      // Guard: malformed packet — data[1] missing or empty.
      // Without this, cid.substring(0,1) throws TypeError and crashes the data handler.
      if (!data[1]) {
        this.log.warn('cidEvent: Received malformed CID packet — data payload is missing. Ignoring.');
        return;
      }

      var qualifier_description;
      const cid = data[1];

      // Parse qualifier as integer — must match the numeric qualifier used by all
      // other cidupdate emissions in this file (zoneTimerOpen, zoneTimerClose).
      // Contact ID standard qualifier values:
      //   1 = New Event / Opening
      //   3 = New Restore / Closing
      //   6 = Previously reported condition still present (repeat)
      const qualifier = parseInt(cid.substring(0, 1), 10);
      if (qualifier === 1) {
        qualifier_description = "event";
      } else if (qualifier === 3) {
        qualifier_description = "restore";
      } else if (qualifier === 6) {
        // Qualifier 6 is valid per the Contact ID standard (repeat/still-present condition).
        // Envisalink may not emit this, but handle it gracefully rather than dropping it.
        qualifier_description = "repeat";
        this.log.warn(`EnvisaLink: CID qualifier 6 (repeat event) received — condition still present.`);
      } else {
        this.log.error(`EnvisaLink: Unrecognized CID qualifier: ${qualifier} received from Panel!`);
        return;
      }

      const code = cid.substring(1, 4);
      // Parse partition and zone_or_user as integers — consistent with all other events
      // in this file (updatePartition, zoneTimerOpen) which emit numeric values.
      // Leading zeros in the raw BCD string ("01", "002") are safely dropped by parseInt.
      const partition    = parseInt(cid.substring(4, 6), 10);
      const zone_or_user = parseInt(cid.substring(6, 9), 10);
      const cid_obj      = ciddefs.cid_events_def[code];

      if (!cid_obj) {
        this.log.error(`EnvisaLink: Unrecognized CID code: ${code} received from Panel!`);
        return;
      }

      const cidupdate_object = {
        partition: partition,
        qualifier: qualifier,
        qualifier_description: qualifier_description,
        code: code,
        type: cid_obj.type,
        subject: cid_obj.label,
        status: tpi.name
      };
      cidupdate_object[cid_obj.type] = zone_or_user;
      this.emit('cidupdate', cidupdate_object);
    };

  } // end startSession()

/**
 * Terminates the current TPI session with the EnvisaLink module.
 * Cleanly closes the socket connection if it exists and is not already destroyed.
 * @returns {boolean} True if connection was successfully terminated, false if already closed.
 */
  endSession() {
    if (tpiserverSocket && !tpiserverSocket.destroyed) {
      tpiserverSocket.end();
      return true;
    } else {
      return false;
    }
  }

/**
 * Sends a command string to the EnvisaLink TPI interface.
 * Automatically appends carriage return and line feed to the command.
 * Respects maintenance mode and validates connection before sending.
 * @param {string} command - The command string to send to the panel.
 * @returns {boolean} True if command was sent successfully, false otherwise.
 */
  sendCommand(command) {
    if (!this.isMaintenanceMode) {      
      if (tpiserverSocket !== undefined && this.isConnected) {
        this.log.debug('!WARNING! PIN/CODE may appear in the clear TX > ', command);
        tpiserverSocket.write(command + '\r\n');
        return true;
      } else {
        this.log.error(`Command not successful. Current session connected status is: ${this.isConnected} and data stream object is defined: ${tpiserverSocket !== undefined}`);
        this.log.debug(`Data Stream: data stream is: ${JSON.stringify(tpiserverSocket)}`);
        return false;
      }
    } else {
      this.log.warn('This module running in maintenance mode, command not sent.');
      return false;
    }
  }

/**
 * Requests a dump of all zone timers from the EnvisaLink module.
 * Uses TPI command 02 to retrieve the raw zone timer data.
 * Zone timers show how long ago each zone was last opened/closed.
 * Response will be received via 'zonetimerdump' event.
 */
  getZonesTimers() {
    var to_send = '^02,$';
    this.lastsentcommand = "02";
    this.sendCommand(to_send);
  }

/**
 * Probes the panel for all currently bypassed zones by sending a bypass
 * command for an unused probe zone. The panel responds by scrolling through
 * all currently bypassed zones on the keypad display before acknowledging
 * the probe zone — these BYPAS keypad updates are captured by updateKeypad
 * and collected into a bypassscan event once the scroll settles.
 *
 * The probe zone should be a zone number that is not wired to any physical
 * sensor on the panel (default: 99). Configure bypassProbeZone in the
 * plugin config to match your panel's unused zone range.
 *
 * Only valid when panel is disarmed and in a bypass-capable state.
 *
 * @param {string} pin - User PIN to authenticate the bypass command.
 * @param {number} probeZone - Unused zone number to probe with (default: 99).
 */
syncBypassedZones(pin, probeZone = 99, partitionNumber = 1) {
    if (this.isMaintenanceMode) {
        this.log.warn('Maintenance mode active zone synchronization, command not sent.');
        return;
    }
    if (!tpiserverSocket || !this.isConnected) {
        this.log.warn('Envisalink plug-in not connected, cannot sync bypass state.');
        return;
    }
    // Only probe when panel is in a bypass-capable disarmed state.
    // Sending bypass during ARMED or ALARM state would be incorrect.
    if (this.alarmSystemMode.includes('ARMED') || this.alarmSystemMode.includes('ALARM')) {
        this.log.warn('Panel is ARMED or in ALARM — skipping probe.');
        return;
    }
    // Do not probe while a bypass or unbypass operation is in flight.
    // The probe command would interfere with the in-progress operation,
    // and the scan result would reflect a partial/transient panel state.
    if (this.isProcessingBypass || this.isProcessingUnBypass) {
        this.log.debug('syncBypassedZones: Bypass or unbypass in progress — deferring probe.');
        return;
    }
    const formattedZone = probeZone >= 100
        ? String(probeZone)
        : String(probeZone).padStart(2, '0');
    this.bypassScanRequested = true;
    this.bypassScanZones.clear();
    this.bypassScanInProgress = false;
    this.log.info(`Starting bypass zone probe using zone ${formattedZone} to enumerate bypassed zones.`);
    const command = pin + '6' + formattedZone;  // PIN + bypass function code + zone
    this.sendCommand(command);

    // No-response timeout: if the panel sends no BYPAS keypad updates within
    // noResponseMs after the probe command, it means no zones are currently
    // bypassed. Emit an empty bypassscan so index.js can clear any stale
    // bypassedZones entries that remain from before the restart.
    // This timeout is cancelled by updateKeypad the moment the first BYPAS
    // update arrives, since bypassScanInProgress will be true by then.
    const noResponseMs = 5000;
    if (this.bypassScanNoResponseTimeout) {
        clearTimeout(this.bypassScanNoResponseTimeout);
    }
    this.bypassScanNoResponseTimeout = setTimeout(() => {
        if (!this.bypassScanInProgress) {
            this.log.debug('syncBypassedZones: No BYPAS updates received — ' +
                          'panel has no bypassed zones.');
            this.emit('bypassscan', {
                zones: new Set(),
                partition: partitionNumber
            });
        }
        this.bypassScanRequested = false;
        this.bypassScanNoResponseTimeout = undefined;
    }, noResponseMs);
}
/**
 * Changes the active partition on the EnvisaLink module.
 * Uses TPI command 01 to switch between partitions.
 * Validates partition number is within valid range (0 to MAXPARTITIONS-1).
 * @param {number} partitionNumber - The partition number to switch to (0-15).
 */
  changePartition(partitionNumber) {
    if ((partitionNumber > -1) && (partitionNumber < MAXPARTITIONS)) {
      var to_send = '^01,' + partitionNumber.toString() + '$';
      this.lastsentcommand = "01";
      this.sendCommand(to_send);
    } else {
      this.log.error(`Invalid Partition Number ${partitionNumber} specified when trying to change partition, ignoring.`);
    }
  }

/**
 * Sends a keypad command string to a specific partition.
 * Uses TPI command 03 to send virtual keypad key presses.
 * Validates partition number is within valid range (0 to MAXPARTITIONS-1).
 * @param {number} partitionNumber - The target partition number (0-15).
 * @param {string} command - The keypad command string to send.
 */
  sendCommandToPartition(partitionNumber, command) {
    if ((partitionNumber > -1) && (partitionNumber < MAXPARTITIONS)) {
      var to_send = '^03,' + partitionNumber.toString() + ',' + command.toString() + '$';
      this.lastsentcommand = "03";
      this.sendCommand(to_send);
    } else {
      this.log.error(`Invalid Partition Number ${partitionNumber} specified when trying to change partition, ignoring.`);
    }
  }

/**
 * Synchronizes the Ademco alarm panel's time and date with the host computer time.
 * Uses keypad keystrokes to navigate the programming menu and set time/date.
 * Sequence: *6 + INSTALLER_CODE + *20 + HHMMMMDDYY + #
 * @param {string} programmerCode - The installer or Master code (default: 4112).
 * @param {number} partitionNumber - The partition number to sync (default: 1).
 * @returns {Promise<boolean>} True if command sequence started successfully, false otherwise.
 */
  async syncAlarmDateTime(programmerCode = '4112', partitionNumber = 1) {
    // 'const self = this' removed — sendKeystroke is an arrow function and
    // inherits 'this' correctly from the enclosing async method.
    if (this.isMaintenanceMode) {
      this.log.warn('This module is running in maintenance mode, time sync command not sent.');
      return false;
    }

    if ((partitionNumber < 1) || (partitionNumber > MAXPARTITIONS)) {
      this.log.error(`Invalid Partition Number ${partitionNumber} specified when trying to sync time, ignoring.`);
      return false;
    }

    if (tpiserverSocket === undefined || !this.isConnected) {
      this.log.error(`Time sync command not successful. Current session connected status is: ${this.isConnected} and data stream object is defined: ${tpiserverSocket !== undefined}`);
      return false;
    }

    const now = new Date();
    const hours   = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const month   = (now.getMonth() + 1).toString().padStart(2, '0'); // getMonth() is 0-indexed
    const day     = now.getDate().toString().padStart(2, '0');
    const year    = now.getFullYear().toString().substr(-2);
    
    // Build the time/date string: HHMMMMDDYY (no day of week for *20 entry)
    const timeString = hours + minutes + month + day + year;
    
    this.log.info(`Syncing alarm panel time to: ${now.toLocaleString()}`);
    this.log.debug(`Time string to send: ${timeString}`);
    
    // Arrow function — 'this' inherited correctly, no self alias needed.
    const sendKeystroke = (keys, delayMs = 300) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          this.sendCommand(keys);
          resolve();
        }, delayMs);
      });
    };

    try {
      await sendKeystroke('*6' + programmerCode, 100);
      this.log.debug('Enter programming mode');
      await sendKeystroke('*20', 800);
      this.log.debug('Navigated to time/date field (*20)');
      await sendKeystroke(timeString, 800);
      this.log.debug('Entered time/date string');
      await sendKeystroke('#', 800);
      this.log.debug('Pressed # to save');
      await sendKeystroke('#', 500);
      this.log.info('Time sync sequence completed');
      return true;
    } catch (error) {
      this.log.error('Error during time sync sequence:', error);
      await sendKeystroke('##', 100);
      return false;
    }
  }

/**
 * Convenience method to sync time for partition 1 with default installer code.
 * @param {string} programmerCode - The installer or Master code (default: 4112).
 * @returns {Promise<boolean>} True if command was sent successfully, false otherwise.
 */
  async syncDateTime(programmerCode = '4112') {
    return await this.syncAlarmDateTime(programmerCode, 1);
  }

/**
 * Reads the current time and date from the alarm panel keypad display.
 * Uses keypad keystrokes to navigate to field *20 and read the display.
 * Sequence: *6 + INSTALLER_CODE + *20
 * @param {string} programmerCode - The installer or Master code (default: 4112).
 * @param {number} partitionNumber - The partition number to query (default: 1).
 * @returns {Promise<boolean>} True if command was sent successfully, false otherwise.
 */
  async getAlarmDateTime(programmerCode = '4112', partitionNumber = 1) {
    // 'const self = this' removed — sendKeystroke is an arrow function and
    // inherits 'this' correctly from the enclosing async method.
    if (this.isMaintenanceMode) {
      this.log.warn('This module is running in maintenance mode, get time command not sent.');
      return false;
    }

    if ((partitionNumber < 1) || (partitionNumber > MAXPARTITIONS)) {
      this.log.error(`Invalid Partition Number ${partitionNumber} specified when trying to get time, ignoring.`);
      return false;
    }

    if (tpiserverSocket === undefined || !this.isConnected) {
      this.log.error(`Get time command not successful. Current session connected status is: ${this.isConnected} and data stream object is defined: ${tpiserverSocket !== undefined}`);
      return false;
    }

    // Arrow function — 'this' inherited correctly, no self alias needed.
    const sendKeystroke = (keys, delayMs = 300) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          this.sendCommand(keys);
          resolve();
        }, delayMs);
      });
    };

    try {
      this.log.info('Requesting current alarm panel time from keypad...');
      await sendKeystroke('*6' + programmerCode, 100);
      this.log.debug('Enter programming mode');
      await sendKeystroke('*20', 800);
      this.log.debug('Navigated to time/date field (*20) - check keypad display');
      await sendKeystroke('##', 500);
      this.log.info('Exited programming mode - time displayed on keypad');
      return true;
    } catch (error) {
      this.log.error('Error during get time sequence:', error);
      await sendKeystroke('##', 100);
      return false;
    }
  }

// Usage examples:
// 
// 1. Sync time with the alarm panel (async/await):
//    await envisalink.syncDateTime('4112');
//    // or for a specific partition with custom installer code:
//    await envisalink.syncAlarmDateTime('4112', 1);
//
// 2. Get current alarm panel time (reads from keypad display):
//    await envisalink.getAlarmDateTime('4112');
//    // Watch for 'keypadupdate' events to see the displayed time
//
// 3. Set up automatic time sync (e.g., daily at 3 AM):
//    setInterval(async () => {
//      await envisalink.syncDateTime('4112');
//    }, 24 * 60 * 60 * 1000); // Every 24 hours
//
// 4. Sync time on successful connection:
//    envisalink.on('envisalinkupdate', async (event) => {
//      if (event.source === 'session_connect_status' && event.qualifier === 3) {
//        // Connection restored — wait a bit then sync
//        setTimeout(async () => {
//          await envisalink.syncDateTime('4112');
//        }, 3000);
//      }
//    });
//
// 5. Monitor keypad updates to see time display:
//    envisalink.on('keypadupdate', (data) => {
//      console.log('Keypad display:', data.code.txt);
//    });

}
module.exports = EnvisaLink
