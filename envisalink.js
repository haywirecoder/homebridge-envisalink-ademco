// 'use strict'
const MAXPARTITIONS = 16;
const MAXZONES = 128;
const MAXALARMUSERS = 47;
var net = require('net')

var EventEmitter = require('events');
var tpidefs = require('./tpi.js')
var ciddefs = require('./cid.js');
const { isUndefined } = require('util');
var EnvisalinkProxyShared = require('./EnvisalinkProxy');
var EnvisaPortForwarder = require('./TransparentPortForwarder');
var tpiserverSocket;
var activezones = [];
var activeZoneTimeOut = undefined;
var inTrouble = false;

const RF_LOW_BATTERY = 384;
const ZONE_BYPASS = 570;
const SESSION_TIMEOUT = 5000;


class EnvisaLink extends EventEmitter {

  isProcessingBypass;
  isProcessingAlarm;
  isProcessingBypassqueue;
  isConnected;
  alarmSystemMode;
  tpiproxyServer;
  wcForwardServer;

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
      // If session watcher is enable auto-reconnection is also enabled.
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

    // are we in maintenance mode?
    this.isMaintenanceMode = config.maintenanceMode ? config.maintenanceMode: false

    // Set interval for testing connection and how long should zone should be consider without any update.
    this.options.heartbeatInterval = Math.min(600,Math.max(10,config.heartbeatInterval));  
    this.options.openZoneTimeout = Math.min(120,Math.max(5,config.openZoneTimeout));  
    
    this.zones = {};
    this.lastmessage = new Date();
    this.lastsentcommand = "";
    this.isProcessingBypass = false;
    this.isProcessingAlarm = false;
    this.isProcessingBypassqueue = 0;
    this.alarmSystemMode = 'READY';

  }

  
  startSession() {

    var self = this;
    self.shouldReconnect = this.options.autoreconnect;
    self.isConnected = false;
    self.lastmessage = Date.now();
    self.isConnectionIdleHandle = undefined;

    // Display starting of connection.
    self.log.info(`Starting connection to envisalink module at: ${self.options.host}, port: ${self.options.port}`);
   
    tpiserverSocket = net.createConnection({
      port: self.options.port,
      host: self.options.host
    });

    if (self.options.proxyEnabled) {
      if (!self.tpiproxyServer) {
        self.tpiproxyServer = new EnvisalinkProxyShared(this.options.proxyPort, this.options.password, this.options.proxyValidationFilter, this.log);
      }
      if (!self.wcForwardServer) {
          self.wcForwardServer = new EnvisaPortForwarder(this.options.wcForwardPort, this.options.host, this.options.wcPort, this.log);
      }
    }  


    tpiserverSocket.on('error', function (ex) {

      self.log.error("EnvisaLink Network Error: ", ex);
      self.isConnected = false;
      var source = "session_connect_status";
      if (!inTrouble)
      {
          self.emit('envisalinkupdate', {
            source: source,
            qualifier: 1
          });
          inTrouble = true;
      }
      // Stop proxy services
      if (self.options.proxyEnabled) {
        if (self.tpiproxyServer) {
          self.tpiproxyServer.stop();
        }
        if (self.wcForwardServer) {
          self.wcForwardServer.stop();      
        }
      }
    });

    tpiserverSocket.on('close', function (hadError) {

      if (hadError) self.log.error("EnvisaLink server connection closed due to a transmission error. ");
      self.isConnected = false;
      var source = "session_connect_status";
      if (!inTrouble)
        {
            self.emit('envisalinkupdate', {
            source: source,
            qualifier: 1
          });
          inTrouble = true;
        }
      // Stop proxy services
      if (self.options.proxyEnabled) {
        if (self.tpiproxyServer) {
          self.tpiproxyServer.stop();
        }
        if (self.wcForwardServer) {
          self.wcForwardServer.stop();      
        }
      }
      // This maybe a problem at startup and auto restart timer hasn't been stated. Start it now and attempt to connect.
      if(self.shouldReconnect && self.isConnectionIdleHandle === undefined )
        { 
          self.log.info(`Re-attempting server connection every: ${self.options.heartbeatInterval} seconds.`);
          self.isConnectionIdleHandle = setTimeout( isConnectionIdle, (self.options.heartbeatInterval * 1000) ); // Check every idle seconds...
        }

    });

    tpiserverSocket.on('end', function () {

      self.log.info('TPI session disconnected.');
      self.isConnected = false;
      // Stop proxy services
      if (self.options.proxyEnabled) {
        if (self.tpiproxyServer) {
          self.tpiproxyServer.stop();
        }
        if (self.wcForwardServer) {
          self.wcForwardServer.stop();      
        }
      }

    });

    tpiserverSocket.on('data', async function (data) {

      var dataslice = data.toString().replace(/[\n\r]/g, '|').split('|');
      var source = "session_connect_status";

      self.log.debug("TPI Data stream: " + dataslice); // Display TPI data stream for debug
      self.lastmessage = Date.now(); // Every time a message comes in, reset the lastmessage timer

      for (var i = 0; i < dataslice.length; i++) {
        var datapacket = dataslice[i];
        if (datapacket !== '') {
          if (datapacket.substring(0, 5) === 'Login') {
            self.log.debug("Login requested. Sending response " + self.options.password)
            self.isConnected = true;
            self.sendCommand(self.options.password);
          } else if ((datapacket.substring(0, 6) === 'FAILED') || (datapacket.substring(0, 9) === 'Timed Out')) {
            self.log.error("EnvisaLink: Login failed.");
            // The session will be closed
            self.isConnected = false;
          } else if (datapacket.substring(0, 2) === 'OK') {
            // ignore, OK is good. or report successful connection.    
            self.log.info(`Successful TPI session established.`);
            if (self.options.proxyEnabled) {
                  self.log.info(`Starting TPI proxy server and Console Forwarder...`);
                  if(self.tpiproxyServer.isRunning()) await self.tpiproxyServer.restart(tpiserverSocket);
                  else await self.tpiproxyServer.start(tpiserverSocket);
                  if(self.wcForwardServer.isRunning()) await self.wcForwardServer.restart();
                  else await self.wcForwardServer.start();
            }
            // If connection had issue prior clear and generate restore event
            // Qualifier: 1 = Event, 3 = Restore
            if (inTrouble)
            {
              self.emit('envisalinkupdate', {
                source: source,
                qualifier: 3
              });
              inTrouble = false;
            }
            // Determine if option to monitor connection is enabled.
            if(self.shouldReconnect && self.options.sessionwatcher)
            {
              self.log.info(`Checking for disconnected session every: ${self.options.heartbeatInterval} seconds.`)
              self.isConnectionIdleHandle = setTimeout( isConnectionIdle, (self.options.heartbeatInterval * 1000) ); // Check every idle seconds...
            }
            else  
            {
             self.log.warn("Warning: Session monitoring is disabled. Envisalink-Ademco will not watch for hung sessions.") 
            }
          } else {
            if (self.options.proxyEnabled) {
                self.tpiproxyServer.writeToClients(data);// Forward data to all connected proxy clients.
            }
            var tpi_str = datapacket.match(/^%(.+)\$/); // pull out everything between the % and $
            if (tpi_str == null) {
              tpi_str = datapacket.match(/\^(.+)\$/); // module command string, could be result of previous command  pull out everything between the ^ sand $.
              if (tpi_str == null)
              {
                self.log.warn("Envisalink data steam format invalid. Packets must encapsulated within the % and $ sentinels: " + datapacket + ". Ignoring update.");
              }  
              else
              {
                if(self.lastsentcommand == tpi_str[1].split(',')[0]) 
                  self.log.info(`Envisakit module command return: ${tpidefs.command_response_codes[tpi_str[1].split(',')[1]]}`);
              }
            } else {
              var data_array = tpi_str[1].split(','); // Element number 1 should be what was matched between the () in the above match. so everything between % and $
              var command = data_array[0]; // The first part is the command.
              var tpi = tpidefs.tpicommands[command];
              if (tpi) {
                if (tpi.bytes === '' || tpi.bytes === 0) {
                  self.log.warn(tpi.pre + ' - ' + tpi.post);
                } else {
                  self.log.debug(tpi.pre + ' | ' + tpi_str + ' | ' + tpi.post)
                  self.log.debug('Envisakit Operation: ' + tpi.action);
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

    function isConnectionIdle() {
      // we didn't receive any messages for greater than heartbeatInterval seconds. Assume dropped and re-connect.
      // clear handle for interval checking of connection
      clearTimeout(self.isConnectionIdleHandle);

      // Calculate drift time
      var millis = Date.now() - self.lastmessage;
      var deltaTime = Math.floor(millis/1000);

      // Was there traffic in allocated time frame?
      self.log.debug("Checking for Heartbeat and connection status...");
      if (deltaTime > (self.options.heartbeatInterval) || !self.isConnected || tpiserverSocket === undefined || tpiserverSocket.destroyed) {
        self.log.warn(`Heartbeat time drift is: ${deltaTime}, connection is active: ${self.isConnected} and the data stream object defined: ${tpiserverSocket !== undefined}. Trying to re-connect session...`);
        self.endSession();
        var source = "session_connect_status";
        // Generate event to indicate there is issue with EVL module connection
        //  Qualifier: 1 = Event, 3 = Restore
        if (!inTrouble)
        {
          self.emit('envisalinkupdate', {
                source: source,
                qualifier: 1
          });
          inTrouble = true;
        }
        setTimeout(function () {self.startSession()}, SESSION_TIMEOUT);
      } else {
        // Connection not idle. Check again connection idle time seconds...
        self.log.debug("Heartbeat check successful and session are validate. Last message time: " + self.lastmessage)
        self.isConnectionIdleHandle = setTimeout(isConnectionIdle, (self.options.heartbeatInterval * 1000)); 
      }
    }; 

    function updateZone(tpi, data) {
      // now, what I need to do here is parse the data packet for parameters, in this case it's one parameter an
      // 8 byte HEX string little endian each bit represents a zone. If 1 the zone is active, 0 means not active.
      var zone_bits = data[1];
      // now, zone_bits should be a hex string, little_endian of zones represented by bits.
      // need to loop through, byte by byte, figure out whats Bits are set and 
      // return an array of active zones.
      // suggest finding the bits by taking a byte if it's not zero, do a modulo 2 on it, if the remainder is non-zero you have a bit
      // then shift the remaining bits right 1, and increment your bit index count by one.
      // When you do all 8 bits, move onto the next byte until no bytes exist.
      // as it's little endian, you would start with the right most Byte. and move left.
      // self.log.debug("Starting zone_bits for loop zone_bits='" + zone_bits +"'");
      var zone_array = []; // Define/initialize zone_array.
      for (var i = 0; i < zone_bits.length; i = i + 2) { // work from left to right, one byte at a time.
        var byte = parseInt(zone_bits.substr(i, 2), 16); // get the two character hex byte value into an int

        // since it's a byte, increment position by 8 bits, but since we're incrementing i by 2. for a 1 byte hex. 
        // we need to use a value of 4 to compensate. Then add 1, since we technically start counting our zones at 1, not zero. so but zero is zone 1.
        var position = (i * 4) + 1;
        // ( 64 - (14+2) * 4) + 1;
        // ( 64 - 16*4) +1;
        // ( 64 - 64) +1;
        // ( 0 ) + 1;
        // 1
        // ( 64 - (12+2) * 4) + 1;
        // ( 64 - 14*4 ) + 1;
        // ( 64 - 56 ) + 1;
        // ( 8 ) + 1;
        // 9
        // self.log.debug( "zone_bits for loop enter subloop position="+ position +" byte='"+ byte +"' byte-original='"+ zone_bits.substr(i, 2) +"' i="+ i);
        for (var n = byte; n > 0; n = n >> 1) {
          if ((n & 0x01) == 1) { // is the right most bit a 1?
            zone_array.push(position);
          }
          position++;
        }
      }
      self.log.debug("Zone updated");
      var z_list = [];

      zone_array.forEach(function (z, i, a) {
        z_list.push(z);
        self.zones[z] = {
          send: tpi.send,
          name: tpi.name,
          code: z
        };
        zoneTimerOpen(tpi, z);
      });
      self.emit('zoneupdate', {
        zone: z_list,
        code: data[0],
        status: tpi.name
      });

    }

    function updatePartition(tpi, data) {
      // Ademco panel sends an array of bytes, each one representing a partition and its state. 
      // Example:
      // 0100010000000000
      // so in the example above out of 8 partitions, partitions 1 and 3 are in state READY. 
      // There is a table you can refer to in section 3.4 of EnvisaLink  Vista TPI programmer's document that lists
      // the different values possible for each byte.
      var partition_string = data[1];

      for (var i = 0; i < partition_string.length; i = i + 2) { // Start at the beginning, and move up two bytes at a time.
        var byte = parseInt(partition_string.substr(i, 2), 10); // convert hex (base 10) to int.
        var partition = (i / 2) + 1;
        var mode = modeToHumanReadable(byte);
        self.emit('updatepartition', {
          partition: partition,
          mode: mode,
          code: byte,
          status: tpi.name
        });
        
      }
    }

    function findZone(zonelist, zone) {
      // Find zone that was being previously track.
      for (var i = 0; i < zonelist.length; i++) {
        if (zone == zonelist[i].zonetimername) {
          self.log.debug("Found zone - ", zone);
          return i;
        }
      }
      // return undefined if not found
      self.log.debug("Not Found zone - ", zone);
      return undefined;
    }

    function zoneTimerOpen(tpi, zone, eventtype ="fault.") {

      var triggerZoneEvent = false;
      var triggerLowbatteryEvent = false;
      var triggerBypassedEvent = false;
      var triggerCheckEvent = false;
      // remove leading zero from zone information
      var numZone = parseInt(zone, 10);

      // Zone event is not a number, returning
      if (isNaN(numZone)) return

      // Check if this zone is present add update time if present,
      // if not add to list

      var zoneid = findZone(activezones, eventtype + numZone);
      if (Number.isInteger(zoneid)) {
        self.log.debug("Zone found in active zone list index - ", zoneid);
        activezones[zoneid].eventepoch = Math.floor(Date.now() / 1000);
      } else {
          self.log.debug("Adding new zone - ", numZone);
          activezones.push({
            zonetimername: eventtype + numZone,
            zone: numZone,
            source: tpi.name,
            eventepoch: Math.floor(Date.now() / 1000),
            eventtype: eventtype
          });
          // What type of event is this fault or something else?
          if(eventtype == "fault.") triggerZoneEvent = true;
          if(eventtype == "lowbatt.") triggerLowbatteryEvent = true;
          if(eventtype == "bypassed.") triggerBypassedEvent = true;
          if(eventtype == "check.") triggerCheckEvent = true;
      }

      if (activezones.length > 0) {
        if (activeZoneTimeOut == undefined) {
          self.log.debug("Activating zone timer");
          activeZoneTimeOut = setTimeout(zoneTimerClose, self.options.openZoneTimeout * 1000);
        }
      }
      // Trigger update to fault the zone
      if (triggerZoneEvent == true) {
        self.emit('zoneevent', {
          zone: numZone,
          mode: "open",
          source: tpi.name + " Zone fault"
        });
      }
       // Trigger update to fault the zone
       if (triggerCheckEvent == true) {
        self.emit('zoneevent', {
          zone: numZone,
          mode: "check",
          source: tpi.name + " Check fault"
        });
      }
      // Trigger low battery using cid event.
      if (triggerLowbatteryEvent == true) {
        self.emit('cidupdate', {
          type: "zone",
          zone: numZone,
          code: RF_LOW_BATTERY,
          name: tpi.name,
          qualifier: 1,
          source: tpi.name + " Low Batt"
        });
      }
      // Trigger a bypassed event
      if (triggerBypassedEvent == true) {
        self.emit('cidupdate', {
          type: "zone",
          zone: numZone,
          code: ZONE_BYPASS,
          name: tpi.name,
          qualifier: 1,
          source: tpi.name + " Bypassed"
        });
      }
    }

    function zoneTimerClose() {
      var z = activezones.length;
      var l_zonetimeout = self.options.openZoneTimeout;
      var minZoneTime = l_zonetimeout;
      var currZoneTime = l_zonetimeout;

      if (activeZoneTimeOut) clearTimeout(activeZoneTimeOut);
      while (z--) {
        // determine if zone hasn't been reported for the allocated time in sec, if so mark as close
        currZoneTime = Math.floor(Date.now() / 1000) - activezones[z].eventepoch;
        if (currZoneTime >= l_zonetimeout) {
          // Is the zone event if related to a fault
          if(activezones[z].eventtype == "fault." || activezones[z].eventtype == "check."){
              self.emit('zoneevent', {
                zone: activezones[z].zone,
                mode: "close",
                source:  activezones[z].source + " Zone Time Out"
            });
          }
          // Zone event is related to battery status
          if(activezones[z].eventtype == "lowbatt."){
            self.emit('cidupdate', {
              type: "zone",
              code: RF_LOW_BATTERY,
              zone: activezones[z].zone,
              name:  activezones[z].source,
              qualifier: 3,
              source:  activezones[z].source + " Low Batt Resolved."
            });
          }
          // remove from active list
          activezones.splice(z, 1);
        } else {
          // Is this entry the smallest time interval in the list?
          currZoneTime = l_zonetimeout - currZoneTime;
          if (minZoneTime > currZoneTime) minZoneTime = currZoneTime;
        }
      }
      if (activezones.length == 0) {
        // Clean up 
        activeZoneTimeOut = undefined;
      } else {
        // Zones are still being track, set timer to review when next zone is scheduled to expire.
        activeZoneTimeOut = setTimeout(zoneTimerClose, minZoneTime * 1000);
      }
    }

    function modeToHumanReadable(mode) {

      if (mode === 0)
        return 'AWAY';
      else if (mode === 1)
        return 'READY';
      else if (mode === 2)
        return 'READY_BYPASS';
      else if (mode === 3)
        return 'NOT_READY';
      else if (mode === 4)
        return 'ARMED_STAY';
      else if (mode === 5)
        return 'ARMED_AWAY';
      else if (mode === 6)
        return 'ARMED_NIGHT';
      else if (mode === 7)
        return 'EXIT_DELAY';
      else if (mode === 8)
        return 'ALARM';
      else if (mode === 9)
        return 'ALARM_MEMORY';
      else
        return 'ARMED_AWAY';
    }

    function getKeyPadLedStatus(keypadled) {

      var mode = {};
      var modeInt = parseInt(keypadled, 16);
      for (var key in tpidefs.led_status) {
        mode[key] = Boolean(tpidefs.led_status[key] & modeInt);
      }
      return mode;
    }

    function keyPadToHumanReadable(mode, extraInfo) {

      var readableCode = 'NOT_READY';
      if (mode.alarm || mode.alarm_fire_zone) {
        readableCode = 'ALARM';
      } else if (mode.alarm_in_memory) {
        readableCode = 'ALARM_MEMORY';
      } else if (mode.fire && mode.ready) {
        readableCode = 'READY_FIRE_TROUBLE';
      } else if (mode.system_trouble && mode.ready) {
        readableCode = 'READY_SYSTEM_TROUBLE';
      } else if (mode.bypass && mode.armed_stay) {
        readableCode = 'ARMED_STAY_BYPASS';
        // The text message from panel is used to determine if the panel is in might node.
        if (extraInfo.includes('NIGHT-STAY')) readableCode = 'ARMED_NIGHT_BYPASS';
        else readableCode = 'ARMED_STAY_BYPASS';
      } else if (mode.bypass && mode.armed_away) {
        readableCode = 'ARMED_AWAY_BYPASS';
      } else if (mode.bypass && mode.armed_zero_entry_delay) {
        readableCode = 'ARMED_NIGHT_BYPASS';
      } else if (mode.bypass && mode.ready) {
        readableCode = 'READY_BYPASS';
      } else if (mode.ready) {
        readableCode = 'READY';
      } else if (mode.armed_stay) {
        // The text message from panel is used to determine if the panel is in might node.
        if (extraInfo.includes('NIGHT-STAY')) readableCode = 'ARMED_NIGHT';
        else readableCode = 'ARMED_STAY';
      } else if (mode.armed_away) {
        readableCode = 'ARMED_AWAY';
      } else if (mode.armed_zero_entry_delay) {
        readableCode = 'ARMED_NIGHT';
      } else if (mode.bypass && !mode.ready) {
        readableCode = 'NOT_READY_BYPASS';
      } else if (mode.not_used2 && mode.not_used3) {
        readableCode = 'NOT_READY';
      } // added to handle 'Hit * for faults'
      return readableCode;
    }

    function updateKeypad(tpi, data) {

      var partition = data[1]; // one byte field indicating which partition the update applies to.
      // ICON bit field is as follows:
      // 15: ARMED STAY
      // 14: LOW BATTERY
      // 13: FIRE
      // 12: READY
      // 11: not used
      // 10: not used
      // 09: CHECK ICON - SYSTEM TROUBLE
      // 08: ALARM (FIRE ZONE)
      // 07: ARMED (ZERO ENTRY DELAY)
      // 06: not used
      // 05: CHIME
      // 04: BYPASS (Zones are bypassed)
      // 03: AC PRESENT
      // 02: ARMED AWAY
      // 01: ALARM IN MEMORY
      // 00: ALARM (System is in Alarm)
      var ICON = data[2]; //two byte, HEX, representation of the bitfield.
      var keypadledstatus = getKeyPadLedStatus(data[2]);
      var userOrZone = data[3]; // one byte field, representing extra info, either the user or the zone.
      var beep = tpidefs.virtual_keypad_beep[data[4]]; // information for the keypad on how to beep.
      var keypad_txt = data[5]; // 32 byte ascii string, a concat of 16 byte top and 16 byte bottom of display
      var icon_array = [];
      var position = 0; // Start at the right most position, Little endian 0.
      var mode = keyPadToHumanReadable(keypadledstatus, keypad_txt);
      
      // This loop, take a two byte hex string, and for every bit set to one in the HEX string
      // adds an element to an array indicating the position of the bit set to one... LittleEndian.
      for (var n = parseInt(ICON, 16); n > 0; n = n >> 1) {
        if ((n & 0x01) == 1) { // is the right most bit a 1?
          icon_array.push(position);
        }
        position++;
      }


      self.alarmSystemMode = mode;
      // Update zone information timer. 
      // Depending on the state of the update it will either represent a zone, or a user.
      // module makes assumption, if system is not-ready and panel text display "FAULT" assume zone is in fault.
      
      if ((mode.substring(0, 9) == 'NOT_READY') && (keypad_txt.includes('FAULT')))
      {    
        zoneTimerOpen(tpi, userOrZone);
      }
      // Check for a monitored zone
      if ((mode.substring(0, 9) == 'NOT_READY') && (keypad_txt.includes('CHECK')))
      {    
        zoneTimerOpen(tpi, userOrZone, "check.");
      }
      // System generate battery low event 
      if((keypadledstatus.low_battery) && (keypad_txt.includes('LOBAT')))
      {
        zoneTimerOpen(tpi, userOrZone, "lowbatt.");
      }

      // bypass event reported to keypad
      if((keypad_txt.substring(0, 5) == 'BYPAS') && (!keypadledstatus.not_used2) && ((mode == 'NOT_READY_BYPASS') || (mode == 'READY_BYPASS'))) 
      {
        zoneTimerOpen(tpi, userOrZone, "bypassed.");
      }

      // Generate event to update to update status 
      self.emit('keypadupdate', {
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
      
    }

    function zoneTimeToHumanReadable(duration) {
      var hours = Math.floor(duration / 60 / 60);
      var minutes = Math.floor(duration / 60) - (hours * 60);
      var seconds = duration % 60; 
      return hours.toString().padStart(2, '0') + 'h:' + minutes.toString().padStart(2, '0') + 'm:' + seconds.toString().padStart(2, '0') +'s';
    }

    function zoneTimerDump(tpi, data) {
      // Raw zone timers used inside the Envisalink.
      // The dump is a 256 character packed HEX string representing 64 UINT16
      // (little endian) zone timers. Zone timers count down from 0xFFFF (zone is open) 
      // to 0x0000 (zone is closed too long ago to remember). Each “tick” of he zone time 
      // is actually 5 seconds so a zone timer of 0xFFFE means “5
      // seconds ago”. Remember, the zone timers are LITTLE ENDIAN so the
      // above example would be transmitted as FEFF.
      const MAXINT = 65536;
      var zone_time = Date.now();
      var zonenum = 0;
      var aHexStringInt = data[1];
      var swappedBits = [];
      var zonesDumpData = []; // Array to store zone information from zone dump
      var leZoneTimerDumpHexStr; // zone timers in LITTLE ENDIAN
      var zoneClosedTimeCountDown;
      var byte;
      for (var i = 0; i < aHexStringInt.length; i = i + 4) { // work from left to right, one byte at a time.
          byte = aHexStringInt.substr(i, 4); // get the two character hex byte value into an int
          zonenum += 1; // Current zone number
          // swap bits to get actual time
          swappedBits = [];
          swappedBits = byte.substr(2, 4);
          swappedBits += byte.substr(0, 2);
          leZoneTimerDumpHexStr += swappedBits;
          zoneClosedTimeCountDown = (MAXINT - parseInt(swappedBits.toString(),16)) * 5; 
          if (swappedBits == "FFFF")
          {
            zonesDumpData.push({
                  zone: zonenum,
                  zonestatus: 'open',
                  ClosedTimeCount: 0,
                  zone_txt: 'Currently Open'
            });

            // Track of zone status
            zoneTimerOpen(tpi, zonenum);
          }
          if (swappedBits == "0000")
            {
              zonesDumpData.push({
                    zone: zonenum,
                    zonestatus: 'close',
                    ClosedTimeCount: MAXINT,
                    zone_txt: 'Last Closed longer than I can remember'
                });
            }
            else {
              zonesDumpData.push({
                  zone: zonenum,
                  zonestatus: 'close',
                  ClosedTimeCount: zoneClosedTimeCountDown,
                  zone_txt: "Last Closed " + zoneTimeToHumanReadable(zoneClosedTimeCountDown)
              });
            }
      }
      self.emit('zonetimerdump', {
        zonedump: zone_time,
        status: tpi.name,
        zoneTimerStatus: zonesDumpData,
        zoneHexData: leZoneTimerDumpHexStr
      });
    }

    function cidEvent(tpi, data) {
      // When a system event happens that is signaled to either the Envisalerts servers or the central monitoring station, 
      // it is also presented through this command. The CID event differs from other TPI 
      // commands as it is a binary coded decimal, not HEX.
      // QXXXPPZZZ0
      // Where:
      // Q = Qualifier. 1 = Event, 3 = Restore
      // XXX = 3 digit CID code
      // PP = 2 digit Partition
      // ZZZ = Zone or User (depends on CID code) 0 = Always 0 (padding)
      // NOTE: The CID event Codes are ContactID codes. Lists of these codes are widely available but will not be reproduced here.
      // Example: 3441010020
      // 3 = Restore (Closing in this case) 441 = Armed in STAY mode
      // 01 = Partition 1
      // 002 = User 2 did it
      // 0 = Always 0
      var qualifier_description;
      var cid = data[1];
      var qualifier = cid.substr(0, 1);
      if (qualifier == 1) { // Event
        qualifier_description = "event";
      } else if (qualifier == 3) { // Restore
        qualifier_description = "restore";
      } else { // Unknown Qualifier!!
        self.log.error(`EnvisaLink: Unrecognized qualifier: ${qualifier} received from Panel!`);
        return undefined;
      }
      var code = cid.substr(1, 3);
      var partition = cid.substr(4, 2);
      var zone_or_user = cid.substr(6, 3);
      var cid_obj = ciddefs.cid_events_def[code];
      
      var cidupdate_object = {
        partition: partition,
        qualifier: qualifier,
        qualifier_description: qualifier_description,
        code: code,
        type: cid_obj.type,
        subject: cid_obj.label,
        status: tpi.name
      };
      cidupdate_object[cid_obj.type] = zone_or_user;
      self.emit('cidupdate', cidupdate_object);
    }
  }

/**
 * Terminates the current TPI session with the EnvisaLink module
 * Cleanly closes the socket connection if it exists and is not already destroyed
 * 
 * @returns {boolean} - True if connection was successfully terminated, false if already closed
 */
  endSession() {
    // Is connected terminate the connection.
    if (tpiserverSocket && !tpiserverSocket.destroyed) {
      tpiserverSocket.end();
      return true;
    } else {
      return false;
    }
  }

/**
 * Sends a command string to the EnvisaLink TPI interface
 * Automatically appends carriage return and line feed to the command
 * Respects maintenance mode and validates connection before sending
 * 
 * @param {string} command - The command string to send to the panel
 * @returns {boolean} - True if command was sent successfully, false otherwise
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
 * Requests a dump of all zone timers from the EnvisaLink module
 * Uses TPI command 02 to retrieve the raw zone timer data
 * Zone timers show how long ago each zone was last opened/closed
 * Response will be received via 'zonetimerdump' event
 * 
 * @returns {void}
 */
  getZonesTimers() {
    var to_send = '^02,$';
    this.lastsentcommand = "02";
    this.sendCommand(to_send);
  }

/**
 * Retrieves the list of currently bypassed zones from the alarm panel
 * Uses keypad command sequence (PIN + 6) to display bypassed zones
 * Only executes if system is in a bypass state (NOT_READY_BYPASS or READY_BYPASS)
 * The bypassed zones will be displayed on the virtual keypad
 * 
 * @param {string} pin - The user PIN code to authenticate the request
 * @returns {void}
 */
  getBypassedZones(pin) {
    // Request panel to list all bypass panel. Check to see if any zone is bypass, if so request panel to output using virtual keypad.
    if ((this.alarmSystemMode == 'NOT_READY_BYPASS') || (this.alarmSystemMode == 'READY_BYPASS')) {
      var to_send = pin + '6';
      this.lastsentcommand = "6";
      this.sendCommand(to_send);
    }
  }

/**
 * Changes the active partition on the EnvisaLink module
 * Uses TPI command 01 to switch between partitions
 * Validates partition number is within valid range (0 to MAXPARTITIONS-1)
 * 
 * @param {number} partitionNumber - The partition number to switch to (0-15)
 * @returns {void}
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
 * Sends a keypad command string to a specific partition
 * Uses TPI command 03 to send virtual keypad key presses
 * Validates partition number is within valid range (0 to MAXPARTITIONS-1)
 * Command can be any valid keypad sequence (numbers, *, #, function keys)
 * 
 * @param {number} partitionNumber - The target partition number (0-15)
 * @param {string} command - The keypad command string to send
 * @returns {void}
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
 * Synchronizes the Ademco alarm panel's time and date with the host computer time
 * Uses keypad keystrokes to navigate the programming menu and set time/date
 * Sequence: *6 + INSTALLER_CODE + 13 + HHMMMMDDYY + #
 * Where:
 * HH = Hours (00-23)
 * MM = Minutes (00-59)
 * MM = Month (01-12)
 * DD = Day (01-31)
 * YY = Year (00-99)
 * 
 * @param {string} programmerCode - The installer or Master code (typically 4 digits, default 4112)
 * @param {number} partitionNumber - The partition number to sync (default: 1)
 * @returns {boolean} - True if command sequence started successfully, false otherwise
 */
  async syncAlarmDateTime(programmerCode = '4112', partitionNumber = 1) {
    const self = this;
    
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

    // Get current date and time
    const now = new Date();
    
    // Format time components
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0'); // getMonth() is 0-indexed
    const day = now.getDate().toString().padStart(2, '0');
    const year = now.getFullYear().toString().substr(-2);
    
    // Build the time/date string: HHMMMMDDYY (no day of week for *20 entry)
    const timeString = hours + minutes + month + day + year;
    
    this.log.info(`Syncing alarm panel time to: ${now.toLocaleString()}`);
    this.log.debug(`Time string to send: ${timeString}`);
    
    // Helper function to send keystroke with delay
    const sendKeystroke = (keys, delayMs = 300) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          self.sendCommand(keys);
          resolve();
        }, delayMs);
      });
    };

    try {
      // Step 1: Enter programming mode (*6 + installer code)
      await sendKeystroke('*6' + programmerCode, 100);
      this.log.debug('Enter programming mode');
      
      // Step 2: Navigate to field *20 (time and date programming)
      await sendKeystroke('*20', 800);
      this.log.debug('Navigated to time/date field (*20)');
      
      // Step 3: Enter the time and date (HHMMMMDDYY)
      await sendKeystroke(timeString, 800);
      this.log.debug('Entered time/date string');
      
      // Step 4: Press # to save and exit programming
      await sendKeystroke('#', 800);
      this.log.debug('Pressed # to save');
      
      // Step 5: Press # again to exit programming mode completely
      await sendKeystroke('#', 500);
      this.log.info('Time sync sequence completed');
      
      return true;
    } catch (error) {
      this.log.error('Error during time sync sequence:', error);
      // Try to exit programming mode
      await sendKeystroke('##', 100);
      return false;
    }
  }

/**
 * Convenience method to sync time for partition 1 with default installer code
 * @param {string} programmerCode - The installer or Master code (default: 4112)
 * @returns {Promise<boolean>} - True if command was sent successfully, false otherwise
 */
  async syncDateTime(programmerCode = '4112') {
    return await this.syncAlarmDateTime(programmerCode, 1);
  }

/**
 * Reads the current time and date from the alarm panel keypad display
 * Uses keypad keystrokes to navigate to field *20 and read the display
 * Sequence: *6 + INSTALLER_CODE + 20
 * The panel will display current time/date which can be read from keypad updates
 * 
 * @param {string} programmerCode - The installer or Master code (typically 4 digits, default 4112)
 * @param {number} partitionNumber - The partition number to query (default: 1)
 * @returns {Promise<boolean>} - True if command was sent successfully, false otherwise
 */
  async getAlarmDateTime(programmerCode = '4112', partitionNumber = 1) {
    const self = this;
    
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

  // Helper function to send keystroke with delay
  const sendKeystroke = (keys, delayMs = 300) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        self.sendCommand(keys);
        resolve();
      }, delayMs);
    });
  };

  try {
    this.log.info('Requesting current alarm panel time from keypad...');
    
    // Step 1: Enter programming mode (*6 + installer code)
    await sendKeystroke('*6' + programmerCode, 100);
    this.log.debug('Enter programming mode');
    
    // Step 2: Navigate to field *20 (time and date programming)
    // The panel will display the current time on the keypad
    await sendKeystroke('*20', 800);
    this.log.debug('Navigated to time/date field (*20) - check keypad display');
    
    // Step 3: Exit programming mode without changes
    await sendKeystroke('##', 500);
    this.log.info('Exited programming mode - time displayed on keypad');
    
    return true;
  } catch (error) {
    this.log.error('Error during get time sequence:', error);
    // Try to exit programming mode
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
//        // Connection restored - wait a bit then sync
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
