
// Raw debugging script for envisalink engine.

var config = require('./config.json');
var nap = require('./envisaLink.js');
var alarm = new nap(console,config);
alarm.connect()

alarm.on('keypadupdate', function(data) {

	console.log("Virtual Keypad event")
	console.log("partition: ", data.partition)
	console.log("icon: ", data.code.icon)
	console.log("zone: ", data.code.zone)
	console.log("beep: ", data.code.beep)
	console.log("txt: ", data.code.txt)
	console.log("status: ", data.status)
	console.log("keypadledstatus: ", data.keypadledstatus)
	console.log("...")

}) 

alarm.on('zoneevent', function(data) {
  
	console.log("zoneevent event")
	console.log("zone: ", data.zone)
	console.log("mode: ", data.mode)
	console.log("source: ", data.source)
	console.log("...")

})

alarm.on('zoneTimerDump', function(data) {
  
	console.log("zoneTimerDump event")
	console.log("zone: ", data.zonedump)
	console.log("...")
})

alarm.on('zoneupdate', function(data) {
  
	console.log("zoneupdate event")
	console.log("zone: ", data.zone)
	console.log("status: ", data.status)
	console.log("code: ", data.code)
	console.log("...")

})
alarm.on('cidupdate', function(data) {
    
	console.log("cidupdate event")
	console.log("code: ", data.code)
	console.log("partition: ", data.partition)
	console.log("type: ", data.type)
	console.log("subject: ", data.subject)
	console.log("description: ", data.description)
	console.log("status: ", data.status)
	console.log("...")

})

alarm.on('updatepartition', function(data) {
    
	console.log("partitionupdate event")
	console.log("partition: ", data.partition)
	console.log("mode: ", data.mode)
	console.log("code: ", data.code)
	console.log("status: ", data.status)
	console.log("...")
})
