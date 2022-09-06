const packageJson = require('./package.json');
var elink = require('./envisalink.js');
const partitionDevice = require('./accessories/partitionAccessory');
const zoneDevices = require('./accessories/zoneAccessory');
const customDevices = require('./accessories/customAccessory');
var tpidefs = require('./tpi.js');
var Accessory, Service, Characteristic, UUIDGen;
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
            this.commandTimeOut = Math.min(30,Math.max(1,config.commandTimeOut));  
            // Should partition be changed when executing command? 
            // Option only valid if this is a multiple partitions system
            this.changePartition = config.changePartition ? config.changePartition: false;
          
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
                this.log("Configuring", this.deviceDescription, "for Homekit...");
                this.refreshPartitionsAccessories();
                this.refreshZoneAccessories();
                this.refreshCustomAccessories();
                this.removeOrphanAccessory();

                // Provide status on configurations completed
                this.log(`Partition configured: ${this.partitions.length}`);
                if (this.zones.length > 0) this.log(`Zone accessories configured: ${this.zones.length}`);
                if (this.bypass.length > 0) this.log("Bypass accessories configured.");
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
                    
                    // Should module errors be suppress from homekit notification?
                    if (this.isEnvisalinkFailureSuppress == false) alarm.on('envisalinkupdate', this.envisalinkUpdate.bind(this));
                    else this.log.warn("No alarm Tamper will be generated for Envisalink communication failure. Please refer to your Homebridge logs for communication failures.");
                }
                else
                    this.log.warn("This plug-in is running in maintenance mode. All updates and operations are disabled!");
            });
        }
    }

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
            var partitionAccessory = new partitionDevice(this.log, partition,Service, Characteristic, UUIDGen, alarm);
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
            else { // accessory already exist just set characteristic
                partitionAccessory.setAccessory(foundAccessory); 
            }
            // Add to active accessory list, which is later used to remove unused cache entries  
            this.activeAccessoryMap[partitionAccessory.uuid] = true;

            var partitionIndex =  this.platformPartitionAccessories.push(partitionAccessory) - 1;
            this.platformPartitionAccessoryMap['p.' + partitionNumber] = partitionIndex;
            this.log.debug("refreshAccessories: Partition number - ", partitionNumber , " configured.");
        }
    }

     // Create associates zone in Homekit based on configuration file
    refreshZoneAccessories() {
         //process zone data
         var maxZone = this.zones.length;
         for (var i = 0; i < this.zones.length; i++) {
             var zone = this.zones[i];
             if ((zone.sensorType == "motion" || zone.sensorType == "glass" || zone.sensorType == "window" || zone.sensorType == "door" || zone.sensorType == "leak" || zone.sensorType == "smoke" || zone.sensorType == "co") && (zone.name != undefined)){
                var zoneNum = Number(zone.zoneNumber ? zone.zoneNumber : (i+1));
                if (zoneNum > maxZone) {
                     maxZone = zoneNum;
                }
                zone.model = this.deviceDescription + " " + zone.sensorType.charAt(0).toUpperCase() + zone.sensorType.slice(1) + " sensor";
                zone.serialNumber = "envisalink." + zone.sensorType + "."+ zone.partition + "." + zoneNum;

                var zoneAccessory = new zoneDevices(this.log, zone, Service, Characteristic, UUIDGen);
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
                else { // accessory already exist just set characteristic
                    zoneAccessory.setAccessory(foundAccessory); 
                }
                // Add to active accessory list, which is later used to remove unused cache entries
                this.activeAccessoryMap[zoneAccessory.uuid] = true;

                var accessoryIndex = this.platformZoneAccessories.push(zoneAccessory) - 1;
                this.platformZoneAccessoryMap['z.' + zoneNum] = accessoryIndex;
                this.log.debug("refreshAccessories: Zone number - ", zoneNum , " configured.");
            } else 
                this.log.error("Misconfigured zone definition " + zone.name + ". Entry - " + i + " ignoring.");
         }

    }

     // Create associates custom in Homekit based on configuration file
    refreshCustomAccessories() {

        // Process toggle chime switch functionality 
        if (this.chime ) {
            var chimeswitch = {};
            chimeswitch.pin = this.masterPin;
            chimeswitch.model = this.deviceDescription + " Keypad";
            chimeswitch.name  = "Chime";
            chimeswitch.customType =  "chimemode";
            chimeswitch.serialNumber = "envisalink.chime.all";
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
            else {// accessory already exist just set characteristic
                customAccessory.setAccessory(foundAccessory);
                
            }
            // Add to active accessory list, which is later used to remove unused cache entries
            this.activeAccessoryMap[customAccessory.uuid] = true;

            var accessoryIndex = this.platformPartitionAccessories.push(customAccessory) - 1;
            this.platformPartitionAccessoryMap['c.chimemode'] = accessoryIndex;
        }

         // Process bypass features (only one bypass button is created)
         if (this.bypass.length > 0) {
            var bypassswitch = this.bypass[0];
            bypassswitch.pin = this.masterPin;
            bypassswitch.model = this.deviceDescription+ " Keypad";
            bypassswitch.name  = "Zone Bypass";
            bypassswitch.customType = "bypass";
            bypassswitch.serialNumber = "envisalink.bypass.all";
            bypassswitch.commandTimeOut = this.commandTimeOut;
            bypassswitch.zoneDevices  = this.platformZoneAccessories;

            if (bypassswitch.enabledbyPass) {
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
                else { // accessory already exist just set characteristic
                    customAccessory.setAccessory(foundAccessory);
                }
                // Add to active accessory list, which is later used to remove unused cache entries
                this.activeAccessoryMap[customAccessory.uuid] = true;
                var accessoryIndex = this.platformPartitionAccessories.push(customAccessory) - 1;
                this.platformPartitionAccessoryMap['c.bypass'] = accessoryIndex;
            }
            else{
                this.log.error("Misconfigured Alarm Zone Bypass switch definition " + bypassswitch.name + " ignoring.");
            }
        }

         // Creating macro/speed keys 
         if (this.speedKeys.length > 0) {
            var speedkey = [];
            speedkey.pin = this.masterPin;
            speedkey.model = this.deviceDescription + " Keypad";
            speedkey.customType =  "speedkeys";
            speedkey.serialNumber = "envisalink.speedKey.all";
            speedkey.name = "Speed Key";
            speedkey.keyList = this.speedKeys;
            var customAccessory = new customDevices(this.log, speedkey, Service, Characteristic, UUIDGen, alarm);
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
            else { // accessory already exist just set characteristic
                customAccessory.setAccessory(foundAccessory);
            }
            // Add to active accessory list, which is later used to remove unused cache entries
            this.activeAccessoryMap[customAccessory.uuid] = true;
            var accessoryIndex = this.platformPartitionAccessories.push(customAccessory) - 1;
            this.platformPartitionAccessoryMap['c.speedkey'] = accessoryIndex;
        }
    }

    // *****************************************
    // * Event Processor from envisalink module
    // *****************************************
    // The envisalink event represent issue related to low level layers which effect all partitions.
    envisalinkUpdate(data) {
        this.log.debug('envisalinkUpdate:  Status changed - ', data);
        // since issue related to EVL module it affect all partition. For each partition set condition
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
                if ((partition.processingAlarm == false) && (partition.accessoryType == "partition")) {
                    if ((partition.envisakitCurrentStatus != data.mode)) {
                        partition.envisakitCurrentStatus = data.mode;
                        
                        this.log.debug("systemUpdate: partition change - " + partition.name + ' to ' + partition.envisakitCurrentStatus);
                        const partitionService = partition.accessory.getService(Service.SecuritySystem);
                        if (partitionService) {
                            if (partition.homekitLastTargetState != partition.ENVISA_TO_HOMEKIT_TARGET[data.mode])
                                {
                                    partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState,partition.ENVISA_TO_HOMEKIT_CURRENT[data.mode]);
                                    if(data.mode != 'ALARM') partitionService.updateCharacteristic(Characteristic.SecuritySystemTargetState,partition.ENVISA_TO_HOMEKIT_TARGET[data.mode]);  
                                    partition.homekitLastTargetState = partition.ENVISA_TO_HOMEKIT_TARGET[data.mode];
                                }       
                            // if system is not ready set general fault
                            if (partition.envisakitCurrentStatus.includes('NOT_READY') || partition.envisakitCurrentStatus.includes('ALARM_MEMORY')) partitionService.updateCharacteristic(Characteristic.StatusFault,Characteristic.StatusFault.GENERAL_FAULT); 
                            else partitionService.updateCharacteristic(Characteristic.StatusFault,Characteristic.StatusFault.NO_FAULT);
                        }
                    }                 
                }
            }
        } else {
            this.log("System status reported: Partition is not monitored, dismissing status update."); 
        }

        // if chime enable update status;
        if (accessoryChimeIndex !== undefined) {
            var accessoryChime = this.platformPartitionAccessories[accessoryChimeIndex];
            if (accessoryChime) {
                if (accessoryChime.envisakitCurrentStatus != data.keypadledstatus.chime) {
                    accessoryChime.envisakitCurrentStatus = data.keypadledstatus.chime;
                    this.log.debug("systemUpdate: Accessory chime change - " + accessoryChime.name + ' to ' +  accessoryChime.envisakitCurrentStatus);
                    if (accessoryChime.customType == "chimemode") {
                        var accessoryService = accessoryChime.accessory.getService(Service.Switch);
                        accessoryService.updateCharacteristic(Characteristic.On,data.keypadledstatus.chime);
                    }
                }
            }
        }

        // if bypass enable update status
        if (accessorybypassIndex !== undefined) {
            var accessoryBypass = this.platformPartitionAccessories[accessorybypassIndex];
            if (accessoryBypass) {
                if (accessoryBypass.envisakitCurrentStatus !=  data.mode) {
                    accessoryBypass.envisakitCurrentStatus = data.mode;
                    this.log.debug("systemUpdate: Accessory bypass change - " + accessoryBypass.name + ' to ' + accessoryBypass.envisakitCurrentStatus);
                    if (accessoryBypass.customType == "bypass") {
                        var accessoryService = accessoryBypass.accessory.getService(Service.Switch);
                        accessoryService.updateCharacteristic(Characteristic.On,accessoryBypass.ENVISA_BYPASS_TO_HOMEKIT[data.mode]);
                    }
                }
            }
        } 
    }

    // Capture partition updates usually associated with arm, disarm events
    partitionUpdate(data) {
        this.log.debug('partitionUpdate: status change - ', data);
        var partitionIndex = this.platformPartitionAccessoryMap['p.' + Number(data.partition)];
        if (partitionIndex !== undefined ) {
            var partition = this.platformPartitionAccessories[partitionIndex];
            if (partition) {
                partition.envisakitCurrentStatus = data.mode;
                this.log.debug("partitionUpdate: Partition data - " + partition.name + ' to ' + partition.envisakitCurrentStatus);
                const partitionService = partition.accessory.getService(Service.SecuritySystem);
                if (partitionService) {
                    if (partition.homekitLastTargetState != partition.ENVISA_TO_HOMEKIT_TARGET[data.mode])
                        {
                            partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState,partition.ENVISA_TO_HOMEKIT_CURRENT[data.mode]);
                            if(data.mode != 'ALARM') partitionService.updateCharacteristic(Characteristic.SecuritySystemTargetState,partition.ENVISA_TO_HOMEKIT_TARGET[data.mode]);  
                            partition.homekitLastTargetState = partition.ENVISA_TO_HOMEKIT_TARGET[data.mode];
                        }       
                    // if system is not ready set general fault
                    if (partition.envisakitCurrentStatus.includes('NOT_READY') || partition.envisakitCurrentStatus.includes('ALARM_MEMORY')) partitionService.updateCharacteristic(Characteristic.StatusFault,Characteristic.StatusFault.GENERAL_FAULT); 
                    else partitionService.updateCharacteristic(Characteristic.StatusFault,Characteristic.StatusFault.NO_FAULT);
                }
                if (partition.processingAlarm) {
                    // clear timer 
                    partition.processingAlarm = false;
                    clearTimeout(partition.armingTimeOut);
                    partition.armingTimeOut = undefined;
                }
            }
        }
        else {
            this.log.debug("Partition status change: Partition not monitored dismissing partition update. "); 
        }
    }
    // Capture zone updates usually associated sensor going from open to close and vice-versa
    zoneUpdate(data) {
        this.log.debug('zoneUpdate: Status change - ', data);
        for (var i = 0; i < data.zone.length; i++) {
            var accessoryIndex = this.platformZoneAccessoryMap['z.' + Number(data.zone[i])];
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
    }

    // Capture low level updates that are not generate from keypad events
    cidUpdate(data)
    {
        this.log.debug('cidUpdate: Status change - ', data);
        /// Zone event
        if ((data.type == 'zone') && (Number(data.zone) > 0)) {
            var accessoryIndex = this.platformZoneAccessoryMap['z.' + Number(data.zone)];
            if (accessoryIndex !== undefined) {
                var accessory = this.platformZoneAccessories[accessoryIndex];
                var accessoryService = accessory.service;
                this.log.debug(`cidUpdate: Accessory change - Event Zone: ${accessoryIndex} Name: ${accessory.name} Code: ${data.code} Qualifier: ${data.qualifier}.`);
                switch (Number(data.code)) { 
                    // qualifier can be 1 = 'Event or Opening', 3 = 'Restore or Closing'
                    case 570:  // Bypass event
                        if(data.qualifier == 1) this.log(`${accessory.name} has been bypass.`);
                        if(data.qualifier == 3) this.log(`${accessory.name} has been unbypass.`);
                        alarm.isProcessingBypassqueue = alarm.isProcessingBypassqueue - 1;
                        if ((alarm.isProcessingBypassqueue <= 0 ) && (alarm.isProcessingBypassqueue)) { 
                            alarm.isProcessingBypass = false; 
                            alarm.isProcessingBypassqueue = 0;
                            this.log(`All queued bypass/unbypass command(s) completed.`)
                        }
                    break;

                    case 384: // RF LOW BATTERY
                        if(data.qualifier == 1) accessoryService.updateCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
                        if(data.qualifier == 3)  accessoryService.updateCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                    break;

                    case 383: // SENSOR TAMPER
                        if(data.qualifier == 1) accessoryService.updateCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.TAMPERED);
                        if(data.qualifier == 3)  accessoryService.updateCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
                    break;
                }
            }
        }
        // event is related to a partition
        if ((data.type == 'zone') && (Number(data.zone) == 0)) {
            var partitionIndex = this.platformPartitionAccessoryMap['p.' + Number(data.partition)];
            if (partitionIndex !== undefined ) {
                var partition = this.platformPartitionAccessories[partitionIndex];
                this.log.debug(`cidUpdate: Partition change - Partition: ${partitionIndex} Name: ${partition.name} Code: ${data.code} Qualifier: ${data.qualifier}.`);
                switch (Number(data.code)) {
                    case 301: // Trouble-AC Power
                        if(data.qualifier == 1) {
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
                            if(data.qualifier == 3)  partitionService.updateCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
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

    //Add accessory to homekit dashboard
    addAccessory(device) {

        this.log.debug('Adding accessory',device.accessory.displayName);
        try {
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [device.accessory]);
          this.accessories.push(device.accessory);
        } catch (err) {
            this.log.error(`Envisalink load Error: An error occurred while adding accessory: ${err}`);
        }
    }

    //Remove accessory to homekit dashboard
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
