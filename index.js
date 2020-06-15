const packageJson = require('./package.json');
var elink = require('./envisalink.js');
var Service, Characteristic, Accessory;
var inherits = require('util').inherits;
var armingTimeOut = undefined;
var commandTimeOut;
var alarm;

/* Register the plugin with homebridge */
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

function EnvisalinkPlatform(log, config) {
    this.log = log;
    this.deviceType = config.deviceType;
    this.pin = config.pin;
    this.port = config.port ? config.port : 4025;
    this.password = config.password;
    this.partitions = config.partitions ? config.partitions : [{name: 'House'}];
    this.zones = config.zones ? config.zones : [];
  

    // set global timeout for commands
    commandTimeOut = config.commandTimeOut ? config.commandTimeOut : 10000;

    this.log("Configuring Envisalink Ademco platform.")
    // Process partition data
    this.platformPartitionAccessories = [];
    for (var i = 0; i < this.partitions.length; i++) {
        var partition = this.partitions[i];
        partition.pin = config.pin;
        partition.model = config.deviceType;
        var accessory = new EnvisalinkAccessory(this.log, "partition", partition, i + 1);
        this.platformPartitionAccessories.push(accessory);
    }
    this.platformZoneAccessories = [];
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
            zone.model = config.deviceType + " " + zone.sensorType + " sensor";
            var accessory = new EnvisalinkAccessory(this.log, zone.sensorType, zone, zone.partition, zoneNum);
            var accessoryIndex = this.platformZoneAccessories.push(accessory) - 1;
            this.platformZoneAccessoryMap['z.' + zoneNum] = accessoryIndex;
        } else {
            this.log("Unhandled accessory type: " + zone.sensorType);
        }
    }


    this.log("Zone accessories configured: ", this.zones.length);
    // Begin connection process and bind alarm events to local function.
    this.log("Starting connection to alarm..." + config.host + ", port: " + this.port);

    alarm = new elink(config)
    alarm.connect();

    alarm.on('keypadupdate', this.systemUpdate.bind(this));
    alarm.on('zoneevent', this.zoneUpdate.bind(this));
    alarm.on('updatepartition', this.partitionUpdate.bind(this));
}


EnvisalinkPlatform.prototype.systemUpdate = function (data) {
    // this.log('System status changed to: ', data.mode);
    var partition = this.platformPartitionAccessories[data.partition - 1];

    if ((data.partition) && (partition.processingAlarm == false)) {
        for (var i = 0; i < this.platformPartitionAccessories.length; i++) {
            var partitionAccessory = this.platformPartitionAccessories[i];
            if (partitionAccessory.partition == data.partition) {
                partitionAccessory.status = data.mode;
                //this.log("Set system status on accessory " + partitionAccessory.name + ' to ' + JSON.stringify(partitionAccessory.status));
            }
        }
    }
}

EnvisalinkPlatform.prototype.partitionUpdate = function (data) {
    //this.log('Partition status changed to: ', data.mode);
    var partition = this.platformPartitionAccessories[data.partition - 1];

    if (data.partition) {
        for (var i = 0; i < this.platformPartitionAccessories.length; i++) {
            var partitionAccessory = this.platformPartitionAccessories[i];
            if (partitionAccessory.partition == data.partition) {
                partitionAccessory.status = data.mode;
                //this.log("Set system status on accessory " + partitionAccessory.name + ' to ' + JSON.stringify(partitionAccessory.status));
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

EnvisalinkPlatform.prototype.zoneUpdate = function (data) {

    //this.log('ZoneUpdate status changed to: ', data.mode);
    for (var i = 0; i < data.zone.length; i++) {
        var accessoryIndex = this.platformZoneAccessoryMap['z.' + data.zone[i]];
        if (accessoryIndex !== undefined) {
            var accessory = this.platformZoneAccessories[accessoryIndex];
            if (accessory) {
                accessory.status = data.mode;
                //this.log("Set status on accessory " + accessory.name + ' to ' + JSON.stringify(accessory.status));

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

EnvisalinkPlatform.prototype.accessories = function (callback) {
    callback(this.platformPartitionAccessories.concat(this.platformZoneAccessories));
}

function EnvisalinkAccessory(log, accessoryType, config, partition, zone) {
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
            .addCharacteristic(Characteristic.ObstructionDetected)
            .on('get', this.getReadyState.bind(this));
        this.services.push(service);
    } else if (this.accessoryType == "motion") {
        var service = new Service.MotionSensor(this.name);
        service
            .getCharacteristic(Characteristic.MotionDetected)
            .on('get', this.getMotionStatus.bind(this));
        this.services.push(service);
    } else if (this.accessoryType == "door") {
        var service = new Service.ContactSensor(this.name);
        service
            .getCharacteristic(Characteristic.ContactSensorState)
            .on('get', this.getContactSensorState.bind(this));
        this.services.push(service);
    } else if (this.accessoryType == "window") {
        var service = new Service.ContactSensor(this.name);
        service
            .getCharacteristic(Characteristic.ContactSensorState)
            .on('get', this.getContactSensorState.bind(this));
        this.services.push(service);
    } else if (this.accessoryType == "leak") {
        var service = new Service.LeakSensor(this.name);
        service
            .getCharacteristic(Characteristic.LeakDetected)
            .on('get', this.getLeakStatus.bind(this));
        this.services.push(service);
    } else if (this.accessoryType == "smoke") {
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

EnvisalinkAccessory.prototype.getServices = function () {

    return this.services;
}

EnvisalinkAccessory.prototype.getReadyState = function (callback) {

    var currentState = this.status;
    var status = true;
    if (currentState && currentState.partition === this.partition) {
        if (currentState.status == "READY") {
            status = false;
        }
    }
    callback(null, status);
}

EnvisalinkAccessory.prototype.getMotionStatus = function (callback) {

    if (this.status == "OPEN") {
        callback(null, true);
    } else {
        callback(null, false);
    }
}

EnvisalinkAccessory.prototype.getAlarmState = function (callback) {

    var currentState = this.status;

    if (this.processingAlarm == false) {
        // this.log("Getting status.", this.status );
        // Default to disarmed
        var status = Characteristic.SecuritySystemCurrentState.DISARMED;
        if (currentState) {
            if (currentState == "ALARM") {
                status = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
            } else if (currentState.substring(0, 5) == "ARMED") {

                if ((currentState == "ARMED_STAY") || (currentState == "ARMED_STAY_BYPASS")) {
                    status = Characteristic.SecuritySystemCurrentState.STAY_ARM;
                } else if ((currentState == "ARMED_NIGHT") || (currentState == "ARMED_NIGHT_BYPASS")) {
                    status = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
                } else status = Characteristic.SecuritySystemCurrentState.AWAY_ARM;

            } else if (currentState == "EXIT_DELAY") {
                //Use the target alarm state during the exit and entrance delays.
                if (this.lastTargetState) {
                    status = this.lastTargetState;
                }
            }
        }
        callback(null, status);
    } else {
        callback(null, this.status);
    }
}

EnvisalinkAccessory.prototype.setAlarmState = function (state, callback) {

    var command = null;
    if (this.processingAlarm == false) {
        if (state == Characteristic.SecuritySystemCurrentState.DISARMED) {
            this.log("Disarming alarm with PIN.");
            command = this.pin + "1" + this.partition
        } else if (state == Characteristic.SecuritySystemCurrentState.STAY_ARM) {
            this.log("Arming alarm to Stay.");
            command = this.pin + "3" + this.partition
        } else if (state == Characteristic.SecuritySystemCurrentState.NIGHT_ARM) {
            this.log("Arming alarm to Night.");
            command = this.pin + "33" + this.partition

        } else if (state == Characteristic.SecuritySystemCurrentState.AWAY_ARM) {
            this.log("Arming alarm to Away.");
            command = this.pin + "2" + this.partition
        }
        if (command) {
            this.processingAlarm = true;
            this.lastTargetState = state;
            alarm.sendCommand(command);
            armingTimeOut = setTimeout(this.proccessAlarmTimer.bind(this), commandTimeOut)
            callback(null, state);

        } else {
            this.log("Error: Unhandled alarm state: " + state);
            callback(null, state);
        }
    } else {
        this.log("Warning: Already handling Alarm state change, igorning request.");
        callback(null, this.lastTargetState);
    }

}

EnvisalinkAccessory.prototype.proccessAlarmTimer = function () {
    var accservice = this.getServices()[0];
    if (this.processingAlarm) {
        this.log("Error: Alarm request did not return successful in allocated time setting state to", this.status);
        this.processingAlarm = false;
        this.lastTargetState = null;
        this.getAlarmState(function (nothing, resultat) {
            accservice.getCharacteristic(Characteristic.SecuritySystemCurrentState).updateValue(resultat);
        });
    } else {
        accservice.getCharacteristic(Characteristic.SecuritySystemCurrentState).updateValue(this.lastTargetState);
        this.lastTargetState = null;
    }
}

EnvisalinkAccessory.prototype.getContactSensorState = function (callback) {

    if (this.status == "OPEN") {
        callback(null, Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    } else {
        callback(null, Characteristic.ContactSensorState.CONTACT_DETECTED);
    }
}

EnvisalinkAccessory.prototype.getLeakStatus = function (callback) {

    if (this.status == "OPEN") {
        callback(null, Characteristic.LeakDetected.LEAK_DETECTED);
    } else {
        callback(null, Characteristic.LeakDetected.LEAK_NOT_DETECTED);
    }
}

EnvisalinkAccessory.prototype.getSmokeStatus = function (callback) {

    if (this.status == "OPEN") {
        callback(null, Characteristic.SmokeDetected.SMOKE_DETECTED);
    } else {
        callback(null, Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
    }

}