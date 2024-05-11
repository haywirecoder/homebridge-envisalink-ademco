[![NPM Version](https://img.shields.io/npm/v/homebridge-flobymoen.svg?style=flat-square)](https://www.npmjs.com/package/homebridge-flobymoen)


<p align="center">
<img src="https://github.com/haywirecoder/homebridge-flobymoen/blob/master/images/flo-by-moen-logo.jpg" width="150">
 
<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">


</p>


# Homebridge Plug-In for Flo by Moen 
An Homebridge plug-in to integrate the Flo by Moen 3 water system with HomeKit. This plug-in manages the Flo smart water kit system. It monitors and control devices via the Flo unofficial cloud API. Thanks to the aioflo Python3 library https://github.com/bachya/aioflo development team, this module uses the logic gain from reviewing those libraries/code.

## Limitation:
* This module works with Smart Water Shutoff and Water sensors only. It does not support the recently release Flo Smart Water Faucets.
* This module will poll for the status of the various components based frequency provided in configuration file. No realtime notification is provided.

## Configuration options

| Attributes        | Description                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| username              | Flo Moen username. This is a required value.                    |
| password              | Flo Moen password. This is a required value.                                                                 |
| deviceRefresh        | Polling interval to obtain status of Flo devices, provide in seconds. Default to <i>90</i> seconds, this is an optional value. <b>Please note:</b> Small values may cause account lock or frequent API errors.                                                                    |
| sleepRevertMinutes          | When Smart Water Shutoff Value is put into sleep what amount of time before it reverted back to previous mode (away or home).  Time value is provided in minutes (<i>120, 1440, 4320</i>). Default to <i>120</i> mins (2 hours), this is an optional value.
| showTemperatureAndHumidity| Display Temperature and Humidity for Water Sensors in Homekit.   Default to <i>true</i>, this is an optional value.                                                        |
| showHealthTestSwitch | Display Health Check switch in Homekit. The switch will turn on for 4 mins while Flo runs the health check.  Default to <i>false</i>, this is an optional value.        
| disableCache         | Disable the storage of Flo access token. This will cause plug-in to obtain a new access token upon startup. This could result in a minor performance hit at startup. Default to <i>false</i>, this is an optional value. |                                           
| enableValveControl         | Enable Homekit to control the Smart Water Shutoff valve. By design the valve will display in Homekit (e.g. Home). The status of the valve will be displayed and monitored, however it will not be controllable (e.g. Open or Close) unless this value is set to true. Default to <i>false</i>, this is an optional value.   |
| treatWarningAsCritical         | By default Flo warnings are treated as alarm faults. Set this value to <i>true</i> to escalated Flo warnings to critical resulting in a Homekit alarm trigger event. |
| offlineTimeLimit         | Battery device periodically send data to the Flo servers. This value determine how long before plug-in indicates the device is offline and a general fault is generated. Defaults to <i>4</i> hours.|
| pingRefresh         | Set value to force a refresh of Flo Cloud service. Should be used if device updates are not occurring for an extended period of time.  |
| excludedDevices         | Using the device serial number to suppress from HomeKit. This is an optional value. | |




Example configuration is below.

```javascript
...

"platforms": [
{
    "name": "Flo-by-Moen",
    "auth" : {
      "username": <username>,
      "password": <password>
    },
    "deviceRefresh": 90,
    "sleepRevertMinutes": 120,
    "platform": "Flo-by-Moen"
}
...
