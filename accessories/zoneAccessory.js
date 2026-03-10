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

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

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
    this.partition = config.partition;
    this.pin = config.pin;
    this.alarm = alarm;
    this.bypassStatus = false;
    this.targetUnbypassZone = false;
    this.uuid = UUIDGen.generate(this.config.serialNumber);
    this.commandTimeOut= config.commandTimeOut ? config.commandTimeOut : 10;
    

    this.ENVISA_TO_HOMEKIT_MOTION = {
      'open': true,
      'check': true,
      'close': false
    };
    this.ENVISA_TO_HOMEKIT_CONTACT = {
      'open': Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
      'check': Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
      'close': Characteristic.ContactSensorState.CONTACT_DETECTED
    };
    this.ENVISA_TO_HOMEKIT_LEAK = {
      'open': Characteristic.LeakDetected.LEAK_DETECTED,
      'check': Characteristic.LeakDetected.LEAK_DETECTED,
      'close': Characteristic.LeakDetected.LEAK_NOT_DETECTED
    };
    this.ENVISA_TO_HOMEKIT_SMOKE = {
      'open': Characteristic.SmokeDetected.SMOKE_DETECTED,
      'check': Characteristic.LeakDetected.SMOKE_DETECTED,
      'close': Characteristic.SmokeDetected.SMOKE_NOT_DETECTED
    };
    this.ENVISA_TO_HOMEKIT_CO = {
      'open': Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL,
      'check': Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL,
      'close': Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL
    };
    this.ENVISA_TO_HOMEKIT_OCCUPANCY = {
      'open': Characteristic.OccupancyDetected.OCCUPANCY_DETECTED,
      'check': Characteristic.OccupancyDetected.OCCUPANCY_DETECTED,
      'close': Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED

    };

  
  }

  setAccessory(accessory) {
    this.accessory = accessory;
    this.accessory.getService(this.Service.AccessoryInformation)
        .setCharacteristic(this.Characteristic.Manufacturer, ENVISALINK_MANUFACTURER)
        .setCharacteristic(this.Characteristic.Model, this.config.model)
        .setCharacteristic(this.Characteristic.SerialNumber, this.config.serialNumber);

    switch (this.sensorType) {
        case 'motion':
        case 'glass':
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

      case 'tilt':
          // Create Occupancy Sensor service
          var OccupancyService = this.accessory.getService(this.Service.OccupancySensor);
          if(OccupancyService == undefined) OccupancyService = this.accessory.addService(this.Service.OccupancySensor,this.name); 
          OccupancyService.getCharacteristic(this.Characteristic.OccupancyDetected)
          .on('get', async callback => this.getOccupancyStatus(callback));
          OccupancyService.setCharacteristic(this.Characteristic.StatusLowBattery, this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          OccupancyService.setCharacteristic(this.Characteristic.StatusTampered, this.Characteristic.StatusTampered.NOT_TAMPERED);
          OccupancyService.setCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.NO_FAULT);
          this.service = OccupancyService;
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
  
      case 'door':
      case 'window':
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
  
      case 'leak':
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
  
      case 'smoke':
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
  
      case 'co':
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

  async getOccupancyStatus(callback) {
    callback(null, this.ENVISA_TO_HOMEKIT_OCCUPANCY[this.envisakitCurrentStatus]); 
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

async setByPass(value, callback) {
    this.log.debug("setByPass: zone - ", this.name + ", " + this.zoneNumber); 

    if (this.alarm.isProcessingBypass || this.alarm.isProcessingUnBypass) {
        const activeOperation = this.alarm.isProcessingBypass ? 'Bypass' : 'UnBypass';
        this.log.warn(`[Zone ${this.zoneNumber}] is already processing ${activeOperation} request. Ignoring request.`);
        return callback(null);
    }
    // Bypass is only available if system is not armed, alarm or in-trouble state.
    if (!this.alarm.alarmSystemMode.includes('ALARM') && !this.alarm.alarmSystemMode.includes('ARMED')) {

      // If bypass switch is on for zone, bypass it; otherwise unbypass (targeted remove).
      if (value) {
        this.log(`Requesting bypassing of ${this.name} ...`);
        // Set flags once here — removed duplicate assignments that were also in outer block.
        this.alarm.isProcessingBypass = true;
        this.alarm.isProcessingUnBypass = false;
        this.targetUnbypassZone = false;
        // Require leading zero for zone numbers which are not two or three digit (128 Panel)
        const formattedZone = (this.deviceType === "128FBP")
                ? (("00" + this.zoneNumber).slice(-3))
                : (("0" + this.zoneNumber).slice(-2));
      
        const l_alarmCommand = this.pin + tpidefs.alarmcommand.bypass + formattedZone;
        this.alarm.commandreferral = tpidefs.alarmcommand.bypass;
        this.alarm.processingBypassqueue = 1;
        this.alarm.sendCommand(l_alarmCommand);
        this.bypassStatus = true;
        // Await the delay so the settling time is actually observed
        await sleep(BYPASS_DELAY + FINAL_SETTLING_TIME);

        // Safety watchdog: if the panel never sends CID 570 confirmation, clear the
        // flags after commandTimeOut seconds so future bypass requests are not blocked.
        // bypassStatus is NOT set here — cidUpdate() sets it on panel confirmation.
        // If the watchdog fires, the UI is rolled back to reflect the actual panel state.
        if (this.bypassWatchdogHandle) clearTimeout(this.bypassWatchdogHandle);
        this.bypassWatchdogHandle = setTimeout(() => {
            if (this.alarm.isProcessingBypass) {
                this.log.warn(`[Zone ${this.zoneNumber}] Bypass time exceeded, panel did not confirm Bypass. ${this.alarm.processingBypassqueue} zones were still pending. Rolling back UI.`);
                this.alarm.isProcessingBypass = false;
                this.alarm.processingBypassqueue = 0;
                this.alarm.commandreferral = 0;
                // Roll back the HomeKit switch to reflect that bypass was not confirmed
                this.bypassStatus = false;
                const bypassSwitch = this.accessory.getService(this.Service.Switch);
                if (bypassSwitch) bypassSwitch.updateCharacteristic(this.Characteristic.On, false);
            }
            this.bypassWatchdogHandle = undefined;
        }, this.commandTimeOut * SECONDS);
    
      } else {
        this.log(`Removing bypassing of ${this.name} ...`);
        // Set flags once here — removed duplicate assignments that were also in outer block.
        this.alarm.isProcessingUnBypass = true;
        this.alarm.isProcessingBypass = false;
        this.targetUnbypassZone = true;
        this.alarm.targetUnbypassZoneNumber = this.zoneNumber;
        // Explicitly reset queue to 1 for this single-zone unbypass. Without this, a stale
        // non-zero value left from a prior reestablishZoneBypass() would require multiple
        // CID 570 events to drain — which never happens for a single-zone command.
        this.alarm.processingUnBypassqueue = 1;
        // Customer grade Vista panels (15P/20P) don't support "unbypassing" a specific zone;
        // logic must: 1) disarm to clear all bypasses, 2) re-bypass all other zones.
        const l_alarmCommand = this.pin + tpidefs.alarmcommand.disarm;
        this.alarm.commandreferral = tpidefs.alarmcommand.targetedunbypass;
        this.bypassStatus = false;
        this.alarm.sendCommand(l_alarmCommand);
        // Await the delay so the settling time is actually observed
        await sleep(DISARM_CLEAR_DELAY + FINAL_SETTLING_TIME);

        // Safety watchdog: if the panel never sends CID 570 unbypass confirmation,
        // clear the flags after commandTimeOut seconds so future requests are not blocked.
        // Roll back the HomeKit switch UI to its prior state if unbypass was not confirmed.
        if (this.unbypassWatchdogHandle) clearTimeout(this.unbypassWatchdogHandle);
        this.unbypassWatchdogHandle = setTimeout(() => {
            if (this.alarm.isProcessingUnBypass) {
                this.log.warn(`[Zone ${this.zoneNumber}] Unbypass time exceeded, panel did not confirm unbypass. ${this.alarm.processingUnBypassqueue} zones were still pending.`);
                this.alarm.isProcessingUnBypass = false;
                this.alarm.processingUnBypassqueue = 0;
                this.alarm.commandreferral = 0;
                this.alarm.targetUnbypassZoneNumber = 0;
                // Roll back the HomeKit switch to reflect that unbypass was not confirmed
                this.bypassStatus = true;
                const bypassSwitch = this.accessory.getService(this.Service.Switch);
                if (bypassSwitch) bypassSwitch.updateCharacteristic(this.Characteristic.On, true);
            }
            this.unbypassWatchdogHandle = undefined;
        }, this.commandTimeOut * SECONDS);
      }
      // bypassStatus is intentionally NOT set here — it is owned by cidUpdate() on
      // panel confirmation (CID 570), or by the watchdog on failure. Setting it here
      // optimistically would leave the UI showing the wrong state if the panel rejects
      // the command and the watchdog fires.
    } else {
      this.bypassStatus = !value;
      this.log(`Alarm is ${this.alarm.alarmSystemMode} can't change bypass state. Ignoring bypass request.`);
    } 
    return callback(null);
  }
}

module.exports = EnvisalinkZoneAccessory;
