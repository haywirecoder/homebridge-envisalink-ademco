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
      this.commandTimeOut = config.commandTimeOut;
      this.batteryRunTime = config.batteryRunTime;
      this.changePartition = config.changePartition;
      this.uuid = UUIDGen.generate(this.config.serialNumber);
      this.alarm = alarm;

      this.ENVISA_TO_HOMEKIT_CURRENT = {
        'NOT_READY': Characteristic.SecuritySystemCurrentState.DISARMED,
        'NOT_READY_TROUBLE': Characteristic.SecuritySystemCurrentState.DISARMED,
        'NOT_READY_BYPASS': Characteristic.SecuritySystemCurrentState.DISARMED,
        'FIRE_TROUBLE' : Characteristic.SecuritySystemCurrentState.DISARMED,
        'READY': Characteristic.SecuritySystemCurrentState.DISARMED,
        'READY_BYPASS': Characteristic.SecuritySystemCurrentState.DISARMED,
        'ARMED_STAY': Characteristic.SecuritySystemCurrentState.STAY_ARM,
        'ARMED_STAY_BYPASS': Characteristic.SecuritySystemCurrentState.STAY_ARM,
        'ARMED_AWAY': Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        'ARMED_AWAY_BYPASS': Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        'ARMED_NIGHT': Characteristic.SecuritySystemCurrentState.NIGHT_ARM,
        'ARMED_NIGHT_BYPASS': Characteristic.SecuritySystemCurrentState.NIGHT_ARM,
        'ALARM': Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED,
        'ALARM_MEMORY': Characteristic.SecuritySystemCurrentState.DISARMED,
        'EXIT_DELAY':  Characteristic.SecuritySystemCurrentState.DISARMED
      };

      this.ENVISA_TO_HOMEKIT_TARGET = {
          'NOT_READY': Characteristic.SecuritySystemTargetState.DISARM,
          'NOT_READY_TROUBLE': Characteristic.SecuritySystemTargetState.DISARM,
          'NOT_READY_BYPASS': Characteristic.SecuritySystemTargetState.DISARM,
          'FIRE_TROUBLE' : Characteristic.SecuritySystemTargetState.DISARM,
          'READY': Characteristic.SecuritySystemTargetState.DISARM,
          'READY_BYPASS': Characteristic.SecuritySystemTargetState.DISARM,
          'ARMED_STAY': Characteristic.SecuritySystemTargetState.STAY_ARM,
          'ARMED_STAY_BYPASS': Characteristic.SecuritySystemTargetState.STAY_ARM,
          'ARMED_AWAY': Characteristic.SecuritySystemTargetState.AWAY_ARM,
          'ARMED_AWAY_BYPASS': Characteristic.SecuritySystemTargetState.AWAY_ARM,
          'ARMED_NIGHT': Characteristic.SecuritySystemTargetState.NIGHT_ARM,
          'ARMED_NIGHT_BYPASS': Characteristic.SecuritySystemTargetState.NIGHT_ARM,
          'ALARM_MEMORY': Characteristic.SecuritySystemTargetState.DISARM,
          'EXIT_DELAY':  Characteristic.SecuritySystemTargetState.DISARM
        };

        this.TARGET_HOMEKIT_TO_ENVISA = {
          0: 'Home',
          1: 'Away',
          2: 'Night',
          3: 'Disarm'
        };
    }

  setAccessory(accessory)  {
    this.accessory = accessory;

    // Set default for security service
    this.ChargingState = this.Characteristic.ChargingState.CHARGING;
    this.envisakitCurrentStatus = "READY";
    this.downTime = undefined;
    this.homekitLastTargetState = this.Characteristic.SecuritySystemTargetState.DISARM;
    this.systemfault = this.Characteristic.StatusFault.NO_FAULT;
    this.processingAlarm = false;
    this.armingTimeOut = undefined;


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

  }

// Handle requests to get the alarm states. Return index of alarm state
  async getCurrentState(callback) {
    var l_homeKitCurrentState = this.ENVISA_TO_HOMEKIT_CURRENT[this.envisakitCurrentStatus];
    return callback(null, l_homeKitCurrentState);
  }

  async getTargetState(callback) {
      return callback(null, this.homekitLastTargetState);
    }

  // Timer triggered event if alarm is not process in an allocated time frame.
  processAlarmTimer() {
      if (this.processingAlarm) {
          this.log.warn(`Alarm request did not return successfully in allocated time. Current alarm status is ${this.envisakitCurrentStatus}`);
          this.setAlarmState();
      } 
  }

  // Set the state of alarm system
  setAlarmState() {
    // get security system
    const securityService = this.accessory.getService(this.Service.SecuritySystem);
    this.log.debug("setAlarmState: Setting Alarm state to", this.envisakitCurrentStatus);
    this.processingAlarm = false;
    this.armingTimeOut = undefined;
    securityService.updateCharacteristic(this.Characteristic.SecuritySystemCurrentState,this.ENVISA_TO_HOMEKIT_CURRENT[this.envisakitCurrentStatus]);
    if(this.envisakitCurrentStatus != 'ALARM') securityService.updateCharacteristic(this.Characteristic.SecuritySystemTargetState,this.ENVISA_TO_HOMEKIT_TARGET[this.envisakitCurrentStatus]);  
  }

  // Change smart water shutoff monitoring state.
  async setTargetState(homekitState, callback) {
    var l_envisalinkCurrentStatus = this.envisakitCurrentStatus;
    var l_alarmCommand = null; // no command has been defined.
    this.log.debug("setTargetState: Homekit alarm requested set - ",homekitState);
    this.log.debug("setTargetState: Current alarm state is - ",l_envisalinkCurrentStatus);
    if (this.processingAlarm == false) {
        // Is alarm system already in current requested state? If yes, ignore the request.
        if (this.ENVISA_TO_HOMEKIT_CURRENT[l_envisalinkCurrentStatus] != homekitState)
        {
            switch (l_envisalinkCurrentStatus) {
              case 'ALARM':   
              case 'ALARM_MEMORY':
              case 'ARMED_STAY':
              case 'ARMED_STAY_BYPASS':
              case 'ARMED_NIGHT':
              case 'ARMED_NIGHT_BYPASS':    
              case 'ARMED_AWAY':
              case 'ARMED_AWAY_BYPASS':
                  if (homekitState == this.Characteristic.SecuritySystemCurrentState.DISARMED) {
                      this.log(`Disarming the alarm system with PIN, [Partition ${this.partitionNumber}].`);
                      l_alarmCommand = this.pin + tpidefs.alarmcommand.disarm;
                  } else this.log("Disarming the alarm system is required prior to changing alarm system state, request is ignored.");
              break;
              case 'READY':
              case 'READY_BYPASS':
                  if (homekitState == this.Characteristic.SecuritySystemCurrentState.STAY_ARM) {
                      this.log(`Arming the alarm system to Stay (Home), [Partition ${this.partitionNumber}].`);
                      l_alarmCommand = this.pin + tpidefs.alarmcommand.stay;
                  } else if (homekitState == this.Characteristic.SecuritySystemCurrentState.NIGHT_ARM) {
                      this.log(`Arming the alarm system to Night, [Partition ${this.partitionNumber}].`);
                      l_alarmCommand = this.pin + tpidefs.alarmcommand.night;
                  } else if (homekitState == this.Characteristic.SecuritySystemCurrentState.AWAY_ARM) {
                      this.log(`Arming the alarm system to Away, [Partition ${this.partitionNumber}].`);
                      l_alarmCommand = this.pin + tpidefs.alarmcommand.away;
                  }
              break;
              case 'NOT_READY': 
              case 'NOT_READY_TROUBLE': 
              case 'NOT_READY_BYPASS': 
              case 'FIRE_TROUBLE': 
                this.log(`The alarm system is not READY. The request for ${this.TARGET_HOMEKIT_TO_ENVISA[homekitState]} is ignored.`); 
              break;
              default:
                this.log.warn(`The alarm system mode command is not supported for partition with status of ${l_envisalinkCurrentStatus}. Please see alarm system keypad for more information.`);
              break;
          }
        }
        else this.log.debug(`setTargetState: Alarm system state is already ${this.TARGET_HOMEKIT_TO_ENVISA[homekitState]}, ignoring request.`); 
    } else this.log("Ignoring request, alarm system is busy processing a previous alarm system mode command(s).");
    // Assume alarm can't be process alarm request return to previous state. 
    // This will get updated if alarm command is valid and successful.
    var l_homekitState = this.homekitLastTargetState;
    // If valid alarm command was determine process request
    if (l_alarmCommand) {
        this.processingAlarm = true;
        this.log.debug("setTargetState: Sending command(s).");
        if (this.changePartition) {
                this.log(`Changing Partition to ${this.partitionNumber}`);
                this.alarm.changePartition(this.partitionNumber);
                await new Promise(r => setTimeout(r, 3000));
        }
        if (this.alarm.sendCommand(l_alarmCommand))
        {
          this.log.debug("setTargetState: Command(s) sent successfully.");
          this.armingTimeOut = setTimeout(this.processAlarmTimer.bind(this), this.commandTimeOut * 1000);
          // Alarm was successful
          l_homekitState = homekitState;
          this.homekitLastTargetState = homekitState;
          return callback(null,l_homekitState);
        }
    } 
    this.log.debug("setTargetState: Command unsuccessful, returning to homekit previous state - ", l_homekitState);
    this.armingTimeOut = setTimeout(this.setAlarmState.bind(this),1000);
    return callback(null,l_homekitState);
  }

  // Battery status Low Battery status and Battery Level.
  async getPanelStatusLowBattery(callback) {
      // Assume battery level is normal.
      var l_batteryLevel = this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      if (this.batteryLevel < 20) l_batteryLevel = this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
      this.log.debug("getPanelStatusLowBattery: Return Low Battery Status - ", l_batteryLevel);
      return callback(null, l_batteryLevel);
  }

  async getPanelBatteryLevel(callback) {
    // Determine how much time has elapse and how much battery is remaining. 
    // Only calculate if battery level is not already zero and AC power is down.
    if ((this.batteryLevel > 0) && (this.ChargingState == this.Characteristic.ChargingState.NOT_CHARGING) ){
        var current = new Date();
        if (this.downTime) 
        {
          var timeDiff = current - this.downTime; //in ms
          // strip the ms
          timeDiff /= 1000;
          this.batteryLevel = Math.max(0,(100-((timeDiff/this.batteryRunTime)*100).toFixed(1))); 
      }
    }
    this.log.debug("getPanelBatteryLevel: Return level - ", this.batteryLevel);
    return callback(null,this.batteryLevel);
  }

  async getPanelCharingState(callback) {
    return callback(null, this.ChargingState );
  }

  async getSecuritySystemService() {
    return this.accessory.getService(this.Service.SecuritySystem);
  }
}

module.exports = EnvisalinkPartitionAccessory;