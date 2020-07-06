# Homebridge-Envisalink-Ademco

This is a Homebridge/HOOBS plug-in leveraging a modified version of a node-red implementation ( https://www.npmjs.com/package/node-red-contrib-envisalink-ademco ) and a Homebridge envisalink DSC module ( https://www.npmjs.com/package/homebridge-envisalink )

This module was designed to work with Ademco Envisalink module with the Vista series alarm boards.

Limits:

* Ademco panels provide limited zone information to their peripherals. The panel only provide real-time information when a zone is faulted (opened) but not when it is restored (closed). However, the virtual key panel is continuously updated with zones information. This module auto set the faulted zone (opened) to restored (close) based the value set by *openZoneTimeout* attributes. Default configuration would result in zone 30 seconds once the virtual keypanel no longer reports a fault for the specific zone.

* When system is "Armed" the panel no longer report the state of each zone. All zone will age out and be considered close once armed. Note: A bypass zone will automaticly show as fault (open) once the alarm is disarmed.

* Envisalink module only support one connection. Once this plug-in is connected, any other connections will result in an error.
* Best pratice would be using master user or installer, and create seperate user

## Configuration options

| Attributes      | Description                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| host            | Envisalink server host IP Address.  *Note:* Plug-in and homebridge will shutdown if not configured.             |
| port            | Envisalink server Port address. Default is 4025.                                                                |
| deviceType      | Device Model. Default is "Honeywell Vista"                                                                      |
| password        | Envisalink server password. Default is "user".                                                                  |
| pin             | Your local alarm PIN. Recommend creating a seperate alarm user for this plug-in. Default pin is 1234            |
| **partitions**  | List of partition to monitor in homekit                                                                         |
| openZoneTimeout | *(optional)* Time out value for zone provided in milliseconds. Default is 30000 ms (30 sec).                    |
| commandTimeOut  | *(optional)* Time out value for alarm command to return provided in milliseconds. Default is 10000 ms (10 sec). |
| autoreconnect   | *(optional)* Automatic reconnect to server if session is broken. Default is true.                               |
| **zones**       | *(Optional)* List of zones to appear and monitor in homekit                                                     |

**partitions**

> - name : partition name (default "house")

**zones** *(Optional)*

> - name: zone name
> - sensorType :  door | leak | motion | smoke | window
> - partition : sensor partition number
> - zoneNumber : panel zone number for sensor

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
    ]
}
...

```

## Non-Consecutive Zones (Recommended)

If your system has unused zones, simply include a *zoneNumber* integer property on ***each*** zone you have in the config. Make sure you put the property on each zone. This is the recommended configuration if you don't wish to monitor (display) all the zones within HomeKit or don't know the ordering of your system zone.

Examaple:

```javascript

...

"zones": [
    {

    "name": "Front Entry",
    "sensorType": "door",
    "partition": 1,
    "zoneNumber": 9
    },
    {
    "name": "Patio Door",
    "sensorType": "door",
    "partition": 1,
    "zoneNumber": 12
    },
    {
    "name": "Garage Door",
    "sensorType": "door",
    "partition": 1,
    "zoneNumber": 5
    }
]

...
