const packageJson = require('./package.json');
var elink = require('./envisalink.js');
var tpidefs = require('./tpi.js');
const partitionDevice = require('./accessories/partitionAccessory');
const zoneDevices = require('./accessories/zoneAccessory');
const customDevices = require('./accessories/customAccessory');
var Service, Characteristic, UUIDGen;
var alarm;

// Envisakit HomeBridge Plugin
const PLUGIN_NAME = 'homebridge-envisalink-ademco';
const PLATFORM_NAME = 'Envisalink-Ademco';

class EnvisalinkPlatform {

    constructor(log, config, api)  {
        this.log = log;
        this.api = api;
        this.config = config;
        this.accessories = [];
        // Must define configuration file and IP address for Envisakit server
        if (!config || !config.host) {
            this.log.error("No configuration or host address defined for plug-in. Please configure the Envisakit Ademco plug-in.");
            // terminate plug-in initialization
            return;

        } else {

            // Read configuration file and set default if needed.
            this.deviceType = config.deviceType ? config.deviceType : "10P";
            this.deviceDescription = "Honeywell VISTA-" + this.deviceType;
            this.partitions = config.partitions ? config.partitions : [{
                name: 'House'
            }];
            this.masterPin = this.config.pin ? this.config.pin : "1234";
            this.bypass = config.bypass ? config.bypass : [];
            this.speedKeys = config.speedKeys ? config.speedKeys : [];
            this.zones = config.zones ? config.zones : [];
            this.platformPartitionAccessories = [];
            this.platformZoneAccessories = [];
            this.platformZoneAccessoryMap = {};
            this.platformPartitionAccessoryMap = {};
            this.activeAccessoryMap = {};
            this.chime = config.chimeToggle ? config.chimeToggle: false;
            this.batteryRunTime = config.batteryRunTime ? config.batteryRunTime: 0;
            // Fix: guard against undefined config.commandTimeOut which causes NaN
            // propagation through Math.min/max, resulting in setTimeout(fn, NaN)
            // which fires immediately — causing watchdogs to trigger in ~1-2 seconds
            // instead of the configured commandTimeOut seconds.
            this.commandTimeOut = Math.min(30, Math.max(1, config.commandTimeOut || 10));
            // Should partition be changed when executing command?
            // Option only valid if this is a multiple partitions system
            this.changePartition = config.changePartition ? config.changePartition: false;

            // Allow alarm to be enabled with fire trouble
            this.ignoreFireTrouble = config.ignoreFireTrouble ? config.ignoreFireTrouble: false;

            // Allow alarm to be enabled with system trouble
            this.ignoreSystemTrouble = config.ignoreSystemTrouble ? config.ignoreSystemTrouble: false;

            // are we in maintenance mode?
            this.isMaintenanceMode = config.maintenanceMode ? config.maintenanceMode: false;

            // suppress envisalink failure?
            this.isEnvisalinkFailureSuppress = config.envisalinkFailureSuppress ? config.envisalinkFailureSuppress: false;

            // When this event is fired it means Homebridge has restored all cached accessories from disk.
            // Dynamic Platform plugins should only register new accessories after this event was fired,
            // in order to ensure they weren't added to homebridge already. This event can also be used
            // to start discovery of new accessories.
            api.on('didFinishLaunching', () => {
                // Create connection object 
                alarm = new elink(log, config);
                // Build device list
                this.log("Configuring", this.deviceDescription, " for Homekit...");
                this.refreshPartitionsAccessories();
                this.refreshZoneAccessories();
                this.refreshCustomAccessories();
                this.removeOrphanAccessory();

                // Provide status on configurations completed
                this.log(`Partition configured: ${this.partitions.length}`);
                if (this.zones.length > 0) this.log(`Zone accessories configured: ${this.zones.length}`);
                if (this.bypass.length > 0){
                    if (this.bypass[0].enabledbyPass) this.log("Bypass accessories configured.");
                }
                if (this.speedKeys.length > 0) this.log("Speed keys accessories configured.");
                if (this.chime) this.log("Chime toggle accessory configured.")
                // Begin connection process and bind alarm events to local function.
                // Should plug-in run in a disconnect mode. Allow maintenance without resulting in a lot of log errors 
                if (this.isMaintenanceMode == false){
                    // Start connection to Envisalink module
                    alarm.startSession();
                    // Bind event to local functions
                    alarm.on('keypadupdate', this.systemUpdate.bind(this));
                    alarm.on('zoneevent', this.zoneUpdate.bind(this));
                    alarm.on('updatepartition', this.partitionUpdate.bind(this));
                    alarm.on('cidupdate', this.cidUpdate.bind(this));
                    
                    // Should module errors be suppressed from homekit notification?
                    if (this.isEnvisalinkFailureSuppress == false) alarm.on('envisalinkupdate', this.envisalinkUpdate.bind(this));
                    else this.log.warn("No alarm Tamper will be generated for Envisalink communication failure. Please refer to your Homebridge logs for communication failures.");
                
                    // Sync panel zone status using virtual keypad at startup.
                    setTimeout(function () {alarm.syncZones(this.masterPin)}.bind(this),config.heartbeatInterval*1000);
                   
                }
                else
                    this.log.warn("This plug-in is running in maintenance mode. All updates and operations are disabled!");
            });
        }
    }

    // ****************************************************
    // * Homekit Accessories from envisalink module       *
    // ****************************************************
    // Create associates in Homekit based on configuration file
    refreshPartitionsAccessories() {
        // Process partition data
        for (var i = 0; i < this.partitions.length; i++) {
            var partition = this.partitions[i];
            var partitionNumber = Number(partition.partitionNumber ? partition.partitionNumber : (i+1));
            partition.pin = partition.partitionPin ? partition.partitionPin: this.masterPin;
            if(isNaN(partition.pin)) {
                this.log.error("Ademco Pin must be a number. Please update configuration for the Envisakit Ademco plug-in.");
                // terminate plug-in initialization
                return;
            }
            if(partition.pin.length != 4) {
                this.log.warn("Ademco PIN are normally length of 4 digits. The provided PIN length may result in unusual behavior.");
            }
            partition.model = this.deviceDescription + " Keypad";
            partition.deviceType =  this.deviceType;
            // set command timeout 
            partition.commandTimeOut = this.commandTimeOut;
            partition.batteryRunTime = this.batteryRunTime * 60 * 60;
            partition.changePartition = this.changePartition;
            partition.serialNumber = "envisalink.partition." + partitionNumber;
            partition.partitionNumber = partitionNumber;
            partition.api = this.api;
            // Allow alarm to be enabled with fire trouble
            partition.ignoreFireTrouble = this.ignoreFireTrouble;
            // Allow alarm to be enabled with system trouble
            partition.ignoreSystemTrouble = this.ignoreSystemTrouble;

            var partitionAccessory = new partitionDevice(this.log, partition, Service, Characteristic, UUIDGen, alarm);
            // check the accessory was not restored from cache
            var foundAccessory = this.accessories.find(accessory => accessory.UUID === partitionAccessory.uuid)
            if (!foundAccessory) {
                // create a new accessory
                let newAccessory = new this.api.platformAccessory(partitionAccessory.name, partitionAccessory.uuid);
                // add services and Characteristic
                partitionAccessory.setAccessory(newAccessory);
                // register the accessory
                this.addAccessory(partitionAccessory);
            }
            else { // accessory already exists — just set characteristic
                partitionAccessory.setAccessory(foundAccessory); 
            }
            // Add to active accessory list, which is later used to remove unused cache entries  
            this.activeAccessoryMap[partitionAccessory.uuid] = true;

            var partitionIndex = this.platformPartitionAccessories.push(partitionAccessory) - 1;
            this.platformPartitionAccessoryMap['p.' + partitionNumber] = partitionIndex;
            this.log.debug("refreshAccessories: Partition number - ", partitionNumber , " configured.");
        }
    }

    // Create zone accessories in Homekit based on configuration file
    refreshZoneAccessories() {
        var maxZone = this.zones.length;
        for (var i = 0; i < this.zones.length; i++) {
            var zone = this.zones[i];
            if ((zone.sensorType == "motion" || zone.sensorType == "tilt" || zone.sensorType == "glass" || zone.sensorType == "window" || zone.sensorType == "door" || zone.sensorType == "leak" || zone.sensorType == "smoke" || zone.sensorType == "co") && (zone.name != undefined)){
                var zoneNum = Number(zone.zoneNumber ? zone.zoneNumber : (i+1));
                if (zoneNum > maxZone) {
                    maxZone = zoneNum;
                }
                zone.model = this.deviceDescription + " " + zone.sensorType.charAt(0).toUpperCase() + zone.sensorType.slice(1) + " sensor";
                zone.serialNumber = "envisalink." + zone.sensorType + "."+ zone.partition + "." + zoneNum;
                if (this.bypass.length > 0) 
                    zone.masterBypass = this.bypass[0].enabledbyPass; 
                else    
                    zone.masterBypass = false;
                zone.pin = this.masterPin;
                zone.commandTimeOut = this.commandTimeOut;

                var zoneAccessory = new zoneDevices(this.log, zone, Service, Characteristic, UUIDGen, alarm);
                // check the accessory was not restored from cache
                var foundAccessory = this.accessories.find(accessory => accessory.UUID === zoneAccessory.uuid)
                if (!foundAccessory) {
                    // create a new accessory
                    let newAccessory = new this.api.platformAccessory(zoneAccessory.name, zoneAccessory.uuid);
                    // add services and Characteristic
                    zoneAccessory.setAccessory(newAccessory);
                    // register the accessory
                    this.addAccessory(zoneAccessory);
                }
                else { // accessory already exists — just set characteristic
                    zoneAccessory.setAccessory(foundAccessory); 
                }
                // Add to active accessory list, which is later used to remove unused cache entries
                this.activeAccessoryMap[zoneAccessory.uuid] = true;

                var accessoryIndex = this.platformZoneAccessories.push(zoneAccessory) - 1;
                this.platformZoneAccessoryMap['z.' + zoneNum] = accessoryIndex;
                this.log.debug('refreshAccessories: Zone number - ' + zoneNum + ' configured.');
            } else 
                this.log.error('Misconfigured zone definition "' + zone.name + '". Entry - ' + i + ' ignoring.');
        }
    }

    // Create custom accessories in Homekit based on configuration file
    refreshCustomAccessories() {

        // Process toggle chime switch functionality 
        if (this.chime) {
            var chimeswitch = {};
            chimeswitch.pin = this.masterPin;
            chimeswitch.model = this.deviceDescription + " Keypad";
            chimeswitch.name  = "Chime";
            chimeswitch.customType = "chimemode";
            chimeswitch.serialNumber = "envisalink.chime.all";
            chimeswitch.commandTimeOut = this.commandTimeOut;
            // Create Chime Toggle button
            var customAccessory = new customDevices(this.log, chimeswitch, Service, Characteristic, UUIDGen, alarm);
            // check the accessory was not restored from cache
            var foundAccessory = this.accessories.find(accessory => accessory.UUID === customAccessory.uuid)
            if (!foundAccessory) {
                // create a new accessory
                let newAccessory = new this.api.platformAccessory(customAccessory.name, customAccessory.uuid);
                // add services and Characteristic
                customAccessory.setAccessory(newAccessory);
                // register the accessory
                this.addAccessory(customAccessory);
            }
            else { // accessory already exists — just set characteristic
                customAccessory.setAccessory(foundAccessory);
            }
            // Add to active accessory list, which is later used to remove unused cache entries
            this.activeAccessoryMap[customAccessory.uuid] = true;

            var accessoryIndex = this.platformPartitionAccessories.push(customAccessory) - 1;
            this.platformPartitionAccessoryMap['c.chimemode'] = accessoryIndex;
        }

        // Process bypass features (only one bypass button is created)
        if (this.bypass.length > 0) {
            if (this.bypass[0].enabledbyPass) {
                var bypassswitch = this.bypass[0];
                bypassswitch.pin = this.masterPin;
                bypassswitch.model = this.deviceDescription + " Keypad";
                bypassswitch.name  = "Zone Bypass";
                bypassswitch.customType = "bypass";
                bypassswitch.serialNumber = "envisalink.bypass.all";
                bypassswitch.commandTimeOut = this.commandTimeOut;
                bypassswitch.zoneDevices = this.platformZoneAccessories;
            
                // Create bypass switch
                var customAccessory = new customDevices(this.log, bypassswitch, Service, Characteristic, UUIDGen, alarm);
                // check the accessory was not restored from cache
                var foundAccessory = this.accessories.find(accessory => accessory.UUID === customAccessory.uuid)
                if (!foundAccessory) {
                    // create a new accessory
                    let newAccessory = new this.api.platformAccessory(customAccessory.name, customAccessory.uuid);
                    // add services and Characteristic
                    customAccessory.setAccessory(newAccessory);
                    // register the accessory
                    this.addAccessory(customAccessory);
                }
                else { // accessory already exists — just set characteristic
                    customAccessory.setAccessory(foundAccessory);
                }
                // Add to active accessory list, which is later used to remove unused cache entries
                this.activeAccessoryMap[customAccessory.uuid] = true;
                var accessoryIndex = this.platformPartitionAccessories.push(customAccessory) - 1;
                this.platformPartitionAccessoryMap['c.bypass'] = accessoryIndex;
            }
        }

        // Creating macro/speed keys 
        if (this.speedKeys.length > 0) {
            var islableUnique = true;
            // Are key names unique?
            if (this.speedKeys && Array.isArray(this.speedKeys)) {
                const names = this.speedKeys.map(key => key.name);
                const uniqueNames = [...new Set(names)];
    
                if (names.length !== uniqueNames.length) {
                    this.log.error('Duplicate Speed Key Labels found. Each label must be unique. Ignoring Speed Key configuration.');
                    islableUnique = false;
                }
            }
            
            if (islableUnique == true) {
                for (var i = 0; i < this.speedKeys.length; i++) {
                    this.speedKeys[i].pin = this.masterPin;
                    this.speedKeys[i].model = this.deviceDescription + " Keypad";
                    this.speedKeys[i].customType = "speedkeys";
                    this.speedKeys[i].serialNumber = "envisalink.speedKey." + this.speedKeys[i].name;

                    var customAccessory = new customDevices(this.log, this.speedKeys[i], Service, Characteristic, UUIDGen, alarm);
                    // check the accessory was not restored from cache
                    var foundAccessory = this.accessories.find(accessory => accessory.UUID === customAccessory.uuid)
                    if (!foundAccessory) {
                        // create a new accessory
                        let newAccessory = new this.api.platformAccessory(customAccessory.name, customAccessory.uuid);
                        // add services and Characteristic
                        customAccessory.setAccessory(newAccessory);
                        // register the accessory
                        this.addAccessory(customAccessory);
                    }
                    else { // accessory already exists — just set characteristic
                        customAccessory.setAccessory(foundAccessory);
                    }
                    // Add to active accessory list, which is later used to remove unused cache entries
                    this.activeAccessoryMap[customAccessory.uuid] = true;
                    var accessoryIndex = this.platformPartitionAccessories.push(customAccessory) - 1;
                    this.platformPartitionAccessoryMap['c.speedkey' + i] = accessoryIndex;
                }
            }
        }
    }

    // ****************************************************
    // * Event Processor from envisalink module           *
    // ****************************************************
    // The envisalink event represents issues related to low level layers which affect all partitions.
    envisalinkUpdate(data) {
        this.log.debug('envisalinkUpdate:  Status changed - ', data);
        // since issue related to EVL module it affects all partitions
        for (var i = 1; i < this.partitions.length+1; i++) {
            var partitionIndex = this.platformPartitionAccessoryMap['p.' + Number(i)];
            if (partitionIndex !== undefined ) {
                var partition = this.platformPartitionAccessories[partitionIndex];
                if (partition) {
                    var partitionService = partition.accessory.getService(Service.SecuritySystem);
                    switch(data.source)
                    {
                        case "session_connect_status":
                            {
                                if(data.qualifier == 1) partitionService.updateCharacteristic(Characteristic.StatusFault,Characteristic.StatusTampered.TAMPERED);
                                if(data.qualifier == 3) partitionService.updateCharacteristic(Characteristic.StatusFault,Characteristic.StatusTampered.NOT_TAMPERED);
                           }
                        break;
                    }
                }
            }
        }
    }

    // Capture general keypad updates including chime and bypass events
    systemUpdate(data) {
        this.log.debug('systemUpdate: Status changed - ', data);
        var partitionIndex = this.platformPartitionAccessoryMap['p.' + Number(data.partition)];
        var accessorybypassIndex = this.platformPartitionAccessoryMap['c.bypass'];
        var accessoryChimeIndex = this.platformPartitionAccessoryMap['c.chimemode'];
        if (partitionIndex !== undefined ) {
            var partition = this.platformPartitionAccessories[partitionIndex];
            // partition update information
            if (partition) {
                if ((partition.processingPartitionCmd == false) && (partition.accessoryType == "partition")) {
                    if ((partition.envisakitCurrentStatus != data.mode)) {
                        partition.envisakitCurrentStatus = data.mode;
                        this.log.debug("systemUpdate: partition change - " + partition.name + ' to ' + partition.envisakitCurrentStatus);
                        const partitionService = partition.accessory.getService(Service.SecuritySystem);
                        if (partitionService) {
                            if (partition.homekitLastTargetState != partition.ENVISA_TO_HOMEKIT_TARGET[data.mode])
                                {
                                    partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState,partition.ENVISA_TO_HOMEKIT_CURRENT[data.mode]);
                                    if(data.mode != 'ALARM') {
                                        partitionService.updateCharacteristic(Characteristic.SecuritySystemTargetState,partition.ENVISA_TO_HOMEKIT_TARGET[data.mode]);  
                                        partition.homekitLastTargetState = partition.ENVISA_TO_HOMEKIT_TARGET[data.mode];
                                    }
                                }       
                            // if system is not ready or has a fault set general fault
                            if (partition.envisakitCurrentStatus.includes('NOT_READY') || partition.envisakitCurrentStatus.includes('ALARM_MEMORY') || partition.envisakitCurrentStatus.includes('READY_FIRE_TROUBLE') || partition.envisakitCurrentStatus.includes('READY_SYSTEM_TROUBLE')) partitionService.updateCharacteristic(Characteristic.StatusFault,Characteristic.StatusFault.GENERAL_FAULT); 
                            else partitionService.updateCharacteristic(Characteristic.StatusFault,Characteristic.StatusFault.NO_FAULT);
                        }
                    }                 
                }
            }
        } else {
            this.log('System status reported: Partition is not monitored, dismissing status update.'); 
        }

        // if chime enabled update status
        if (accessoryChimeIndex !== undefined) {
            var accessoryChime = this.platformPartitionAccessories[accessoryChimeIndex];
            if (accessoryChime) {
                if ((accessoryChime.envisakitCurrentStatus != data.keypadledstatus.chime) && (accessoryChime.isProcessingChimeOnOff == false)) {
                    accessoryChime.envisakitCurrentStatus = data.keypadledstatus.chime;
                    this.log.debug("systemUpdate: Accessory chime change - " + accessoryChime.name + ' to ' +  accessoryChime.envisakitCurrentStatus);
                    if (accessoryChime.customType == "chimemode") {
                        var accessoryService = accessoryChime.accessory.getService(Service.Switch);
                        accessoryService.updateCharacteristic(Characteristic.On,data.keypadledstatus.chime);
                    }
                }
                // Has the condition been met that the processing flag can be cleared?
                if((accessoryChime.envisakitCurrentStatus == data.keypadledstatus.chime) && (accessoryChime.isProcessingChimeOnOff == true)){
                    accessoryChime.isProcessingChimeOnOff = false;
                }
            }
        }

        // if bypass switch enabled update status
        if (accessorybypassIndex !== undefined) {
            var accessoryBypass = this.platformPartitionAccessories[accessorybypassIndex];
            if (accessoryBypass) {
                if (accessoryBypass.envisakitCurrentStatus !=  data.mode){
                    accessoryBypass.envisakitCurrentStatus = data.mode;
                    this.log.debug("systemUpdate: Accessory bypass change - " + accessoryBypass.name + ' to ' + accessoryBypass.envisakitCurrentStatus);
                    if (accessoryBypass.customType == "bypass") {
                        var accessoryService = accessoryBypass.accessory.getService(Service.Switch);
                        accessoryService.updateCharacteristic(Characteristic.On,accessoryBypass.ENVISA_BYPASS_TO_HOMEKIT[data.mode]);
                    }
                }
            }
        } 

        // Check if panel is on battery power (loss power)
        if(!data.keypadledstatus.ac_present){
            if(partition.ChargingState == Characteristic.ChargingState.CHARGING) {
                partition.ChargingState = Characteristic.ChargingState.NOT_CHARGING; 
                partition.downTime = new Date(); 
            }
        } else partition.ChargingState = Characteristic.ChargingState.CHARGING;
        
    }

    // Capture partition updates associated with arm, disarm, and bypass state changes.
    async partitionUpdate(data) {
        this.log.debug('partitionUpdate: status change - ', data);

        // --- Guard: partition must be monitored ---
        const partitionIndex = this.platformPartitionAccessoryMap['p.' + Number(data.partition)];
        if (partitionIndex === undefined) {
            this.log.debug('partitionUpdate: Partition not monitored, dismissing update.');
            return;
        }

        const partition = this.platformPartitionAccessories[partitionIndex];
        if (!partition) {
            this.log.debug('partitionUpdate: Partition accessory not found, dismissing update.');
            return;
        }

        const partitionService = partition.accessory.getService(Service.SecuritySystem);
        if (!partitionService) {
            this.log.debug('partitionUpdate: Partition service not found, dismissing update.');
            return;
        }

        // --- Section 1: Update HomeKit partition state ---
        // Both ENVISA_TO_HOMEKIT_CURRENT and ENVISA_TO_HOMEKIT_TARGET now cover every
        // mode the panel can emit including ALARM and NOT_READY_TROUBLE, so no undefined
        // guard is needed. The ALARM carve-out on target state is also removed — ALARM
        // now maps explicitly to DISARM in ENVISA_TO_HOMEKIT_TARGET, which is correct
        // since HomeKit requires a valid target state even when an alarm is triggered.
        const targetState  = partition.ENVISA_TO_HOMEKIT_TARGET[data.mode];
        const currentState = partition.ENVISA_TO_HOMEKIT_CURRENT[data.mode];
        const stateChanged = !partition.processingPartitionCmd &&
                             (partition.homekitLastTargetState !== targetState);

        if (stateChanged) {
            partition.envisakitCurrentStatus = data.mode;
            this.log.debug(`partitionUpdate: Partition ${partition.name} changed to ${partition.envisakitCurrentStatus}`);
            partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState, currentState);
            partitionService.updateCharacteristic(Characteristic.SecuritySystemTargetState, targetState);
            partition.homekitLastTargetState = targetState;
        }

        // Fault status always reflects the current known partition state.
        // Uses partition.envisakitCurrentStatus (not data.mode) so it remains consistent
        // even when the stateChanged guard above blocks a HomeKit update.
        const hasFault = partition.envisakitCurrentStatus.includes('NOT_READY') ||
                         partition.envisakitCurrentStatus.includes('ALARM_MEMORY');
        partitionService.updateCharacteristic(
            Characteristic.StatusFault,
            hasFault ? Characteristic.StatusFault.GENERAL_FAULT : Characteristic.StatusFault.NO_FAULT
        );

        // --- Section 2: Clear arming command in progress ---
        // Bug fix: original code called clearTimeout(partition.armingTimeOut) but the
        // handle is stored as partition.armingTimeOutHandle — the timeout was never
        // actually cleared, causing the arming watchdog to always fire after commandTimeOut.
        if (partition.processingPartitionCmd) {
            this.log.debug('partitionUpdate: Clearing arming command processing flag.');
            partition.processingPartitionCmd = false;
            alarm.commandreferral = "";
            clearTimeout(partition.armingTimeOutHandle);
            partition.armingTimeOutHandle = undefined;
        }

        // Shared condition used by both Section 3 and Section 4.
        // Confirms the panel has returned to a fully clean disarmed state with no
        // bypasses active — the only reliable signal that a disarm has fully settled.
        const isCleanDisarmedState = !data.mode.includes('ARMED') &&
                                     !data.mode.includes('BYPASS');

        // --- Section 3: Unbypass completion ---
        // Triggered independently of clearzonebypass so it covers the disarmed-state
        // unbypass case where the system was never armed. The panel does not reliably
        // emit CID 570 qualifier 3 on a full disarm, so the partition returning to a
        // clean non-armed non-bypass state is the authoritative completion signal.
        if (alarm.isProcessingUnBypass && isCleanDisarmedState) {
            this.log(`partitionUpdate: Disarm confirmed — unbypass processing complete.`);
            alarm.isProcessingUnBypass = false;
            alarm.processingUnBypassqueue = 0;

            // Cancel all zone-level unbypass watchdogs for this partition before
            // reestablishZoneBypass() sets isProcessingBypass. A stale isProcessingUnBypass
            // alongside isProcessingBypass would block all future bypass requests.
            for (const za of this.platformZoneAccessories) {
                if (za.partition === partition.partitionNumber && za.unbypassWatchdogHandle) {
                    clearTimeout(za.unbypassWatchdogHandle);
                    za.unbypassWatchdogHandle = undefined;
                }
            }

            // Targeted unbypass: one specific zone was removed. Delete it from memory
            // then reestablish bypasses for all remaining zones, since the disarm
            // cleared all bypasses on the panel as a side effect.
            if (partition.bypassedZonesMemory && alarm.commandreferral === tpidefs.alarmcommand.targetedunbypass) {
                this.log(`partitionUpdate: Removing zone ${alarm.targetUnbypassZoneNumber} from bypass memory.`);
                partition.bypassedZones.delete(alarm.targetUnbypassZoneNumber);
                partition.saveBypassedZones();
                this.log(`partitionUpdate: bypassedZones remaining: ${Array.from(partition.bypassedZones)}`);
                alarm.commandreferral = 0;
                alarm.targetUnbypassZoneNumber = 0;
                // reestablishZoneBypass is async — await so its full send loop completes
                // before any further partition events are processed.
                await partition.reestablishZoneBypass();
            } else {
                // Fix (Problem 3 & 4): Non-targeted path previously did nothing to
                // bypassedZones, leaving stale entries that would be re-bypassed on the
                // next disarm by reestablishZoneBypass(). Two sub-cases:
                //
                //   targetUnbypassZoneNumber === 0 → master unbypass (customAccessory cleared
                //   ALL bypasses via disarm). Clear the entire bypassedZones set since the
                //   panel has removed every bypass.
                //
                //   targetUnbypassZoneNumber > 0 → single-zone unbypass with bypassedZonesMemory
                //   disabled. Remove only that zone so it is not re-bypassed on the next disarm.
                if (alarm.targetUnbypassZoneNumber === 0) {
                    this.log(`partitionUpdate: Master unbypass detected — clearing all zones from bypass memory.`);
                    partition.bypassedZones.clear();
                    partition.saveBypassedZones();
                } else {
                    this.log(`partitionUpdate: Removing zone ${alarm.targetUnbypassZoneNumber} from bypass memory (non-targeted path).`);
                    partition.bypassedZones.delete(alarm.targetUnbypassZoneNumber);
                    partition.saveBypassedZones();
                    alarm.targetUnbypassZoneNumber = 0;
                }
                alarm.commandreferral = 0;
            }
        }

        // --- Section 4: Arm-to-disarm bypass UI clearing ---
        // clearzonebypass is only set when the panel transitions to ARMED (Section 5).
        // When a subsequent disarm is confirmed via a clean non-armed non-bypass state,
        // clear all individual zone bypass switches in HomeKit to reflect that the panel
        // has cleared all bypasses as a side effect of the disarm.
        if (partition.clearzonebypass && isCleanDisarmedState) {
            this.log(`partitionUpdate: Arm-to-disarm detected. Clearing zone bypass switches. ` +
                     `Total zone accessories: ${this.platformZoneAccessories.length}`);

            for (const zoneAccessory of this.platformZoneAccessories) {
                // Scope to bypassed individual-switch zones on this partition only.
                // Master bypass zones manage their own UI via customAccessory.
                if (zoneAccessory.partition === partition.partitionNumber &&
                    zoneAccessory.bypassStatus === true &&
                    zoneAccessory.config.masterBypass === false) {
                    this.log(`partitionUpdate: Clearing bypass switch for zone ${zoneAccessory.name}`);
                    zoneAccessory.bypassStatus = false;
                    const bypassSwitch = zoneAccessory.accessory.getService(Service.Switch);
                    if (bypassSwitch) bypassSwitch.updateCharacteristic(Characteristic.On, false);
                }
            }
            partition.clearzonebypass = false;

            // Reestablish any persisted zone bypasses or clear memory depending on config.
            // reestablishZoneBypass() is awaited so its full send loop completes before
            // any further partition events are processed.
            this.log(`partitionUpdate: bypassedZonesMemory enabled: ${partition.bypassedZonesMemory}`);
            partition.bypassedZonesMemory
                ? await partition.reestablishZoneBypass()
                : partition.bypassedZones.clear();
        }

        // --- Section 5: Set arm-to-disarm bypass clear flag ---
        // Marks that the panel is now armed so that when a subsequent disarm is
        // detected in Section 4 all zone bypass switches are cleared in HomeKit.
        if (data.mode.includes('ARMED')) {
            this.log(`partitionUpdate: ${data.mode} detected — setting clearzonebypass flag.`);
            partition.clearzonebypass = true;
        }
    }

    // Capture zone updates usually associated with sensor going from open to close and vice-versa
    zoneUpdate(data) {
        this.log.debug('zoneUpdate: Status change - ', data);
        var accessoryIndex = this.platformZoneAccessoryMap['z.' + Number(data.zone)];
        if (accessoryIndex !== undefined) {
            var zoneaccessory = this.platformZoneAccessories[accessoryIndex];
            if (zoneaccessory) {
                zoneaccessory.envisakitCurrentStatus = data.mode;
                this.log.debug("zoneUpdate: Accessory change - " + zoneaccessory.name + ' to ' + zoneaccessory.envisakitCurrentStatus);
                var accessoryService = zoneaccessory.service;
                switch(zoneaccessory.sensorType) {
                    case "motion":
                    case "glass":
                        if (accessoryService) accessoryService.getCharacteristic(Characteristic.MotionDetected).setValue(zoneaccessory.ENVISA_TO_HOMEKIT_MOTION[data.mode]);  
                    break;
    
                    case "tilt":
                        if (accessoryService) accessoryService.getCharacteristic(Characteristic.OccupancyDetected).setValue(zoneaccessory.ENVISA_TO_HOMEKIT_OCCUPANCY[data.mode]);  
                    break;
                    
                    case "door":
                    case "window":
                        if (accessoryService) accessoryService.getCharacteristic(Characteristic.ContactSensorState).setValue(zoneaccessory.ENVISA_TO_HOMEKIT_CONTACT[data.mode]);  
                    break;

                    case "leak":
                        if (accessoryService) accessoryService.getCharacteristic(Characteristic.LeakDetected).setValue(zoneaccessory.ENVISA_TO_HOMEKIT_LEAK[data.mode]);  
                    break;

                    case "smoke":
                        if (accessoryService) accessoryService.getCharacteristic(Characteristic.SmokeDetected).setValue(zoneaccessory.ENVISA_TO_HOMEKIT_SMOKE[data.mode]);  
                    break;

                    case "co":
                        if (accessoryService) accessoryService.getCharacteristic(Characteristic.CarbonMonoxideDetected).setValue(zoneaccessory.ENVISA_TO_HOMEKIT_CO[data.mode]); 
                    break;
                }
            }
        } 
    }

    // Capture low level updates that are not generated from keypad events, but sent to monitoring station.
    async cidUpdate(data) {
        this.log.debug('cidUpdate: Status change - ', data);

        // Zone event
        if ((data.type == 'zone') && (Number(data.zone) > 0)) {
            var accessoryIndex = this.platformZoneAccessoryMap['z.' + Number(data.zone)];
            if (accessoryIndex !== undefined) {
                var accessory = this.platformZoneAccessories[accessoryIndex];
                var partitionIndex = this.platformPartitionAccessoryMap['p.' + Number(accessory.partition)];
                var partition = this.platformPartitionAccessories[partitionIndex];
                
                // Guard against zones configured on an unmonitored partition.
                // Without this, all partition.xxx accesses below throw TypeError and crash
                // the entire cidUpdate handler including non-bypass codes (150, 384, 383).
                if (!partition) {
                    this.log.warn(`cidUpdate: Zone ${data.zone} belongs to partition ${accessory.partition} which is not monitored. Skipping.`);
                    return;
                }

                var accessoryService = accessory.service;
                this.log.debug(`cidUpdate: Accessory change - Zone: ${data.zone} Name: ${accessory.name} Code: ${data.code} Qualifier: ${data.qualifier}.`);
                switch (Number(data.code)) { 

                    case 150: // Alarm, 24-Hour Auxiliary
                        if(data.qualifier == 1) accessoryService.updateCharacteristic(Characteristic.StatusFault, Characteristic.StatusFault.GENERAL_FAULT);
                        if(data.qualifier == 3) accessoryService.updateCharacteristic(Characteristic.StatusFault, Characteristic.StatusFault.NO_FAULT);
                    break;

                    case 384: // RF LOW BATTERY
                        if(data.qualifier == 1) accessoryService.updateCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
                        if(data.qualifier == 3) accessoryService.updateCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                    break;

                    case 383: // SENSOR TAMPER
                        if(data.qualifier == 1) accessoryService.updateCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.TAMPERED);
                        if(data.qualifier == 3) accessoryService.updateCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
                    break;

                    // qualifier: 1 = Event/Opening, 3 = Restore/Closing
                    case 570: // Bypass event
                        if (data.qualifier == 1) {
                            this.log(`${accessory.name} has been bypassed.`);
                            if (alarm.isProcessingBypass) { 
                                alarm.processingBypassqueue = Math.max(0, alarm.processingBypassqueue - 1);
                                this.log(`cidUpdate: processingBypassqueue decremented, new value: ${alarm.processingBypassqueue}`);
                            }

                            // Add zone to bypass memory and persist.
                            partition.bypassedZones.add(accessory.zoneNumber);
                            // If unbypass is also in progress, do not touch the unbypass queue —
                            // the panel is still processing the unbypass command.
                            if (!alarm.isProcessingUnBypass) {
                                alarm.processingUnBypassqueue = partition.bypassedZones.size;
                            }
                            partition.saveBypassedZones();
                            
                            this.log('cidUpdate: Bypass event for zone ' + accessory.zoneNumber +
                                ' bypassedZones Memory: ' + Array.from(partition.bypassedZones));

                            const bypassSwitch = accessory.accessory.getService(Service.Switch);
                            if (bypassSwitch) {
                                bypassSwitch.updateCharacteristic(Characteristic.On, true);
                                accessory.bypassStatus = true;
                            }
                        }

                        if (data.qualifier == 3) {
                            this.log(`${accessory.name} has been unbypassed.`);
                            this.log('cidUpdate: Unbypass event for zone ' + accessory.zoneNumber +
                                ', targetUnbypassZone: ' + accessory.targetUnbypassZone +
                                ', alarm command code: ' + alarm.commandreferral +
                                ', bypassedZones Memory: ' + Array.from(partition.bypassedZones));

                            // Fix (Problem 2): Guard against late-arriving CID 570 qualifier 3
                            // events after partitionUpdate has already completed the unbypass and
                            // potentially called reestablishZoneBypass() for remaining zones.
                            // bypassedZones membership is the authoritative signal:
                            //
                            //   Zone NOT in bypassedZones → partitionUpdate already removed it.
                            //   Ignore to prevent corrupting a zone that was just re-bypassed.
                            //
                            //   Zone IS in bypassedZones → legitimate unbypass signal. Covers:
                            //     - Physical keypad unbypass (plugin never initiated, zone still tracked)
                            //     - Plugin-initiated unbypass fallback via zoneTimerClose synthetic event
                            //     - In-flight unbypass not yet handled by partitionUpdate
                            if (!partition.bypassedZones.has(accessory.zoneNumber)) {
                                this.log(`cidUpdate: Zone ${accessory.zoneNumber} not in bypassedZones — ` +
                                    `unbypass already handled by partitionUpdate. Ignoring late CID 570 qualifier 3.`);
                            } else {
                                const isTargetedUnbypass = partition.bypassedZonesMemory &&
                                    alarm.commandreferral == tpidefs.alarmcommand.targetedunbypass;
                                const shouldRemove = !isTargetedUnbypass || accessory.targetUnbypassZone === true;

                                if (shouldRemove) {
                                    // Fix (Problem 1): Only modify bypassedZones and trigger a save
                                    // if the zone is actually tracked. A physical keypad unbypass of
                                    // a zone that was never added to bypassedZones should still clear
                                    // the HomeKit switch but must not trigger a spurious disk write.
                                    // The has() check above already guarantees the zone is present,
                                    // so delete and save are always correct here.
                                    partition.bypassedZones.delete(accessory.zoneNumber);
                                    partition.saveBypassedZones();
                                    accessory.targetUnbypassZone = false;
                                    const bypassSwitch = accessory.accessory.getService(Service.Switch);
                                    if (bypassSwitch) {
                                        bypassSwitch.updateCharacteristic(Characteristic.On, false);
                                        accessory.bypassStatus = false;
                                    }
                                    this.log('cidUpdate: Removed zone ' + accessory.zoneNumber +
                                        ' from bypassedZones, bypassedZones Memory: ' + Array.from(partition.bypassedZones));
                                } else {
                                    this.log('cidUpdate: Zone ' + accessory.zoneNumber + ' not targeted for unbypass, skipping.');
                                }
                            }
                        }

                        // Bypass completion: all queued bypass confirmations received.
                        // Clear processing flags and cancel watchdogs.
                        if ((alarm.processingBypassqueue <= 0) && (alarm.isProcessingBypass)) {
                            alarm.isProcessingBypass = false;
                            alarm.processingBypassqueue = 0;
                            alarm.commandreferral = 0;
                            // Cancel the zone-level watchdog (set by setByPass on a single-zone bypass)
                            if (accessory.bypassWatchdogHandle) {
                                clearTimeout(accessory.bypassWatchdogHandle);
                                accessory.bypassWatchdogHandle = undefined;
                            }
                            // Cancel the partition-level watchdog (set by reestablishZoneBypass for multi-zone)
                            if (partition.bypassWatchdogHandle) {
                                clearTimeout(partition.bypassWatchdogHandle);
                                partition.bypassWatchdogHandle = undefined;
                            }
                            this.log(`All queued bypass command(s) completed.`);
                        }
                    break;
                }
            }
        }

        // Event is related to a partition
        if (Number(data.partition) > 0) {
            var partitionIndex = this.platformPartitionAccessoryMap['p.' + Number(data.partition)];
            if (partitionIndex !== undefined ) {
                var partition = this.platformPartitionAccessories[partitionIndex];
                this.log.debug(`cidUpdate: Partition change - Partition: ${partitionIndex} Name: ${partition.name} Code: ${data.code} Qualifier: ${data.qualifier}.`);
                switch (Number(data.code)) {
                    case 301: // Trouble-AC Power
                        if((data.qualifier == 1) && (partition.ChargingState == Characteristic.ChargingState.CHARGING)) {
                            partition.ChargingState = Characteristic.ChargingState.NOT_CHARGING; 
                            partition.downTime = new Date(); 
                        }
                        if(data.qualifier == 3) partition.ChargingState = Characteristic.ChargingState.CHARGING; 
                    break;

                    case 302: // Trouble-Low Battery (AC is lost, battery is getting low)
                        if(data.qualifier == 1)
                            if (partition.batteryLevel > 20) partition.batteryLevel = 20;
                        if(data.qualifier == 3) partition.batteryLevel = 100;
                        var partitionServiceBattery = partition.getService(Service.Battery);
                        if (partitionServiceBattery) partitionServiceBattery.updateCharacteristic(Characteristic.BatteryLevel,partition.batteryLevel); 
                    break;

                    case 309: // Trouble-Battery Test Failure (Battery failed at test interval)
                    case 311: // Trouble-Battery Missing
                        if(data.qualifier == 1)
                            partition.batteryLevel = 0;
                        if(data.qualifier == 3) partition.batteryLevel = 100;
                        var partitionService = partition.accessory.getService(Service.SecuritySystem);
                        if (partitionService) partitionService.updateCharacteristic(Characteristic.BatteryLevel,partition.batteryLevel); 
                    break;

                    case 144: // Alarm-Sensor Tamper-# 
                    case 145: // Alarm-Exp. Module Tamper-#
                    case 137: // Burg-Tamper-#
                    case 316: // Trouble System Tamper
                        var partitionService = partition.accessory.getService(Service.SecuritySystem);
                        if (partitionService) {
                            if(data.qualifier == 1) partitionService.updateCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.TAMPERED);
                            if(data.qualifier == 3) partitionService.updateCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
                        }
                    break;
                }
            }
        }
    }

    // Find accessory with no association with this plug-in and remove
    removeOrphanAccessory() {
        var cachedAccessory = this.accessories;
        var foundAccessory;
        for (var i = 0; i < cachedAccessory.length; i++) 
        {   
            let accessory = cachedAccessory[i];
            foundAccessory = this.activeAccessoryMap[accessory.UUID];
            if (foundAccessory == undefined) {
                this.removeAccessory(accessory,true);
            }
        }
    }

    // Add accessory to homekit dashboard
    addAccessory(device) {
        this.log.debug('Adding accessory',device.accessory.displayName);
        try {
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [device.accessory]);
          this.accessories.push(device.accessory);
        } catch (err) {
            this.log.error(`Envisalink load Error: An error occurred while adding accessory: ${err}`);
        }
    }

    // Remove accessory from homekit dashboard
    removeAccessory(accessory, updateIndex) {
      this.log.debug('Envisalink Removing accessory:',accessory.displayName );
      if (accessory) {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
      if (updateIndex) {
        if (this.accessories.indexOf(accessory) > -1) {
            this.accessories.splice(this.accessories.indexOf(accessory), 1);
      }}
    }

    // This function is invoked when homebridge restores cached accessories from disk at startup.
    // It should be used to setup event handlers for characteristics and update respective values.
    configureAccessory(accessory) {
        this.log.debug('Loading accessory from cache:', accessory.displayName);
        // add the restored accessory to the accessories cache so we can track if it has already been registered
        this.accessories.push(accessory);
    }
}

const homebridge = homebridge => {
    Accessory = homebridge.hap.Accessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, EnvisalinkPlatform);
};
  
module.exports = homebridge;
