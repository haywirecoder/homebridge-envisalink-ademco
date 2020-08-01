# Change Log

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/).

## v1.1.5 (2020-08-01)

### Break fixes
* Correct configuration removing leading zero for alarm PIN. 
* Addition to assure alarm PIN is all digit and proper lenght.
  
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
