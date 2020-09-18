// 'use strict'
var net = require('net')
var EventEmitter = require('events').EventEmitter;
var util = require('util')
var tpidefs = require('./tpi.js')
var ciddefs = require('./cid.js')
var utilfunc = require('./helper.js')
var actual;
var activezones = [];
var activeZoneTimeOut = undefined;


class EnvisaLink {

  constructor(log, config) {
    EventEmitter.call(this);
    this.log = log;
    this.options = {
      host: config.host,
      port: config.port ? config.port : 4025,
      password: config.password ? config.password : "user",
      zones: config.panelzones ? config.panelzones : 64,
      partitions: config.panelpartition ? config.panelpartition : 1,
      autoreconnect: config.autoreconnect ? config.autoreconnect : true,
    };
    this.zones = {};
    this.options.heartbeatInterval = utilfunc.toIntBetween(config.heartbeatInterval, 10, 120, 30);
    this.options.openZoneTimeout = utilfunc.toIntBetween(config.openZoneTimeout, 5, 120, 30);
    this.lastmessage = new Date();

    this.log(this.options.heartbeatInterval);
    this.log(this.options.openZoneTimeout);
  }

  
  connect() {
    var _this = this;
    this.partitions = {};
    this.users = {};
    this.shouldReconnect = this.options.autoreconnect;
    this.cid = {};
    this.IsConnected = false;
    this.lastmessage = new Date();
    this.isConnectionIdleHandle = undefined;

    actual = net.createConnection({
      port: this.options.port,
      host: this.options.host
    });

    actual.on('error', function (ex) {
      _this.log.error(ex);
    });

    actual.on('close', function (hadError) {
      _this.IsConnected = false;
      if (_this.isConnectionIdleHandle !== undefined) 
      {
         clearTimeout(_this.isConnectionIdleHandle);
      }
      setTimeout(function () {
        if (_this.shouldReconnect && (actual === undefined || actual.destroyed)) {
          _this.log.warn("Session closed unexpectedly. Re-establishing Session...");
          _this.connect();
        }
      }, 5000);
    });

    actual.on('end', function () {
      _this.log.debug("Envisalink received end request, disconnecting");
      _this.log('Disconnect TPI session');
      clearTimeout(_this.isConnectionIdleHandle);
      _this.IsConnected = false;
    });

    actual.on('data', function (data) {
      var dataslice = data.toString().replace(/[\n\r]/g, '|').split('|');
      _this.lastmessage = new Date(); // Everytime a message comes in, reset the lastmessage timer

      for (var i = 0; i < dataslice.length; i++) {
        var datapacket = dataslice[i];
        if (datapacket !== '') {
          if (datapacket.substring(0, 5) === 'Login') {
            _this.log.debug("Login requested. Sending response " + _this.options.password)
            _this.IsConnected = true;
            _this.sendCommand(_this.options.password);
          } else if ((datapacket.substring(0, 6) === 'FAILED') || (datapacket.substring(0, 9) === 'Timed Out')) {
            _this.log.error("Login failed.");
            // The session will be closed.
            _this.IsConnected = false;
          } else if (datapacket.substring(0, 2) === 'OK') {
            // ignore, OK is good. or report successful connection.    
            _this.log('Successful TPI session established');
            _this.isConnectionIdleHandle = setTimeout( isConnectionIdle, (_this.options.heartbeatInterval * 1000) ); // Check every idle seconds...

          } else {
            var command_str = datapacket.match(/^%(.+)\$/); // pull out everything between the % and $
            if (command_str == null) {
              _this.log.error("Command format invalid! command='" + datapacket + "'");
            } else {

              var command_array = command_str[1].split(','); // Element number 1 should be what was matched between the () in the above match. so everything between % and $
              var command = command_array[0]; // The first part is the command.
              var tpi = tpidefs.tpicommands[command];
              if (tpi) {
                if (tpi.bytes === '' || tpi.bytes === 0) {
                  _this.log.warn(tpi.pre + ' - ' + tpi.post);
                } else {
                  _this.log.debug(tpi.pre + ' | ' + command_str + ' | ' + tpi.post)
                  switch (tpi.action) {
                    case 'updatezone':
                      updateZone(tpi, command_array);
                      break;
                    case 'updatepartition':
                      updatePartition(tpi, command_array);
                      break;
                    case 'updatekeypad':
                      updateKeypad(tpi, command_array);
                      break;
                    case 'cidEvent':
                      cidEvent(tpi, command_array);
                      break;
                    case 'zonetimerdump':
                      zoneTimerDump(tpi, command_array);
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
      // we didn't receive any messages for greater than heartbeatInterval seconds. Assume dropped  and re-connect.
      clearTimeout(_this.isConnectionIdleHandle);
      var nowDate = new Date()
      var deltaTime = (nowDate.getTime() -_this.lastmessage.getTime());

      _this.log.debug("Checking for Heartbeat...")

     if (deltaTime > (_this.options.heartbeatInterval * 1000)) {
        _this.log.warn("Missing Heartbeat: Trying to re-connect session...");
        _this.disconnect();
        setTimeout(function () {_this.connect()}, 5000);
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
      var initialUpdate; // this isn't good. After the for each, initialUpdate will be the value of the last one... 

      zone_array.forEach(function (z, i, a) {
        z_list.push(z);
        initialUpdate = _this.zones[z] === undefined;
        _this.zones[z] = {
          send: tpi.send,
          name: tpi.name,
          code: z
        };
        zoneTimerOpen(tpi, z);
      });
      _this.emit('zoneupdate', {
        zone: z_list,
        code: data[0],
        status: tpi.name,
        initialUpdate: initialUpdate
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
        if (partition <= _this.options.partitions) {
          var mode = modeToHumanReadable(byte);
          var initialUpdate = _this.partitions[partition] === undefined;
          _this.partitions[partition] = {
            send: tpi.send,
            name: tpi.name,
            code: {
              "partition": partition,
              "value": mode
            }
          };
          _this.emit('updatepartition', {
            partition: partition,
            mode: mode,
            code: byte,
            status: tpi.name,
            initialUpdate: initialUpdate
          });
        }
      }
    }

    function findZone(zonelist, zone) {

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

    function zoneTimerOpen(tpi, zone) {
      var mode = "OPEN";
      var triggerZoneEvent = false;
      var zoneid = findZone(activezones, zone);
      if (Number.isInteger(zoneid)) {
        _this.log.debug("Zone found in active zone list index - ", zoneid);
        activezones[zoneid].eventepoch = Math.floor(Date.now() / 1000);
      } else {
        _this.log.debug("Adding new zone - ", zone);
        activezones.push({
          zone: zone,
          eventepoch: Math.floor(Date.now() / 1000)
        });
        triggerZoneEvent = true;
      }

      if (activezones.length > 0) {
        if (activeZoneTimeOut == undefined) {
          _this.log.debug("Activating zone timer");
          activeZoneTimeOut = setTimeout(zoneTimeOut, _this.options.openZoneTimeout * 1000);
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

    function zoneTimeOut() {
      var mode = "CLOSE";
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
        activeZoneTimeOut = setTimeout(zoneTimeOut, minZoneTime * 1000);
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
      } else if (mode.system_trouble) {
        readableCode = 'NOT_READY_TROUBLE';
      } else if (mode.bypass && mode.armed_stay) {
        readableCode = 'ARMED_STAY_BYPASS';
      } else if (mode.bypass && mode.armed_away) {
        readableCode = 'ARMED_AWAY_BYPASS';
      } else if (mode.bypass && mode.armed_zero_entry_delay) {
        readableCode = 'ARMED_NIGHT_BYPASS';
      } else if (mode.bypass) {
        readableCode = 'READY_BYPASS';
      } else if (mode.ready) {
        readableCode = 'READY';
      } else if (mode.armed_stay) {
        readableCode = 'ARMED_STAY';
      } else if (mode.armed_away) {
        readableCode = 'ARMED_AWAY';
      } else if (mode.armed_zero_entry_delay) {
        readableCode = 'ARMED_NIGHT';
      } else if (mode.not_used2 && mode.not_used3) {
        readableCode = 'NOT_READY';
      } // added to handle 'Hit * for faults'
      return readableCode;
    }

    function updateKeypad(tpi, data) {

      var partition = data[1]; // one byte field indicating which partition the update applies to.
      var initialUpdate = _this.partitions[partition] === undefined;
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
      var zone = data[3]; // one byte field, representing extra info, either the user or the zone.
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

      if (partition <= _this.options.partitions) {
        var initialUpdate = _this.partitions[partition] === undefined;
        _this.partitions[partition] = {
          send: tpi.send,
          name: tpi.name,
          code: data
        };

        // update zone information
        if (mode != 'READY') {
          zoneTimerOpen(tpi, zone);
        }

        _this.emit('keypadupdate', {
          partition: partition,
          code: {
            icon: icon_array,
            zone: zone,
            beep: beep,
            txt: keypad_txt
          },
          status: tpi.name,
          keypadledstatus: keypadledstatus,
          mode: mode,
          initialUpdate: initialUpdate
        });
      }
    }

    function zoneTimerDump(tpi, data) {
      // Raw zone timers used inside the Envisalink.
      // The dump is a 256 character packed HEX string representing 64 UINT16
      // (little endian) zone timers. Zone timers count down from 0xFFFF (zone is open) 
      // to 0x0000 (zone is closed too long ago to remember). Each “tick” of he zone time 
      // is actually 5 seconds so a zone timer of 0xFFFE means “5
      // seconds ago”. Remember, the zone timers are LITTLE ENDIAN so the
      // above example would be transmitted as FEFF.

      var zone_bits = data[1];
      var swappedBit = [];
      var zone_time = [];
      var byte;
      var timer;

      var initialUpdate = undefined;

      for (var i = 0; i < zone_bits.length; i = i + 4) { // work from left to right, one byte at a time.
        byte = zone_bits.substr(i, 4); // get the two character hex byte value into an int

        // swapbits to get actual time
        swappedBit = [];
        swappedBit = byte.substr(2, 4);
        swappedBit += byte.substr(1, 2);
        // Determine how much mins since last event
        timer = Math.floor(5 / 60);

        if (swappedBit != "0000") {
          timer = (parseInt('FFFF', 16) - parseInt(swappedBit, 16));
          zone_time.push(Math.floor((timer * 5) / 60));
        } else
          zone_time.push(0);
      }

      _this.emit('zoneTimerDump', {
        zonedump: zone_time,
        status: tpi.name,
        initialUpdate: initialUpdate
      });
    }

    function cidEvent(tpi, data) {
      var cid = data[1];
      var qualifier = cid.substr(0, 1);
      if (qualifier == 1) { // Event
        qualifier = "Event";
      } else if (qualifier == 3) { // Restoral
        qualifier = "Restoral";
      } else { // Unknown Qualifier!!
        this.log.error('log-error: ', " Unrecognized qualifier '" + qualifier + "' received from Panel!");
        return undefined;
      }
      var code = cid.substr(1, 3);
      var partition = cid.substr(4, 2);
      var zone_or_user = cid.substr(6, 3);
      var cid_obj = ciddefs.cid_event_def[code];
      var initialUpdate = _this.cid === undefined;
      _this.cid = {
        send: tpi.send,
        name: tpi.name,
        code: cid,
        qualifier: qualifier,
        code: code,
        type: cid_obj.type,
        subject: cid_obj.msg_subject,
        partition: partition
      };
      var an_object = {
        qualifier: qualifier,
        code: cid,
        partition: partition,
        type: cid_obj.type,
        subject: cid_obj.msg_subject,
        description: cid_obj.txt,
        status: tpi.name,
        initialUpdate: initialUpdate
      };
      an_object[cid_obj.type] = zone_or_user;
      _this.emit('cidupdate', an_object);
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (actual && !actual.destroyed && this.IsConnected) {
      actual.end();
      return false;
    } else {
      return true;
    }
  }

  sendCommand(command) {
    if (actual && !actual.destroyed && this.IsConnected) {
      actual.write(command + '\r\n');
    } else {
      this.log.error('Command not successful, no TPI session established.');
    }
  }
}

util.inherits(EnvisaLink, EventEmitter)
module.exports = EnvisaLink