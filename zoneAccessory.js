"use strict";
var tpidefs = require('./../tpi.js');

const ENVISALINK_MANUFACTURER = "Envisacor Technologies Inc."

class EnvisalinkZoneAccessory {
  constructor(log, config, Service, Characteristic, UUIDGen, alarm) {
    this.Characteristic = Characteristic;
    this.Service = Service;
    this.log = log;
    this.name = config.name;
    this.config = config;
    this.sensorType = config.sensorType;
    this.accessoryType =  "sensor";
    this.zoneNumber = config.zoneNumber;
    this.pin = config.pin;
    this.alarm = alarm;
    this.bypassStatus = false;
    this.uuid = UUIDGen.generate(this.config.serialNumber);
    

    this.ENVISA_TO_HOMEKIT_MOTION = {
      'open': true,
      'close': false
    };
    this.ENVISA_TO_HOMEKIT_CONTACT = {
      'open': Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
      'close': Characteristic.ContactSensorState.CONTACT_DETECTED
    };
    this.ENVISA_TO_HOMEKIT_LEAK = {
      'open': Characteristic.LeakDetected.LEAK_DETECTED,
      'close': Characteristic.LeakDetected.LEAK_NOT_DETECTED
    };
    this.ENVISA_TO_HOMEKIT_SMOKE = {
      'open': Characteristic.SmokeDetected.SMOKE_DETECTED,
      'close': Characteristic.SmokeDetected.SMOKE_NOT_DETECTED
    };
    this.ENVISA_TO_HOMEKIT_CO = {
      'open': Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL,
      'close': Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL
    };

  
  }

  setAccessory(accessory) {
    this.accessory = accessory;
    this.accessory.getService(this.Service.AccessoryInformation)
        .setCharacteristic(this.Characteristic.Manufacturer, ENVISALINK_MANUFACTURER)
        .setCharacteristic(this.Characteristic.Model, this.config.model)
        .setCharacteristic(this.Characteristic.SerialNumber, this.config.serialNumber);

    switch (this.sensorType) {
        case "motion":
        case "glass":
          // Create motion sensor service
          var motionService = this.accessory.getService(this.Service.MotionSensor);
          if(motionService == undefined) motionService = this.accessory.addService(this.Service.MotionSensor,this.name); 
          motionService.getCharacteristic(this.Characteristic.MotionDetected)
          .on('get', async callback => this.getMotionStatus(callback));
          motionService.setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          motionService.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);
          motionService.setCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.NO_FAULT);
          this.service = motionService;
          this.bypassEnabled = this.config.bypassEnabled ? this.config.bypassEnabled : false;
          this.commandTimeOut = this.config.commandTimeOut;
          this.envisakitCurrentStatus = "close";

          // Bypass switch for individual sensor only if the master bypass switch is disabled. 
          var swbypass = this.accessory.getService(this.Service.Switch);
          if(this.bypassEnabled && !this.config.masterBypass) {
              if(swbypass == undefined) swbypass = this.accessory.addService(this.Service.Switch,this.name + " bypass"); 
              swbypass.getCharacteristic(this.Characteristic.On) 
                  .on('get', async callback => this.getByPass(callback))
                  .on('set', async (state, callback) => this.setByPass(state, callback));  
          }
          else {
            if (swbypass!= undefined) this.accessory.removeService(swbypass);
          }

      break;
  
      case "door":
      case "window":
          // Create contact sensor service
          var contactService = this.accessory.getService(this.Service.ContactSensor);
          if(contactService == undefined) contactService = this.accessory.addService(this.Service.ContactSensor,this.name); 
          contactService.getCharacteristic(this.Characteristic.ContactSensorState)
          .on('get', async callback => this.getContactSensorStatus(callback));
          contactService.setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          contactService.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);
          contactService.setCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.NO_FAULT);
          this.service = contactService;
          this.bypassEnabled = this.config.bypassEnabled ? this.config.bypassEnabled : false;
          this.commandTimeOut = this.config.commandTimeOut;
          this.envisakitCurrentStatus = "close";

          // Bypass switch for individual sensor only if the master bypass switch is disabled. 
          var swbypass = this.accessory.getService(this.Service.Switch);
          if(this.bypassEnabled && !this.config.masterBypass) {
              if(swbypass == undefined) swbypass = this.accessory.addService(this.Service.Switch,this.name + " bypass"); 
              swbypass.getCharacteristic(this.Characteristic.On) 
                  .on('get', async callback => this.getByPass(callback))
                  .on('set', async (state, callback) => this.setByPass(state, callback));  
          }
          else {
            if (swbypass!= undefined) this.accessory.removeService(swbypass);
          }
         
      break;
  
      case "leak":
          // Create leak sensor
          var leakService = this.accessory.getService(this.Service.LeakSensor);
          if(leakService == undefined) leakService = this.accessory.addService(this.Service.LeakSensor,this.name); 
          leakService.getCharacteristic(this.Characteristic.LeakDetected)
          .on('get', async callback => this.getLeakStatus(callback));
          leakService.setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          leakService.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);
          leakService.setCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.NO_FAULT);
          this.service = leakService;
          this.bypassEnabled = this.config.bypassEnabled ? this.config.bypassEnabled : false;
          this.envisakitCurrentStatus = "close";

          // Bypass switch for individual sensor only if the master bypass switch is disabled. 
          var swbypass = this.accessory.getService(this.Service.Switch);
          if(this.bypassEnabled && !this.config.masterBypass) {
              if(swbypass == undefined) swbypass = this.accessory.addService(this.Service.Switch,this.name + " bypass"); 
              swbypass.getCharacteristic(this.Characteristic.On) 
                  .on('get', async callback => this.getByPass(callback))
                  .on('set', async (state, callback) => this.setByPass(state, callback));  
          }
          else {
            if (swbypass!= undefined) this.accessory.removeService(swbypass);
          }

      break;
  
      case "smoke":
          // Create Smoke Detected sensor
          var SmokeSensorService = this.accessory.getService(this.Service.SmokeSensor);
          if(SmokeSensorService == undefined) SmokeSensorService = this.accessory.addService(this.Service.SmokeSensor,this.name); 
          SmokeSensorService.getCharacteristic(this.Characteristic.SmokeDetected)
          .on('get', async callback => this.getSmokeStatus(callback));
          SmokeSensorService.setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          SmokeSensorService.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);
          SmokeSensorService.setCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.NO_FAULT);
          this.service = SmokeSensorService;
          this.bypassEnabled = this.config.bypassEnabled ? this.config.bypassEnabled : false;
          this.envisakitCurrentStatus = "close";

      break;
  
      case "co":
           // Create Carbon Monoxide sensor
           var CarbonMonoxideSensorService = this.accessory.getService(this.Service.CarbonMonoxideSensor);
           if(CarbonMonoxideSensorService == undefined) CarbonMonoxideSensorService = this.accessory.addService(this.Service.CarbonMonoxideSensor,this.name); 
           CarbonMonoxideSensorService.getCharacteristic(this.Characteristic.CarbonMonoxideDetected)
           .on('get', async callback => this.getCOStatus(callback));
           CarbonMonoxideSensorService.setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
           CarbonMonoxideSensorService.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);
           CarbonMonoxideSensorService.setCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.NO_FAULT);
           this.service = CarbonMonoxideSensorService;
           this.bypassEnabled = this.config.bypassEnabled ? this.config.bypassEnabled : false;
           this.envisakitCurrentStatus = "close";
           
      break;
    }
  }

  async getMotionStatus(callback) {
    callback(null, this.ENVISA_TO_HOMEKIT_MOTION[this.envisakitCurrentStatus]); 
  }

  async getContactSensorStatus(callback) {
      callback(null, this.ENVISA_TO_HOMEKIT_CONTACT[this.envisakitCurrentStatus]);
  }

  async getLeakStatus(callback) {
    callback(null, this.ENVISA_TO_HOMEKIT_LEAK[this.envisakitCurrentStatus]);
  }

  async getSmokeStatus(callback) {
    callback(null, this.ENVISA_TO_HOMEKIT_SMOKE[this.envisakitCurrentStatus]);
  }

  async getCOStatus(callback) {
    callback(null, this.ENVISA_TO_HOMEKIT_CO[this.envisakitCurrentStatus]);
  }

  async getByPass(callback) {
    
    return callback(null,this.bypassStatus);
    
  }

  // Timer triggered event if bypass does not occur in an allocated time frame.
  processBypassTimer() {
    if (this.alarm.isProcessingBypass) {
        this.log.warn(`Bypass request did not return successfully in the allocated time.`);
        this.alarm.isProcessingBypass = false;
        this.alarm.isProcessingBypassqueue = 0;
    } 
  }

async setByPass(value, callback) {
    this.log.debug("setByPass: zone - ", this.name + ", " + this.zoneNumber); 

    if (this.alarm.isProcessingBypass) {
      this.log(`Already processing Bypass request. Command ignored.`);
      return callback(null);
    }
    // Bypass is only available if system is not armed, alarm or in-trouble state.
    if (!this.alarm.alarmSystemMode.includes('ALARM') && !this.alarm.alarmSystemMode.includes('ARMED')) {

      var l_zonesToBypass;
      var l_alarmCommand;
      this.alarm.isProcessingBypass = true;

      // If switch is bypass is on for zone, clear system (disarm system), otherwise bypass selected zone.
      if (value)
      {
        this.log(`Requesting bypassing of ${this.name} ...`)
        // Require leading zero for zone numbers which are not two or three digit (128 Panel)
        if (this.deviceType == "128FBP") 
          l_zonesToBypass = (("00" + this.zoneNumber).slice(-3));
        else
          l_zonesToBypass  = (("0" + this.zoneNumber).slice(-2));
      
        l_alarmCommand = this.pin + tpidefs.alarmcommand.bypass + l_zonesToBypass;
        this.alarm.isProcessingBypassqueue = 1;
    
      }
      else {
        this.log(`Removing bypassing of ${this.name} ...`);
      l_alarmCommand = this.pin + tpidefs.alarmcommand.disarm;
      } 
    
      // Set busy status on process Bypass
      this.byPassTimeOut = setTimeout(this.processBypassTimer.bind(this), this.commandTimeOut * 1000);
      this.alarm.sendCommand(l_alarmCommand);
      await new Promise(r => setTimeout(r, 2000));
      // Set current of switch
      this.bypassStatus = value;
    }
    else
    {
      this.bypassStatus = !value;
      this.log(`Alarm is ${this.alarm.alarmSystemMode} no action required. Ignoring bypass request.`);
    } 
    return callback(null)
  }
}

module.exports = EnvisalinkZoneAccessory;
