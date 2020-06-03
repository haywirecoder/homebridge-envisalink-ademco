var elink = require('./envisalink.js');
var Service, Characteristic, Accessory;
var inherits = require('util').inherits;
var processingAlarm = false;
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
    this.password = config.password;
    this.partitions = config.partitions;
    this.zones = config.zones ? config.zones : [];

    this.log("Configuring Envisalink Ademco platform,  Host: " + config.host + ", port: " + config.port + ", type: " + this.deviceType);

    this.platformPartitionAccessories = [];
    for (var i = 0; i < this.partitions.length; i++) {
        var partition = this.partitions[i];
        partition.pin = config.pin;
        var accessory = new EnvisalinkAccessory(this.log, "partition", partition, i + 1);
        this.platformPartitionAccessories.push(accessory);
    }
    this.platformZoneAccessories = [];
    this.platformZoneAccessoryMap = {};

    
    var maxZone = this.zones.length;
   
   for (var i = 0; i < this.zones.length; i++) {
            var zone = this.zones[i];
            if (zone.sensorType == "motion" || zone.sensorType == "window" || zone.sensorType == "door" || zone.sensorType == "leak" || zone.sensorType == "smoke") {
                var zoneNum = zone.zoneNumber ? zone.zoneNumber : (i + 1);
                if (zoneNum > maxZone) {
                    maxZone = zoneNum;
                }
                var accessory = new EnvisalinkAccessory(this.log, zone.sensorType, zone, zone.partition, zoneNum);
                var accessoryIndex = this.platformZoneAccessories.push(accessory) - 1;
                this.platformZoneAccessoryMap['z.' + zoneNum] = accessoryIndex;
            } else {
                this.log("Unhandled accessory type: " + zone.sensorType);
            }
        }

    this.log("Zone Accessory Configured: ", this.zones.length);
    this.log("Starting connetion to alarm...", config.host);
    
    alarm = new elink(config)
    alarm.connect();
    
    alarm.on('keypadupdate', this.systemUpdate.bind(this));
    alarm.on('zoneevent', this.zoneUpdate.bind(this));
    alarm.on('updatepartition', this.partitionUpdate.bind(this));
}


EnvisalinkPlatform.prototype.systemUpdate = function (data) {
   // this.log('System status changed to: ', data.mode);
    if ((data.partition) && (processingAlarm == false)){
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
    if (data.partition){
        for (var i = 0; i < this.platformPartitionAccessories.length; i++) {
            var partitionAccessory = this.platformPartitionAccessories[i];
            if (partitionAccessory.partition == data.partition) {
                partitionAccessory.status = data.mode;
                //this.log("Set system status on accessory " + partitionAccessory.name + ' to ' + JSON.stringify(partitionAccessory.status));
            }
        }
        // partition update occured, if was due to alarm state change clear state.
        processingAlarm = false;
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
}

EnvisalinkAccessory.prototype.getServices = function () {
  
    return this.services;
}

EnvisalinkAccessory.prototype.getMotionStatus = function (callback) {
    
    if (this.status  == "OPEN") {
        callback(null, true);
    } else {
        callback(null, false);
    }
}

EnvisalinkAccessory.prototype.getReadyState = function (callback) {
    
    var currentState = this.status;
    var status = true;
    if (currentState && currentState.partition === this.partition) {
        if (currentState.status == "READY" ) {
            status = false;
        }
    }
    callback(null, status);
}
EnvisalinkAccessory.prototype.getAlarmState = function (callback) {
  
    var currentState = this.status;
    if (processingAlarm == false){

    //Default to disarmed
        var status = Characteristic.SecuritySystemCurrentState.DISARMED;
        if (currentState) 
        {
        if (currentState == "ALARM") {
            status = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
        } else if (currentState.substring(0,5) == "ARMED") {

            if ((currentState == "ARMED_STAY") || (currentState == "ARMED_STAY_BYPASS")) {
                status = Characteristic.SecuritySystemCurrentState.STAY_ARM;
            }
            else if ((currentState == "ARMED_NIGHT") || (currentState == "ARMED_NIGHT_BYPASS")) {
                status = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
            }
            else status = Characteristic.SecuritySystemCurrentState.AWAY_ARM;

        } else if (currentState == "EXIT_DELAY") {
            //Use the target alarm state during the exit and entrance delays.
            status = this.lastTargetState;
        }
    } 
    callback(null, status);
    } else {
        callback(null, this.lastTargetState);
    }
}

EnvisalinkAccessory.prototype.setAlarmState = function (state, callback) {
  
    var command = null;
    if (processingAlarm == false) { 
        if (state == Characteristic.SecuritySystemCurrentState.DISARMED) {
            this.log("Disarming alarm with PIN.");
            command = this.pin + "01" + this.partition
        } else if (state == Characteristic.SecuritySystemCurrentState.STAY_ARM) {
            this.log("Arming alarm to Stay.");
            command = this.pin + "03" + this.partition 
        }
        else if (state == Characteristic.SecuritySystemCurrentState.NIGHT_ARM) {
            this.log("Arming alarm to Night.");
            command = this.pin + "033" + this.partition

        } else if (state == Characteristic.SecuritySystemCurrentState.AWAY_ARM) {
            this.log("Arming alarm to Away.");
            command = this.pin + "02" + this.partition 
        }
        if (command) {
            processingAlarm = true;
            alarm.sendCommand(command);
            this.lastTargetState = state;
            setTimeout(this.proccessAlarmTimer.bind(this), 10000)
            callback(null, state);

        } else {
            this.log("Unhandled alarm state: " + state);
            callback();
        }
    } else {
        this.log("Warning: Already handling Alarm state change, igorning request.");
        callback();
    }

}

EnvisalinkAccessory.prototype.proccessAlarmTimer = function () {
    if (processingAlarm)
    {
        this.log("Error: Alarm request did not return successful in allocated time.");
    }
    processingAlarm = false;
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



