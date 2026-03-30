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

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

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
      this.ignoreFireTrouble =  config.ignoreFireTrouble;
      this.ignoreSystemTrouble = config.ignoreSystemTrouble;
      this.api = config.api;
      this.alarm = alarm;
      // Create variable and object to manage zone bypass. The zone bypass list will maintain the list of zone bypass and use as memory when alarm reset
      this.bypassedZones = new Set();
      // Use lowercase throughout — index.js reads/writes partition.clearzonebypass (all lowercase).
      // The previous clearZoneBypass (capital Z) was a different property and was never read.
      this.clearzonebypass = false;
      this.bypassedZonesMemory = config.bypassedZonesMemory;
   

      this.ENVISA_TO_HOMEKIT_CURRENT = {
        'NOT_READY':            Characteristic.SecuritySystemCurrentState.DISARMED,
        'NOT_READY_TROUBLE':    Characteristic.SecuritySystemCurrentState.DISARMED,  
        'NOT_READY_BYPASS':     Characteristic.SecuritySystemCurrentState.DISARMED,
        'READY_FIRE_TROUBLE':   Characteristic.SecuritySystemCurrentState.DISARMED,
        'READY_SYSTEM_TROUBLE': Characteristic.SecuritySystemCurrentState.DISARMED,
        'READY':                Characteristic.SecuritySystemCurrentState.DISARMED,
        'READY_BYPASS':         Characteristic.SecuritySystemCurrentState.DISARMED,
        'ARMED_STAY':           Characteristic.SecuritySystemCurrentState.STAY_ARM,
        'ARMED_STAY_BYPASS':    Characteristic.SecuritySystemCurrentState.STAY_ARM,
        'ARMED_AWAY':           Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        'ARMED_AWAY_BYPASS':    Characteristic.SecuritySystemCurrentState.AWAY_ARM,
        'ARMED_NIGHT':          Characteristic.SecuritySystemCurrentState.NIGHT_ARM,
        'ARMED_NIGHT_BYPASS':   Characteristic.SecuritySystemCurrentState.NIGHT_ARM,
        'ALARM':                Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED,
        'ALARM_MEMORY':         Characteristic.SecuritySystemCurrentState.DISARMED,
        'EXIT_DELAY':           Characteristic.SecuritySystemCurrentState.DISARMED
        };

      this.ENVISA_TO_HOMEKIT_TARGET = {
        'NOT_READY':            Characteristic.SecuritySystemTargetState.DISARM,
        'NOT_READY_TROUBLE':    Characteristic.SecuritySystemTargetState.DISARM,
        'NOT_READY_BYPASS':     Characteristic.SecuritySystemTargetState.DISARM,
        'READY_FIRE_TROUBLE':   Characteristic.SecuritySystemTargetState.DISARM,
        'READY_SYSTEM_TROUBLE': Characteristic.SecuritySystemTargetState.DISARM,
        'READY':                Characteristic.SecuritySystemTargetState.DISARM,
        'READY_BYPASS':         Characteristic.SecuritySystemTargetState.DISARM,
        'ARMED_STAY':           Characteristic.SecuritySystemTargetState.STAY_ARM,
        'ARMED_STAY_BYPASS':    Characteristic.SecuritySystemTargetState.STAY_ARM,
        'ARMED_AWAY':           Characteristic.SecuritySystemTargetState.AWAY_ARM,
        'ARMED_AWAY_BYPASS':    Characteristic.SecuritySystemTargetState.AWAY_ARM,
        'ARMED_NIGHT':          Characteristic.SecuritySystemTargetState.NIGHT_ARM,
        'ARMED_NIGHT_BYPASS':   Characteristic.SecuritySystemTargetState.NIGHT_ARM,
        'ALARM':                Characteristic.SecuritySystemTargetState.DISARM,  
        'ALARM_MEMORY':         Characteristic.SecuritySystemTargetState.DISARM,
        'EXIT_DELAY':           Characteristic.SecuritySystemTargetState.DISARM
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
    this.envisakitRevoveryStatus = "READY";
    this.downTime = undefined;
    this.homekitLastTargetState = this.Characteristic.SecuritySystemTargetState.DISARM;
    this.systemfault = this.Characteristic.StatusFault.NO_FAULT;
    this.processingPartitionCmd = false;
    this.armingTimeOutHandle = undefined;
    this.setSecuritySystemValueHandle = undefined;


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
        .on('set', this.setTargetState.bind(this));
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
            .on('get',async callback =>  this.getPanelCharingState(callback));     
       
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
      if (this.processingPartitionCmd) {
          this.log.warn(`Alarm request did not return successfully in allocated time. Current alarm status is ${this.envisakitCurrentStatus}`);
          this.armingTimeOutHandle = undefined;
          this.alarm.commandreferral = "";
          this.setAlarmRecoveryValues();
      } 
  }

  // Set the state of alarm system
  setAlarmRecoveryValues() {
    // get security system
    this.setSecuritySystemValueHandle = undefined;
    const securityService = this.accessory.getService(this.Service.SecuritySystem);
    this.log.debug("setAlarmRecoveryValues: Setting Alarm state to", this.envisakitRevoveryStatus);
    this.processingPartitionCmd = false;
    securityService.updateCharacteristic(this.Characteristic.SecuritySystemCurrentState,this.ENVISA_TO_HOMEKIT_CURRENT[this.envisakitRevoveryStatus]);
    if(this.envisakitCurrentStatus != 'ALARM') securityService.updateCharacteristic(this.Characteristic.SecuritySystemTargetState,this.ENVISA_TO_HOMEKIT_TARGET[this.envisakitRevoveryStatus]);  
  }

  // Used to set UI values for alarm state
  setAlarmValues() {
    // get security system
    this.setSecuritySystemValueHandle = undefined;
    const securityService = this.accessory.getService(this.Service.SecuritySystem);
    this.log.debug("setAlarmValues: Setting Alarm state to", this.envisakitCurrentStatus);
    securityService.updateCharacteristic(this.Characteristic.SecuritySystemCurrentState,this.ENVISA_TO_HOMEKIT_CURRENT[this.envisakitCurrentStatus]);
    if(this.envisakitCurrentStatus != 'ALARM') securityService.updateCharacteristic(this.Characteristic.SecuritySystemTargetState,this.ENVISA_TO_HOMEKIT_TARGET[this.envisakitCurrentStatus]);  
  }
  
  // Change state.
  async setTargetState(homekitState, callback) {

    // Acknowledge HomeKit immediately to prevent re-firing the set handler
    // before async operations complete. Execution continues normally after this.
    callback(null);

    const securityService = this.accessory.getService(this.Service.SecuritySystem);
    this.envisakitRevoveryStatus = this.envisakitCurrentStatus;
    var l_envisaliklocalStatus;
    var l_alarmCommand = null;
    this.log.debug("setTargetState: Homekit alarm requested set - ", homekitState);
    this.log.debug("setTargetState: Current alarm state is - ", this.envisakitCurrentStatus);

    if (this.processingPartitionCmd == false) {
        // Is alarm system already in current requested state? If yes, ignore the request.
        if (this.ENVISA_TO_HOMEKIT_CURRENT[this.envisakitCurrentStatus] != homekitState) {
            switch (this.envisakitCurrentStatus) {
                // Disarm state
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
                        l_envisaliklocalStatus = "READY";
                        this.alarm.commandreferral = tpidefs.alarmcommand.disarm;
                    } else this.log("Disarming the alarm system is required prior to changing alarm system state, request is ignored.");
                break;

                // Arming state
                case 'READY_FIRE_TROUBLE':
                    if (this.ignoreFireTrouble) {
                        this.log.warn(`Arming Partition [${this.partitionNumber}] in Fire Trouble status.`);
                        // Don't break, fall through arming sequence
                    } else {
                        this.log.warn(`Partition [${this.partitionNumber}] in Fire trouble status. Arming request failed.`);
                        break;
                    }
                case 'READY_SYSTEM_TROUBLE':
                    if (this.ignoreSystemTrouble) {
                        this.log.warn(`Arming Partition [${this.partitionNumber}] in System Trouble status.`);
                        // Don't break, fall through arming sequence
                    } else {
                        this.log.warn(`Partition [${this.partitionNumber}] in System trouble status. Arming request failed.`);
                        break;
                    }
                case 'READY':
                case 'READY_BYPASS':
                    if (homekitState == this.Characteristic.SecuritySystemCurrentState.STAY_ARM) {
                        this.log(`Arming the alarm system to Stay (Home), [Partition ${this.partitionNumber}].`);
                        l_alarmCommand = this.pin + tpidefs.alarmcommand.stay;
                        l_envisaliklocalStatus = "ARMED_STAY";
                        this.alarm.commandreferral = tpidefs.alarmcommand.stay;
                    } else if (homekitState == this.Characteristic.SecuritySystemCurrentState.NIGHT_ARM) {
                        this.log(`Arming the alarm system to Night, [Partition ${this.partitionNumber}].`);
                        l_alarmCommand = this.pin + tpidefs.alarmcommand.night;
                        l_envisaliklocalStatus = "ARMED_NIGHT";
                        this.alarm.commandreferral = tpidefs.alarmcommand.night;
                    } else if (homekitState == this.Characteristic.SecuritySystemCurrentState.AWAY_ARM) {
                        this.log(`Arming the alarm system to Away, [Partition ${this.partitionNumber}].`);
                        l_envisaliklocalStatus = "ARMED_AWAY";
                        l_alarmCommand = this.pin + tpidefs.alarmcommand.away;
                        this.alarm.commandreferral = tpidefs.alarmcommand.away;
                    }
                break;

                // Trouble states
                case 'NOT_READY':
                case 'NOT_READY_TROUBLE':
                case 'NOT_READY_BYPASS':
                    this.log(`The alarm system is not READY. The request for ${this.TARGET_HOMEKIT_TO_ENVISA[homekitState]} is ignored.`);
                break;
                default:
                    this.log.warn(`The alarm system mode command is not supported for partition with status of ${this.envisakitCurrentStatus}. Please see alarm system keypad for more information.`);
                break;
            }
        } else this.log.debug(`setTargetState: Alarm system state is already ${this.TARGET_HOMEKIT_TO_ENVISA[homekitState]}, ignoring request.`);
    } else this.log("Ignoring request, alarm system is busy processing a previous alarm system mode command(s).");

    // If a valid alarm command was determined, process the request.
    if (l_alarmCommand) {
        this.processingPartitionCmd = true;
        this.log.debug("setTargetState: Sending command(s).");
        if (this.changePartition) {
            this.log(`Changing Partition to ${this.partitionNumber}`);
            this.alarm.changePartition(this.partitionNumber);
            await sleep(PARTITION_SWITCH_DELAY);
        }
        if (this.alarm.sendCommand(l_alarmCommand)) {
            this.log.debug("setTargetState: Command(s) sent successfully.");
            // Confirm success by monitoring for partition change event. If event doesn't 
            // occur within commandTimeOut, assume failure and roll back.
            await sleep(DISARM_CLEAR_DELAY);
            this.armingTimeOutHandle = setTimeout(this.processAlarmTimer.bind(this), this.commandTimeOut * SECONDS);

            // Workaround to prevent Home UI from flipping back and forth when setting NIGHT.
            // When the proper state is reported by the panel the UI will already be correct.
            if (l_envisaliklocalStatus != "ARMED_NIGHT") this.homekitLastTargetState = homekitState;
            else this.homekitLastTargetState = this.Characteristic.SecuritySystemTargetState.STAY_ARM;

            // Set UI status
            this.envisakitCurrentStatus = l_envisaliklocalStatus;
            this.setSecuritySystemValueHandle = setTimeout(this.setAlarmValues.bind(this), ACCESSORIESTIMEOUT / 2);
            return;
        }
    }

    // Command unsuccessful or not determined — return UI to previous state.
    this.log.debug("setTargetState: Command unsuccessful, returning to homekit previous state - ", this.homekitLastTargetState);
    this.setSecuritySystemValueHandle = setTimeout(this.setAlarmRecoveryValues.bind(this), ACCESSORIESTIMEOUT);
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

  // To determine the total time required to re-establish bypasses, we need to account for the panel's 
  // processing speed and the mandatory "breathing room" required between keystrokes to avoid the ^00,00 (Busy) 
  // or ^00,04 (Timeout) errors.
  calculateBypassWaitTime(zoneCount) {
    let smartDelay;
    if (zoneCount <= 2) {
        smartDelay = 500;   // Performance Mode
    } else if (zoneCount <= 8) {
        smartDelay = 800;   // Balanced Mode
    } else {
        smartDelay = 1200;  // High Reliability Mode
    }
    return (smartDelay);
  }

  // Reestablish zone bypasses from plug-in memory. The plugin tracks bypassed zones in the bypassedZones set, 
  // but the panel will clear all bypasses on an alarm disarm, creating a mismatch between the plugin and panel states.
  // This method re-sends a single combined bypass command for all zones tracked in bypassedZones,
  // restoring the panel state to match the plugin's internal set.
  async reestablishZoneBypass() {
    if (this.bypassedZones.size === 0) {
        this.log.debug(`reestablishZoneBypass: [Partition ${this.partitionNumber}] No zones to reestablish.`);
        return;
    }

    this.log(`Reestablishing bypass for ${this.bypassedZones.size} zone(s).`);

    // Usage of individual bypass commands with delay is required to prevent panel from dropping bypass
    // requests due to buffer overflow when multiple zones are bypassed.
    const waitTime = this.calculateBypassWaitTime(this.bypassedZones.size);

    this.alarm.processingBypassqueue = this.bypassedZones.size;
    this.alarm.commandreferral = tpidefs.alarmcommand.bypass;
    this.alarm.isProcessingBypass = true;
    // Note: any pending unbypass watchdog on zone accessories is cancelled by the
    // index.js call site before invoking reestablishZoneBypass() — see partitionUpdate
    // and cidUpdate. The stub loop that was here did nothing (_getZoneAccessoryIndex
    // does not exist on this class) and has been removed.

    // Iterate through each zone and send a discrete bypass command
    for (const zoneNumber of this.bypassedZones) {
        const formattedZone = (this.deviceType === "128FBP")
        ? (("00" + Number(zoneNumber)).slice(-3))
        : (("0" + Number(zoneNumber)).slice(-2));

        // Construct individual command: PIN + 6 + ZONE
        const l_alarmCommand = this.pin + tpidefs.alarmcommand.bypass + formattedZone;
        this.log(`reestablishZoneBypass: Sent bypass for zone: ${formattedZone}`);
        // Send the command for the individual zone bypass
        this.alarm.sendCommand(l_alarmCommand);
        // Await the delay — without await the sleep() Promise is discarded and
        // all commands fire in a tight loop, defeating the inter-command spacing.
        await sleep(waitTime);
    }
    await sleep(FINAL_SETTLING_TIME);
    this.log(`${this.bypassedZones.size} zone(s) queued for bypass.`);

    // Safety watchdog is set HERE — after all commands have been sent and the
    // settling time has elapsed. Starting it before sendCommand() would consume
    // part of the timeout budget just waiting for the send loop to complete,
    // leaving the panel less time to respond before the watchdog fires.
    // commandTimeOut gives the panel its full allocated window from this point.
    if (this.bypassWatchdogHandle) clearTimeout(this.bypassWatchdogHandle);
    this.bypassWatchdogHandle = setTimeout(() => {
        if (this.alarm.isProcessingBypass) {
            this.log.warn(`[Partition ${this.partitionNumber}] Bypass time expired — panel did not confirm all bypasses. ${this.alarm.processingBypassqueue} zones were still pending.`);
            this.alarm.isProcessingBypass = false;
            this.alarm.processingBypassqueue = 0;
            this.alarm.commandreferral = 0;
        }
        this.bypassWatchdogHandle = undefined;
    }, this.commandTimeOut * SECONDS);
  }


  // Restore bypassedZones from Homebridge storage on plugin startup.
  // Returns true if data was restored, false if no file found or load failed.
  restoreBypassedZones() {
    const fs = require('fs');
    const path = require('path');

    try {
        const filePath = path.join(this.api.user.storagePath(), 
            `envisalink-bypass-p${this.partitionNumber}.json`);

        if (!fs.existsSync(filePath)) {
            this.log.debug(`restoreBypassedZones: [Partition ${this.partitionNumber}] No saved bypass file found, starting fresh.`);
            return false;
        }

        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(data.bypassedZones)) {
            this.bypassedZones = new Set(data.bypassedZones.map(Number));
            this.log(`restoreBypassedZones: [Partition ${this.partitionNumber}] Restored zones: ${Array.from(this.bypassedZones)}`);
            return true;
        }
    } catch (err) {
        this.log.warn(`restoreBypassedZones: [Partition ${this.partitionNumber}] Failed to restore bypassedZones: ${err.message}`);
    }
    return false;
  }

// Persist bypassedZones to Homebridge storage so it survives plugin restarts.
// File is stored at <homebridge_storage_path>/envisalink-bypass-p<partitionNumber>.json
// Uses a debounce so that rapid CID 570 bursts during reestablishZoneBypass() (N zones)
// result in only ONE disk write after the burst settles, rather than N blocking writes
// that would stall the Node.js event loop and risk missing subsequent CID events.
saveBypassedZones() {
    if (this._saveDebounceHandle) clearTimeout(this._saveDebounceHandle);
    this._saveDebounceHandle = setTimeout(() => {
        this._saveDebounceHandle = undefined;
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(this.api.user.storagePath(),
            `envisalink-bypass-p${this.partitionNumber}.json`);
        const data = JSON.stringify({ bypassedZones: Array.from(this.bypassedZones) });
        // Use non-blocking writeFile — writeFileSync would block the event loop and
        // could cause the plugin to miss incoming TPI CID events during reestablish.
        fs.writeFile(filePath, data, 'utf8', (err) => {
            if (err) {
                this.log.warn(`saveBypassedZones: [Partition ${this.partitionNumber}] Failed to save bypassedZones: ${err.message}`);
            } else {
                this.log.debug(`saveBypassedZones: [Partition ${this.partitionNumber}] Saved zones: ${Array.from(this.bypassedZones)}`);
            }
        });
    }, 300); // 300 ms debounce — comfortably longer than inter-command spacing
  }
}

module.exports = EnvisalinkPartitionAccessory;