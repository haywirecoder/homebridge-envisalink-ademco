# Homebridge-Envisalink-Ademco
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![NPM Version](https://img.shields.io/npm/v/homebridge-envisalink-ademco.svg)](https://www.npmjs.com/package/homebridge-envisalink-ademco)
[![npm](https://img.shields.io/npm/dt/homebridge-envisalink-ademco.svg?style=flat-square)](https://www.npmjs.com/package/homebridge-envisalink-ademco)

<p align="center">
     <img src="https://github.com/homebridge/branding/blob/latest/logos/homebridge-color-round-stylized.png" width="150">
     <img src="https://github.com/haywirecoder/homebridge-envisalink-ademco/blob/master/img/link.png?raw=true" width="50">
     <img src="https://github.com/haywirecoder/homebridge-envisalink-ademco/blob/master/img/EyezOn_logo_signature_size.png?raw=true" width="150">

 </p>


----------------------------------

This module is designed to work with the Ademco Envisalink module and Vista series alarm panels. It supports alarm operations (e.g., arm, disarm, night, and stay), zone bypassing, and special function keys (e.g., fire, panic, medical), and exposes alarm system sensors to Homebridge. <b>Note:</b> This module uses the Envisalink Third Party Interface (TPI). Ensure TPI is enabled (i.e., Alert is checked) for your module.

Limitations:

* Ademco panels provide limited zone information to their peripherals. The panel only provides real-time information when a zone is faulted (open) but not when it is restored (closed). However, the virtual keypad is continuously updated with zone information. This module automatically sets faulted zones (open) to restored (closed) based on the value set by the *openZoneTimeout* attribute. The default configuration results in the zone closing 30 seconds after the virtual keypad no longer reports a fault for that specific zone.

* When the system is armed, the panel no longer reports the state of each zone. All zones will age out and be considered restored once armed. Note: A bypassed zone will automatically show as faulted (open) once the alarm is disarmed.

* The Envisalink TPI interface only supports one connection. Once this plug-in is connected, any other connection attempts will result in an error. Conversely, if Envisalink is being used for another purpose, this module will not be able to connect. The proxy server function provided by this plug-in may provide an alternative method for sharing this connection. Please see notes below.

* Confirm you have a stable network connection to the Envisalink module before installing this plug-in. While the auto-reconnect logic option is available, it is designed for occasional network issues.

* This plug-in uses two indicators for <i>NIGHT STAY</i>. "Arm-Instant (Zero Delay-Stay)" is similar to STAY mode but without the entry delay feature and is usually associated with <i>NIGHT STAY</i>. The plug-in also uses virtual keypad text as an indicator of night mode.

* To receive updates for RF low battery, AC failure, low panel battery, and bypass status, reporting must be enabled for the Envisalink module. Refer to https://www.eyezon.com/EZMAIN/evl4honeywell.php, section "Panel Programming Options." 

**Please Note:** It is recommended not to use the master user or installer code in the configuration file. Create a separate alarm user with the proper access permissions (please refer to your panel guide).
  

## Configuration Options

| Attributes        | Description                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| host              | Envisalink server host IP address. *Note:* The plug-in and Homebridge will shut down if not configured.                      |
| port              | Envisalink server port address. The default is 4025.                                                                         |
| deviceType        | Device model. The default is "Honeywell Vista."                                                                              |
| password          | Envisalink server password. The default is "user."                                                                           |
| pin               | Your local alarm PIN. It is recommended to create a separate alarm user for this plug-in. The default PIN is 1234.                     |
| **partitions**    | List of partitions to monitor in HomeKit.                                                                                 |
| openZoneTimeout   | *(optional)* Timeout value for zones, provided in seconds. The default is 30 seconds.                                           |
| sessionsWatcher   | *(optional)* Automatically disconnect and create a new session if the module detects a hung session. This is done by periodically (i.e., heartbeatInterval) checking the last updates from the virtual keypad. Setting this value to true will cause the "autoReconnect" setting to be ignored in the configuration file and will always set "autoReconnect" to true. The default is true. |
| heartbeatInterval | *(optional)* Heartbeat interval to determine if the Envisalink session is hung. <b>Please note:</b> Setting this value below 30 seconds may cause incorrect identification of a hung state. The default is 30 seconds.                      |
| commandTimeOut    | *(optional)* Timeout value for alarm commands to return, provided in seconds. The default is 10 seconds.                        |
| autoReconnect     | *(optional)* Automatically reconnect to the server if the network channel is broken. This value is automatically set to true if sessionWatcher is enabled. The default is true.                                |
| chimeToggle       | *(optional)* Create a switch to enable and disable the chime bell. The panel only allows a change in bell status when the alarm is not armed. The default is false.                         |
| batteryRunTime    | *(optional)* User-supplied runtime of the main system backup battery in hours. This value allows the plug-in to estimate the remaining time when the system switches to backup battery power. |  
| ignoreFireTrouble   | *(optional)* When the virtual keypad sends a fire trouble signal, treat it as a warning and allow the system to arm the alarm. The default is false. |
| ignoreSystemTrouble   | *(optional)* When the virtual keypad sends a system trouble signal, treat it as a warning and allow the system to arm the alarm. The default is false. |
| proxyEnabled   | *(optional)* Create a proxy server that allows two additional Envisalink TPI clients to share the existing Envisalink TPI connection. These clients can connect to the TPI default port <i>4026</i> and HTTP (web console) default port <i>4080</i> of the Homebridge server running this plug-in. The default setting is false. <p><p>**Note:** Because the connection to the Envisalink server is being shared, a secondary TPI client may cause this plug-in to malfunction.<p>**Support Notice:** Support is limited to the proxy server itself. Issues related to third-party clients are not covered and will not be addressed.|
| maintenanceMode   | *(optional)* Disable communication with the Envisalink module. The default is false. <p>**Note:** This will disable all updates.                      |
| **zones**         | *(optional)* List of zones to display and monitor in HomeKit.                                                              |
| **bypass**        | *(optional)* Creates a bypass control (a switch) to bypass zones that are open (faulted).                                |
|                   | If "quickbypass" is not enabled, the bypass switch can only bypass zones that are being monitored in HomeKit and have the zone entry "bypassenable" attribute set to true.    |
|                   | "quickbypass" can be used to bypass all faulted zones. This feature must be enabled in the Ademco panel *(refer to panel guide)*.                               |
| **speedkeys**     | *(optional)* Create controls (switches) to replicate the special function keys on the Ademco keypad.                          |

**partitions**

> - name: Partition name - *If not present, defaults to "house."*
> - partitionNumber: Partition number - *If not present, a consecutive number is used, which is not ideal. Not needed in a single partition configuration.*
> - partitionPIN: Partition PIN/code - *If not present, the master configured PIN is used. Not needed in a single partition configuration.*

**zones** *(Optional section -- At least one zone must be defined if used)*

> - name: Zone name - *This is a required value for each entry.*
> - sensorType: co | door | glass | leak | motion | smoke | window - *This is a required value for each entry.*
> - partition: Sensor partition number - *This is a required value for each entry.*
> - zoneNumber: Panel zone number for the sensor. The presence of this attribute triggers consecutive or non-consecutive zone numbering (see example). *This attribute is required if your system has unused zones, uses non-consecutive zone numbering, or if you want to selectively display zones within HomeKit.*
> - bypassEnabled: true | false - A true value allows zones to be bypassed. This setting works in conjunction with the bypass control option (below). *This is an optional element and defaults to false. The alarm system will not allow fire or emergency zones to be bypassed.*

**bypass** *(Optional section)*

> - enabledbyPass: true | false - A true value creates a global bypass switch in HomeKit to bypass faulted zones with bypassEnabled set to true. A false value (default) allows for the creation of a zone-specific switch associated with each zone with bypassEnabled. The direct zone bypass switch can bypass zones that are faulted and/or normal. Unbypassing one zone will unbypass all zones; this is a limitation of the alarm panel. *Note: Once your system is disarmed, bypassed zones will need to be bypassed again to arm your system again.* 
> - quickbypass: true | false - Must be pre-configured on the alarm panel (please refer to your alarm panel programming guide). If programmed, "Quick Bypass" allows you to easily bypass all open (faulted) zones without having to configure zones individually and performs operations quickly. *This is a required value for this section.*

**speedkeys** *(Optional section)*
> - name: Name of the special function key to display in HomeKit - *This is a required value for this section, and each name must be unique.*
> - speedcommand: A | B | C | D | Custom - Indicates which special function key (e.g., A, B, C, and D keys) will be associated with this switch. The special keys are located to the left of the numeric keys and can be programmed with special functions at the alarm panel. "Custom" allows the use of a command field to input a custom automated input sequence that imitates keypad inputs. *This is a required value for this section.* 
> - command: Input a custom automated input sequence that imitates keypad inputs. The special '@pin' notation will be replaced with the configured master PIN/code. *This is required if "custom" is selected as speedcommand.*

An example configuration is below:

```javascript
...

"platforms": [

{

    "platform": "Envisalink-Ademco",
    "host": "192.168.YYY.XXX",
    "deviceType": "20P",
    "password": "---envisalink password (default is user)---",
    "pin": "---panel pin for arming/disarming---",
    "partitions": [
    {
        "name": "House"
    }

    ],
    "zones": [
        {
        "name": "Front Door",
        "sensorType": "door",   
        "partition": 1
        },
        {
        "name": "Master Bedroom Window",
        "sensorType": "window",
        "partition": 1,
        "bypassEnabled": true
        }
    ],
    "bypass": [
        {
        "enabledbyPass": true,
        "quickbypass": false
        }
    ],
    "speedkeys" : [
        {
        "name": "Panic",
        "speedcommand": "A"
        },
        {
        "name": "Special key",
        "speedcommand": "custom",
        "command": "@pin03"
        }
    ]
}
...

```

## Non-Consecutive Zones

If your system has unused zones, simply include a *zoneNumber* integer property on ***each*** zone you have in the config. Make sure you add the property to each zone. This is the recommended configuration if you don't wish to monitor (display) all zones within HomeKit or don't know the ordering of your system zones.

Example:

```javascript

...

"zones": [
    {
    "name": "Front Entry",
    "sensorType": "door",
    "partition": 1,
    "zoneNumber": 9,
    "bypassEnabled": true
    },
    {
    "name": "Patio Door",
    "sensorType": "door",
    "partition": 1,
    "zoneNumber": 12,
    "bypassEnabled": true
    },
    {
    "name": "Bedroom Window",
    "sensorType": "window",
    "partition": 1,
    "zoneNumber": 16,
    "bypassEnabled": false
    },
    {
    "name": "Garage Door",
    "sensorType": "door",
    "partition": 1,
    "zoneNumber": 5
    }
]

...
