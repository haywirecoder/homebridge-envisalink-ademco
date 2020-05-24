var net = require("net");
var elink = require('./envisalink.js');
var dateFormat = require('dateformat');
var Service, Characteristic, Accessory;
var inherits = require('util').inherits;
var enableSet = true;

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
    homebridge.registerPlatform("homebridge-envisalink", "Envisalink", EnvisalinkPlatform);
}

function EnvisalinkPlatform(log, config) {
    this.log = log;
    this.deviceType = config.deviceType;
    this.pin = config.pin;
    this.password = config.password;
    this.partitions = config.partitions;
    this.zones = config.zones ? config.zones : [];

    this.log("Configuring Envisalink platform,  Host: " + config.host + ", port: " + config.port + ", type: " + this.deviceType);

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
            if (zone.type == "motion" || zone.type == "window" || zone.type == "door" || zone.type == "leak" || zone.type == "smoke") {
                var zoneNum = zone.zoneNumber ? zone.zoneNumber : (i + 1);
                if (zoneNum > maxZone) {
                    maxZone = zoneNum;
                }
                var accessory = new EnvisalinkAccessory(this.log, zone.type, zone, zone.partition, zoneNum);
                var accessoryIndex = this.platformZoneAccessories.push(accessory) - 1;
                this.platformZoneAccessoryMap['z.' + zoneNum] = accessoryIndex;
            } else {
                this.log("Unhandled accessory type: " + zone.type);
            }
        }

    this.log("Zone Accessory Configured: ", this.zones.length);
    this.log("Starting connetion to alarm...", config.host);
    
    this.alarm = new elink(config)
    this.alarm.connect();
    
   this.alarm.on('keypadupdate', this.systemUpdate.bind(this));
   this.alarm.on('zoneupdate', this.zoneUpdate.bind(this));
   this.alarm.on('updatepartition',this.partitionUpdate.bind(this));
   this.alarm.on('zoneTimerDump',this.zoneTimerUpdate.bind(this));

}


EnvisalinkPlatform.prototype.systemUpdate = function (data) {
    this.log('System status changed to: ', data.alarmstatus);
}

EnvisalinkPlatform.prototype.zoneUpdate = function (data) {
    this.log('ZoneUpdate status changed to: ', data.status);
}

EnvisalinkPlatform.prototype.partitionUpdate = function (data) {
    this.log('partitionupdate status changed to: ', data.status);
}
EnvisalinkPlatform.prototype.zoneTimerUpdate = function (data) {
    this.log('Timer update: ', data.zonedump);
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
    
    if (this.status && this.status.send == "open") {
        callback(null, true);
    } else {
        callback(null, false);
    }
}

EnvisalinkAccessory.prototype.getReadyState = function (callback) {
    
    var currentState = this.status;
    var status = true;
    if (currentState && currentState.partition === this.partition) {
        if (currentState.send == "ready" || currentState.send == "readyforce") {
            status = false;
        }
    }
    callback(null, status);
}
EnvisalinkAccessory.prototype.getAlarmState = function (callback) {
  
    var currentState = this.status;
    var status = Characteristic.SecuritySystemCurrentState.DISARMED;

    callback(null, status);
}

EnvisalinkAccessory.prototype.setAlarmState = function (state, callback) {
    
  
}

EnvisalinkAccessory.prototype.getContactSensorState = function (callback) {
   
    if (this.status && this.status.send == "open") {
        callback(null, Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    } else {
        callback(null, Characteristic.ContactSensorState.CONTACT_DETECTED);
    }
}

EnvisalinkAccessory.prototype.getLeakStatus = function (callback) {

    if (this.status && this.status.send == "open") {
        callback(null, Characteristic.LeakDetected.LEAK_DETECTED);
    } else {
        callback(null, Characteristic.LeakDetected.LEAK_NOT_DETECTED);
    }
}

EnvisalinkAccessory.prototype.getSmokeStatus = function (callback) {
    
    if (this.status && this.status.send == "open") {
        callback(null, Characteristic.SmokeDetected.SMOKE_DETECTED);
    } else {
        callback(null, Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
    }
    
}

EnvisalinkAccessory.prototype.processAlarmState = function (nextEvent, callback) {
    
}


