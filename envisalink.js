// 'use strict'
const MAXPARTITIONS = 16;
const MAXZONES = 128;
const MAXALARMUSERS = 47;
var net = require('net')
var EventEmitter = require('events');
var tpidefs = require('./tpi.js')
var ciddefs = require('./cid.js')
var actual;
var activezones = [];
var activeZoneTimeOut = undefined;
var inTrouble = false;



class EnvisaLink extends EventEmitter {
  
  constructor(log, config) {
    super();
    this.log = log;
    this.options = {
      host: config.host,
      port: config.port ? config.port : 4025,
      password: config.password ? config.password : "user",
    };

    if (config.autoReconnect == undefined)
      this.options.autoreconnect = true;
    else
      this.options.autoreconnect = config.autoReconnect;

    if (config.sessionWatcher == undefined)
      this.options.sessionwatcher = true;
    else
      this.options.sessionwatcher = config.sessionWatcher;

    // are we in maintanance mode?
    this.isMaintenanceMode = config.maintenanceMode ? config.maintenanceMode: false

    // Set interval for testing connection and how long should zone should be consider without any update.
    this.options.heartbeatInterval = Math.min(600,Math.max(10,config.heartbeatInterval));  
    this.options.openZoneTimeout = Math.min(120,Math.max(5,config.openZoneTimeout));  
    
    this.zones = {};
    this.lastmessage = new Date();
    this.lastsentcommand = "";

  }

  
  startSession() {
    var _this = this;
    this.shouldReconnect = this.options.autoreconnect;
    this.IsConnected = false;
    this.lastmessage = new Date();
    this.isConnectionIdleHandle = undefined;

    // Display starting of connection.
    this.log.info(`Starting connection to envisalink module at: ${this.options.host}, port: ${this.options.port}`);
   
    actual = net.createConnection({
      port: this.options.port,
      host: this.options.host
    });


    actual.on('error', function (ex) {
      _this.log.error("EnvisaLink: ", ex);
    });

    actual.on('close', function (hadError) {
      _this.IsConnected = false;
      var source = "session_connect_status";
      if (_this.isConnectionIdleHandle !== undefined) 
      {
         clearTimeout(_this.isConnectionIdleHandle);
      }
      setTimeout(function () {
        if (_this.shouldReconnect && (actual === undefined || actual.destroyed)) {
          _this.log.warn("Session closed unexpectedly. Re-establishing Session...");
          // Generate event to indicate there is issue with EVL module connection
          //  Qualifier. 1 = Event, 3 = Restoral
          if (!inTrouble)
          {
            _this.emit('envisalinkupdate', {
              source: source,
              qualifier: 1
            });
            inTrouble = true;
          }
          _this.startSession();
        }
      }, 5000);
    });

    actual.on('end', function () {
      _this.log.debug("Envisalink received end request, disconnecting");
      _this.log.info('Disconnect TPI session');
      clearTimeout(_this.isConnectionIdleHandle);
      _this.IsConnected = false;
    });

    actual.on('data', function (data) {
      var dataslice = data.toString().replace(/[\n\r]/g, '|').split('|');
      var source = "session_connect_status";
      _this.lastmessage = new Date(); // Everytime a message comes in, reset the lastmessage timer
      for (var i = 0; i < dataslice.length; i++) {
        var datapacket = dataslice[i];
        if (datapacket !== '') {
          
          if (datapacket.substring(0, 5) === 'Login') {
            _this.log.debug("Login requested. Sending response " + _this.options.password)
            _this.IsConnected = true;
            _this.sendCommand(_this.options.password);
          } else if ((datapacket.substring(0, 6) === 'FAILED') || (datapacket.substring(0, 9) === 'Timed Out')) {
            _this.log.error("EnvisaLink: Login failed.");
            // The session will be closed.
            _this.IsConnected = false;
          } else if (datapacket.substring(0, 2) === 'OK') {
            // ignore, OK is good. or report successful connection.    
            _this.log.info(`Successful TPI session established.`);
            // If connection had issue prior clear and generate restoral event
            //  Qualifier. 1 = Event, 3 = Restoral
            if (inTrouble)
            {
              _this.emit('envisalinkupdate', {
                source: source,
                qualifier: 3
              });
              inTrouble = false;
            }
            // Determine if option to monitor connection is enabled.
            if(_this.shouldReconnect && _this.options.sessionwatcher)
            {
              _this.log.info(`Checking for disconnected session every: ${_this.options.heartbeatInterval} seconds.`)
              _this.isConnectionIdleHandle = setTimeout( isConnectionIdle, (_this.options.heartbeatInterval * 1000) ); // Check every idle seconds...
            }
            else  
            {
             _this.log.warn("Warning: Session monitoring is disabled. Envisalink-Ademco will not watch for hung sessions.") 
            }
          } else {
            var tpi_str = datapacket.match(/^%(.+)\$/); // pull out everything between the % and $
            if (tpi_str == null) {
              tpi_str = datapacket.match(/\^(.+)\$/); // module command string, could be result of previous command  pull out everything between the ^ sand $.
              if (tpi_str == null)
              {
                _this.log.warn("Envisalink data steam format invalid! : '" + datapacket + "'");
              }  
              else
              {
                if(_this.lastsentcommand == tpi_str[1].split(',')[0]) 
                  _this.log.info(`Envisakit module command return: ${tpidefs.command_response_codes[tpi_str[1].split(',')[1]]}`);
              }

            } else {
              var data_array = tpi_str[1].split(','); // Element number 1 should be what was matched between the () in the above match. so everything between % and $
              var command = data_array[0]; // The first part is the command.
              var tpi = tpidefs.tpicommands[command];
              if (tpi) {
                if (tpi.bytes === '' || tpi.bytes === 0) {
                  _this.log.warn(tpi.pre + ' - ' + tpi.post);
                } else {
                  _this.log.debug(tpi.pre + ' | ' + tpi_str + ' | ' + tpi.post)
                  _this.log.debug('Envisakit Operation: ' + tpi.action);
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
      clearTimeout(_this.isConnectionIdleHandle);
      var nowDate = new Date();
      var deltaTime = Math.abs(nowDate.getTime() -_this.lastmessage.getTime()) / 1000;

      // Was there traffic in allocated timeframe?
      _this.log.debug("Checking for Heartbeat...");
     if (deltaTime > (_this.options.heartbeatInterval)) {
        _this.log.warn("Missing Heartbeat - Time drift: ", deltaTime ,". Trying to re-connect session...");
        _this.endSession();
       // Generate event to indicate there is issue with EVL module connection
        setTimeout(function () {_this.startSession()}, 5000);
      } else {
        // Connection not idle. Check again connection idle time seconds...
        _this.log.debug("Heartbeat successful. Last message time: " + _this.lastmessage)
        _this.isConnectionIdleHandle = setTimeout(isConnectionIdle, (_this.options.heartbeatInterval * 1000)); 
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
      // _this.log.debug("Starting zone_bits for loop zone_bits='" + zone_bits +"'");
      var zone_array = []; // Define/initialize zone_array.
      for (var i = 0; i < zone_bits.length; i = i + 2) { // work from left to right, one byte at a time.
        var byte = parseInt(zone_bits.substr(i, 2), 16); // get the two character hex byte value into an int


        // sinze it's a byte, increment position by 8 bits, but since we're incrementing i by 2. for a 1 byte hex. 
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
        // _this.log.debug( "zone_bits for loop enter subloop position="+ position +" byte='"+ byte +"' byte-original='"+ zone_bits.substr(i, 2) +"' i="+ i);
        for (var n = byte; n > 0; n = n >> 1) {
          if ((n & 0x01) == 1) { // is the right most bit a 1?
            zone_array.push(position);
          }
          position++;
        }
      }
      _this.log.debug("Zone updated");
      var z_list = [];

      zone_array.forEach(function (z, i, a) {
        z_list.push(z);
        _this.zones[z] = {
          send: tpi.send,
          name: tpi.name,
          code: z
        };
        zoneTimerOpen(tpi, z, "open");
      });
      _this.emit('zoneupdate', {
        zone: z_list,
        code: data[0],
        status: tpi.name
      });

    }

    function updatePartition(tpi, data) {
      // Unlike the code below, this Ademco pannel sends a array of bytes each one representing a partition and it's state. 
      // Example:
      // 0100010000000000
      // so in the example above out of 8 partitions, partitions 1 and 3 are in state READY. 
      // There is a table you can refer to in section 3.4 of EnvisaLink  Vista TPI programmer's document that lists
      // the different values possible for each byte.
      var partition_string = data[1];

      for (var i = 0; i < partition_string.length; i = i + 2) { // Start at the begining, and move up two bytes at a time.
        var byte = parseInt(partition_string.substr(i, 2), 10); // convert hex (base 10) to int.
        var partition = (i / 2) + 1;
        var mode = modeToHumanReadable(byte);
        _this.emit('updatepartition', {
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
        if (zone == zonelist[i].zone) {
          _this.log.debug("Found zone - ", zone);
          return i;
        }
      }
      // return undefined if not found
      _this.log.debug("Not Found zone - ", zone);
      return undefined;
    }

    function zoneTimerOpen(tpi, zone, mode) {
      
      var triggerZoneEvent = false;
      var zoneid = findZone(activezones, zone);
      if (Number.isInteger(zoneid)) {
        _this.log.debug("Zone found in active zone list index - ", zoneid);
        activezones[zoneid].eventepoch = Math.floor(Date.now() / 1000);
      } else {
        if (mode == "open")
        {
          _this.log.debug("Adding new zone - ", zone);
          activezones.push({
            zone: zone,
            eventepoch: Math.floor(Date.now() / 1000)
          });
          triggerZoneEvent = true;
        }
      }

      if (activezones.length > 0) {
        if (activeZoneTimeOut == undefined) {
          _this.log.debug("Activating zone timer");
          activeZoneTimeOut = setTimeout(zoneTimerClose, _this.options.openZoneTimeout * 1000);
        }
      }

      if (triggerZoneEvent == true) {
        _this.emit('zoneevent', {
          zone: [parseInt(zone, 10)],
          mode: mode,
          source: tpi.name
        });
      }
    }

    function zoneTimerClose() {
      var mode = "close";
      var z_close = [];
      var z = activezones.length;
      var l_zonetimeout = _this.options.openZoneTimeout;
      var minZoneTime = l_zonetimeout;
      var currZoneTime = l_zonetimeout;

      if (activeZoneTimeOut) clearTimeout(activeZoneTimeOut);
      while (z--) {
        // determine if zone hasn't been reported for the allocated time in sec, if so mark as close
        currZoneTime = Math.floor(Date.now() / 1000) - activezones[z].eventepoch;
        if (currZoneTime >= l_zonetimeout) {
          z_close.push(parseInt(activezones[z].zone));
          // remove from active list
          activezones.splice(z, 1);
        } else {
          // Is this entry the smallest time interval in the list?
          currZoneTime = l_zonetimeout - currZoneTime;
          if (minZoneTime > currZoneTime) minZoneTime = currZoneTime;
        }
      }
      if (z_close.length > 0) {
        // zones that are now closed
        _this.emit('zoneevent', {
          zone: z_close,
          mode: mode,
          source: "Zone Time Out"
        });

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

    function keyPadToHumanReadable(mode) {
      var readableCode = 'NOT_READY';
      if (mode.alarm || mode.alarm_fire_zone || mode.fire) {
        readableCode = 'ALARM';
      } else if (mode.alarm_in_memory) {
        readableCode = 'ALARM_MEMORY';
      } else if (mode.system_trouble) {
        readableCode = 'NOT_READY_TROUBLE';
      } else if (mode.bypass && mode.armed_stay) {
        readableCode = 'ARMED_STAY_BYPASS';
      } else if (mode.bypass && mode.armed_away) {
        readableCode = 'ARMED_AWAY_BYPASS';
      } else if (mode.bypass && mode.armed_zero_entry_delay) {
        readableCode = 'ARMED_NIGHT_BYPASS';
      } else if (mode.bypass && mode.ready) {
        readableCode = 'READY_BYPASS';
      } else if (mode.ready) {
        readableCode = 'READY';
      } else if (mode.armed_stay) {
        readableCode = 'ARMED_STAY';
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
      var mode = keyPadToHumanReadable(keypadledstatus);
      var userOrZone = data[3]; // one byte field, representing extra info, either the user or the zone.
      var beep = tpidefs.virtual_keypad_beep[data[4]]; // information for the keypad on how to beep.
      var keypad_txt = data[5]; // 32 byte ascii string, a concat of 16 byte top and 16 byte bottom of display
      var icon_array = [];
      var position = 0; // Start at the right most position, Little endian 0.



      // This loop, take a two byte hex string, and for every bit set to one in the HEX string
      // adds an element to an array indicating the position of the bit set to one... LittleEndian.
      for (var n = parseInt(ICON, 16); n > 0; n = n >> 1) {
        if ((n & 0x01) == 1) { // is the right most bit a 1?
          icon_array.push(position);
        }
        position++;
      }

      // Update zone information timer. 
      // Depending on the state of the update it will either represent a zone, or a user.
      // module makes assumption, if system is not-ready and panel text display "FAULT" assume zone is in fault.
      
      if ((mode == 'NOT_READY') && (keypad_txt.includes('FAULT')))
      {    
        zoneTimerOpen(tpi, userOrZone, "open")  
      }
    
      _this.emit('keypadupdate', {
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
          // swapbits to get actual time
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
            zoneTimerOpen(tpi, zonenum, "open");
          }
          if (swappedBits == "0000")
            {
              zonesDumpData.push({
                    zone: zonenum,
                    zonestatus: 'close',
                    ClosedTimeCount: MAXINT,
                    zone_txt: 'Last Closed longer ago than I can remember'
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
      _this.emit('zonetimerdump', {
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
      // Q = Qualifier. 1 = Event, 3 = Restoral
      // XXX = 3 digit CID code
      // PP = 2 digit Partition
      // ZZZ = Zone or User (depends on CID code) 0 = Always 0 (padding)
      // NOTE: The CID event Codes are ContactID codes. Lists of these codes are widely available but will not be reproduced here.
      // Example: 3441010020
      // 3 = Restoral (Closing in this case) 441 = Armed in STAY mode
      // 01 = Partition 1
      // 002 = User 2 did it
      // 0 = Always 0
      var qualifier_description;
      var cid = data[1];
      var qualifier = cid.substr(0, 1);
      if (qualifier == 1) { // Event
        qualifier_description = "event";
      } else if (qualifier == 3) { // Restoral
        qualifier_description = "restoral";
      } else { // Unknown Qualifier!!
        this.log.error(`EnvisaLink: Unrecognized qualifier: ${qualifier} received from Panel!`);
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
      
      _this.emit('cidupdate', cidupdate_object);
    }
  }

  endSession() {
    // Is connected terminate the connection.
    if (actual && !actual.destroyed && this.IsConnected) {
      actual.end();
      return false;
    } else {
      return true;
    }
  }

  sendCommand(command) {
    if (!this.isMaintenanceMode) {
      if (actual && !actual.destroyed && this.IsConnected) {
        this.log.debug('!WARNING! PIN/CODE may appear in the clear TX >', command);
        actual.write(command + '\r\n');
      } else {
        this.log.error('Envisakit Module: Command not successful, no TPI session established.');
      }
    } else 
      this.log.warn('This module running in maintenance mode, command not send.');
  }

  dumpZoneTimers() {
    var to_send = '^02,$';
    this.lastsentcommand = "02";
    this.sendCommand(to_send);
  }

  changePartition(partitionNumber) {

    if ((partitionNumber > -1) && (partitionNumber < MAXPARTITIONS)) {
      var to_send = '^01,' + partitionNumber.toString() + '$';
      this.lastsentcommand = "01";
      this.sendCommand(to_send);
    }
    else
      this.log.error(`EnvisaLink: Invalid Partition Number ${partitionNumber} specified when trying to change partition, ignoring.`);
  }

  sendCommandToPartition(partitionNumber,command) {
    if ((partitionNumber > -1) && (partitionNumber < MAXPARTITIONS)) {
      var to_send = '^03,' + partitionNumber.toString() + ',' + command.toString() +'$';
      this.lastsentcommand = "03";
      this.sendCommand(to_send);
    }
    else
      this.log.error(`EnvisaLink: Invalid Partition Number ${partitionNumber} specified when trying to change partition, ignoring.`);
    
  }
}
module.exports = EnvisaLink