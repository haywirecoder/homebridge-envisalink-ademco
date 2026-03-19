"use strict";
var tpidefs = require('./../tpi.js');

const ENVISALINK_MANUFACTURER = "Envisacor Technologies Inc."
const SECONDS = 1000;
const ACCESSORIESTIMEOUT = 1000;
const PARTITION_SWITCH_DELAY = 2000; // Partition switch: Long delay
const BYPASS_DELAY = 800;  // Bypass: Medium delay
const DISARM_CLEAR_DELAY = 1200; // Disarm/Clear: Long delay
const STANDARD_KEYSTROKE_DELAY = 400; // Standard keystroke: Short delay
const FINAL_SETTLING_TIME = 500; // Final Settling Time

const SPEED_KEY_PREFIX = "SPEED_KEY_";
const CHARACTERISTICTIMEOUT = 2000; // Time to wait before resetting characteristic to false for momentary switch

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

class EnvisalinkCustomAccessory {
  constructor(log, config, Service, Characteristic, UUIDGen, alarm) {
    this.Characteristic = Characteristic;
    this.Service = Service;
    this.UUIDGen = UUIDGen;
    this.log = log;
    this.name = config.name;
    this.config = config;
    this.customType = config.customType;
    this.accessoryType = "custom";
    this.pin = config.pin;
    this.uuid = UUIDGen.generate(this.config.serialNumber);
    this.alarm = alarm;
    this.envisakitCurrentStatus = false;
    this.delayfactor = config.delayfactor ? config.delayfactor : 1;

    this.ENVISA_BYPASS_TO_HOMEKIT = {
      'NOT_READY': false,
      'NOT_READY_TROUBLE': false,
      'NOT_READY_BYPASS': true,
      'READY_FIRE_TROUBLE': false,
      'READY_SYSTEM_TROUBLE': false,
      'READY': false,
      'READY_BYPASS': true,
      'ARMED_STAY': false,
      'ARMED_STAY_BYPASS': true,
      'ARMED_AWAY': false,
      'ARMED_AWAY_BYPASS': true,
      'ARMED_NIGHT': false,
      'ARMED_NIGHT_BYPASS': true,
      'ALARM': false,
      'ALARM_MEMORY': false,
      'EXIT_DELAY': false
    };
  }
 
  setAccessory(accessory) {
    this.accessory = accessory;
    this.accessory.getService(this.Service.AccessoryInformation)
        .setCharacteristic(this.Characteristic.Manufacturer, ENVISALINK_MANUFACTURER)
        .setCharacteristic(this.Characteristic.Model, this.config.model)
        .setCharacteristic(this.Characteristic.SerialNumber, this.config.serialNumber);
    
    switch (this.customType) {
          case 'chimemode':
            var swServiceChime = this.accessory.getService(this.Service.Switch);
            if(swServiceChime == undefined) swServiceChime = this.accessory.addService(this.Service.Switch); 
            swServiceChime.setCharacteristic(this.Characteristic.On, false);
            swServiceChime.getCharacteristic(this.Characteristic.On)
              .on('get', async callback => this.getChime(callback))
              .on('set', async (state, callback) => this.setChime(state, callback));
            this.envisakitCurrentStatus = false;
            this.commandTimeOut = this.config.commandTimeOut;
            this.isProcessingChimeOnOff = false;
            this.chimeOnOffTimeOut = undefined;
          break;
          case 'bypass':
            var swServiceBypass = this.accessory.getService(this.Service.Switch);
            if(swServiceBypass == undefined) swServiceBypass = this.accessory.addService(this.Service.Switch); 
            swServiceBypass.setCharacteristic(this.Characteristic.On, false);
            swServiceBypass.getCharacteristic(this.Characteristic.On)
                  .on('get', async callback => this.getByPass(callback))
                  .on('set', async (state, callback) => this.setByPass(state, callback));   
            this.zoneDevices = this.config.zoneDevices;
            this.quickbypass = this.config.quickbypass ? this.config.quickbypass : false;
            this.commandTimeOut = this.config.commandTimeOut;
            this.byPassTimeOut = undefined;
            this.unByPassTimeOut = undefined;
            this.envisakitCurrentStatus = "READY";
          break;
          case 'speedkeys':
            
            var swServiceSpeedkey = this.accessory.getService(this.Service.Switch);
            if(swServiceSpeedkey == undefined) swServiceSpeedkey = this.accessory.addService(this.Service.Switch);
            
            swServiceSpeedkey.setCharacteristic(this.Characteristic.On, false);
            // bind index value to object for click events
            swServiceSpeedkey.getCharacteristic(this.Characteristic.On) 
                 .on('set', this.setSpeedKey.bind(this));
            
            if (this.config.speedcommand == "custom") 
            {
               this.speedKeyCommand = this.config.customcommand.replace("@pin",this.pin);
            }
            else
            {
               this.speedKeyCommand = this.config.speedcommand;
            }  
           

          break;
    }

  }

  async getChime(callback) {
    return callback(null,  this.envisakitCurrentStatus);
  }
  
  async setChime(value, callback) {
    this.log.debug('setChime: Chime set - ', value);
    callback(null);  // ← acknowledge HomeKit immediately

    if (this.isProcessingChimeOnOff) {
        this.log('Already processing a Chime toggle request. Command ignored.');
        return;
    }

    if (this.envisakitCurrentStatus !== value) {
        var l_alarmCommand = this.pin + tpidefs.alarmcommand.togglechime;
        this.alarm.commandreferral = tpidefs.alarmcommand.togglechime;
        if (this.alarm.sendCommand(l_alarmCommand)) {
            this.isProcessingChimeOnOff = true;  // ← set before any async gap
            this.envisakitCurrentStatus = value;
            if (this.chimeOnOffTimeOut) clearTimeout(this.chimeOnOffTimeOut);
            this.chimeOnOffTimeOut = setTimeout(this.processChimeOffTimer.bind(this), this.commandTimeOut * SECONDS);
        }
    } else {
        this.log('Chime already in requested state. Command ignored.');
    }
  }
  processChimeOffTimer() {
    if (this.isProcessingChimeOnOff) {
        this.log.warn(`Chime toggle request did not return successfully in the allocated time.`);
        this.isProcessingChimeOnOff = false;
        this.chimeOnOffTimeOut = undefined;
    } 
  }

  async getByPass(callback) {
    return callback(null, this.ENVISA_BYPASS_TO_HOMEKIT[this.envisakitCurrentStatus]);
  }

  processBypassTimer() {
    if (this.alarm.isProcessingBypass) {
        this.log.warn(`All Bypass request did not return successfully in the allocated time.`);
        this.alarm.isProcessingBypass = false;
        this.alarm.processingBypassqueue = 0;
        this.alarm.commandreferral = 0;
        // Roll back the HomeKit master bypass switch so the UI reflects
        // that the bypass was not confirmed by the panel. Without this the switch
        // stays ON even though the panel rejected or dropped the command.
        const switchService = this.accessory.getService(this.Service.Switch);
        if (switchService) switchService.updateCharacteristic(this.Characteristic.On, false);
        this.byPassTimeOut = undefined;
    } 
  }

  processUnBypassTimer() {
    if (this.alarm.isProcessingUnBypass) {
        this.log.warn(`All Unbypass request did not return successfully in the allocated time.`);
        this.alarm.isProcessingUnBypass = false;
        this.alarm.processingUnBypassqueue = 0;
        this.alarm.commandreferral = 0;
        this.alarm.targetUnbypassZoneNumber = 0;
        this.unByPassTimeOut = undefined;
        // No HomeKit UI rollback needed here — the switch was already set to false
        // (locSetValue = false) before the disarm command was sent in READY_BYPASS path.
    }
  }

  async setByPass(value, callback) {
    this.log.debug('setByPass: Bypass set - ', value);
    callback(null);  // ← acknowledge HomeKit immediately

    if (this.alarm.isProcessingBypass || this.alarm.isProcessingUnBypass) {
        this.log("Already processing Bypass or UnBypass request. Command ignored.");
        return;
    }

    // Set busy flag immediately — before any await or branch logic —
    // so re-entrant calls from HomeKit are blocked from this point on.
    this.alarm.isProcessingBypass = true;
    this.alarm.processingBypassqueue = 0;

    var locSetValue = value;
    var switchService = this.accessory.getService(this.Service.Switch);

    switch (this.envisakitCurrentStatus) {
        case 'NOT_READY':
            if (value) {
                this.log(`Reviewing fault zones for bypassing...`);
                var l_alarmCommand;
                if (this.quickbypass) {
                    this.log(`Quick Bypass configured. Quick bypass of fault zones.`);
                    l_alarmCommand = this.pin + tpidefs.alarmcommand.quickbypass;
                    this.alarm.commandreferral = tpidefs.alarmcommand.quickbypass;
                    this.alarm.processingBypassqueue = 1;
                    this.alarm.sendCommand(l_alarmCommand);
                    this.byPassTimeOut = setTimeout(this.processBypassTimer.bind(this), this.commandTimeOut * SECONDS);
                    break;
                }
                if (this.zoneDevices.length == 0) {
                    this.log(`Nothing to bypass. There are no zones defined.`);
                    setTimeout(function () {switchService.updateCharacteristic(this.Characteristic.On, false)}.bind(this), CHARACTERISTICTIMEOUT);
                    break;
                }
                var bypassCount = 0;
                var formattedZone = "";
                var bValue = false;
                for (var i = 0; i < this.zoneDevices.length; i++) {
                    var zoneinfo = this.zoneDevices[i];
                    if (zoneinfo) {
                        this.log.debug(`setByPass: Reviewing zone - ${zoneinfo.name}, ${zoneinfo.bypassEnabled}`);
                        if ((zoneinfo.envisakitCurrentStatus != "close") && (zoneinfo.bypassEnabled)) {
                            this.log(`Requesting bypassing of ${zoneinfo.name} ...`);
                            if (zoneinfo.envisakitCurrentStatus == "check") this.log.warn(`${zoneinfo.name} is generating a check message, which requires your attention. This could result in unexpected results with bypass function.`);
                            if (formattedZone.length > 1) formattedZone = formattedZone + ",";
                            formattedZone = (this.deviceType === "128FBP")
                                ? (("00" + zoneinfo.zoneNumber).slice(-3))
                                : (("0" + zoneinfo.zoneNumber).slice(-2));
                            bypassCount++;
                        }
                    }
                }
                if (bypassCount == 0) {
                    this.log("No zones were enabled for bypass. Please set bypassEnabled flag for zone(s) wanting to enable for bypass by Homekit.");
                    bValue = false;
                } else {
                    l_alarmCommand = this.pin + tpidefs.alarmcommand.bypass + formattedZone;
                    this.alarm.commandreferral = tpidefs.alarmcommand.bypass;
                    this.alarm.processingBypassqueue = bypassCount;
                    this.alarm.sendCommand(l_alarmCommand);
                    await sleep(BYPASS_DELAY * this.delayfactor);
                    bValue = true;
                    this.log(`${bypassCount} zone(s) queued for bypass.`);
                    if (this.byPassTimeOut) clearTimeout(this.byPassTimeOut);
                    this.byPassTimeOut = setTimeout(this.processBypassTimer.bind(this), this.commandTimeOut * SECONDS);
                }
            }
            setTimeout(function () {switchService.updateCharacteristic(this.Characteristic.On, bValue)}.bind(this), CHARACTERISTICTIMEOUT);
            locSetValue = bValue;
        break;

        case 'READY_BYPASS':
        case 'NOT_READY_BYPASS':
            if (value == false) {
                this.log(`Clearing bypass zones...`);
                var l_alarmCommand = this.pin + tpidefs.alarmcommand.disarm;
                this.alarm.commandreferral = tpidefs.alarmcommand.disarm;
                this.alarm.isProcessingUnBypass = true;
                this.alarm.isProcessingBypass = false;
                this.alarm.processingUnBypassqueue = 1;
                this.alarm.targetUnbypassZoneNumber = 0;
                this.alarm.sendCommand(l_alarmCommand);
                if (this.unByPassTimeOut) clearTimeout(this.unByPassTimeOut);
                this.unByPassTimeOut = setTimeout(this.processUnBypassTimer.bind(this), this.commandTimeOut * SECONDS);
            }
            locSetValue = false;
        break;

        case 'READY':
            if (value == true) {
                this.log(`Alarm is ${this.envisakitCurrentStatus} no action required. Ignoring bypass request.`);
                setTimeout(function () {switchService.updateCharacteristic(this.Characteristic.On, false)}.bind(this), CHARACTERISTICTIMEOUT);
            }
            locSetValue = false;
        break;

        default:
            setTimeout(function () {switchService.updateCharacteristic(this.Characteristic.On, !value)}.bind(this), CHARACTERISTICTIMEOUT);
            locSetValue = !value;
        break;
    }

    if (this.alarm.processingBypassqueue == 0) this.alarm.isProcessingBypass = false;
  }

  async setSpeedKey(value, callback) {
    callback(null);  // ← acknowledge HomeKit immediately

    if (value) {
        var switchService = this.accessory.getService(this.Service.Switch);
        var l_alarmCommand = this.speedKeyCommand;
        this.log(`Sending panel command for speed key ${this.name}`);
        this.log.debug(`Sending command string sent ${l_alarmCommand}`);
        this.alarm.sendCommand(l_alarmCommand);
        setTimeout(function () {switchService.updateCharacteristic(this.Characteristic.On, false)}.bind(this), CHARACTERISTICTIMEOUT);
    }
  }

}

module.exports = EnvisalinkCustomAccessory;
