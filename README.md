# Homebridge-Envisalink-Ademco
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![NPM Version](https://img.shields.io/npm/v/homebridge-envisalink-ademco.svg)](https://www.npmjs.com/package/homebridge-envisalink-ademco)
[![npm](https://img.shields.io/npm/dt/homebridge-envisalink-ademco.svg?style=flat-square)](https://www.npmjs.com/package/homebridge-envisalink-ademco)

<p align="center">
     <img src="https://github.com/homebridge/branding/blob/latest/logos/homebridge-color-round-stylized.png" width="150">
     <img src="https://github.com/haywirecoder/homebridge-envisalink-ademco/blob/master/img/EyezOn_logo_signature_size.png?raw=true" width="150">

 </p>

<b>*** WARNING **** </b> 

When upgrading from any prior version of the plugin to version 2.0.0+, you need to re-assign accessories to the rooms and rebuild/correct the existing automation that included these accessories. This is a one-time event and is not a bug. This is the result of upgrading to the Homebridge modern dynamic platform, which generated new unique internal IDs. 

----------------------------------

This module was designed to work with Ademco Envisalink module with the Vista series alarm panels. It supports alarm operations (e.g. Arm, disarm, night, and stay), bypassing of zones, and special function keys (e.g. Fire, Panic, Medical) and exposes the alarm system sensors to homebridge. <b>Note:</b> This module uses the Envisalink Third Party Interface (TPI). Make sure TPI is enabled (i.e. Alert is checked) for your module.

Limits:

* Ademco panels provide limited zone information to their peripherals. The panel only provides real-time information when a zone is faulted (opened) but not when it is restored (closed). However, the virtual key panel is continuously updated with zone information. This module auto-sets the faulted zone (opened) to restored (closed) based on the value set by the *openZoneTimeout* attributes. Default configuration would result in the zone closing 30 seconds after the virtual key panel no longer reports a fault for the specific zone.

* When the system is "Armed" the panel no longer reports the state of each zone. All zones will age out and be considered closed once armed. Note: A bypass zone will automatically show as fault (open) once the alarm is disarmed.

* Envisalink TPI interface only supports one connection. Once this plug-in is connected, any other connections will result in an error. Vice-versa, if Envisalink is being used for another purpose this module will not be able to connect. Confirm you have a stable network connection to the Envisalink module before installing this plug-in. While the auto-reconnect logic option is available, it is designed for occasional network issues.

* This plug-in uses "Arm-Instant (Zero Delay-Stay)" as an indicator of <i>NIGHT STAY</i>. Arms-Instant is similar to the STAY mode, but without the entry delay feature and is usually associated with <i>NIGHT STAY</i>.

* To receive updates for RF Low battery, AC failure, Low Panel Battery and Bypass reporting must be enabled for the Envisakit module. Refer to https://www.eyezon.com/EZMAIN/evl4honeywell.php section "Panel Programming Options". 

Please Note: I recommended not using the master user or installer code in the configure file. Create a separate alarm user with the proper access permissions (please refer to your panel guide).
  

## Configuration options

| Attributes        | Description                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| host              | Envisalink server host IP Address.  *Note:* Plug-in and homebridge will shut down if not configured.                      |
| port              | Envisalink server Port address. The default is 4025.                                                                         |
| deviceType        | Device Model. The default is "Honeywell Vista".                                                                              |
| password          | Envisalink server password. The default is "user".                                                                           |
| pin               | Your local alarm PIN. Recommend creating a separate alarm user for this plug-in. The default pin is 1234                     |
| **partitions**    | List of partitions to monitor in Homekit.                                                                                 |
| openZoneTimeout   | *(optional)* Time out value for zone provided in second. The default is 30 seconds.                                           |
| sessionsWatcher   | *(optional)* Automatic disconnect and recreate a new session if the module detects a hang session. This is done by periodically (i.e. heartbeatInterval) checking the last updates from the virtual keypad. Setting this value to true will result in the "autoReconnect" setting being ignored in the configuration file and setting "autoReconnect" always to true. The default is true. |
| heartbeatInterval | *(optional)* Heartbeat interval to determine if the envisalink session is hung. <b>Please note:</b> Setting this value below 30 seconds may cause incorrect identification of a hang state. The default is 30 seconds.                      |
| commandTimeOut    | *(optional)* Time-out value for alarm command to return provided in second. The default is 10 seconds.                        |
| autoReconnect     | *(optional)* Automatic reconnect to server if network channel is broken. This value is automatically set to true if sessionWatcher is enabled. The default is true.                                |
| chimeToggle       | *(optional)* Create a switch to enable and disable the Chime bell. The panel only allows a change in bell status when the alarm is not armed. The default is false.                         |
| batteryRunTime    | *(optional)* User-supplied run time of main system battery backup in hours. This value allows the plug-in to estimate the remaining time when the system switches to a backup battery. |  
| maintenanceMode   | *(optional)* Disable communication with envisakit module. **Note:** This will disable all updates.                      |
| **zones**         | *(optional)* List of zones to appear and monitor in Homekit                                                              |
| **bypass**        | *(optional)* Creates a bypass control (a switch) to bypass zones that are open (faulted)                                |
|                   | By design the bypass switch can only bypass the zone that is being monitored in Homekit and the zone entry "bypassenable" set to true.    |
|                   | "quickbypass" Can be used to bypass all fault zones. This feature must be enabled in Ademco panel *(refer to panel guide)*.                               |
| **speedkeys**     | *(optional)* Create controls (switches) to replicate the special function keys on the Ademco keypad                          |

**partitions**

> - name : partition name - *if not present default value to "house"*
> - partitionNumber: partition number - *if not present consecutive number is used, which is not ideal. Not needed in a single partition configuration.*
> - partitionPIN: partition PIN/Code - *if not present master configure PIN is used. Not needed in a single partition configuration.*

**zones** *(Optional section -- At least one zone must be defined if used)*

> - name: zone name  - *This is a required value for each entry*
> - sensorType : co | door | glass | leak | motion | smoke | window - *This is a required value for each entry*
> - partition : sensor partition number. - *This is a required value for each entry*
> - zoneNumber : panel zone number for the sensor. - The presence of this attribute triggers consecutive zone numbering or non-consecutive zone numbering (see example). *This attribute is required if your system has unused zones, using non-consecutive zone numbering, or wants to selectively show zones within homekit*
> - bypassEnabled :  true | false - A true value allows zones to be bypassed. This setting works in concert with the bypass control option (below). *This is an optional element and defaults to false. The alarm system will not allow fire or emergency zones to be bypassed.*

**bypass** *(Optional section)*

> - enabledbyPass: true | false   - A true value creates a global bypass switch in homekit to bypass faulted zones with bypassEnabled set to true. A false value (default) allows for the creation of a zone-specific switch associated with each zone with bypassEnabled. The direct zone bypass switch can bypass zones that are faulted and/or normal. Un-bypassing one zone will unbypass all zones; this is a limitation of the alarm panel. *Note: Once your system is disarmed, the bypass zones will have to be bypassed again to arm your system again.* 
> - quickbypass : true | false   - Must be pre-configured on the alarm panel (please refer to your alarm panel programming guide). If programmed, "Quick Bypass" allows you to easily bypass all open (faulted) zones without having to configure zones individually and perform operations quickly. *This is a required value for this section*

**speedkeys** *(Optional section)*
> - name: Name of special function key to display in Homekit - *This is a required value for this section*
> - speedcommand: A | B | C | D | Custom - Indicates which special function key (e.g. A, B, C, and D keys) will be associated with this switch. The special keys are located to the left of the numeric keys and can be programmed with special functions at the alarm panel. Custom allows the use of a command field to input a custom automated input sequence that imitates keypad inputs. *This is a required value for this section*
> - command: Input custom automated input sequence that imitates keypad inputs. Special @pin notation will be replaced with configuration master PIN/Code. *This is required if custom is selected as speedcommand.*

An example configuration is below.

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

If your system has unused zones, simply include a *zoneNumber* integer property on ***each*** zone you have in the config. Make sure you put the property in each zone. This is the recommended configuration if you don't wish to monitor (display) all the zones within HomeKit or don't know the ordering of your system zone.

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
