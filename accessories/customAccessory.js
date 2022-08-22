"use strict";
var tpidefs = require('./../tpi.js');

const SPEED_KEY_PREXFIX = "SPEED_KEY_";
const ENVISALINK_MANUFACTURER = "Envisacor Technologies Inc."

class EnvisalinkCustomAccessory {
  constructor(log, config, Service, Characteristic, UUIDGen, alarm) {
    this.Characteristic = Characteristic;
    this.Service = Service;
    this.log = log;
    this.name = config.name;
    this.config = config;
    this.customType = config.customType;
    this.pin = config.pin;
    this.uuid = UUIDGen.generate(this.config.serialNumber);
    this.alarm = alarm;
    this.envisakitCurrentStatus = false;
    this.ENVISA_BYPASS_TO_HOMEKIT = {
      'NOT_READY': false,
      'NOT_READY_TROUBLE': false,
      'NOT_READY_BYPASS': true,
      'READY': false,
      'READY_BYPASS': true,
      'ARMED_STAY': false,
      'ARMED_STAY_BYPASS': true,
      'ARMED_AWAY': false,
      'ARMED_AWAY_BYPASS': true,
      'ARMED_NIGHT': false,
      'ARMED_NIGHT_BYPASS': true,
      'ALARM': false,
      'ALARM_MEMORY': false
    };
  }
 
  setAccessory(accessory) {
    this.accessory = accessory;
    this.accessory.getService(this.Service.AccessoryInformation)
        .setCharacteristic(this.Characteristic.Manufacturer, ENVISALINK_MANUFACTURER)
        .setCharacteristic(this.Characteristic.Model, this.config.model)
        .setCharacteristic(this.Characteristic.SerialNumber, this.config.serialNumber);
    
    switch (this.customType) {
          case "chimemode":
            var swServiceChime = this.accessory.getService(this.Service.Switch);
            if(swServiceChime == undefined) swServiceChime = this.accessory.addService(this.Service.Switch); 
            swServiceChime.setCharacteristic(this.Characteristic.On, false);
            swServiceChime.getCharacteristic(this.Characteristic.On)
              .on('get', async callback => this.getChime(callback))
              .on('set', async (state, callback) => this.setChime(state, callback));
            this.envisakitCurrentStatus = false;
          break;
          case "bypass":
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
            this.envisakitCurrentStatus = "READY";
          break;
          case "speedkeys":
            this.speedKeyCommand = [];
            this.speedKeySubname = [];
            var l_keylist = this.config.keyList;
            for (var index = 0; index < l_keylist.length; index++) {

              var swServiceSpeedkey = this.accessory.getServiceById(this.Service.Switch,SPEED_KEY_PREXFIX+l_keylist[index].name);
              if(swServiceSpeedkey == undefined) swServiceSpeedkey = this.accessory.addService(this.Service.Switch,l_keylist[index].name, SPEED_KEY_PREXFIX+l_keylist[index].name); 
              // bind index value to object for click events
              swServiceSpeedkey.getCharacteristic(this.Characteristic.On) 
                 .on('set', this.setSpeedKey.bind(this,index));
              
              this.speedKeySubname[index] = l_keylist[index].name;
              if (l_keylist[index].speedcommand == "custom")  
                  this.speedKeyCommand[index]= l_keylist[index].customcommand.replace("@pin",this.pin);
              else
                  this.speedKeyCommand[index]= l_keylist[index].speedcommand;

             }
             // remove old switch services if they are no longer define as part of speedkey list
             if(this.accessory.context.swSubnames){
              var oldSwichnamelist = this.accessory.context.swSubnames.filter(x =>  this.speedKeySubname.indexOf(x) === -1);
              for (var indexOld= 0; indexOld < oldSwichnamelist.length; indexOld++) {
                this.log.debug('setAccessory: speedkeys Removing switch - ', oldSwichnamelist[indexOld]);
                var swOldServiceSpeedkey = this.accessory.getServiceById(this.Service.Switch,SPEED_KEY_PREXFIX+oldSwichnamelist[indexOld]);
                if(swOldServiceSpeedkey != undefined) this.accessory.removeService(swOldServiceSpeedkey);
              }
             }
             this.accessory.context.swSubnames = this.speedKeySubname;
          break;
    }

  }

  async getChime(callback) {
    return callback(null,  this.envisakitCurrentStatus);
  }

  async setChime(value,callback) {
    this.log.debug('setChime: Chime set - ', value );
    var l_alarmCommand = this.pin + tpidefs.alarmcommand.togglechime
    this.alarm.sendCommand(l_alarmCommand);    
    this.envisakitCurrentStatus = !this.envisakitCurrentStatus;              
    return callback(null);
  }   

  async getByPass(callback) {
    callback(null, this.ENVISA_BYPASS_TO_HOMEKIT[this.envisakitCurrentStatus]);
  }

  proccessBypassTimer() {
    if (this.alarm.isProcessingBypass) {
        this.log.warn(`All Bypass request did not return successfully in the allocated time.`);
        this.alarm.isProcessingBypass = false;
        this.alarm.isProcessingBypassqueue = 0;
    } 
  }
  async setByPass(value, callback) {
    this.log.debug('setByPass:  Bypass set - ', value);
    // Determine if processing another bypass command.
    if (this.alarm.isProcessingBypass) {
        this.log("Already processing Bypass request. Command ignored.");
        callback(null,this.ENVISA_BYPASS_TO_HOMEKIT[this.envisakitCurrentStatus]);
    }
    else
    {
        // Set busy status on process Bypass
        this.alarm.isProcessingBypass = true;
        this.alarm.isProcessingBypassqueue = 0;
        // Get the button service and updated switch soon after set function is complete 
        var switchService = this.accessory.getService(this.Service.Switch);
        // Determine alarm status and execute bypass on status
        switch (this.envisakitCurrentStatus) {
            case "NOT_READY":
                // System not ready, review candidate for zone bypass 
                if (value) {
                    this.log(`Reviewing fault zones for bypassing...`);
                    var l_alarmCommand;
                    if (this.quickbypass) {
                        this.log(`Quick Bypass configured. Quick bypass of fault zones.`);
                        l_alarmCommand = this.pin + tpidefs.alarmcommand.quickbypass;
                        this.alarm.sendCommand(l_alarmCommand);
                        callback(null,value);
                        break;
                    }
                    // Reviewing zone that are being monitored and are bypass enabled (allowed to be bypass)
                    if (this.zoneDevices.length == 0) {
                        this.log.warn(`No zones were defined.`);
                        setTimeout(function () {switchService.updateCharacteristic(this.Characteristic.On,false)}.bind(this),500);
                        callback(null, false);
                        break;
                    }
                    var bypasscount = 0;
                    var zonesToBypass = "";
                    var bValue = false;
                    for (var i = 0; i < this.zoneDevices.length; i++) {
                        var zoneinfo = this.zoneDevices[i];
                        if (zoneinfo) {
                            // Only bypass zone that are open and has been enabled for bypass, default is false for all zone define in configuration file.
                            this.log.debug("setByPass: Reviewing zone - ", zoneinfo.name + ", " + zoneinfo.status + ", " + zoneinfo.bypassEnabled);
                            if ((zoneinfo.envisakitCurrentStatus == "open") && (zoneinfo.bypassEnabled)) {
                                this.log(`Requesting bypassing of ${zoneinfo.name} ...`);
                                if (zonesToBypass.length > 1) zonesToBypass = zonesToBypass + ","; 
                                // Require leading zero for zone numbers which are not two or three digit (128 Panel)
                                if (this.deviceType == "128FBP") 
                                    zonesToBypass = zonesToBypass + (("00" + zoneinfo.zoneNumber).slice(-3));
                                else
                                    zonesToBypass = zonesToBypass + (("0" + zoneinfo.zoneNumber).slice(-2));
                                bypasscount = bypasscount + 1;
                            }
                        }
                    } 
                    if (bypasscount == 0) {
                        this.log("No zones were enabled for bypass. Please set bypassEnabled flag for zone(s) wanting to enable for bypass by Homekit.")
                        bValue = false;
                    }
                    else {
                        l_alarmCommand = this.pin + tpidefs.alarmcommand.bypass + zonesToBypass;
                        this.alarm.sendCommand(l_alarmCommand);
                        await new Promise(r => setTimeout(r, 2000));
                        this.alarm.isProcessingBypassqueue == bypasscount;
                        bValue = true;
                        this.log(`${bypasscount.toString()} zone(s) queued for bypass.`);
                        this.byPassTimeOut = setTimeout(this.proccessBypassTimer.bind(this), this.commandTimeOut * 1000);
                    }
                
                }
                setTimeout(function () {switchService.updateCharacteristic(this.Characteristic.On,bValue)}.bind(this),500);
                callback(null, bValue);
            break;
            case "READY_BYPASS":
            case "NOT_READY_BYPASS":
                // Clear bypass zones
                if (value == false) {
                    this.log(`Clearing bypass zones...`)
                    var l_alarmCommand = this.pin + tpidefs.alarmcommand.disarm;
                    this.alarm.sendCommand(l_alarmCommand);
                }
                callback(null, false);
            break;
            case 'READY':
                this.log(`Alarm is ${this.envisakitCurrentStatus} no action required. Ignoring bypass request.`);
                // Turn off switch, since no action was completed.
                setTimeout(function () {switchService.updateCharacteristic(this.Characteristic.On,false)}.bind(this),2000);
                callback(null, false);
            break;
            default:
                // Nothing to process, return to previous state, 
                setTimeout(function () {switchService.updateCharacteristic(this.Characteristic.On,!value)}.bind(this),2000);
                callback(null, !value);
            break;
        }
        // Is there anything in the queue being process?
        if (this.alarm.isProcessingBypassqueue == 0 ) this.alarm.isProcessingBypass = false;
    }
  }
  async setSpeedKey(swIdenity,value,callback) {

    this.log.debug('setSpeedKey:  Macro/speed keys set -', swIdenity,value,callback);
  
    if (value) {
        // Get the button service and updated switch soon after set function is complete
        var switchService = this.accessory.getServiceById(this.Service.Switch,SPEED_KEY_PREXFIX+this.speedKeySubname[swIdenity]);
        // Replace token values with pin
        var l_alarmCommand = this.speedKeyCommand[swIdenity].replace("@pin",this.pin);
        this.log(`Sending panel command for speed key ${this.speedKeySubname[swIdenity]}`);       
        this.alarm.sendCommand(l_alarmCommand);
          // turn off after 2 sec
        setTimeout(function () {switchService.updateCharacteristic(this.Characteristic.On,false)}.bind(this),2000);
    }
    callback(null); 
  }

}

module.exports = EnvisalinkCustomAccessory;