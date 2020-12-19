const packageJson = require('./package.json');
var elink = require('./envisalink.js');
var tpidefs = require('./tpi.js');
var Service, Characteristic, Accessory;
var inherits = require('util').inherits;
var utilfunc = require('./helper.js');
var armingTimeOut = undefined;
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

    constructor(log, config) {

        this.log = log;
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

            // set global timeout for commands
            commandTimeOut = utilfunc.toIntBetween(config.commandTimeOut, 1, 30, 10);
            

            this.log("Configuring Envisalink Ademco platform.");
            // Process partition data
            for (var i = 0; i < this.partitions.length; i++) {
                var partition = this.partitions[i];
                partition.pin = config.pin ? config.pin : "1234"
                if(isNaN(partition.pin)) {
                    this.log.error("Ademco Pin must be a number. Please update configuration for the Envisakit Ademco plug-in.");
                    // terminate plug-in initization
                    return;
                }
                if(partition.pin.length != 4) {
                    this.log.warn("Ademco PIN are normally lenght of 4 digits. The provided PIN lenght may result in unusual behaviour.");
                }
                partition.Model = config.deviceType + " Keypad";
                partition.SerialNumber = "Envisalink." + (i + 1);
                var accessory = new EnvisalinkAccessory(this.log, "partition", partition, i + 1, []);
                this.platformPartitionAccessories.push(accessory);
            }
            this.platformZoneAccessoryMap = {};
            this.platformPartitionAccessoryMap = {};

            //process zone data
            var maxZone = this.zones.length;
            for (var i = 0; i < this.zones.length; i++) {
                var zone = this.zones[i];
                if ((zone.sensorType == "motion" || zone.sensorType == "window" || zone.sensorType == "door" || zone.sensorType == "leak" || zone.sensorType == "smoke") && (zone.name != undefined)){
                    var zoneNum = zone.zoneNumber ? zone.zoneNumber : (i + 1);
                    if (zoneNum > maxZone) {
                        maxZone = zoneNum;
                    }
                    zone.Model = config.deviceType + " " + zone.sensorType.charAt(0).toUpperCase() + zone.sensorType.slice(1) + " sensor";
                    zone.SerialNumber = "Envisalink." + zone.partition + "." + zoneNum;
                    var accessory = new EnvisalinkAccessory(this.log, zone.sensorType, zone, zone.partition, zoneNum, []);
                    var accessoryIndex = this.platformZoneAccessories.push(accessory) - 1;
                    this.platformZoneAccessoryMap['z.' + zoneNum] = accessoryIndex;
                } else {
                    this.log.error("Misconfigured Zone defination " + zone.name + " entry " + i + " igoring.");
                }
            }

            // Process bypass features (only one bypass button is created)
            if (this.bypass.length > 0) {
                var bypassswitch = this.bypass[0];
                bypassswitch.pin = config.pin ? config.pin : 1234;
                bypassswitch.Model = config.deviceType + " Keypad";
                bypassswitch.SerialNumber = "Envisalink." + 1;
                if (bypassswitch.name != undefined) {
                    // Pass the list of zone to bypass control and speed to the first partition
                    var accessory = new EnvisalinkAccessory(this.log, "bypass", bypassswitch, 1, 200, this.platformZoneAccessories);
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
                funckey.Model = config.deviceType + " Keypad";
                funckey.SerialNumber = "Envisalink." + 1;
                if (funckey.name != undefined) {
                var keycode = funckey.panelfunction ? funckey.panelfunction : String.fromCharCode(i + 65);
                var accessory = new EnvisalinkAccessory(this.log, "keys", funckey, 1, keycode, []);
                this.platformPartitionAccessories.push(accessory);
                }
                else {
                    this.log.error("Miscofigured Function key defination " + funckey.name + " igoring.");
                }

            }

            // Provide status on configurations completed
            if (this.zones.length > 0) this.log("Zone accessories configured: ", this.zones.length);
            if (this.bypass.length > 0) this.log("Bypass accessories configured.");
            if (this.keys.length > 0) this.log("Speed keys accessories configured.");
            
            // Begin connection process and bind alarm events to local function.
            // Create connection object and start the connection 
            alarm = new elink(log, config);
            alarm.connect();
            alarm.on('keypadupdate', this.systemUpdate.bind(this));
            alarm.on('zoneevent', this.zoneUpdate.bind(this));
            alarm.on('updatepartition', this.partitionUpdate.bind(this));
        }
    }

    systemUpdate(data) {
        this.log.debug('System status changed to: ', data.mode);
        var partition = this.platformPartitionAccessories[Number(data.partition) - 1];
        var accessorybypassIndex = this.platformPartitionAccessoryMap['b.' + Number(data.partition)];
        // partition update information
        if ((data.partition) && (partition.processingAlarm == false)) {
            for (var i = 0; i < this.platformPartitionAccessories.length; i++) {
                var partitionAccessory = this.platformPartitionAccessories[i];
                if (partitionAccessory.partition == data.partition) {
                    if (partitionAccessory.status != data.mode) {
                        partitionAccessory.status = data.mode;
                        this.log.debug("Set system status on accessory " + partitionAccessory.name + ' to ' + JSON.stringify(partitionAccessory.status));
                        var partitionService = (partitionAccessory.getServices())[0];
                        if (partitionService) {
                            partitionAccessory.getAlarmState(function (nothing, resultat) {
                                partitionService.getCharacteristic(Characteristic.SecuritySystemCurrentState).updateValue(resultat)
                            });
                        }
                    }
                }
            }
        }
        // if bypass enable update status
        if (accessorybypassIndex !== undefined) {
            var accessory = this.platformPartitionAccessories[accessorybypassIndex - 1];
            if (accessory) {
                accessory.status = data.mode;
                this.log.debug("Set status on accessory " + accessory.name + ' to ' + JSON.stringify(accessory.status));
                if (accessory.accessoryType == "bypass") {
                    var accservice = (accessory.getServices())[0];
                    accessory.getByPass(function (nothing, resultat) {
                        accservice.getCharacteristic(Characteristic.On).updateValue(resultat)
                    });
                }
            }
        }
    }


    partitionUpdate(data) {
        this.log.debug('Partition status changed to: ', data.mode);
        var partition = this.platformPartitionAccessories[Number(data.partition) - 1];

        if (data.partition) {
            for (var i = 0; i < this.platformPartitionAccessories.length; i++) {
                var partitionAccessory = this.platformPartitionAccessories[i];
                if (partitionAccessory.partition == data.partition) {
                    partitionAccessory.status = data.mode;
                    this.log.debug("Set system status on accessory " + partitionAccessory.name + ' to ' + JSON.stringify(partitionAccessory.status));
                    var partitionService = (partitionAccessory.getServices())[0];
                    if (partitionService) {
                        partitionAccessory.getAlarmState(function (nothing, resultat) {
                            partitionService.getCharacteristic(Characteristic.SecuritySystemCurrentState).updateValue(resultat)
                        });
                    }
                }
            }
            // partition update occured, if was due to alarm state change clear state.
            if (partition) {
                if (partition.processingAlarm) {
                    // clear timer and return state immediately
                    partition.processingAlarm = false;
                    clearTimeout(armingTimeOut);
                    armingTimeOut = undefined;
                    partition.proccessAlarmTimer();
                }
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
                        if (accessory.accessoryType == "motion") {

                            accessory.getMotionStatus(function (nothing, resultat) {
                                accservice.getCharacteristic(Characteristic.MotionDetected).setValue(resultat);
                            });

                        } else if (accessory.accessoryType == "door" || accessory.accessoryType == "window") {

                            accessory.getContactSensorState(function (nothing, resultat) {
                                accservice.getCharacteristic(Characteristic.ContactSensorState).setValue(resultat);
                            });

                        } else if (accessory.accessoryType == "leak") {

                            accessory.getLeakStatus(function (nothing, resultat) {
                                accservice.getCharacteristic(Characteristic.LeakDetected).setValue(resultat);
                            });

                        } else if (accessory.accessoryType == "smoke") {

                            accessory.getSmokeStatus(function (nothing, resultat) {
                                accservice.getCharacteristic(Characteristic.SmokeDetected).setValue(resultat);
                            });
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
        if (this.accessoryType == "partition") {
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

        } else if (this.accessoryType == "motion") {
            var service = new Service.MotionSensor(this.name);
            service
                .getCharacteristic(Characteristic.MotionDetected)
                .on('get', this.getMotionStatus.bind(this));
            this.services.push(service);
            this.bypassEnabled = config.bypassEnabled ? config.bypassEnabled : false;

        } else if (this.accessoryType == "door") {
            var service = new Service.ContactSensor(this.name);
            service
                .getCharacteristic(Characteristic.ContactSensorState)
                .on('get', this.getContactSensorState.bind(this));
            this.services.push(service);
            this.bypassEnabled = config.bypassEnabled ? config.bypassEnabled : false;

        } else if (this.accessoryType == "window") {
            var service = new Service.ContactSensor(this.name);
            service
                .getCharacteristic(Characteristic.ContactSensorState)
                .on('get', this.getContactSensorState.bind(this));
            this.services.push(service);
            this.bypassEnabled = config.bypassEnabled ? config.bypassEnabled : false;

        } else if (this.accessoryType == "leak") {
            var service = new Service.LeakSensor(this.name);
            service
                .getCharacteristic(Characteristic.LeakDetected)
                .on('get', this.getLeakStatus.bind(this));
            this.services.push(service);
            this.bypassEnabled = config.bypassEnabled ? config.bypassEnabled : false;

        } else if (this.accessoryType == "smoke") {
            var service = new Service.SmokeSensor(this.name);
            service
                .getCharacteristic(Characteristic.SmokeDetected)
                .on('get', this.getSmokeStatus.bind(this));
            this.services.push(service);
            this.bypassEnabled = config.bypassEnabled ? config.bypassEnabled : false;

        } else if (this.accessoryType == "bypass") {
            var service = new Service.Switch(this.name);
            service
                .getCharacteristic(Characteristic.On)
                .on('get', this.getByPass.bind(this))
                .on('set', this.setByPass.bind(this));
            this.services.push(service);
            this.zoneaccessories = accessories;
            this.quickbypass = config.quickbypass ? config.quickbypass : false;
            this.processingBypass = false;

        } else if (this.accessoryType == "keys") {
            // These are push button key, upon processing request will return to off.
            var service = new Service.Switch(this.name);
            service
                .getCharacteristic(Characteristic.On)
                .on('get', this.getFuntionKey.bind(this))
                .on('set', this.setFuntionKey.bind(this));
            this.services.push(service);
            // function just require sending charater code of key. Such as "A", "B" ...etc.
            this.functionkeycode = code;
        }

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

        // Default to disarmed
        var status = Characteristic.SecuritySystemCurrentState.DISARMED;
        if (this.processingAlarm == false) {
            this.log.debug("Getting status.", currentState);

            if (currentState) {
                if (currentState == "ALARM") {
                    status = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
                } else if (currentState.substring(0, 5) == "ARMED") {

                    if ((currentState == "ARMED_STAY") || (currentState == "ARMED_STAY_BYPASS")) {
                        status = Characteristic.SecuritySystemCurrentState.STAY_ARM;
                    } else if ((currentState == "ARMED_NIGHT") || (currentState == "ARMED_NIGHT_BYPASS")) {
                        status = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
                    } else
                        status = Characteristic.SecuritySystemCurrentState.AWAY_ARM;

                } else if (currentState == "EXIT_DELAY") {
                    //Use the target alarm state during the exit and entrance delays.
                    if (this.lastTargetState) {
                        status = this.lastTargetState;
                    }
                }
            }
            callback(null, status);
        } else {
            if (this.lastTargetState) {
                status = this.lastTargetState;
            }
            callback(null, status);
        }
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
                    alarm.sendCommand(command);
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
            partitionService.getCharacteristic(Characteristic.SecuritySystemCurrentState).updateValue(Characteristic.SecuritySystemCurrentState.DISARMED);
            callback(null, Characteristic.SecuritySystemCurrentState.DISARMED);
        }
    }

    proccessAlarmTimer() {
        var partitionService = this.getServices()[0];
        if (this.processingAlarm) {
            this.log.warn("Alarm request did not return successful in allocated time. Current alarm status is ", this.status);
            this.processingAlarm = false;
            this.getAlarmState(function (nothing, resultat) {
                partitionService.getCharacteristic(Characteristic.SecuritySystemCurrentState).updateValue(resultat);
            });
        } else {
            partitionService.getCharacteristic(Characteristic.SecuritySystemCurrentState).updateValue(this.lastTargetState);
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
            callback(null,this.lastTargetState);
        }
        else
        {
            this.lastTargetState = value;
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
                        alarm.sendCommand(command);
                        this.processingBypass = false;
                        callback(null,value);
                        break;
                    }
                    // Reviewing zone that are being monitored and are bypass enabled (allowed to be bypass)
                    if (this.zoneaccessories.length == 0) {
                        this.log.warn("No zones defined for Bypassing.");
                        this.processingBypass = false;
                        this.lastTargetState = false;
                        setTimeout(function () {switchService.getCharacteristic(Characteristic.On).updateValue(false)},500);
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
                                alarm.sendCommand(command);
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
                this.lastTargetState = bValue;
                setTimeout(function () {switchService.getCharacteristic(Characteristic.On).updateValue(bValue)},500);
                callback(null, bValue);
                break;
            case "READY_BYPASS":
                // Clear bypass zones
                if (value == false) {
                    this.log("Clearing bypass zones...")
                    var command = this.pin + tpidefs.alarmcommand.disarm + this.partition;
                    alarm.sendCommand(command);
                }
                this.lastTargetState = false;
                callback(null, false);
                break;
            case 'READY':
                this.log("Alarm is ", this.status, " no action required. Ignoring Bypass request.");
                this.lastTargetState = false;
                // Turn off switch, since no action was completed.
                setTimeout(function () {switchService.getCharacteristic(Characteristic.On).updateValue(false)},500);
                callback(null, false);
                break;
            default:
                // Nothing to process, return to previous state, 
                this.lastTargetState = !value;
                setTimeout(function () {switchService.getCharacteristic(Characteristic.On).updateValue(!value)},500);
                callback(null, !value);
                break;

        }
    }
    getFuntionKey(callback) {

        callback(null, false);
    }

    setFuntionKey(value, callback) {

        this.log('Triggered special function key');
         // Get the button service and updated switch soon after set function is complete 
        if (value) {
            var switchService = this.getServices()[0];
            this.log("Sending code ", this.functionkeycode);
            var command = this.functionkeycode;
            alarm.sendCommand(command);
            setTimeout(function () {switchService.getCharacteristic(Characteristic.On).updateValue(false)},500);
        }
        callback(null, false);
    }
}