# Homebridge-Envisalink-Ademco
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![NPM Version](https://img.shields.io/npm/v/homebridge-envisalink-ademco.svg)](https://www.npmjs.com/package/homebridge-envisalink-ademco)
[![npm](https://img.shields.io/npm/dt/homebridge-envisalink-ademco.svg?style=flat-square)](https://www.npmjs.com/package/homebridge-envisalink-ademco)

This module was designed to work with Ademco Envisalink module with the Vista series alarm panels. It supports alarm operations (e.g. Arm, disarm, night and stay), bypassing of zones, special function keys (e.g. Fire, Panic, Medical) and exposes the alarm system sensors to homebridge.


Limits:

* Ademco panels provide limited zone information to their peripherals. The panel only provide real-time information when a zone is faulted (opened) but not when it is restored (closed). However, the virtual key panel is continuously updated with zones information. This module auto set the faulted zone (opened) to restored (close) based the value set by *openZoneTimeout* attributes. Default configuration would result in zone closing 30 seconds after the virtual keypanel no longer reports a fault for the specific zone.

* When system is "Armed" the panel no longer report the state of each zone. All zone will age out and be considered close once armed. Note: A bypass zone will automaticly show as fault (open) once the alarm is disarmed.

* Envisalink module only support one connection. Once this plug-in is connected, any other connections will result in an error. Vice-versa, if Envisalink is being used for other purpose this module will not be able to connect. Confirm you have a stable network connection to the Envisalink module prior to installing this plug-in. While the auto-reconnect logic option is avalaible it is design for occasional network issues.

* This plug-in uses "Arm-Instant (Zero Delay-Stay)" as indicator of <i>NIGHT STAY</i>. Arms-Instant is similar to the STAY mode, but without the entry delay feature and usually associated with <i>NIGHT STAY</i>.

Please Note: I recommended not using the master user or installer code in the configure file. Create a seperate alarm user with the proper access permissions (please refer to your panel guide).
  

## Configuration options

| Attributes        | Description                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| host              | Envisalink server host IP Address.  *Note:* Plug-in and homebridge will shutdown if not configured.                      |
| port              | Envisalink server Port address. Default is 4025.                                                                         |
| deviceType        | Device Model. Default is "Honeywell Vista".                                                                              |
| password          | Envisalink server password. Default is "user".                                                                           |
| pin               | Your local alarm PIN. Recommend creating a seperate alarm user for this plug-in. Default pin is 1234                     |
| **partitions**    | List of partition to monitor in Homekit.                                                                                  |
| openZoneTimeout   | *(optional)* Time out value for zone provided in second. Default is 30 second.                             |
| sessionsWatcher | *(optional)*  Automatic disconnect and recreate a new session if module detect a hang session. This is done by periodically (i.e. heartbeatInterval) checking the last updates from the virtual keypad. Autreconnect value must also be set to true for this option to be valid. Default is true. |
| heartbeatInterval | *(optional)* Heartbeat interval to determine if envisalink sessions has hang. Default is 30 second. |
| commandTimeOut    | *(optional)* Time-out value for alarm command to return provided in second. Default is 10 second.          |
| autoReconnect     | *(optional)* Automatic reconnect to server if network channel is broken. Default is true.                                        |
| chimeToggle     | *(optional)*  Create a switch to enable and disabled Chime bell. Panel only allow change bell status when alarm is not armed. Default is false.                         |
| batteryRunTime     | *(optional)*  User suppied run time of main system battery backup in hours. This value allows plug-in to estimate remaining time when system switch to backup battery. |  
| maintenanceMode     | *(optional)*  Disable communication with Envisakit module. **Note:** This will disable all updates.                        |
| **zones**         | *(Optional)* List of zones to appear and monitor in Homekit                                                              |
| **bypass**        | *(Optional)* Creates a bypass control (a switch) to bypass zones which are open (faulted)                                |
|                   | By design the bypass switch can only bypass zone that are being monitored in Homekit and the zone entry "bypassenable" set to true.    |
|                   | "quickbypass" Can be used to bypass all fault zones. This feature must to be enabled in ademco panel *(refer to panel guide)*.                               |
| **speedkeys**          | *(Optional)* Create controls (switches) to replicate the special function keys on Ademco keypad                           |

**partitions**

> - name : partition name - *if not present default value to "house"*
> - partitionNumber: partition number - *if not present consecutive number is used, which is not ideal. Not needed in a single partition configuration.*
> - partitionPIN: partition PIN/Code - *if not present master configure PIN is used. Not needed in a single partition configuration.*

**zones** *(Optional section -- Atleast one zone must be define if used)*

> - name: zone name  - *This is a required value for each entry*
> - sensorType : co | door | glass | leak | motion | smoke | window - *This is a required value for each entry*
> - partition : sensor partition number. - *This is a required value for each entry*
> - zoneNumber : panel zone number for sensor. - The presence of this attribute triggers consecutive zone numbering or non-consecutive zone numbering (see example). *This attribute is required if your system has unused zones, using non-consecutive zone numbering or wanting to selectively show zones within homekit*
> - bypassEnabled :  true | false - A true value allows zones to be bypass when open (faulted). This setting works in concert with the bypass control option (below). *This is optional element and default to false*

**bypass** *(Optional section)*

> - enabledbyPass: true | false   - Create bypass switch in homekit
> - quickbypass : true | false   - Must be pre-configure on alarm panel (please refer to your alarm panel programning guide). If programmed, "Quick Bypass" allows you to easily bypass all open (faulted) zones without having to configure zone individually and perform operation quicker. *This is a required value for this section*

**speedkeys** *(Optional section)*
> - name: Name of special function key to display in Homekit - *This is a required value for this section*
> - speedcommand: A | B | C | D | Custom - Indicates which special function key (e.g. A, B, C and D keys) will be associated with this switch. The special keys are located to the left of the numeric keys can be programmed with special function at the alarm panel. Custom allow the use of command field to input custom automated input sequence that imitates keypad inputs. *This is a required value for this section*
> - command: Input custom automated input sequence that imitates keypad inputs. Special @pin notation will be replace with configuration master PIN/Code. *This is a required if custom is select as speedcommand.*

Example configuration is below.

```javascript
...

"platforms": [

{

    "platform": "Envisalink-Ademco",
    "host": "192.168.YYY.XXX",
    "deviceType": "Honeywell Vista",
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

If your system has unused zones, simply include a *zoneNumber* integer property on ***each*** zone you have in the config. Make sure you put the property on each zone. This is the recommended configuration if you don't wish to monitor (display) all the zones within HomeKit or don't know the ordering of your system zone.

Examaple:

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
