# homebridge-envisalink-ademco

This is a homebridge plugin support for Ademco Envisalink. Work in progress



```javascript
 "platforms": [
    {
      "platform": "Envisalink-ademco",
      "host": "192.168.0.XXX",
      "deviceType": "Honeywell Vista",
      "password": "---envisalink password (default is user)---",
      "pin": "---panel pin for disarming---",
      "suppressZoneAccessories": false,
      "suppressClockReset": false,
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
        },
        {
          "name": "Downstairs Windows",
          "type": "window",
          "partition": 1
        },
        {
          "name": "Basement Leak",
          "type": "leak",
          "partition": 1
        },
        {
          "name": "Upstairs Smoke",
          "type": "smoke",
          "partition": 1
        },
        {
          "name": "Living Room Motion",
          "type": "motion",
          "partition": 1
        }
      ],
      "userPrograms": [
        {
          "name": "Basement Smoke",
          "type": "smoke",
          "partition": 1
        }
      ]
    }
  ]
```

