const packageJson = require('./package.json');
var elink = require('./envisalink.js');
var tpidefs = require('./tpi.js');
var Service, Characteristic, Accessory, uuid;
var inherits = require('util').inherits;
var alarm;


// Register the plugin with homebridge 
module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;
    uuid = homebridge.hap.uuid;


    var acc = EnvisalinkAccessory.prototype;
    inherits(EnvisalinkAccessory, Accessory);
    EnvisalinkAccessory.prototype.parent = Accessory.prototype;
    for (var mn in acc) {
        EnvisalinkAccessory.prototype[mn] = acc[mn];
    }
    homebridge.registerPlatform("homebridge-envisalink-ademco", "Envisalink-Ademco", EnvisalinkPlatform);
}

class EnvisalinkPlatform {

    constructor(log, config, api)  {

        this.log = log;
        this.api = api;
        this.config = config;
        // Must define configuation file and IP address for Envisakit server
        if (!config || !config.host) {
            this.log.error("No configuration or host address defined for plug-in. Please configure the Envisakit Ademco plug-in.");
            // terminate plug-in initization
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
            this.chime = config.chimeToggle ? config.chimeToggle: false;
            this.batteryRunTime = config.batteryRunTime ? config.batteryRunTime: 0;
            this.commandTimeOut = Math.min(30,Math.max(1,config.commandTimeOut));  
            // Should partition be changed when executing command? 
            // Option only valid if this is a multiple partitions system
            this.changePartition = config.changePartition ? config.changePartition: false;
          
            // are we in maintanance mode?
            this.isMaintenanceMode = config.maintenanceMode ? config.maintenanceMode: false;

            // surpress envisalink failure?
            this.isEnvisalinkFailureSuppress = config.envisalinkFailureSuppress ? config.envisalinkFailureSuppress: false;

            
            // Create connection object 
            alarm = new elink(log, config);

            // Build device list
            this.log("Configuring", this.deviceDescription, "for Homekit...");
            this.refreshAccessories();

            // Provide status on configurations completed
            this.log(`Partition configured: ${this.partitions.length}`);
            if (this.zones.length > 0) this.log(`Zone accessories configured: ${this.zones.length}`);
            if (this.bypass.length > 0) this.log("Bypass accessories configured.");
            if (this.speedKeys.length > 0) this.log("Speed keys accessories configured.");
            if (this.chime) this.log("Chime toggle accessory configured.")
            
            // Begin connection process and bind alarm events to local function.
            // Should plug run in a disconnect mode. Allow maintaince without resulting in alot of log errors 
            if (this.isMaintenanceMode == false){
                // Start connection to envisilink module
                alarm.startSession();
                // Bind event to local functions
                alarm.on('keypadupdate', this.systemUpdate.bind(this));
                alarm.on('zoneevent', this.zoneUpdate.bind(this));
                alarm.on('updatepartition', this.partitionUpdate.bind(this));
                alarm.on('cidupdate', this.cidUpdate.bind(this));
                
                // Should module errors be suppress from homekit notification?
                if (this.isEnvisalinkFailureSuppress == false) alarm.on('envisalinkupdate', this.envisalinkUpdate.bind(this));
                else this.log.warn("No alarm Tamper will be generated for Envisalink communication failure. Pleae refer to your Homebridge logs for commication failures.");
            }
            else
                this.log.warn("This plug-in is running in maintenance mode. All updates and operations are disabled!");
        }
    }

    // Create associates in Homekit based on configuration file
    refreshAccessories() {
        // Process partition data
        for (var i = 0; i < this.partitions.length; i++) {
            var partition = this.partitions[i];
            var partitionNumber = Number(partition.partitionNumber ? partition.partitionNumber : (i+1));
            partition.pin = partition.partitionPin ? partition.partitionPin: this.masterPin;
            if(isNaN(partition.pin)) {
                this.log.error("Ademco Pin must be a number. Please update configuration for the Envisakit Ademco plug-in.");
                // terminate plug-in initization
                return;
            }
            if(partition.pin.length != 4) {
                this.log.warn("Ademco PIN are normally lenght of 4 digits. The provided PIN lenght may result in unusual behaviour.");
            }
            partition.Model = this.deviceDescription + " Keypad";
            partition.deviceType =  this.deviceType;
            // set command timeout 
            partition.commandTimeOut = this.commandTimeOut;
            partition.batteryRunTime = this.batteryRunTime * 60 * 60;
            partition.changePartition = this.changePartition;
            partition.SerialNumber = "Envisalink." + partitionNumber;
            var accessory = new EnvisalinkAccessory(this.log, "partition", partition, partitionNumber, []);
            var partitionIndex =  this.platformPartitionAccessories.push(accessory) - 1;
            this.platformPartitionAccessoryMap['p.' + partitionNumber] = partitionIndex;
            this.log.debug("Partition number: ", partitionNumber , " configured.");
        }

        //process zone data
        var maxZone = this.zones.length;
        for (var i = 0; i < this.zones.length; i++) {
            var zone = this.zones[i];
            if ((zone.sensorType == "motion" || zone.sensorType == "glass" || zone.sensorType == "window" || zone.sensorType == "door" || zone.sensorType == "leak" || zone.sensorType == "smoke" || zone.sensorType == "co") && (zone.name != undefined)){
                var zoneNum = Number(zone.zoneNumber ? zone.zoneNumber : (i+1));
                if (zoneNum > maxZone) {
                    maxZone = zoneNum;
                }
                zone.Model = this.deviceDescription + " " + zone.sensorType.charAt(0).toUpperCase() + zone.sensorType.slice(1) + " sensor";
                zone.deviceType =  this.deviceType;
                zone.SerialNumber = "Envisalink." + zone.partition + "." + zoneNum;
                zone.pin = 0;
                var accessory = new EnvisalinkAccessory(this.log, zone.sensorType, zone, zone.partition, zoneNum, []);
                var accessoryIndex = this.platformZoneAccessories.push(accessory) - 1;
                this.platformZoneAccessoryMap['z.' + zoneNum] = accessoryIndex;
                this.log.debug("Zone number: ", zoneNum , " configured.");
            } else {
                this.log.error("Misconfigured Zone defination " + zone.name + ". Entry - " + i + " igoring.");
            }
        }

        // Process bypass features (only one bypass button is created)
        if (this.bypass.length > 0) {
            var bypassswitch = this.bypass[0];
            bypassswitch.pin = this.masterPin;
            bypassswitch.Model = this.deviceDescription+ " Keypad";
            bypassswitch.deviceType =  this.deviceType;
            bypassswitch.SerialNumber = "Envisalink.ByPass.1";
            bypassswitch.partition = 1;
            bypassswitch.commandTimeOut = this.commandTimeOut
            if (bypassswitch.enabledbyPass) {
                bypassswitch.name = "Zone Bypass"
                // Pass the list of zone to bypass control and speed to the first partition
                var accessory = new EnvisalinkAccessory(this.log, "bypass", bypassswitch, bypassswitch.partition, 206, this.platformZoneAccessories);
                var accessoryIndex = this.platformPartitionAccessories.push(accessory) - 1;
                this.platformPartitionAccessoryMap['b.' + bypassswitch.partition] = accessoryIndex;
            }
            else{
                this.log.error("Misconfigured Alarm Zone Bypass switch defination " + bypassswitch.name + " igoring.");
            }
        }

        // Creating macro/speed keys
        if (this.speedKeys.length > 0) {
            var speedkey = [];
            speedkey.pin = this.masterPin;
            speedkey.Model = this.deviceDescription + " Keypad";
            speedkey.deviceType =  this.deviceType;
            speedkey.SerialNumber = "Envisalink.SpeedKey";
            speedkey.partition = 1;
            speedkey.name = "Speed Key";
            var accessory = new EnvisalinkAccessory(this.log, "speedkeys", speedkey, speedkey.partition,"speedkey", this.speedKeys);
            this.platformPartitionAccessories.push(accessory);
        }
        
        // Process toggle chime switch functionality 
        if (this.chime ) {
            var chimeswitch = {};
            chimeswitch.pin = this.masterPin;
            chimeswitch.Model = this.deviceDescription + " Keypad";
            chimeswitch.deviceType =  this.deviceType;
            chimeswitch.SerialNumber = "Envisalink.Chime.1";
            chimeswitch.name  = "Chime";
            chimeswitch.partition = 1;
            // Create Chime Toogle button
            var accessory = new EnvisalinkAccessory(this.log, "chime", chimeswitch, chimeswitch.partition , 209, []);
            var accessoryIndex = this.platformPartitionAccessories.push(accessory) - 1;
            this.platformPartitionAccessoryMap['c.' + chimeswitch.partition] = accessoryIndex;
        }
    }
    // The envisalink event represent issue related to low level layers which effect all partitions.
    envisalinkUpdate(data) {
        this.log.debug('Envisalink status changed to: ', data);
        // since issue related to EVL module it affect all partition. For each partition set condition
        for (var i = 1; i < this.partitions.length+1; i++) {
            var partitionIndex = this.platformPartitionAccessoryMap['p.' + Number(i)];
            if (partitionIndex !== undefined ) {
                var partition = this.platformPartitionAccessories[partitionIndex];
                if (partition) {
                    var partitionService = (partition.getServices())[1];
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

    systemUpdate(data) {
        this.log.debug('System status changed to: ', data);
        var partitionIndex = this.platformPartitionAccessoryMap['p.' + Number(data.partition)];
        var accessorybypassIndex = this.platformPartitionAccessoryMap['b.' + Number(data.partition)];
        var accessoryChimeIndex = this.platformPartitionAccessoryMap['c.' + Number(data.partition)];
        if (partitionIndex !== undefined ) {
            var partition = this.platformPartitionAccessories[partitionIndex];
            // partition update information
            if (partition) {
                if ((partition.processingAlarm == false) && (partition.accessoryType == "partition")) {
                    if (partition.status != data.mode) {
                        partition.status = data.mode;
                        this.log.debug("Set system status on accessory " + partition.name + ' to ' + partition.status);
                        var partitionService = (partition.getServices())[1];
                        if (partitionService) {
                            partition.getAlarmState(function (nothing, returnValue) {
                                    partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState,returnValue);
                            });
                            // if system is not ready set general fault
                            if (partition.status.includes('NOT_READY')) partitionService.updateCharacteristic(Characteristic.StatusFault,Characteristic.StatusFault.GENERAL_FAULT); 
                            else partitionService.updateCharacteristic(Characteristic.StatusFault,Characteristic.StatusFault.NO_FAULT);
                        }
                    }                 
                }
            }
        } else {
            this.log.debug("System status reported: Partition not monitored dismissing status update."); 
        }
         // if chime enable update status
        if (accessoryChimeIndex !== undefined) {
            var accessoryChime = this.platformPartitionAccessories[accessoryChimeIndex];
            if (accessoryChime) {
                if (accessoryChime.status != data.keypadledstatus.chime) {
                    accessoryChime.status = data.keypadledstatus.chime;
                    this.log.debug("Set status on accessory " + accessoryChime.name + ' to ' +  accessoryChime.status);
                    if (accessoryChime.accessoryType == "chime") {
                        var accessoryService = (accessoryChime.getServices())[0];
                        accessoryChime.getChime(function (nothing, returnValue) {
                            accessoryService.updateCharacteristic(Characteristic.On,returnValue)
                        });
                    }
                }
            }
        }

        // if bypass enable update status
        if (accessorybypassIndex !== undefined) {
            var accessoryBypass = this.platformPartitionAccessories[accessorybypassIndex];
            if (accessoryBypass) {
                if (accessoryBypass.alarmstatus !=  data.mode) {
                    accessoryBypass.alarmstatus = data.mode;
                    this.log.debug("Set status on accessory " + accessoryBypass.name + ' to ' + accessoryBypass.alarmstatus);
                    if (accessoryBypass.accessoryType == "bypass") {
                        var accessoryService = (accessoryBypass.getServices())[0];
                        accessoryBypass.getByPass(function (nothing, returnValue) {
                            accessoryService.updateCharacteristic(Characteristic.On,returnValue)
                        });
                    }
                }
            }
        }
    }


    partitionUpdate(data) {
        this.log.debug('Partition status change: ', data);
        var partitionIndex = this.platformPartitionAccessoryMap['p.' + Number(data.partition)];
        if (partitionIndex !== undefined ) {
            var partition = this.platformPartitionAccessories[partitionIndex];
            if (partition) {
                partition.status = data.mode;
                this.log.debug("Set system status on accessory " + partition.name + ' to ' + partition.status);
                var partitionService = (partition.getServices())[1];
                if (partitionService) {
                        partition.getAlarmState(function (nothing, returnValue) {
                            partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState,returnValue);
                        });
                        if (partition.status.includes('NOT_READY')) partitionService.updateCharacteristic(Characteristic.StatusFault,Characteristic.StatusFault.GENERAL_FAULT); 
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

    zoneUpdate(data) {
        this.log.debug('Zone status change: ', data);
        for (var i = 0; i < data.zone.length; i++) {
            var accessoryIndex = this.platformZoneAccessoryMap['z.' + Number(data.zone[i])];
            if (accessoryIndex !== undefined) {
                var accessory = this.platformZoneAccessories[accessoryIndex];
                if (accessory) {
                    accessory.status = data.mode;
                    this.log.debug("Set status on accessory " + accessory.name + ' to ' + accessory.status);

                    var accessoryService = (accessory.getServices())[0];
                    if (accessoryService) {
                        switch(accessory.accessoryType) {
                            case "motion":
                            case "glass":
                                accessory.getMotionStatus(function (nothing, returnValue) {
                                    accessoryService.getCharacteristic(Characteristic.MotionDetected).setValue(returnValue);        
                                });          
                            break;
                            case "door":
                            case "window":
                                accessory.getContactSensorState(function (nothing, returnValue) {
                                    accessoryService.getCharacteristic(Characteristic.ContactSensorState).setValue(returnValue);
                                });
                            break;
                            case "leak":
                                accessory.getLeakStatus(function (nothing, returnValue) {
                                    accessoryService.getCharacteristic(Characteristic.LeakDetected).setValue(returnValue);
                                });
                            break;
                            case "smoke":
                                accessory.getSmokeStatus(function (nothing, returnValue) {
                                    accessoryService.getCharacteristic(Characteristic.SmokeDetected).setValue(returnValue);
                                });
                            break;
                            case "co":
                                accessory.getCOStatus(function (nothing, returnValue) {
                                    accessoryService.getCharacteristic(Characteristic.CarbonMonoxideDetected).setValue(returnValue);
                                });
                            break;
                        }
                    }
                }
            }
        }
    }

    cidUpdate(data)
    {
        this.log.debug('CID status change: ', data);
        /// Zone event
        if ((data.type == 'zone') && (Number(data.zone) > 0)) {
            var accessoryIndex = this.platformZoneAccessoryMap['z.' + Number(data.zone)];
            if (accessoryIndex !== undefined) {
                var accessory = this.platformZoneAccessories[accessoryIndex];
                var accessoryService = (accessory.getServices())[0];
                this.log.debug(`Security Event Zone: ${accessoryIndex} Name: ${accessory.name} Code: ${data.code} Qualifier: ${data.qualifier}.`);
                switch (Number(data.code)) { 
                    // qualifier can be 1 = 'Event or Opening', 3 = 'Restore or Closing'
                    case 570:  // ByPass event
                        if(data.qualifier == 1) this.log(`${accessory.name} has been bypass.`);
                        if(data.qualifier == 3) this.log(`${accessory.name} has been unbypass.`);
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
        // System event, event is related to partition
        if ((data.type == 'zone') && (Number(data.zone) == 0)) {
            var partitionIndex = this.platformPartitionAccessoryMap['p.' + Number(data.partition)];
            if (partitionIndex !== undefined ) {
                var partition = this.platformPartitionAccessories[partitionIndex];
                this.log.debug(`Security Event Partition: ${partitionIndex} Name: ${partition.name} Code: ${data.code} Qualifier: ${data.qualifier}.`);
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
                        var partitionService = (partition.getServices())[1];
                        if (partitionService) partitionService.updateCharacteristic(Characteristic.BatteryLevel,partition.batteryLevel); 
                    break;

                    case 309: // Trouble-Battery Test Failure (Battery failed at test interval)
                    case 311: // Trouble-Battery Missing
                        if(data.qualifier == 1)
                            partition.batteryLevel = 0;
                        if(data.qualifier == 3) partition.batteryLevel = 100;
                        var partitionService = (partition.getServices())[1];
                        if (partitionService) partitionService.updateCharacteristic(Characteristic.BatteryLevel,partition.batteryLevel); 
                    break;

                    case 144: // Alarm-Sensor Tamper-# 
                    case 145: // Alarm-Exp. Module Tamper-#
                    case 137: // Burg-Tamper-#
                    case 316: // Trouble System Tamper
                        var partitionService = (partition.getServices())[1];
                        if (partitionService) {
                            if(data.qualifier == 1) partitionService.updateCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.TAMPERED);
                            if(data.qualifier == 3)  partitionService.updateCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
                        }
                    break;
                }
            }
        }
    }
    accessories(callback) {
        callback(this.platformPartitionAccessories.concat(this.platformZoneAccessories));
    }
}


  
class EnvisalinkAccessory {
    constructor(log, accessoryType, serviceConfig, partition, uid, accessories) {
        this.log = log;
        this.name = serviceConfig.name;

        var id = 'envisalink.' + partition;
        if (uid) {
            id += "." + uid;
        }
        this.uuid_base = uuid.generate(id);
        Accessory.call(this, this.name, this.uuid_base);

        this.accessoryType = accessoryType;
        this.partition = partition;
        this.pin = serviceConfig.pin;
        this.deviceType = serviceConfig.deviceType;
        this.zone = uid;
        this.services = [];

        // Ddtermine device and create
        switch (this.accessoryType) {
            case "partition":
                var service = new Service.SecuritySystem(this.name);
                service
                    .getCharacteristic(Characteristic.SecuritySystemCurrentState)
                    .on('get', this.getAlarmState.bind(this));
                service
                    .getCharacteristic(Characteristic.SecuritySystemTargetState)
                    .on('get', this.getAlarmState.bind(this))
                    .on('set', this.setAlarmState.bind(this));
                service
                    .setCharacteristic(Characteristic.StatusFault, Characteristic.StatusFault.NO_FAULT);    
                service
                    .setCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
                // Add battery service
                // Set initial battery level
                this.batteryLevel = 100;
                var batteryService = new Service.Battery(this.name + " Backup Battery");
                batteryService
                        .getCharacteristic(Characteristic.StatusLowBattery)
                        .on('get', this.getPanelStatusLowBattery.bind(this));
                batteryService.setCharacteristic(Characteristic.BatteryLevel,this.batteryLevel);
                
                if (serviceConfig.batteryRunTime > 0) {
                    // Only show battery level if user has provided a battery run time.
                    batteryService
                        .getCharacteristic(Characteristic.BatteryLevel)
                        .on('get', this.getPanelBatteryLevel.bind(this)); 
                    batteryService
                        .getCharacteristic(Characteristic.ChargingState)
                        .on('get', this.getPanelCharingState.bind(this));     
                   
                }
                // link battery service to partition
                service.addLinkedService(batteryService);
                this.services.push(batteryService);
                
                this.services.push(service);

                // Set default for security service
                this.ChargingState = Characteristic.ChargingState.CHARGING;
                this.status = "READY";
                this.downTime = null;
                this.lastTargetState = Characteristic.SecuritySystemCurrentState.DISARMED;
                this.commandTimeOut = serviceConfig.commandTimeOut;
                this.batteryRunTime = serviceConfig.batteryRunTime;
                this.changePartition = serviceConfig.changePartition;
                this.systemfault = Characteristic.StatusFault.NO_FAULT;
                this.processingAlarm = false;
                this.armingTimeOut = undefined;
            break;
        
            case "motion":
                var service = new Service.MotionSensor(this.name);
                service
                    .getCharacteristic(Characteristic.MotionDetected)
                    .on('get', this.getMotionStatus.bind(this));
              
                service.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                service.setCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
                this.services.push(service);

                this.bypassEnabled = serviceConfig.bypassEnabled ? serviceConfig.bypassEnabled : false;
                this.status = "close";
            break;
        
            case "glass":
                var service = new Service.MotionSensor(this.name);
                service
                    .getCharacteristic(Characteristic.MotionDetected)
                    .on('get', this.getMotionStatus.bind(this));
                service.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                service.setCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
                this.services.push(service);

                this.bypassEnabled = serviceConfig.bypassEnabled ? serviceConfig.bypassEnabled : false;
                this.status = "close";
            break;
        
            case "door":
                var service = new Service.ContactSensor(this.name);
                service
                    .getCharacteristic(Characteristic.ContactSensorState)
                    .on('get', this.getContactSensorState.bind(this));
                service.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                service.setCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
                this.services.push(service);

                this.bypassEnabled = serviceConfig.bypassEnabled ? serviceConfig.bypassEnabled : false;
                this.status = "close";
            break;
        
            case "window":
                var service = new Service.ContactSensor(this.name);
                service
                    .getCharacteristic(Characteristic.ContactSensorState)
                    .on('get', this.getContactSensorState.bind(this));
                service.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                service.setCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
                this.services.push(service);

                this.bypassEnabled = serviceConfig.bypassEnabled ? serviceConfig.bypassEnabled : false;
                this.status = "close";
            break;
        
            case "leak":
                var service = new Service.LeakSensor(this.name);
                service
                    .getCharacteristic(Characteristic.LeakDetected)
                    .on('get', this.getLeakStatus.bind(this));
                service.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                service.setCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
                this.services.push(service);
               
                this.bypassEnabled = serviceConfig.bypassEnabled ? serviceConfig.bypassEnabled : false;
                this.status = "close";
            break;
        
            case "smoke":
                var service = new Service.SmokeSensor(this.name);
                service
                    .getCharacteristic(Characteristic.SmokeDetected)
                    .on('get', this.getSmokeStatus.bind(this));
                service.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                service.setCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
                this.services.push(service);

                this.bypassEnabled = serviceConfig.bypassEnabled ? serviceConfig.bypassEnabled : false;
                this.status = "close";
            break;
        
            case "co":
                var service = new Service.CarbonMonoxideSensor(this.name);
                service
                    .getCharacteristic(Characteristic.CarbonMonoxideDetected)
                    .on('get', this.getCOStatus.bind(this));
                service.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                service.setCharacteristic(Characteristic.StatusTampered, Characteristic.StatusTampered.NOT_TAMPERED);
                this.services.push(service);

                this.bypassEnabled = serviceConfig.bypassEnabled ? serviceConfig.bypassEnabled : false;
                this.status = "close";
            break;
        
            case "bypass":
                var service = new Service.Switch(this.name);
                service
                    .getCharacteristic(Characteristic.On)
                    .on('get', this.getByPass.bind(this))
                    .on('set', this.setByPass.bind(this));
                this.services.push(service);
                this.zoneaccessories = accessories;
                this.quickbypass = serviceConfig.quickbypass ? serviceConfig.quickbypass : false;
                this.status = false;
                this.isProcessingBypass = false;
                this.commandTimeOut = serviceConfig.commandTimeOut;
                this.alarmstatus = "READY";
            break;
        
            case "speedkeys":
                // These are push button key, upon processing request will return to off
               this.command = [];
               this.subname = [];
               this.log(accessories);
                for (var i = 0; i < accessories.length; i++) {
                  
                    var service = new Service.Switch(accessories[i].name, "SPEED_KEY_"+i);
                    service
                        .getCharacteristic(Characteristic.On)
                        .on('set', this.setSpeedKey.bind(this,i));
                    this.services.push(service);
                    this.subname[i] = accessories[i].name;
                    if (accessories[i].speedcommand == "custom")  
                        this.command[i]= accessories[i].customcommand;
                    else
                        this.command[i]= accessories[i].speedcommand;
                }
            break;

            case "chime":
                // These are push button key, upon processing request will return current state of chime report by keypad event.
                var service = new Service.Switch(this.name);
                service
                    .getCharacteristic(Characteristic.On)
                    .on('get', this.getChime.bind(this))
                    .on('set', this.setChime.bind(this));
                this.services.push(service);
                this.status = false;
            break;
        }
        // Set device informaiton.
        var serviceAccessoryInformation = new Service.AccessoryInformation();
        serviceAccessoryInformation.setCharacteristic(Characteristic.Manufacturer, 'Envisacor Technologies Inc.');
        serviceAccessoryInformation.setCharacteristic(Characteristic.Model, serviceConfig.Model);
        serviceAccessoryInformation.setCharacteristic(Characteristic.Name, 'homebridge-envisalink-ademco');
        serviceAccessoryInformation.setCharacteristic(Characteristic.SerialNumber, serviceConfig.SerialNumber);
        serviceAccessoryInformation.setCharacteristic(Characteristic.FirmwareRevision, packageJson.version);
        // Add accessory information
        this.services.push(serviceAccessoryInformation);
    }

    getServices() {
        return this.services;
    }

    getAlarmState(callback) {

        var currentState = this.status;
        // Assume last target state and in arming state.
        var status = this.lastTargetState;
        if (this.processingAlarm == false) {
            this.log.debug("Getting status current state: ", currentState);
            switch (currentState) {
                case "ALARM":
                case "ALARM_MEMORY":
                    status = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
                break;
                case 'ARMED_STAY':
                case 'ARMED_STAY_BYPASS':
                    status = Characteristic.SecuritySystemCurrentState.STAY_ARM;
                    this.lastTargetState = Characteristic.SecuritySystemCurrentState.STAY_ARM;
                break;
                case 'ARMED_NIGHT':
                case 'ARMED_NIGHT_BYPASS':    
                    status = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
                    this.lastTargetState = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
                break;
                case 'ARMED_AWAY':
                case 'ARMED_AWAY_BYPASS':
                    status = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
                    this.lastTargetState = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
                break;
                case 'READY':
                case 'READY_BYPASS':
                    status = Characteristic.SecuritySystemCurrentState.DISARMED;
                    this.lastTargetState = Characteristic.SecuritySystemCurrentState.DISARMED;
                break;
                case 'NOT_READY':
                case 'NOT_READY_TROUBLE':
                case 'NOT_READY_BYPASS':
                    status = Characteristic.SecuritySystemCurrentState.DISARMED;
                    this.lastTargetState = Characteristic.SecuritySystemCurrentState.DISARMED;
                break;
            }
        }
        this.log.debug('Return Alarm Status Get: ', status);
        callback(null, status);
    }

    async setAlarmState(state, callback) {
        var currentState = this.status;
        var command = null;
        if (currentState != "NOT_READY") {
            if (this.processingAlarm == false) {
                if (state == Characteristic.SecuritySystemCurrentState.DISARMED) {
                    this.log(`Disarming alarm with PIN. [Partition ${this.partition}]`);
                    command = this.pin + tpidefs.alarmcommand.disarm;
                } else if (state == Characteristic.SecuritySystemCurrentState.STAY_ARM) {
                    this.log(`Arming alarm to Stay (Home). [Partition ${this.partition}]`);
                    command = this.pin + tpidefs.alarmcommand.stay;
                } else if (state == Characteristic.SecuritySystemCurrentState.NIGHT_ARM) {
                    this.log(`Arming alarm to Night. [Partition ${this.partition}]`);
                    command = this.pin + tpidefs.alarmcommand.night;
                } else if (state == Characteristic.SecuritySystemCurrentState.AWAY_ARM) {
                    this.log(`Arming alarm to Away. [Partition ${this.partition}]`);
                    command = this.pin + tpidefs.alarmcommand.away;
                }

                if (command) {
                    this.processingAlarm = true;
                    this.lastTargetState = state;
                    this.log.debug("Partition state command issued");
                    if (this.changePartition) {

                        this.log(`Changing Partition to ${this.partition}`);
                        alarm.changePartition(this.partition);
                        //utilfunc.sleep(2000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                    alarm.sendCommand(command);
                    this.armingTimeOut = setTimeout(this.proccessAlarmTimer.bind(this), this.commandTimeOut * 1000);
                    callback(null, state);
                } else {
                    this.log.error(`Unhandled alarm state: ${state}`);
                    callback(null, state);
                }
            } else {
                this.log.warn(`Already handling Alarm state change, igorning request.`);
                callback(null, this.lastTargetState);
            }
        } else {
            this.log.warn("Alarm not ready, igorning request.");
            var partitionService = this.getServices()[1];
            partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState,Characteristic.SecuritySystemCurrentState.DISARMED);
            callback(null, Characteristic.SecuritySystemCurrentState.DISARMED);
        }
    }
    
    // Battery status Low Battery status and Battery Level.
    getPanelStatusLowBattery(callback) {
        this.log.debug("Triggered Low Battery Check")
        // Assume battery level is normal.
        var currentValue = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        if (this.batteryLevel < 20) currentValue = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
        this.log.debug("Return Status: ", currentValue);
        callback(null, currentValue);
    }

    getPanelBatteryLevel(callback) {
        this.log.debug("Triggered Battery Level Check");
        // Determine how much time has elapse and how much battery is remaining. 
        // Only calculate if battery leve is not already zero and AC power is down.
        if ((this.batteryLevel > 0) && (this.ChargingState == Characteristic.ChargingState.NOT_CHARGING) ){
            var current = new Date();
            var timeDiff = current - this.downTime; //in ms
            // strip the ms
            timeDiff /= 1000;
            this.batteryLevel = Math.max(0,(100-((timeDiff/this.batteryRunTime)*100).toFixed(1)));
        }
        this.log.debug("Return Level: ", this.batteryLevel);
        callback(null,this.batteryLevel);
    }

    getPanelCharingState(callback) {
        this.log.debug("Triggered Charging status: ", this.ChargingState );
        callback(null,this.ChargingState);
    }

    proccessAlarmTimer() {
        var partitionService = this.getServices()[1];
        if (this.processingAlarm) {
            this.log.warn(`Alarm request did not return successful in allocated time. Current alarm status is ${this.status}`);
            this.processingAlarm = false;
            this.getAlarmState(function (nothing, returnValue) {
                partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState,returnValue);
            });
        } 
    }

    getMotionStatus(callback) {

        if (this.status == "open") {
            callback(null, true);
        } else {
            callback(null, false);
        }
    }

    getContactSensorState(callback) {

        if (this.status == "open") {
            callback(null, Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
        } else {
            callback(null, Characteristic.ContactSensorState.CONTACT_DETECTED);
        }
    }

    getLeakStatus(callback) {

        if (this.status == "open") {
            callback(null, Characteristic.LeakDetected.LEAK_DETECTED);
        } else {
            callback(null, Characteristic.LeakDetected.LEAK_NOT_DETECTED);
        }
    }

    getSmokeStatus(callback) {

        if (this.status == "open") {
            callback(null, Characteristic.SmokeDetected.SMOKE_DETECTED);
        } else {
            callback(null, Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
        }

    }

    getCOStatus(callback) {

        if (this.status == "open") {
            callback(null, Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL);
        } else {
            callback(null, Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL);
        }

    }

    getByPass(callback) {
        this.log.debug('Triggered Bypass Get: ', this.alarmstatus);
        switch (this.alarmstatus) {
            // if zone are bypass set button to on position.
            case "READY_BYPASS":
            case "ARMED_STAY_BYPASS":
            case "ARMED_NIGHT_BYPASS":
                this.status = true;
            break;
            default:
                this.status = false;
        }
        this.log.debug('Return Bypass Get: ', this.status);
        callback(null, this.status);
    }

    async setByPass(value, callback) {
        this.log.debug('Triggered Bypass: ', value, this.alarmstatus);
        // Determine if processing another bypass command.
        if (this.isProcessingBypass) {
            this.log("Already processing bypass request. Command ignored.");
            callback(null,this.status);
        }
        else
        {
            this.status = value;
            this.isProcessingBypass = true;
            // Get the button service and updated switch soon after set function is complete 
            var switchService = this.getServices()[0];
            // If alarm is on ignore request
            switch (this.alarmstatus) {
                case "NOT_READY":
                    // System not ready, review candidate for zone bypass 
                    if (value) {
                        this.log(`Reviewing fault zones for bypassing...`);
                        var command;
                        if (this.quickbypass) {
                            this.log(`Quick Bypass configured. Quick bypass of fault zones.`);
                            command = this.pin + tpidefs.alarmcommand.quickbypass;
                            alarm.sendCommand(command);
                            callback(null,value);
                            break;
                        }
                        // Reviewing zone that are being monitored and are bypass enabled (allowed to be bypass)
                        if (this.zoneaccessories.length == 0) {
                            this.log.warn(`No zones were defined.`);
                            this.status = false;
                            setTimeout(function () {switchService.updateCharacteristic(Characteristic.On,false)},500);
                            callback(null, false);
                            break;
                        }
                        var bypasscount = 0;
                        var zonesToBypass = "";
                        var bValue = false;
                        for (var i = 0; i < this.zoneaccessories.length; i++) {
                            var zoneinfo = this.zoneaccessories[i];
                            if (zoneinfo) {
                                // Only bypass zone that are open and has been enabled for bypass, default is false for all zone define in configuration file.
                                this.log.debug("Reviewing Zone: ", zoneinfo.name + ", " + zoneinfo.status + ", " + zoneinfo.bypassEnabled);
                                if ((zoneinfo.status == "open") && (zoneinfo.bypassEnabled)) {
                                    this.log(`Requesting bypassing of ${zoneinfo.name} ...`);
                                    if (zonesToBypass.length > 1) zonesToBypass = zonesToBypass + ","; 
                                    // Require leading zero for zone numbers which are not two or three digit (128 Panel)
                                    if (this.deviceType == "128FBP") 
                                        zonesToBypass = zonesToBypass + (("00" + zoneinfo.zone).slice(-3));
                                    else
                                        zonesToBypass = zonesToBypass + (("0" + zoneinfo.zone).slice(-2));
                                    bypasscount = bypasscount + 1;
                                }
                            }
                        } 
                        if (bypasscount == 0) {
                            this.log("No zones were enabled for bypass. Please set bypassEnabled flag for zone(s) wanting to enable for bypass by Homekit.")
                            bValue = false;
                        }
                        else {
                            command = this.pin + tpidefs.alarmcommand.bypass + zonesToBypass;
                            alarm.sendCommand(command);
                            await new Promise(r => setTimeout(r, 2000));
                            bValue = true;
                            this.log(`${bypasscount.toString()} zone(s) were queued for bypass.`);
                        }
                    
                    }
                    this.status = bValue;
                    setTimeout(function () {switchService.updateCharacteristic(Characteristic.On,bValue)},500);
                    callback(null, bValue);
                break;
                case "READY_BYPASS":
                    // Clear bypass zones
                    if (value == false) {
                        this.log(`Clearing bypass zones...`)
                        var command = this.pin + tpidefs.alarmcommand.disarm + this.partition;
                        alarm.sendCommand(command);
                    }
                    this.status = false;
                    callback(null, false);
                break;
                case 'READY':
                    this.log(`Alarm is ${this.alarmstatus} no action required. Ignoring bypass request.`);
                    this.status = false;
                    // Turn off switch, since no action was completed.
                    setTimeout(function () {switchService.updateCharacteristic(Characteristic.On,false)},2000);
                    callback(null, false);
                break;
                default:
                    // Nothing to process, return to previous state, 
                    this.status = !value;
                    setTimeout(function () {switchService.updateCharacteristic(Characteristic.On,!value)},2000);
                    callback(null, !value);
                break;
            }
            this.isProcessingBypass = false;
        }
    }

    setSpeedKey(key,value,callback) {

        this.log.debug('Triggered macro/speed keys', key);
        if (value) {
            // Get the button service and updated switch soon after set function is complete
            var switchService = this.getServices()[key];
            // Replace token values with pin
            var alarmcommand = this.command[key].replace("@pin",this.pin);
            this.log(`Sending panel command for key ${this.subname[key]}`);
            alarm.sendCommand(alarmcommand);
              // turn off after 2 sec
            setTimeout(function () {switchService.updateCharacteristic(Characteristic.On,false)}.bind(this),2000);
        }
        callback(null);
      
    }

    getChime(callback) {

        this.log.debug('Return Chime Get: ', this.status);
        callback(null, this.status);
    }

    setChime(value, callback) {
        this.log.debug('Triggered Chime');
        var command = this.pin + tpidefs.alarmcommand.togglechime
        alarm.sendCommand(command);    
        this.status = !this.status;              
        callback(null);
    }
}