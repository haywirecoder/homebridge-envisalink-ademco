const packageJson = require('./package.json');
var elink = require('./envisalink.js');
var tpidefs = require('./tpi.js');
var Service, Characteristic, Accessory, uuid;
var inherits = require('util').inherits;
var utilfunc = require('./helper.js');
var armingTimeOut = undefined;
var isMaintenanceMode = false;
var commandTimeOut;
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
            this.deviceType = config.deviceType ? config.deviceType : "Honeywell Vista";
            this.partitions = config.partitions ? config.partitions : [{
                name: 'House'
            }];
            this.bypass = config.bypass ? config.bypass : [];
            this.keys = config.keys ? config.keys : [];
            this.zones = config.zones ? config.zones : [];
            this.platformPartitionAccessories = [];
            this.platformZoneAccessories = [];
            this.platformZoneAccessoryMap = {};
            this.platformPartitionAccessoryMap = {};
            this.chime = config.chimeToggle ? config.chimeToggle: false;
            // set global timeout for commands
            commandTimeOut = utilfunc.toIntBetween(config.commandTimeOut, 1, 30, 10);
            // are we in maintanance mode?
            isMaintenanceMode = config.maintenanceMode ? config.maintenanceMode: false
            
            // Build device list
            this.refreshAccessories();

            // Provide status on configurations completed
            if (this.zones.length > 0) this.log("Zone accessories configured: ", this.zones.length);
            if (this.bypass.length > 0) this.log("Bypass accessories configured.");
            if (this.keys.length > 0) this.log("Speed keys accessories configured.");
            if (this.chime) this.log("Chime toggle accessory configured.")
            
            // Begin connection process and bind alarm events to local function.
            // Create connection object and start the connection 
            alarm = new elink(log, config);

            // Should plug run in a disconnect mode. Allow maintaince without resulting in alot of logs error 
            if (isMaintenanceMode == false){
                alarm.connect();
                alarm.on('keypadupdate', this.systemUpdate.bind(this));
                alarm.on('zoneevent', this.zoneUpdate.bind(this));
                alarm.on('updatepartition', this.partitionUpdate.bind(this));
            }
            else
                this.log.warn("This plug-in is running in maintenance mode. All updates and operations are disabled!");
        }
    }

    // Create associates in Homekit based on configuration file
    refreshAccessories() {
        this.log("Configuring Envisalink Ademco platform.");
        // Process partition data
        for (var i = 0; i < this.partitions.length; i++) {
            var partition = this.partitions[i];
            partition.pin = this.config.pin ? this.config.pin : "1234"
            if(isNaN(partition.pin)) {
                this.log.error("Ademco Pin must be a number. Please update configuration for the Envisakit Ademco plug-in.");
                // terminate plug-in initization
                return;
            }
            if(partition.pin.length != 4) {
                this.log.warn("Ademco PIN are normally lenght of 4 digits. The provided PIN lenght may result in unusual behaviour.");
            }
            partition.Model = this.config.deviceType + " Keypad";
            partition.SerialNumber = "Envisalink." + (i + 1);
            var accessory = new EnvisalinkAccessory(this.log, "partition", partition, i + 1, []);
            this.platformPartitionAccessories.push(accessory);
        }

        //process zone data
        var maxZone = this.zones.length;
        for (var i = 0; i < this.zones.length; i++) {
            var zone = this.zones[i];
            if ((zone.sensorType == "motion" || zone.sensorType == "glass" || zone.sensorType == "window" || zone.sensorType == "door" || zone.sensorType == "leak" || zone.sensorType == "smoke" || zone.sensorType == "co") && (zone.name != undefined)){
                var zoneNum = zone.zoneNumber ? zone.zoneNumber : (i + 1);
                if (zoneNum > maxZone) {
                    maxZone = zoneNum;
                }
                zone.Model = this.config.deviceType + " " + zone.sensorType.charAt(0).toUpperCase() + zone.sensorType.slice(1) + " sensor";
                zone.SerialNumber = "Envisalink." + zone.partition + "." + zoneNum;
                var accessory = new EnvisalinkAccessory(this.log, zone.sensorType, zone, zone.partition, zoneNum, []);
                var accessoryIndex = this.platformZoneAccessories.push(accessory) - 1;
                this.platformZoneAccessoryMap['z.' + zoneNum] = accessoryIndex;
            } else {
                this.log.error("Misconfigured Zone defination " + zone.name + ". Entry - " + i + " igoring.");
            }
        }

        // Process bypass features (only one bypass button is created)
        if (this.bypass.length > 0) {
            var bypassswitch = this.bypass[0];
            bypassswitch.pin = this.config.pin ? this.config.pin : 1234;
            bypassswitch.Model = this.config.deviceType + " Keypad";
            bypassswitch.SerialNumber = "Envisalink.ByPass.1";
            bypassswitch.partition = 1;
            if (bypassswitch.name != undefined) {
                // Pass the list of zone to bypass control and speed to the first partition
                var accessory = new EnvisalinkAccessory(this.log, "bypass", bypassswitch, bypassswitch.partition, 206, this.platformZoneAccessories);
                var accessoryIndex = this.platformPartitionAccessories.push(accessory);
                this.platformPartitionAccessoryMap['b.' + bypassswitch.partition] = accessoryIndex;
            }
            else{
                this.log.error("Misconfigured Bypass switch defination " + bypassswitch.name + " igoring.");
            }

        }

        // Creating special function key (pre-program)
        for (var i = 0; i < this.keys.length; i++) {
            var funckey = this.keys[i];
            funckey.Model = this.config.deviceType + " Keypad";
            funckey.SerialNumber = "Envisalink.KeyFunction." + i;
            funckey.partition = 1;
            if (funckey.name != undefined) {
                var keycode = funckey.panelfunction ? funckey.panelfunction : String.fromCharCode(i + 65);
                var accessory = new EnvisalinkAccessory(this.log, "keys", funckey, funckey.partition, keycode, []);
                this.platformPartitionAccessories.push(accessory);
            }
            else {
                this.log.error("Misconfigured Function key defination " + funckey.name + " igoring.");
            }
        }
        
        // Process toggle chime switch functionality 
        if (this.chime ) {
        var chimeswitch = {};
        chimeswitch.pin = this.config.pin ? this.config.pin : 1234;
        chimeswitch.Model = this.config.deviceType + " Keypad";
        chimeswitch.SerialNumber = "Envisalink.Chime.1";
        chimeswitch.name  = "Chime";
        chimeswitch.partition = 1;
        // Create Chime Toogle button
        var accessory = new EnvisalinkAccessory(this.log, "chime", chimeswitch, chimeswitch.partition , 209, []);
        var accessoryIndex = this.platformPartitionAccessories.push(accessory);
        this.platformPartitionAccessoryMap['c.' + chimeswitch.partition] = accessoryIndex;
        }
    }

    systemUpdate(data) {
        this.log.debug('System status changed to: ', data.mode);
        var partition = this.platformPartitionAccessories[Number(data.partition) - 1];
        var accessorybypassIndex = this.platformPartitionAccessoryMap['b.' + Number(data.partition)];
        var accessoryChimeIndex = this.platformPartitionAccessoryMap['c.' + Number(data.partition)];
        // partition update information
        if ((partition.processingAlarm == false) && (partition.accessoryType == "partition")) {
            if (partition.status != data.mode) {
                partition.status = data.mode;
                this.log.debug("Set system status on accessory " + partition.name + ' to ' + partition.status);
                var partitionService = (partition.getServices())[0];
                if (partitionService) {
                    partition.getAlarmState(function (nothing, returnValue) {
                                partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState,returnValue)
                        });
                }
            }
        }
         // if chime enable update status
         if (accessoryChimeIndex !== undefined) {
            var accessoryChime = this.platformPartitionAccessories[accessoryChimeIndex - 1];
            if (accessoryChime) {
                accessoryChime.status = data.keypadledstatus.chime;
                this.log.debug("Set status on accessory Chime " + accessoryChime.status);
                if (accessoryChime.accessoryType == "chime") {
                    var accservice = (accessoryChime.getServices())[0];
                    accessoryChime.getChime(function (nothing, returnValue) {
                        accservice.updateCharacteristic(Characteristic.On,returnValue)
                    });
                }
            }
        }

        // if bypass enable update status
        if (accessorybypassIndex !== undefined) {
            var accessoryBypass = this.platformPartitionAccessories[accessorybypassIndex - 1];
            if (accessoryBypass) {
                accessoryBypass.status = data.mode;
                this.log.debug("Set status on accessory " + accessoryBypass.name + ' to ' + accessoryBypass.status);
                if (accessoryBypass.accessoryType == "bypass") {
                    var accservice = (accessoryBypass.getServices())[0];
                    accessoryBypass.getByPass(function (nothing, returnValue) {
                        accservice.updateCharacteristic(Characteristic.On,returnValue)
                    });
                }
            }
        }
    }


    partitionUpdate(data) {
        this.log.debug('Partition status changed to: ', data.mode);
        var partition = this.platformPartitionAccessories[Number(data.partition) - 1];

        if ((data.partition) && (partition.partition == data.partition)) {
               partition.status = data.mode;
                this.log.debug("Set system status on accessory " + partition.name + ' to ' + partition.status);
                var partitionService = (partition.getServices())[0];
                if (partitionService) {
                        partition.getAlarmState(function (nothing, returnValue) {
                            partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState,returnValue)
                        });
                }
                if (partition.processingAlarm) {
                    // clear timer and return state immediately
                    partition.processingAlarm = false;
                    clearTimeout(armingTimeOut);
                    armingTimeOut = undefined;
                    partition.proccessAlarmTimer();
                }
        }
    }

    zoneUpdate(data) {
        this.log.debug('ZoneUpdate status changed to: ', data.mode);
        for (var i = 0; i < data.zone.length; i++) {
            var accessoryIndex = this.platformZoneAccessoryMap['z.' + data.zone[i]];
            if (accessoryIndex !== undefined) {
                var accessory = this.platformZoneAccessories[accessoryIndex];
                if (accessory) {
                    accessory.status = data.mode;
                    this.log.debug("Set status on accessory " + accessory.name + ' to ' + JSON.stringify(accessory.status));

                    var accservice = (accessory.getServices())[0];
                    if (accservice) {
                        switch(accessory.accessoryType) {
                            case "motion":
                            case "glass":
                                accessory.getMotionStatus(function (nothing, returnValue) {
                                    accservice.getCharacteristic(Characteristic.MotionDetected).setValue(returnValue);
                                });
                            break;
                            case "door":
                            case "window":
                                accessory.getContactSensorState(function (nothing, returnValue) {
                                    accservice.getCharacteristic(Characteristic.ContactSensorState).setValue(returnValue);
                                });
                            break;
                            case "leak":
                                accessory.getLeakStatus(function (nothing, returnValue) {
                                    accservice.getCharacteristic(Characteristic.LeakDetected).setValue(returnValue);
                                });
                            break;
                            case "smoke":
                                accessory.getSmokeStatus(function (nothing, returnValue) {
                                    accservice.getCharacteristic(Characteristic.SmokeDetected).setValue(returnValue);
                                });
                            break;
                            case "co":
                                accessory.getCOStatus(function (nothing, returnValue) {
                                    accservice.getCharacteristic(Characteristic.CarbonMonoxideDetected).setValue(returnValue);
                                });
                            break;
                        }
                    }
                }
            }
        }
    }

    accessories(callback) {
        callback(this.platformPartitionAccessories.concat(this.platformZoneAccessories));
    }
}


  
class EnvisalinkAccessory {
    constructor(log, accessoryType, config, partition, code, accessories) {
        this.log = log;
        this.name = config.name;

        var id = 'envisalink.' + partition;
        if (code) {
            id += "." + code;
        }
        this.uuid_base = uuid.generate(id);
        Accessory.call(this, this.name, this.uuid_base);

        this.accessoryType = accessoryType;
        this.partition = partition;
        this.pin = config.pin ? config.pin : 1234;
        this.zone = code;
        this.status = null;
        this.processingAlarm = false;
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
                    .addCharacteristic(Characteristic.StatusFault)
                    .on('get', this.getReadyState.bind(this));
                this.services.push(service);
                this.status = "READY";
                this.lastTargetState = Characteristic.SecuritySystemCurrentState.DISARMED;
            break;
        
            case "motion":
                var service = new Service.MotionSensor(this.name);
                service
                    .getCharacteristic(Characteristic.MotionDetected)
                    .on('get', this.getMotionStatus.bind(this));
                this.services.push(service);
                this.bypassEnabled = config.bypassEnabled ? config.bypassEnabled : false;
            break;
        
            case "glass":
                    var service = new Service.MotionSensor(this.name);
                    service
                        .getCharacteristic(Characteristic.MotionDetected)
                        .on('get', this.getMotionStatus.bind(this));
                    this.services.push(service);
                    this.bypassEnabled = config.bypassEnabled ? config.bypassEnabled : false;
            break;
        
            case "door":
                var service = new Service.ContactSensor(this.name);
                service
                    .getCharacteristic(Characteristic.ContactSensorState)
                    .on('get', this.getContactSensorState.bind(this));
                this.services.push(service);
                this.bypassEnabled = config.bypassEnabled ? config.bypassEnabled : false;
            break;
        
            case "window":
                var service = new Service.ContactSensor(this.name);
                service
                    .getCharacteristic(Characteristic.ContactSensorState)
                    .on('get', this.getContactSensorState.bind(this));
                this.services.push(service);
                this.bypassEnabled = config.bypassEnabled ? config.bypassEnabled : false;
            break;
        
            case "leak":
                var service = new Service.LeakSensor(this.name);
                service
                    .getCharacteristic(Characteristic.LeakDetected)
                    .on('get', this.getLeakStatus.bind(this));
                this.services.push(service);
                this.bypassEnabled = config.bypassEnabled ? config.bypassEnabled : false;
            break;
        
            case "smoke":
                var service = new Service.SmokeSensor(this.name);
                service
                    .getCharacteristic(Characteristic.SmokeDetected)
                    .on('get', this.getSmokeStatus.bind(this));
                this.services.push(service);
                this.bypassEnabled = config.bypassEnabled ? config.bypassEnabled : false;
            break;
        
            case "co":
                var service = new Service.CarbonMonoxideSensor(this.name);
                service
                    .getCharacteristic(Characteristic.CarbonMonoxideDetected)
                    .on('get', this.getCOStatus.bind(this));
                this.services.push(service);
                this.bypassEnabled = config.bypassEnabled ? config.bypassEnabled : false;
            break;
        
            case "bypass":
                var service = new Service.Switch(this.name);
                service
                    .getCharacteristic(Characteristic.On)
                    .on('get', this.getByPass.bind(this))
                    .on('set', this.setByPass.bind(this));
                this.services.push(service);
                this.zoneaccessories = accessories;
                this.quickbypass = config.quickbypass ? config.quickbypass : false;
            break;
        
            case "keys":
                // These are push button key, upon processing request will return to off.
                var service = new Service.Switch(this.name);
                service
                    .getCharacteristic(Characteristic.On)
                    .on('get', this.getFuntionKey.bind(this))
                    .on('set', this.setFuntionKey.bind(this));
                this.services.push(service);
                // function just require sending charater code of key. Such as "A", "B" ...etc.
                this.functionkeycode = code;
                this.status = false;
            break;
        
            case "chime":
                // These are push button key, upon processing request will return current state of chime report by keypad event.
                var service = new Service.Switch(this.name);
                service
                    .getCharacteristic(Characteristic.On)
                    .on('get', this.getChime.bind(this))
                    .on('set', this.setChime.bind(this));
                this.services.push(service);
                this.status = true;
            break;
        }
        // set device informaiton.
        var serviceAccessoryInformation = new Service.AccessoryInformation();
        serviceAccessoryInformation.setCharacteristic(Characteristic.Manufacturer, 'Envisacor Technologies Inc.');
        serviceAccessoryInformation.setCharacteristic(Characteristic.Model, config.Model);
        serviceAccessoryInformation.setCharacteristic(Characteristic.Name, 'homebridge-envisalink-ademco');
        serviceAccessoryInformation.setCharacteristic(Characteristic.SerialNumber, config.SerialNumber);
        serviceAccessoryInformation.setCharacteristic(Characteristic.FirmwareRevision, packageJson.version);
        // Add accessory information
        this.services.push(serviceAccessoryInformation);
    }

    getServices() {
        return this.services;
    }

    getReadyState(callback) {

        var currentState = this.status;
        var status = Characteristic.StatusFault.NO_FAULT;
        if (currentState) {
            if (currentState == "NOT_READY")
                status = Characteristic.StatusFault.GENERAL_FAULT;
        }

        this.log.debug("Readystate Return ", status);
        callback(null, status);
    }

    getMotionStatus(callback) {

        if (this.status == "OPEN") {
            callback(null, true);
        } else {
            callback(null, false);
        }
    }

    getAlarmState(callback) {

        var currentState = this.status;
        // Assume last target state
        var status = this.lastTargetState;
        if (this.processingAlarm == false) {
            this.log.debug("Getting status.", currentState);
            switch (currentState) {
                case "ALARM":
                    status = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
                break;
                case 'ARMED_STAY':
                case 'ARMED_STAY_BYPASS':
                    status = Characteristic.SecuritySystemCurrentState.STAY_ARM;
                break;
                case 'ARMED_NIGHT':
                case 'ARMED_NIGHT_BYPASS':    
                    status = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
                break;
                case 'ARMED_AWAY':
                case 'ARMED_AWAY_BYPASS':
                    status = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
                break;
                case 'READY':
                case 'READY_BYPASS':
                case 'NOT_READY':
                case 'NOT_READY_TROUBLE':
                    status = Characteristic.SecuritySystemCurrentState.DISARMED;
                break;
            }
        }
        callback(null, status);
    }

    setAlarmState(state, callback) {
        var currentState = this.status;
        var command = null;
        if (currentState != "NOT_READY") {
            if (this.processingAlarm == false) {
                if (state == Characteristic.SecuritySystemCurrentState.DISARMED) {
                    this.log("Disarming alarm with PIN.");
                    command = this.pin + tpidefs.alarmcommand.disarm + this.partition;

                } else if (state == Characteristic.SecuritySystemCurrentState.STAY_ARM) {
                    this.log("Arming alarm to Stay (Home).");
                    command = this.pin + tpidefs.alarmcommand.stay + this.partition;
                } else if (state == Characteristic.SecuritySystemCurrentState.NIGHT_ARM) {
                    this.log("Arming alarm to Night.");
                    command = this.pin + tpidefs.alarmcommand.night + this.partition;

                } else if (state == Characteristic.SecuritySystemCurrentState.AWAY_ARM) {
                    this.log("Arming alarm to Away.");
                    command = this.pin + tpidefs.alarmcommand.away + this.partition;
                }

                if (command) {
                    this.processingAlarm = true;
                    this.lastTargetState = state;
                    if (!isMaintenanceMode) alarm.sendCommand(command);
                    armingTimeOut = setTimeout(this.proccessAlarmTimer.bind(this), commandTimeOut * 1000);
                    callback(null, state);
                } else {
                    this.log.error("Unhandled alarm state: " + state);
                    callback(null, state);
                }
            } else {
                this.log.warn("Already handling Alarm state change, igorning request.");
                callback(null, this.lastTargetState);
            }
        } else {
            this.log.warn("Alarm not ready, igorning request.");
            var partitionService = this.getServices()[0];
            partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState,Characteristic.SecuritySystemCurrentState.DISARMED);
            callback(null, Characteristic.SecuritySystemCurrentState.DISARMED);
        }
    }

    proccessAlarmTimer() {
        var partitionService = this.getServices()[0];
        if (this.processingAlarm) {
            this.log.warn("Alarm request did not return successful in allocated time. Current alarm status is ", this.status);
            this.processingAlarm = false;
            this.getAlarmState(function (nothing, returnValue) {
                partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState,returnValue);
            });
        } else {
            partitionService.updateCharacteristic(Characteristic.SecuritySystemCurrentState,this.lastTargetState);
            
        }
    }

    getContactSensorState(callback) {

        if (this.status == "OPEN") {
            callback(null, Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
        } else {
            callback(null, Characteristic.ContactSensorState.CONTACT_DETECTED);
        }
    }

    getLeakStatus(callback) {

        if (this.status == "OPEN") {
            callback(null, Characteristic.LeakDetected.LEAK_DETECTED);
        } else {
            callback(null, Characteristic.LeakDetected.LEAK_NOT_DETECTED);
        }
    }

    getSmokeStatus(callback) {

        if (this.status == "OPEN") {
            callback(null, Characteristic.SmokeDetected.SMOKE_DETECTED);
        } else {
            callback(null, Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
        }

    }

    getCOStatus(callback) {

        if (this.status == "OPEN") {
            callback(null, Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL);
        } else {
            callback(null, Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL);
        }

    }

    getByPass(callback) {
        var status = false;
        this.log.debug('Triggered Bypass Get', this.status);
        switch (this.status) {
            // if zone are bypass set button to on position.
            case "READY_BYPASS":
            case "ARMED_STAY_BYPASS":
            case "ARMED_NIGHT_BYPASS":
                status = true;
            break;
            default:
                status = false;
        }
        callback(null, status);
    }

    setByPass(value, callback) {
        this.log.debug('Triggered Bypass: ', value);
        // Determine if processing another bypass command.
        if (this.processingBypass) {
            this.log("Already processing bypass request. Command ignored.");
            callback(null,this.status);
        }
        else
        {
            this.status = value;
        }

         // Get the button service and updated switch soon after set function is complete 
        var switchService = this.getServices()[0];
        // If alarm is on ignore request
        switch (this.status) {
            case "NOT_READY":
                // System not ready, candidate for zone bypass 
                if (value) {
                    this.processingBypass = true;
                    this.log("Reviewing fault zones for bypassing...");
                    var command;
                    if (this.quickbypass) {
                        this.log("Quick Bypass configured. Quick bypass of fault zones.");
                        command = this.pin + tpidefs.alarmcommand.quickbypass;
                        if (!isMaintenanceMode) alarm.sendCommand(command);
                        this.processingBypass = false;
                        callback(null,value);
                        break;
                    }
                    // Reviewing zone that are being monitored and are bypass enabled (allowed to be bypass)
                    if (this.zoneaccessories.length == 0) {
                        this.log.warn("No zones defined for Bypassing.");
                        this.processingBypass = false;
                        this.status = false;
                        setTimeout(function () {switchService.updateCharacteristic(Characteristic.On,false)},500);
                        callback(null, false);
                        break;
                    }
                    var bypasscount = 0;
                    var bValue = false;
                    for (var i = 0; i < this.zoneaccessories.length; i++) {
                        var zoneinfo = this.zoneaccessories[i];
                        if (zoneinfo) {
                            // Only bypass zone that are open and has been enabled for bypass, default is false for all zone define in configuration file.
                            this.log.debug("Reviewing Zone", zoneinfo.name + ", " + zoneinfo.status + ", " + zoneinfo.bypassEnabled);
                            if ((zoneinfo.status == "OPEN") && (zoneinfo.bypassEnabled)) {
                                this.log("Bypassing", zoneinfo.name);
                                command = this.pin + tpidefs.alarmcommand.bypass + zoneinfo.zone;
                                // don't over load the command buffer, waiting 500 ms before requesting another bypass request
                                if (!isMaintenanceMode) alarm.sendCommand(command);
                                utilfunc.sleep(500);
                                bypasscount = bypasscount + 1;
                                bValue = true;
                            }
                        }
                    }
                    if (bypasscount == 0) this.log("No zones were enabled for Bypassing")
                    else this.log("Bypass ", bypasscount.toString(), " zone(s)");
                   
                }
                this.processingBypass = false;
                this.status = bValue;
                setTimeout(function () {switchService.updateCharacteristic(Characteristic.On,bValue)},500);
                callback(null, bValue);
            break;
            case "READY_BYPASS":
                // Clear bypass zones
                if (value == false) {
                    this.log("Clearing bypass zones...")
                    var command = this.pin + tpidefs.alarmcommand.disarm + this.partition;
                    if (!isMaintenanceMode) alarm.sendCommand(command);
                }
                this.status = false;
                callback(null, false);
            break;
            case 'READY':
                this.log("Alarm is ", this.status, " no action required. Ignoring Bypass request.");
                this.status = false;
                // Turn off switch, since no action was completed.
                setTimeout(function () {switchService.updateCharacteristic(Characteristic.On,false)},500);
                callback(null, false);
            break;
            default:
                // Nothing to process, return to previous state, 
                this.status = !value;
                setTimeout(function () {switchService.updateCharacteristic(Characteristic.On,!value)},500);
                callback(null, !value);
            break;

        }
    }
    getFuntionKey(callback) {

        var status = false;
        callback(null, status);
    }

    setFuntionKey(value, callback) {

        this.log('Triggered special function key');
         // Get the button service and updated switch soon after set function is complete 
        if (value) {
            var switchService = this.getServices()[0];
            this.log("Sending code ", this.functionkeycode);
            var command = this.functionkeycode;
            if (!isMaintenanceMode) alarm.sendCommand(command);
            setTimeout(function () {switchService.updateCharacteristic(Characteristic.On,false)},500);
        }
        callback(null, false);
    }

    getChime(callback) {

        this.log.debug('Triggered Chime Get ', this.status);
        callback(null, this.status);
    }

    setChime(value, callback) {

        var command = this.pin + tpidefs.alarmcommand.togglechime
        this.log.debug('Toggling Chime sending command ', command);
        if (!isMaintenanceMode) alarm.sendCommand(command);    
        this.status = !this.status;              
        callback(null, !value);
    }
}