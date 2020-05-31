# Homebridge-Envisalink-Ademco

This is a homebridge plugin leveraging a modified version of a node-red implementation ( https://www.npmjs.com/package/node-red-contrib-envisalink-ademco ) and a Homebridge envisalink DSC module ( https://www.npmjs.com/package/homebridge-envisalink )
This module was designed to work with Ademco Envisalink module with the Vista series alarm boards.

Limits:
  * Ademco panels provide limited zone information to their peripherals. The panel only provide real-time information when a zone is faulted (opened) but not when it is restored (closed). However, the virtual key panel continuously updated with zones information. This module auto set the faulted zone (opened) to restored (close) after 30 second after the virtual panel no longer reports a fault for the specific zone.

  * When system is "Armed" the panel no longer report the state of each zone. All zone will age out and be considered close once armed. Note: A bypass zone will automaticly show as fault (open) once the alarm is disarmed.

Example configuration is below:


```javascript
 "platforms": [
    {
      "platform": "Envisalink-Ademco",
      "host": "192.168.0.XXX",
      "deviceType": "Honeywell Vista",
      "password": "---envisalink password (default is user)---",
      "pin": "---panel pin for disarming---",
      "partitions": [
        {
          "name": "Alarm"
        }
      ],
      "zones": [
        {
          "name": "Front Door",
          "type": "door",
          "partition": 1
        },
        {
          "name": "Master Bedroom Window",
          "type": "window",
          "partition": 1
        }
    }
  ]
```

## Non-Consecutive Zones (Recommened)
If your system has unused zones, simply include a *zoneNumber* integer property on ***each*** zone you have in the config. Make sure you put the property on each zone. This is the recommended configuration if you don't wish to monitor (display) all the zones within HomeKit or don't know the ordering of your system zone.

Examaple:
```javascript
...
"zones": [
  {
    "name": "Front Entry",
    "type": "door",
    "partition": 1,
    "zoneNumber": 1
  },
  {
    "name": "Patio Door",
    "type": "door",
    "partition": 1,
    "zoneNumber": 2
  },
  {
    "name": "Garage Door",
    "type": "door",
    "partition": 1,
    "zoneNumber": 5
  }
]
...
