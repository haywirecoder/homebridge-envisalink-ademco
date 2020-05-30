# Homebridge-Envisalink-Ademco

This is a homebridge plugin leverages using a modified version of a node-red implementation ( https://www.npmjs.com/package/node-red-contrib-envisalink-ademco ) and Homebridge envisalink module ( https://www.npmjs.com/package/homebridge-envisalink )
This module was designed to work with Ademco Envisalink module with the Vista series alarm boards.

Limits:
  * Ademco panels provide limited zone information to their peripherals. Ademco panels only provide real-time information of when a zone is faulted (opened) but not when it is restored (closed). However, the viritual key constant is updated with zones information, this module auto set zone faulted (opened) to expired in 30 second if the virtual panel no reports as open.

  * When system is Armed board no longer report the state of each zone. All zone will age out and consider close once armed. 


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
          "name": "Master Bedroom Door",
          "type": "door",
          "partition": 1
        }
    }
  ]
```

## Non-Consecutive Zones (Recommened)
If your system has unused zones, simply include a *zoneNumber* integer property on ***each*** zone you have in the config. Make sure you put the property on each zone.

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
