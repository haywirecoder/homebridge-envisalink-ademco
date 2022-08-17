"use strict";

const ENVISALINK_MANUFACTURER = "Envisacor Technologies Inc."

class EnvisalinkZoneAccessory {
  constructor(log, config, Service, Characteristic, UUIDGen) {
    this.Characteristic = Characteristic;
    this.Service = Service;
    this.log = log;
    this.name = config.name;
    this.config = config;
    this.sensorType = config.sensorType;
    this.zoneNumber = config.zoneNumber;
    this.pin = config.pin;
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
          var montionService = this.accessory.getService(this.Service.MotionSensor);
          if(montionService == undefined) montionService = this.accessory.addService(this.Service.MotionSensor,this.name); 
          montionService.getCharacteristic(this.Characteristic.MotionDetected)
          .on('get', async callback => this.getMotionStatus(callback));
          montionService.setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          montionService.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);
          this.service = montionService;

          this.bypassEnabled = this.config.bypassEnabled ? this.config.bypassEnabled : false;
          this.envisakitCurrentStatus = "close";
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
          this.service = contactService;
          this.bypassEnabled = this.config.bypassEnabled ? this.config.bypassEnabled : false;
          this.envisakitCurrentStatus = "close";
      break;
  
      case "leak":
          // Create leak sensor
          var leakService = this.accessory.getService(this.Service.LeakSensor);
          if(leakService == undefined) leakService = this.accessory.addService(this.Service.LeakSensor,this.name); 
          leakService.getCharacteristic(this.Characteristic.LeakDetected)
          .on('get', async callback => this.getLeakStatus(callback));
          leakService.setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          leakService.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);
          this.service = leakService;
          this.bypassEnabled = this.config.bypassEnabled ? this.config.bypassEnabled : false;
          this.envisakitCurrentStatus = "close";
      break;
  
      case "smoke":
          // Create Smoke Detected sensor
          var SmokeSensorService = this.accessory.getService(this.Service.SmokeSensor);
          if(SmokeSensorService == undefined) SmokeSensorService = this.accessory.addService(this.Service.SmokeSensor,this.name); 
          SmokeSensorService.getCharacteristic(this.Characteristic.SmokeDetected)
          .on('get', async callback => this.getSmokeStatus(callback));
          SmokeSensorService.setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          SmokeSensorService.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);
          this.service = SmokeSensorService;
          this.bypassEnabled = this.config.bypassEnabled ? this.config.bypassEnabled : false;
          this.envisakitCurrentStatus = "close";
      break;
  
      case "co":
           // Create Carbon Monoxide sensor
           var CarbonMonoxideSensorService = this.accessory.getService(this.Service.CarbonMonoxideSensor);
           if(CarbonMonoxideSensorService == undefined) SmokeDetectedService = this.accessory.addService(this.Service.CarbonMonoxideSensor,this.name); 
           CarbonMonoxideSensorService.getCharacteristic(this.Characteristic.CarbonMonoxideDetected)
           .on('get', async callback => this.getCOStatus(callback));
           CarbonMonoxideSensorService.setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
           CarbonMonoxideSensorService.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);
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

}

module.exports = EnvisalinkZoneAccessory;