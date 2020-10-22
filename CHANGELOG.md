# Change Log

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/).
# v1.1.9 (2020-10-15)

### Break fixes
* Correct issue which auto-restart option was ignored.

### Changes
* Add new configuration option to disable Envisalink module session watcher.
* Improve functionality and reponse speed of Bypass switch.

# v1.1.8 (2020-09-20)

### Changes
* Important: Timeout values (openZoneTimeout, heartbeatInterval, commandTimeOut) are now set to seconds rather than milliseconds. This will NOT be automaticly updated in the configuation file. If value is in milliseconds module will use default values.
* Expose heatbeat session check values in configation file and UX. 
  
### Break fixes
* Configuration file zone attribute for bypass was not correctly expose in UX. 
  
  
## v1.1.7 (2020-08-12)

### Changes
* Added support to detect silent drop connections to Envisakit module and re-connect if autoconnect is enabled.

### Break fixes
* Correct TypeError which cause module to terminate and shutdown homebridge.

## v1.1.6 (2020-08-01)

### Break fixes
* Correct configuration removing leading zero for alarm PIN. 
* Addition to assure alarm PIN is all digit and proper lenght.

### Changes
* Package engine requirement updated to Nodejs version 12+
  
## v1.1.4 (2020-07-27)

### Break fixes
* Configuration file fix for bypass feature 

## v1.1.3 (2020-07-26)

### Enhancements
* Added support for Bypassing fault zones
* Added support for keypanel special function keys (e.g. Fire, Medical, Panic...etc)
* Enhancements to update method for alarm status, allowing for more realtime updates to status
* Ehhancements to UX configuration

### Changes
* Serial numbering schema  (* Note: This may require updating previous automation and room aassigment in Homekit)
  
### Break fixes
* Error handling when connection was not present, cause module to terminate. 
  
## v1.0.15 (2020-07-02)

### Changes
* Re-factor of source code for easies of troubleshooting and future enhancements
  
### Break fixes
* Fix polling logic for sensors
  

## v1.0.12 (2020-06-07)

### Changes
* Added new configuration options for command timeout and sensor polling frequency


## v1.0.8 (2020-06-05)

### Changes
* Added easy config for Config UI X.
* Change attribute for zones "type" attribute has been changed to "sensorType" this is to enabled the UX configuration manager.


## v1.0.0 (2020-06-03)
### Release
