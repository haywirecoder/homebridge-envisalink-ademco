# Change Log
All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/).
# v2.0.12 (2024-02-01) 
## Enhancements
* Minor updates to readme and references

## Break fixes
* Partition issue cause restart when alarm times out was reached in arming/disarmed process

# v2.0.11 (2023-12-03) 
## Enhancements
* More automation friendly. Warning message for duplicated activities (e.g Arming when system is already Armed...etc) issue #45. Are now gone, plug-in ignored request that would result in same alarm state.
* Dependency updates.

# v2.0.10 (2023-07-20)
## Break fixes
* Turn off debug logging for chime button.

# v2.0.9 (2023-07-18)
## Break fixes
* Fix 'Security System Target State: characteristic undefined' error during an alarm state.
* Correct various typo and undefine value.
* Fix various issue with Chime button state (issue #43)

## Enhancements
* Add support for dynamic monitor of a zone Type 12 - Monitor Zone. Zone will show as open and generate a homekit fault for the zone.

# v2.0.8 (2023-06-04)
## Break fixes
* Fix the issue when some zones were bypassed non-bypass zone were showing as close.

## Enhancements
* Enhance warning message when the alarm system failed to complete the requested activity.

# v2.0.7 (2023-05-16)
## Break fixes
* Fix the problem with zone 0-9 random closures  (issue #39).

# v2.0.6 (2023-05-02)
## Break fixes
* Fix the problem associated with the bypass switch not defaulting to false if missing.

# v2.0.5 (2023-04-30)
## Enhancements
* Add functionality to allow bypassing a specific zone that is fault and/or normal. (issue #38)

# v2.0.4 (2023-01-29)
## Enhancements
* Add additional method to obtain low battery and AC status using the virtual keypad. (issue #34)

## Break fixes
* Correct characteristic 'Security System Current State' error. (issue #36)

# v2.0.3 (2022-10-22)
## Break fixes
* Fix logic flow which resulted in error message when Bypass switch is disabled. (issue #31)
* Fix issue which cause the plug-in to restart due to an undefined variable.

# v2.0.2 (2022-10-01)
## Changes
* Documentation updates.
* Enabling Session Watcher will always enable automatic reconnection this reduces possible confusion.

## Enhancements
* Control logic enhancement to assure arming/disarm always return to Homekit in a timely manner.

# v2.0.1 (2022-09-10)
## Changes
* Spelling, grammar and white spacing fixes. Thanks @reedloden.
* Minor enhancement to config UX.

# v2.0.0 (2022-08-21)
## Enhancements
* Complete re-write/re-factoring to modern dynamic platform, remove deprecated code, updated depended libraries and optimization of code. Improved response time all around and lay the foundation for future release.

 <b>WARNING:</b> When upgrading from any prior version of the plugin to version 2.0.0+, you need to re-assign accessories to rooms and rebuild/correct existing automation which included these accessories. This is a one-time event and is not a bug. This is the result of upgrading to the Homebridge modern dynamic platform, which generated new unique internal ID. 

* Panel "Not Ready" or "Alarm In Memory" result in a general faults. <i>Please note:</i> Apple Home application doesn't show visual indicators for faults, it does appears in the setting security system tile. 3rd party applications such as Eve Home do show visual an indicator.
* Envisalink TPI connection changed from General Fault to Tamper events in Homekit. This is now inline with other alarm errors from the panel. A configuration value in UX can now be used to suppress the event.

## Break fixes
* Corrected issue with Bypass functionality not working with multiple zone bypass

# v1.2.2 (2022-04-05)
## Enhancements
* Envisalink TPI connection issues now surface in Homekit as a general faults. <i>Please note:</i> Apple Home application doesn't show visual indicators for faults, it does appears in the setting security system tile. 3rd party applications such as Eve Home do show visual indicator.

## Break fixes
* Corrected Typo in config.scheme.json and coding issue which prevented auto re-connect from functioning property (#23). If your issue where auto connect is not enabling, please set attribute via the configure tool (autoReconnect=true).

# v1.2.1 (2022-02-10)
## Enhancements
* Add Device Model Vista 21ip (#21) to config.scheme.json.

# v1.2.0 (2022-02-04)
## Enhancements
* Add support for low battery status for both panel and sensors
* Add support for custom macro keys. This allow creation of switches that execute custom keypad commands.
* Add system tamper notification support via Homekit.
* Add Support for partition numbering, custom partition PIN/CODE and changing partitions for operations. This allow partitions to be skip (issue #17) and targeted activities for partition. <i>BETA: Multiple partition plug-in feedback/validation needed. </i>
* Configuration UI update to support partition numbering, partition PIN and selection of panel/device type. <b>Please note: </b> selecting proper panel type is important for 128 panel users.

## Changes
* <b>IMPORTANT:</b> "Keys" section has been replace with "speedKeys" to allow for custom macro keys. The original "Keys" configuration must be re-configure in configure file/UX. In addition to save space speedkey are group together by default. 
* <b>IMPORTANT:</b> Option to create a Bypass switch has been updated. It will need to be re-enabled in configure file/UX. 
* Streamline configuration UX.

## Break fixes
* Fix issues which was suppressing partition controls messages in core Envisakit engine (issue #17).
* Bypass zones must be fix formatted to either 2 digit or 3 digit for larger panels.
* Fix issue with function key display error upon execution. Correction include as part of speedkey configuration.

# v1.1.26 (2021-10-05)
## Enhancements
* Add Support for Chime On/Off switch in HomeKit (issue #16).
* Add option to place plug-in in maintenance mode. This disabled communication with Envisakit module, allowing for maintenance of the module without losing configuration and/or filling up the Homebridge logs with errors/warnings.

## Changes
* Correct "Characteristic not in required or optional characteristic section for service Switch" warning (issue #14).
* Envisalink data stream format error have been changed from an "Error" to a "Warning".
* Phase 1 code cleanup and optimization.

# v1.1.24 (2020-02-25)
## Changes
* Documentation and tag mis-match. CO2 configuration tag replace with CO to align with standard. Manual correction will be needed in the configuration file for those using Carbon Monoxide Detector type from v1.1.23 (e.g. Replace C02 with CO).

# v1.1.23 (2021-02-05)
## Enhancements
* Add Support for Carbon Monoxide Detector (#11).
* Add Support for Glass break Detector as a motion sensor.

# v1.1.22 (2020-12-17)
## Break fixes
* Fix issues introduce with 1.1.21. Correction to management of zone status.

# v1.1.21 (2020-12-11)
## Break fixes
* Correct issue with false open from virtual panel event.

# v1.1.20 (2020-10-31)
### Break fixes
* Correct issue which could result incorrect entry within config.json file.
  
### Changes
* Minor error handling routine changes. Change will ignored mis-configured section of configuration files.

# v1.1.19 (2020-10-15)
### Break fixes
* Correct issue which auto-restart option was ignored.

### Changes
* Add new configuration option to disable Envisalink module session watcher.
* Improve functionality and response speed of Bypass switch.

# v1.1.8 (2020-09-20)
### Changes
* Important: Timeout values (openZoneTimeout, heartbeatInterval, commandTimeOut) are now set to seconds rather than milliseconds. This will NOT be automatically updated in the configuration file. If value is in milliseconds module will use default values.
* Expose heartbeat session check values in configuration file and UX. 
  
### Break fixes
* Configuration file zone attribute for bypass was not correctly expose in UX. 
  
# v1.1.7 (2020-08-12)
### Changes
* Added support to detect silent drop connections to Envisakit module and re-connect if autoconnect is enabled.

### Break fixes
* Correct TypeError which cause module to terminate and shutdown homebridge.

# v1.1.6 (2020-08-01)
### Break fixes
* Correct configuration removing leading zero for alarm PIN. 
* Addition to assure alarm PIN is all digit and proper length.

### Changes
* Package engine requirement updated to Nodejs version 12+
  
# v1.1.4 (2020-07-27)
### Break fixes
* Configuration file fix for bypass feature 

# v1.1.3 (2020-07-26)
### Enhancements
* Added support for Bypassing fault zones
* Added support for keypanel special function keys (e.g. Fire, Medical, Panic...etc)
* Enhancements to update method for alarm status, allowing for more realtime updates to status
* Enhancements to UX configuration

### Changes
* Serial numbering schema  (* Note: This may require updating previous automation and room assignment in Homekit)
  
### Break fixes
* Error handling when connection was not present, cause module to terminate. 
  
# v1.0.15 (2020-07-02)
### Changes
* Re-factor of source code for easies of troubleshooting and future enhancements
  
### Break fixes
* Fix polling logic for sensors
  

# v1.0.12 (2020-06-07)
### Changes
* Added new configuration options for command timeout and sensor polling frequency


# v1.0.8 (2020-06-05)
### Changes
* Added easy config for Config UI X.
* Change attribute for zones "type" attribute has been changed to "sensorType" this is to enabled the UX configuration manager.


# v1.0.0 (2020-06-03)
### Release
