const packageJson = require('./package.json');
var elink = require('./envisalink.js');
var tpidefs = require('./tpi.js');
const partitionDevice = require('./accessories/partitionAccessory');
const zoneDevices = require('./accessories/zoneAccessory');
const customDevices = require('./accessories/customAccessory');
var Service, Characteristic, UUIDGen;
var alarm;

const ZONE_TIMEOUT_CONST = 2000;
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
            this.bypassedMemory = config.bypassedMemory ? config.bypassedMemory : [];
            this.platformPartitionAccessories = [];
            this.platformZoneAccessories = [];
            this.platformZoneAccessoryMap = {};
            this.platformPartitionAccessoryMap = {};
            this.activeAccessoryMap = {};
            this.chime = config.chimeToggle ? config.chimeToggle: false;
            this.batteryRunTime = config.batteryRunTime ? config.batteryRunTime: 0;
            // Guard against undefined config.commandTimeOut which causes NaN
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

            // memory for bypassed zones to support bypass persistence across multiple arm/disarm cycles
            if (this.bypassedMemory.length > 0) {
                this.bypassedZonesMemory = config.bypassedMemory[0].zoneMemory ? config.bypassedMemory[0].zoneMemory : false;

                // Config option for the probe zone bypass probing. An un-used zone is needed to scan for bypassed zones.
                this.bypassProbeZone = config.bypassedMemory[0].probeZone ? config.bypassedMemory[0].probeZone  : 99;}
            else {
                this.bypassedZonesMemory = false;
                this.bypassProbeZone = 99;
            }

            

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
                 
                // Check if bypass probe zone is configured using default value and warn about unintended consequences of default value.
                if ((!config.bypassProbeZone) && (this.bypassedZonesMemory == true) ){
                this.log.warn('A bypass probe zone was not provided, defaulting to zone 99. ' +
                    'Verify zone 99 is not wired on your panel to assure this default will not cause problems. ' +
                    'Set bypassProbeZone in your config to suppress this warning.');
                }
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

                    // Probe for bypasszones if bypass memory enabled. 
                    // This will sync the bypass state of zones at startup and after any change in bypass state.
                    if(this.bypassedZonesMemory == true) {
                        this.log.info(`Zone synchonization will started in: ${config.heartbeatInterval} seconds.`);
                        alarm.on('bypassscan', this.bypassScanUpdate.bind(this));
                        // After connection settles — probe for current bypass state
                        // heartbeatInterval gives the panel time to fully connect before the probe
                        // Waiting until idle time, don't attemp if plug is busy processing another bypass/unbypass command 
                        // to avoid conflicts. If busy, defer and retry in 5 seconds.
                        const attemptBypassSync = () => {
                            if (alarm.isProcessingBypass || alarm.isProcessingUnBypass) {
                                this.log.debug('Bypass sync deferred — operation in progress. Retrying in 5 seconds.');
                                setTimeout(attemptBypassSync, 5000);
                                return;
                            }
                            alarm.bypassProbeZone = this.bypassProbeZone;
                            for (let i = 0; i < this.partitions.length; i++) {
                                alarm.syncBypassedZones(this.masterPin, this.bypassProbeZone);
                            }
                        };
                        setTimeout(attemptBypassSync, config.heartbeatInterval * 1000);
                    } 
                    
                    // Should module errors be suppressed from homekit notification?
                    if (this.isEnvisalinkFailureSuppress == false) alarm.on('envisalinkupdate', this.envisalinkUpdate.bind(this));
                    else this.log.warn("No alarm Tamper will be generated for Envisalink communication failure. Please refer to your Homebridge logs for communication failures.");
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
            // memory for bypassed zones to support bypass persistence across multiple arm/disarm cycles
             partition.bypassedZonesMemory = this.bypassedZonesMemory;

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
        // max waiting time for zone command timeout 
        const maxWait = Math.max(((this.zones.length * ZONE_TIMEOUT_CONST) + ZONE_TIMEOUT_CONST), (this.commandTimeOut * 1000));
        
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
                zone.commandTimeOut = maxWait;

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
            this.log.warn('System status reported: Partition is not monitored, dismissing status update.'); 
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
        if (partition.bypassedZonesMemory && alarm.commandreferral === tpidefs.alarmcommand.targetedunbypass) {
            // Targeted unbypass: one specific zone was removed. Delete it from memory
            // then reestablish bypasses for all remaining zones, since the disarm
            // cleared all bypasses on the panel as a side effect.
            this.log.debug(`partitionUpdate: Removing zone ${alarm.targetUnbypassZoneNumber} from bypass memory.`);
            partition.bypassedZones.delete(Number(alarm.targetUnbypassZoneNumber));
            //partition.saveBypassedZones();
            this.log.debug(`partitionUpdate: bypassedZones remaining: ${Array.from(partition.bypassedZones)}`);
            alarm.commandreferral = 0;
            alarm.targetUnbypassZoneNumber = 0;
            // reestablishZoneBypass is async — await so its full send loop completes
            // before any further partition events are processed.
            await partition.reestablishZoneBypass();

        } else {
            // Non-targeted path — covers two sub-cases, neither of which reestablishes.
            //
            //   targetUnbypassZoneNumber === 0 → master unbypass (customAccessory cleared
            //   ALL bypasses via disarm). Clear the entire bypassedZones set since the
            //   panel has removed every bypass. Never reestablish — the user intentionally
            //   cleared all bypasses.
            //
    
            if ((alarm.targetUnbypassZoneNumber === 0) && (alarm.commandreferral === tpidefs.alarmcommand.disarm)) {
                this.log.debug(`partitionUpdate: Master unbypass detected — clearing all zones from bypass memory.`);
                partition.bypassedZones.clear();
                //partition.saveBypassedZones();
            }
            alarm.commandreferral = 0;
            // reestablishZoneBypass is intentionally NOT called here. The non-targeted
            // path means either the user cleared all bypasses (master unbypass) or memory
            // is disabled — in both cases re-bypassing would contradict the user's intent.
        }
        // --- Section 4: Arm-to-disarm bypass UI clearing ---
        // clearzonebypass is only set when the panel transitions to ARMED (Section 5).
        // When a subsequent disarm is confirmed via a clean non-armed non-bypass state,
        // clear all individual zone bypass switches in HomeKit to reflect that the panel
        // has cleared all bypasses as a side effect of the disarm.
        if (partition.clearzonebypass && isCleanDisarmedState) {
            this.log(`Arm-to-disarm detected. Clearing zone bypass switches. ` +
                     `Total zone accessories: ${this.platformZoneAccessories.length}`);

            for (const zoneAccessory of this.platformZoneAccessories) {
                // Scope to bypassed individual-switch zones on this partition only.
                // Master bypass zones manage their own UI via customAccessory.
                if (String(zoneAccessory.partition) === String(partition.partitionNumber) &&
                    zoneAccessory.bypassStatus === true &&
                    zoneAccessory.config.masterBypass === false) {
                    this.log.debug(`partitionUpdate: Clearing bypass switch for zone ${zoneAccessory.name}`);
                    zoneAccessory.bypassStatus = false;
                    const bypassSwitch = zoneAccessory.accessory.getService(Service.Switch);
                    if (bypassSwitch) bypassSwitch.updateCharacteristic(Characteristic.On, false);
                }
                else this.log.debug(`partitionUpdate: Skipping bypass switch for zone: ${zoneAccessory.name} partition: ${zoneAccessory.partition}, bypassStatus: ${zoneAccessory.bypassStatus}, masterBypass: ${zoneAccessory.config.masterBypass}`);
            }
            partition.clearzonebypass = false;

            // Reestablish any persisted zone bypasses or clear memory depending on config.
            // reestablishZoneBypass() is awaited so its full send loop completes before
            // any further partition events are processed.
            this.log.debug(`partitionUpdate: bypassedZonesMemory enabled: ${partition.bypassedZonesMemory}`);
            partition.bypassedZonesMemory
                ? await partition.reestablishZoneBypass()
                : partition.bypassedZones.clear();
        }

        // --- Section 5: Set arm-to-disarm bypass clear flag ---
        // Marks that the panel is now armed so that when a subsequent disarm is
        // detected in Section 4 all zone bypass switches are cleared in HomeKit.
        if (data.mode.includes('ARMED')) {
            this.log.debug(`partitionUpdate: ${data.mode} detected — setting clearzonebypass flag.`);
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
                                this.log.debug(`cidUpdate: processingBypassqueue decremented, new value: ${alarm.processingBypassqueue}`);
                            }

                            // Add zone to bypass memory and persist.
                            partition.bypassedZones.add(Number(accessory.zoneNumber));                
                            // the panel is still processing the unbypass command.
                            if (!alarm.isProcessingUnBypass) {
                                alarm.processingUnBypassqueue = partition.bypassedZones.size;
                            }
                            //partition.saveBypassedZones();
                            
                            this.log.debug('cidUpdate: Bypass event for zone ' + accessory.zoneNumber +
                                ' bypassedZones Memory: ' + Array.from(partition.bypassedZones));

                            const bypassSwitch = accessory.accessory.getService(Service.Switch);
                            if (bypassSwitch) {
                                bypassSwitch.updateCharacteristic(Characteristic.On, true);
                                accessory.bypassStatus = true;
                            }
                        }

                        if (data.qualifier == 3) {
                            this.log(`${accessory.name} has been unbypassed.`);
                            this.log.debug('cidUpdate: Unbypass event for zone ' + accessory.zoneNumber +
                                ', targetUnbypassZone: ' + accessory.targetUnbypassZone +
                                ', alarm command code: ' + alarm.commandreferral +
                                ', bypassedZones Memory: ' + Array.from(partition.bypassedZones));

                            // Two legitimate cases for acting on qualifier 3:
                            //   1. Plugin initiated the unbypass — isProcessingUnBypass is true.
                            //      This is the primary completion signal. Always process it.
                            //   2. Physical keypad unbypass — isProcessingUnBypass is false but zone
                            //      is still in bypassedZones. Process it to keep UI in sync.
                            //
                            // Ignore when: isProcessingUnBypass is false AND zone is not in bypassedZones.
                            // This catches genuinely late/duplicate CID events after partitionUpdate
                            // already completed the unbypass and removed the zone from memory.
                            const isPluginInitiated = alarm.isProcessingUnBypass;
                            const isKeypadInitiated = !alarm.isProcessingUnBypass && 
                                                    partition.bypassedZones.has(Number(accessory.zoneNumber));

                            if (!isPluginInitiated && !isKeypadInitiated) {
                                this.log.debug(`cidUpdate: Zone ${accessory.zoneNumber} — unbypass CID ignored ` +
                                    `(not processing unbypass and zone not in memory).`);
                            } else {
                                const isTargetedUnbypass = partition.bypassedZonesMemory &&
                                    alarm.commandreferral == tpidefs.alarmcommand.targetedunbypass;
                                const shouldRemove = !isTargetedUnbypass || accessory.targetUnbypassZone === true;

                                if (shouldRemove) {
                                    if (partition.bypassedZones.has(Number(accessory.zoneNumber))) {
                                        partition.bypassedZones.delete(Number(accessory.zoneNumber));
                                        //  partition.saveBypassedZones();
                                        this.log.debug('cidUpdate: Removed zone ' + accessory.zoneNumber +
                                            ' from bypassedZones, bypassedZones Memory: ' + 
                                            Array.from(partition.bypassedZones));
                                    }
                                    accessory.targetUnbypassZone = false;
                                    const bypassSwitch = accessory.accessory.getService(Service.Switch);
                                    if (bypassSwitch) {
                                        bypassSwitch.updateCharacteristic(Characteristic.On, false);
                                        accessory.bypassStatus = false;
                                    }

                                    // If plugin initiated this unbypass, clear the processing flag
                                    // and cancel the watchdog — the panel confirmed completion.
                                    if (isPluginInitiated) {
                                        alarm.isProcessingUnBypass = false;
                                        alarm.processingUnBypassqueue = 0;
                                        // Cancel zone-level unbypass watchdog
                                        if (accessory.unbypassWatchdogHandle) {
                                            clearTimeout(accessory.unbypassWatchdogHandle);
                                            accessory.unbypassWatchdogHandle = undefined;
                                        }
                                        this.log.debug(`cidUpdate: Unbypass confirmed by CID 570 — clearing isProcessingUnBypass.`);

                                        // If targeted unbypass with memory enabled, reestablish remaining zones.
                                        if (partition.bypassedZonesMemory && 
                                            alarm.commandreferral === tpidefs.alarmcommand.targetedunbypass) {
                                            const partitionIdx = this.platformPartitionAccessoryMap['p.' + Number(accessory.partition)];
                                            const part = this.platformPartitionAccessories[partitionIdx];
                                            if (part) {
                                                alarm.commandreferral = 0;
                                                alarm.targetUnbypassZoneNumber = 0;
                                                await part.reestablishZoneBypass();
                                            }
                                        } else {
                                            alarm.commandreferral = 0;
                                            alarm.targetUnbypassZoneNumber = 0;
                                        }
                                    }
                                } else {
                                    this.log.debug('cidUpdate: Zone ' + accessory.zoneNumber + 
                                        ' not targeted for unbypass, skipping.');
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
            } else {
                this.log.debug(`cidUpdate: Zone ${data.zone} not monitored, skipping CID event processing for this zone.`);
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
            } else {
                this.log.debug(`cidUpdate: Partition ${data.partition} not monitored, skipping CID event processing for this partition.`);
            }
        }
    }
    bypassScanUpdate(data) {
        this.log.debug('bypassScanUpdate: Panel bypass scan received - ', data);

        if (alarm.isProcessingBypass || alarm.isProcessingUnBypass) {
            this.log.debug('bypassScanUpdate: Operation in progress — ignoring scan result.');
            return;
        }

        const partitionIndex = this.platformPartitionAccessoryMap['p.' + Number(data.partition)];
        if (partitionIndex === undefined) return;
        const partition = this.platformPartitionAccessories[partitionIndex];
        if (!partition) return;

        this.log.debug(`bypassScanUpdate: Panel reports ${data.zones.size} bypassed zone(s) ` +
                `for partition ${data.partition}: ${Array.from(data.zones)}`);

        // Snapshot to avoid mutation during iteration
        const currentMemory = new Set([...partition.bypassedZones].map(Number));

        for (const zoneNumber of currentMemory) {
            // Critical: only reconcile zones that actually belong to this partition.
            // Zones on other partitions are invisible to this probe and must never
            // be removed based on a scan that could not see them.
            const zoneIndex = this.platformZoneAccessoryMap['z.' + zoneNumber];
            if (zoneIndex === undefined) continue;
            const za = this.platformZoneAccessories[zoneIndex];
            if (!za || Number(za.partition) !== Number(data.partition)) {
                this.log.debug(`bypassScanUpdate: Zone ${zoneNumber} belongs to ` +
                    `partition ${za ? za.partition : 'unknown'} — skipping.`);
                continue;
            }

            if (!data.zones.has(zoneNumber)) {
                this.log.debug(`bypassScanUpdate: Zone ${zoneNumber} no longer bypassed ` +
                    `on panel — removing from memory.`);
                partition.bypassedZones.delete(zoneNumber);
                za.bypassStatus = false;
                const bypassSwitch = za.accessory.getService(Service.Switch);
                if (bypassSwitch) bypassSwitch.updateCharacteristic(Characteristic.On, false);
            } else {
                this.log.debug(`bypassScanUpdate: Zone ${zoneNumber} confirmed ` +
                    `bypassed on panel — no change.`);
            }
        }

        for (const zoneNumber of data.zones) {
            if (!partition.bypassedZones.has(zoneNumber)) {
                // Only add if this zone actually belongs to the scanned partition
                const zoneIndex = this.platformZoneAccessoryMap['z.' + zoneNumber];
                if (zoneIndex === undefined) continue;
                const za = this.platformZoneAccessories[zoneIndex];
                if (!za || Number(za.partition) !== Number(data.partition)) continue;

                this.log.debug(`bypassScanUpdate: Zone ${zoneNumber} bypassed on panel ` +
                    `but not in memory — adding.`);
                partition.bypassedZones.add(zoneNumber);
                za.bypassStatus = true;
                const bypassSwitch = za.accessory.getService(Service.Switch);
                if (bypassSwitch) bypassSwitch.updateCharacteristic(Characteristic.On, true);
            }
        }
        //partition.saveBypassedZones();
        this.log(`Zone for Partition ${data.partition} synchronization complete. Panel bypassed zones: ${Array.from(partition.bypassedZones).length? Array.from(partition.bypassedZones).join(', '): 'None'}`);
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
