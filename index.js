const packageJson = require('./package.json');
var elink = require('./envisalink.js');
var Service, Characteristic, Accessory;
var inherits = require('util').inherits;
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
        this.deviceType = config.deviceType ? config.deviceType : "Honeywell Vista";
        this.partitions = config.partitions ? config.partitions : [{ name: 'House' }];
        this.zones = config.zones ? config.zones : [];

        // set global timeout for commands
        commandTimeOut = config.commandTimeOut ? config.commandTimeOut : 10000;
        this.platformPartitionAccessories = [];
        this.platformZoneAccessories = [];

        // Must define IP address for Envisakit server
        if (config.host == undefined) {
            this.log.error("No host address defined for plug-in. Please configure the Envisakit server address.");
            this.log.error("Requesting shutdown and exiting.");
            // terminate plug-in and homebridge
            process.kill(process.pid, 'SIGINT');

        }
        else {
            this.log("Configuring Envisalink Ademco platform.");
            // Process partition data
            for (var i = 0; i < this.partitions.length; i++) {
                var partition = this.partitions[i];
                partition.pin = config.pin;
                partition.model = config.deviceType;
                var accessory = new EnvisalinkAccessory(this.log, "partition", partition, i + 1);
                this.platformPartitionAccessories.push(accessory);
            }
            this.platformZoneAccessoryMap = {};

            //process zone data
            var maxZone = this.zones.length;
            for (var i = 0; i < this.zones.length; i++) {
                var zone = this.zones[i];
                if (zone.sensorType == "motion" || zone.sensorType == "window" || zone.sensorType == "door" || zone.sensorType == "leak" || zone.sensorType == "smoke") {
                    var zoneNum = zone.zoneNumber ? zone.zoneNumber : (i + 1);
                    if (zoneNum > maxZone) {
                        maxZone = zoneNum;
                    }
                    zone.model = config.deviceType + " " + zone.sensorType.charAt(0).toUpperCase() + zone.sensorType.slice(1) + " sensor";
                    var accessory = new EnvisalinkAccessory(this.log, zone.sensorType, zone, zone.partition, zoneNum);
                    var accessoryIndex = this.platformZoneAccessories.push(accessory) - 1;
                    this.platformZoneAccessoryMap['z.' + zoneNum] = accessoryIndex;
                }
                else {
                    this.log.error("Unhandled accessory type: " + zone.sensorType);
                }
            }

            this.log("Zone accessories configured: ", this.zones.length);
            // Begin connection process and bind alarm events to local function.
            this.log("Starting connection to alarm..." + config.host + ", port: " + config.port);
            alarm = new elink(log, config);
            alarm.connect();
            alarm.on('keypadupdate', this.systemUpdate.bind(this));
            alarm.on('zoneevent', this.zoneUpdate.bind(this));
            alarm.on('updatepartition', this.partitionUpdate.bind(this));
        }
    }

    systemUpdate(data) {
        this.log.debug('System status changed to: ', data.mode);
        var partition = this.platformPartitionAccessories[data.partition - 1];

        if ((data.partition) && (partition.processingAlarm == false)) {
            for (var i = 0; i < this.platformPartitionAccessories.length; i++) {
                var partitionAccessory = this.platformPartitionAccessories[i];
                if (partitionAccessory.partition == data.partition) {
                    partitionAccessory.status = data.mode;
                    this.log.debug("Set system status on accessory " + partitionAccessory.name + ' to ' + JSON.stringify(partitionAccessory.status));
                }
            }
        }
    }

    partitionUpdate(data) {
        this.log.debug('Partition status changed to: ', data.mode);
        var partition = this.platformPartitionAccessories[data.partition - 1];

        if (data.partition) {
            for (var i = 0; i < this.platformPartitionAccessories.length; i++) {
                var partitionAccessory = this.platformPartitionAccessories[i];
                if (partitionAccessory.partition == data.partition) {
                    partitionAccessory.status = data.mode;
                    this.log.debug("Set system status on accessory " + partitionAccessory.name + ' to ' + JSON.stringify(partitionAccessory.status));
                }
            }
            // partition update occured, if was due to alarm state change clear state.
            if (partition) {
                if ((partition.processingAlarm)) {
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

                        }
                        else if (accessory.accessoryType == "door" || accessory.accessoryType == "window") {

                            accessory.getContactSensorState(function (nothing, resultat) {
                                accservice.getCharacteristic(Characteristic.ContactSensorState).setValue(resultat);
                            });

                        }
                        else if (accessory.accessoryType == "leak") {

                            accessory.getLeakStatus(function (nothing, resultat) {
                                accservice.getCharacteristic(Characteristic.LeakDetected).setValue(resultat);
                            });

                        }
                        else if (accessory.accessoryType == "smoke") {

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
    constructor(log, accessoryType, config, partition, zone) {
        this.log = log;
        this.name = config.name;

        var id = 'envisalink.' + partition;
        if (zone) {
            id += "." + zone;
        }
        this.uuid_base = uuid.generate(id);
        Accessory.call(this, this.name, this.uuid_base);

        this.accessoryType = accessoryType;
        this.partition = partition;
        this.pin = config.pin;
        this.zone = zone;
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
        }
        else if (this.accessoryType == "motion") {
            var service = new Service.MotionSensor(this.name);
            service
                .getCharacteristic(Characteristic.MotionDetected)
                .on('get', this.getMotionStatus.bind(this));
            this.services.push(service);
        }
        else if (this.accessoryType == "door") {
            var service = new Service.ContactSensor(this.name);
            service
                .getCharacteristic(Characteristic.ContactSensorState)
                .on('get', this.getContactSensorState.bind(this));
            this.services.push(service);
        }
        else if (this.accessoryType == "window") {
            var service = new Service.ContactSensor(this.name);
            service
                .getCharacteristic(Characteristic.ContactSensorState)
                .on('get', this.getContactSensorState.bind(this));
            this.services.push(service);
        }
        else if (this.accessoryType == "leak") {
            var service = new Service.LeakSensor(this.name);
            service
                .getCharacteristic(Characteristic.LeakDetected)
                .on('get', this.getLeakStatus.bind(this));
            this.services.push(service);
        }
        else if (this.accessoryType == "smoke") {
            var service = new Service.SmokeSensor(this.name);
            service
                .getCharacteristic(Characteristic.SmokeDetected)
                .on('get', this.getSmokeStatus.bind(this));
            this.services.push(service);
        }

        var serviceAccessoryInformation = new Service.AccessoryInformation();
        serviceAccessoryInformation.setCharacteristic(Characteristic.Identify, true);
        serviceAccessoryInformation.setCharacteristic(Characteristic.Manufacturer, 'Envisacor Technologies Inc.');
        serviceAccessoryInformation.setCharacteristic(Characteristic.Model, config.model);
        serviceAccessoryInformation.setCharacteristic(Characteristic.Name, 'homebridge-envisalink-ademco');
        serviceAccessoryInformation.setCharacteristic(Characteristic.SerialNumber, 'Envisalink3/4');
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
        callback(null, status);
    }

    getMotionStatus(callback) {

        if (this.status == "OPEN") {
            callback(null, true);
        }
        else {
            callback(null, false);
        }
    }

    getAlarmState(callback) {

        var currentState = this.status;

        if (this.processingAlarm == false) {
            this.log.debug("Getting status.", currentState);
            // Default to disarmed
            var status = Characteristic.SecuritySystemCurrentState.DISARMED;
            if (currentState) {
                if (currentState == "ALARM") {
                    status = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
                }
                else if (currentState.substring(0, 5) == "ARMED") {

                    if ((currentState == "ARMED_STAY") || (currentState == "ARMED_STAY_BYPASS")) {
                        status = Characteristic.SecuritySystemCurrentState.STAY_ARM;
                    }
                    else if ((currentState == "ARMED_NIGHT") || (currentState == "ARMED_NIGHT_BYPASS")) {
                        status = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
                    }
                    else
                        status = Characteristic.SecuritySystemCurrentState.AWAY_ARM;

                }
                else if (currentState == "EXIT_DELAY") {
                    //Use the target alarm state during the exit and entrance delays.
                    if (this.lastTargetState) {
                        status = this.lastTargetState;
                    }
                }
            }
            callback(null, status);
        }
        else {
            callback(null, this.status);
        }
    }

    setAlarmState(state, callback) {
        var currentState = this.status;
        var command = null;

        if (currentState != "NOT_READY") {
            if (this.processingAlarm == false) {
                if (state == Characteristic.SecuritySystemCurrentState.DISARMED) {
                    this.log("Disarming alarm with PIN.");
                    command = this.pin + "1" + this.partition;
                }
                else if (state == Characteristic.SecuritySystemCurrentState.STAY_ARM) {
                    this.log("Arming alarm to Stay (Home).");
                    command = this.pin + "3" + this.partition;
                }
                else if (state == Characteristic.SecuritySystemCurrentState.NIGHT_ARM) {
                    this.log("Arming alarm to Night.");
                    command = this.pin + "33" + this.partition;

                }
                else if (state == Characteristic.SecuritySystemCurrentState.AWAY_ARM) {
                    this.log("Arming alarm to Away.");
                    command = this.pin + "2" + this.partition;
                }
                if (command) {
                    this.processingAlarm = true;
                    this.lastTargetState = state;
                    alarm.sendCommand(command);
                    armingTimeOut = setTimeout(this.proccessAlarmTimer.bind(this), commandTimeOut);
                    callback(null, state);

                }
                else {
                    this.log.error("Unhandled alarm state: " + state);
                    callback(null, state);
                }
            }
            else {
                this.log.warn("Already handling Alarm state change, igorning request.");
                callback(null, this.lastTargetState);
            }
        }
        else {
            this.log.warn("Alarm not ready, igorning request.");
            callback(null, this.lastTargetState);
        }
    }

    proccessAlarmTimer() {
        var accservice = this.getServices()[0];
        if (this.processingAlarm) {
            this.log.error("Alarm request did not return successful in allocated time, setting status to", this.status);
            this.processingAlarm = false;
            this.lastTargetState = null;
            this.getAlarmState(function (nothing, resultat) {
                accservice.getCharacteristic(Characteristic.SecuritySystemCurrentState).updateValue(resultat);
            });
        }
        else {
            accservice.getCharacteristic(Characteristic.SecuritySystemCurrentState).updateValue(this.lastTargetState);
            this.lastTargetState = null;
        }
    }

    getContactSensorState(callback) {

        if (this.status == "OPEN") {
            callback(null, Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
        }
        else {
            callback(null, Characteristic.ContactSensorState.CONTACT_DETECTED);
        }
    }

    getLeakStatus(callback) {

        if (this.status == "OPEN") {
            callback(null, Characteristic.LeakDetected.LEAK_DETECTED);
        }
        else {
            callback(null, Characteristic.LeakDetected.LEAK_NOT_DETECTED);
        }
    }

    getSmokeStatus(callback) {

        if (this.status == "OPEN") {
            callback(null, Characteristic.SmokeDetected.SMOKE_DETECTED);
        }
        else {
            callback(null, Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
        }

    }
}









