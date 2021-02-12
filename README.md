# Homebridge-Envisalink-Ademco
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![NPM Version](https://img.shields.io/npm/v/homebridge-envisalink-ademco.svg)](https://www.npmjs.com/package/homebridge-envisalink-ademco)

This module was designed to work with Ademco Envisalink module with the Vista series alarm panels. It supports alarm operations (e.g. Arm, disarm, night and stay), bypassing of zones, special function keys (e.g. Fire, Panic, Medical) and exposes the alarm system sensors to homebridge.

This module is leveraging a modified version of a node-red implementation ( https://www.npmjs.com/package/node-red-contrib-envisalink-ademco ) and a Homebridge envisalink DSC module ( https://www.npmjs.com/package/homebridge-envisalink )

Limits:

* Ademco panels provide limited zone information to their peripherals. The panel only provide real-time information when a zone is faulted (opened) but not when it is restored (closed). However, the virtual key panel is continuously updated with zones information. This module auto set the faulted zone (opened) to restored (close) based the value set by *openZoneTimeout* attributes. Default configuration would result in zone closing 30 seconds after the virtual keypanel no longer reports a fault for the specific zone.

* When system is "Armed" the panel no longer report the state of each zone. All zone will age out and be considered close once armed. Note: A bypass zone will automaticly show as fault (open) once the alarm is disarmed.

* Envisalink module only support one connection. Once this plug-in is connected, any other connections will result in an error.

Please Note: I recommended not using the master user or installer code in the configure file. Create a seperate alarm user with the proper access permissions (please refer to your panel guide).
  

## Configuration options

| Attributes        | Description                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| host              | Envisalink server host IP Address.  *Note:* Plug-in and homebridge will shutdown if not configured.                      |
| port              | Envisalink server Port address. Default is 4025.                                                                         |
| deviceType        | Device Model. Default is "Honeywell Vista"                                                                               |
| password          | Envisalink server password. Default is "user".                                                                           |
| pin               | Your local alarm PIN. Recommend creating a seperate alarm user for this plug-in. Default pin is 1234                     |
| **partitions**    | List of partition to monitor in homekit                                                                                  |
| openZoneTimeout   | *(optional)* Time out value for zone provided in second. Default is 30 second.                             |
| sessionsWatcher | *(optional)*  Automatic disconnect and recreate a new session if module detect a hang session. This is done by periodically (i.e. heartbeatInterval) checking the last updates from the virtual keypad. Autreconnect value must also be set to true for this option to be valid. Default is true. |
| heartbeatInterval | *(optional)* Heartbeat interval to determine if envisalink sessions has hang. Default is 30 second. |
| commandTimeOut    | *(optional)* Time-out value for alarm command to return provided in second. Default is 10 second.          |
| autoreconnect     | *(optional)* Automatic reconnect to server if network channel is broken. Default is true.                                        |
| **zones**         | *(Optional)* List of zones to appear and monitor in homekit                                                              |
| **bypass**        | *(Optional)* Creates a bypass control (a switch) to bypass zones which are open (faulted)                                |
|                   | By design the bypass switch can only bypass zone that are being monitored in homekit and the zone entry "bypassenable" set to true.    |
|                   | "quickbypass" Can be used to bypass all fault zones. This feature must to be enabled in ademco panel *(refer to panel guide)*.                               |
| **keys**          | *(Optional)* Create controls (switches) to replicate the special function keys on Ademco keypad                           |

**partitions**

> - name : partition name - *if not present default value to "house"*

**zones** *(Optional section -- Atleast one zone must be define if used)*

> - name: zone name  - *This is a required value for each entry*
> - sensorType : carbon monoxide | door | glass | leak | motion | smoke | window - *This is a required value for each entry*
> - partition : sensor partition number. - *This is a required value for each entry*
> - zoneNumber : panel zone number for sensor. - The presence of this attribute triggers consecutive zone numbering or non-consecutive zone numbering (see example). *This attribute is required if your system has unused zones, using non-consecutive zone numbering or wanting to selectively show zones within homekit*
> - bypassEnabled :  true | false - A true value allows zones to be bypass when open (faulted). This setting works in concert with the bypass control option (below). *This is optional element and default to false*

**bypass** *(Optional section)*

> - name: Bypass switch name to display in Homekit - *This is a required value for this section*
> - quickbypass : true | false   - Must be pre-configure on alarm panel (please refer to your alarm panel programning guide). If programmed, "Quick Bypass" allows you to easily bypass all open (faulted) zones without having to configure zone individually and perform operation quicker. *This is a required value for this section*

**keys** *(Optional section)*
> - name: Name of special function key to display in Homekit - *This is a required value for this section*
> - panelcode: A | B | C | D - Indicates which special function key (e.g. A, B, C and D keys) will be associated with this switch. The special keys are located to the left of the numeric keys can be programmed with special function at the alarm panel. *This is a required value for this section*

Example configuration is below.

```javascript
...

"platforms": [

{

    "platform": "Envisalink-Ademco",
    "host": "192.168.YYY.XXX",
    "deviceType": "Honeywell Vista",
    "password": "---envisalink password (default is user)---",
    "pin": "---panel pin for disarming---",
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
        "partition": 1
        }
    ],
    "bypass": [
        {
        "name": "Home Bypass",
        "quickbypass": false
        }
    ],
    "keys" : [
        {
        "name": "Panic",
        "panelfunction": "A"
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