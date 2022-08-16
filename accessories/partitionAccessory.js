"use strict";
var tpidefs = require('./../tpi.js');

const ENVISALINK_MANUFACTURER = "Envisacor Technologies Inc."

class EnvisalinkPartitionAccessory {
 
 constructor(log, config, Service, Characteristic, UUIDGen, alarm) {
    this.Characteristic = Characteristic;
    this.Service = Service;
    this.log = log;
    this.name = config.name;
    this.config = config;
    this.accessoryType = "partition";
    this.partitionNumber = config.partitionNumber;
    this.pin = config.pin;
    this.uuid = UUIDGen.generate('envisalink.' + this.accessoryType + this.partitionNumber);
    this.alarm = alarm;

    this.ENVISA_TO_HOMEKIT = {
      'NOT_READY': Characteristic.SecuritySystemCurrentState.DISARMED,
      'NOT_READY_TROUBLE': Characteristic.SecuritySystemCurrentState.DISARMED,
      'NOT_READY_BYPASS': Characteristic.SecuritySystemCurrentState.DISARMED,
      'READY': Characteristic.SecuritySystemCurrentState.DISARMED,
      'READY_BYPASS': Characteristic.SecuritySystemCurrentState.DISARMED,
      'ARMED_STAY': Characteristic.SecuritySystemCurrentState.STAY_ARM,
      'ARMED_STAY_BYPASS': Characteristic.SecuritySystemCurrentState.STAY_ARM,
      'ARMED_AWAY': Characteristic.SecuritySystemCurrentState.AWAY_ARM,
      'ARMED_AWAY_BYPASS': Characteristic.SecuritySystemCurrentState.AWAY_ARM,
      'ARMED_NIGHT': Characteristic.SecuritySystemCurrentState.NIGHT_ARM,
      'ARMED_NIGHT_BYPASS': Characteristic.SecuritySystemCurrentState.NIGHT_ARM,
      'ALARM': Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED,
      'ALARM_MEMORY': Characteristic.SecuritySystemCurrentState.DISARMED
    };

    
  }


  setAccessory(accessory)  {
    this.accessory = accessory;
    this.accessory.getService(this.Service.AccessoryInformation)
        .setCharacteristic(this.Characteristic.Manufacturer, ENVISALINK_MANUFACTURER)
        .setCharacteristic(this.Characteristic.Model, this.config.model)
        .setCharacteristic(this.Characteristic.SerialNumber, this.config.serialNumber);

    var securityService = this.accessory.getService(this.Service.SecuritySystem);
    if(securityService == undefined) securityService = this.accessory.addService(this.Service.SecuritySystem,this.name);
    securityService.getCharacteristic(this.Characteristic.SecuritySystemCurrentState)
        .on('get', async callback => this.getCurrentState(callback));
    securityService.getCharacteristic(this.Characteristic.SecuritySystemTargetState)
        .on('get', async callback => this.getTargetState(callback))
        .on('set', async (state, callback) => this.setTargetState(state, callback));
    securityService.setCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.NO_FAULT);
    securityService.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);

    // Add battery service
    // Set initial battery level
    this.batteryLevel = 100;
    var batteryService = this.accessory.getService(this.Service.Battery)
    if(batteryService == undefined) batteryService = this.accessory.addService(this.Service.Battery,this.name + " Backup Battery");    
    batteryService
            .getCharacteristic(this.Characteristic.StatusLowBattery)
            .on('get', async callback => this.getPanelStatusLowBattery(callback));
    batteryService.setCharacteristic(this.Characteristic.BatteryLevel,this.batteryLevel);
    
    if (this.config.batteryRunTime > 0) {
        // Only show battery level if user has provided a battery run time.
        batteryService
            .getCharacteristic(this.Characteristic.BatteryLevel)
            .on('get',  async callback => this.getPanelBatteryLevel(callback)); 
        batteryService
            .getCharacteristic(this.Characteristic.ChargingState)
            .on('get', async callback => this.getPanelCharingState(callback));     
       
    }

    // link battery service to partition
    securityService.addLinkedService(batteryService);

    // Set default for security service
    this.ChargingState = this.Characteristic.ChargingState.CHARGING;
    this.envisakitCurrentStatus = "READY";
    this.downTime = null;
    this.homekitLastTargetState = this.Characteristic.SecuritySystemCurrentState.DISARMED;
    this.commandTimeOut = this.config.commandTimeOut;
    this.batteryRunTime = this.config.batteryRunTime;
    this.changePartition = this.config.changePartition;
    this.systemfault = this.Characteristic.StatusFault.NO_FAULT;
    this.processingAlarm = false;
    this.armingTimeOut = undefined;

  }

// Handle requests to get the alarm states. Return index of alarm state
async getCurrentState(callback) {
  var l_homeKitCurrentState = this.ENVISA_TO_HOMEKIT[this.envisakitCurrentStatus];
  return callback(null, l_homeKitCurrentState);
}

async getTargetState(callback) {
    return callback(null, this.homekitLastTargetState);
  }

proccessAlarmTimer() {
     // get security system
     const securitySevice = this.accessory.getService(this.Service.SecuritySystem);
    if (this.processingAlarm) {
        this.log.warn(`Alarm request did not return successfully in allocated time. Current alarm status is ${this.l_envisalikCurrentStatus}`);
        this.processingAlarm = false;
        this.armingTimeOut = undefined;
        securitySevice.updateCharacteristic(this.Characteristic.SecuritySystemCurrentState,this.ENVISA_TO_HOMEKIT[this.envisakitCurrentStatus]);
        securitySevice.updateCharacteristic(this.Characteristic.SecuritySystemTargetState,this.ENVISA_TO_HOMEKIT[this.envisakitCurrentStatus]);  
    } 
}
// Change smart water shutoff monitoring state.
async setTargetState(homekitState, callback) {
  var l_envisalikCurrentStatus = this.envisakitCurrentStatus;
  var l_alarmCommand = null; // no command has been defined.
  this.log.debug("setTargetState: Homekit alarm requested set - ",homekitState);
  if (this.processingAlarm == false) {
      switch (l_envisalikCurrentStatus) {
          case 'ALARM':   
          case 'ALARM_MEMORY':
          case 'ARMED_STAY':
          case 'ARMED_STAY_BYPASS':
          case 'ARMED_NIGHT':
          case 'ARMED_NIGHT_BYPASS':    
          case 'ARMED_AWAY':
          case 'ARMED_AWAY_BYPASS':
              if (homekitState == this.Characteristic.SecuritySystemCurrentState.DISARMED) {
                  this.log(`Disarming alarm with PIN. [Partition ${this.partitionNumber}]`);
                  l_alarmCommand = this.pin + tpidefs.alarmcommand.disarm;
              } else this.log.warn("Disarming the alarm is required prior to changing alarm system mode.");
          break;
          case 'READY':
          case 'READY_BYPASS':
              if (homekitState == this.Characteristic.SecuritySystemCurrentState.STAY_ARM) {
                  this.log(`Arming alarm to Stay (Home). [Partition ${this.partitionNumber}]`);
                  l_alarmCommand = this.pin + tpidefs.alarmcommand.stay;
              } else if (homekitState == this.Characteristic.SecuritySystemCurrentState.NIGHT_ARM) {
                  this.log(`Arming alarm to Night. [Partition ${this.partitionNumber}]`);
                  l_alarmCommand = this.pin + tpidefs.alarmcommand.night;
              } else if (homekitState == this.Characteristic.SecuritySystemCurrentState.AWAY_ARM) {
                  this.log(`Arming alarm to Away. [Partition ${this.partitionNumber}]`);
                  l_alarmCommand = this.pin + tpidefs.alarmcommand.away;
              }
          break;
          default:
              this.log.warn(`No alarm system mode command is supported for partition status ${currentState}. Please use alarm system keypad or bypass the open zones.`);
          break;

      }
  } else this.log.warn("Alarm system is busy processing a previous alarm system mode command.");
  // If valid alarm command was determine process request
  if (l_alarmCommand) {
      this.processingAlarm = true;
      this.log.debug("setAlarmState: Partition state command issued.");
      if (this.changePartition) {
              this.log(`Changing Partition to ${this.partitionNumber}`);
              this.alarm.changePartition(this.partitionNumber);
              await new Promise(r => setTimeout(r, 3000));
      }
      this.alarm.sendCommand(l_alarmCommand);
      this.armingTimeOut = setTimeout(this.proccessAlarmTimer.bind(this), this.commandTimeOut * 1000);
      callback(null, homekitState);
     
  } else {
      // Couldn't process alarm request returning to previous state
      callback(null,this.homekitLastTargetState);
      // get security system
      const securitySevice = this.accessory.getService(this.Service.SecuritySystem);
      securitySevice.updateCharacteristic(this.Characteristic.SecuritySystemCurrentState,this.homekitLastTargetState);
      securitySevice.updateCharacteristic(this.Characteristic.SecuritySystemTargetState,this.homekitLastTargetState);        
  }
    
}
 // Battery status Low Battery status and Battery Level.
 async getPanelStatusLowBattery(callback) {
    // Assume battery level is normal.
    var l_batteryLevel = this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    if (this.batteryLevel < 20) l_batteryLevel = this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    this.log.debug("getPanelStatusLowBattery: Return Low Battery Status - ", l_batteryLevel);
    callback(null, l_batteryLevel);
}

async getPanelBatteryLevel(callback) {
  // Determine how much time has elapse and how much battery is remaining. 
  // Only calculate if battery leve is not already zero and AC power is down.
  if ((this.batteryLevel > 0) && (this.ChargingState == this.Characteristic.ChargingState.NOT_CHARGING) ){
      var current = new Date();
      var timeDiff = current - this.downTime; //in ms
      // strip the ms
      timeDiff /= 1000;
      this.batteryLevel = Math.max(0,(100-((timeDiff/this.batteryRunTime)*100).toFixed(1)));
  }
  this.log.debug("getPanelBatteryLevel: Return level - ", this.batteryLevel);
  callback(null,this.batteryLevel);
}

async getPanelCharingState(callback) {
  return callback(null, this.ChargingState );
}

async getSecuritySystemService() {
  return this.accessory.getService(this.Service.SecuritySystem);
}
  
}
module.exports = EnvisalinkPartitionAccessory;