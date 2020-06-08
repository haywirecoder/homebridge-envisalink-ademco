# Homebridge-Envisalink-Ademco

This is a Homebridge/HOOBS plug-in leveraging a modified version of a node-red implementation ( https://www.npmjs.com/package/node-red-contrib-envisalink-ademco ) and a Homebridge envisalink DSC module ( https://www.npmjs.com/package/homebridge-envisalink )
This module was designed to work with Ademco Envisalink module with the Vista series alarm boards.


Limits:
  * Ademco panels provide limited zone information to their peripherals. The panel only provide real-time information when a zone is faulted (opened) but not when it is restored (closed). However, the virtual key panel is continuously updated with zones information. This module auto set the faulted zone (opened) to restored (close) after 30 second once the virtual panel no longer reports a fault for the specific zone.

  * When system is "Armed" the panel no longer report the state of each zone. All zone will age out and be considered close once armed. Note: A bypass zone will automaticly show as fault (open) once the alarm is disarmed.

Please note: As of version 1.0.8 the attribute for zones "type" attribute has been changed to "sensorType" this is to enabled the UX Hoobs configuration manager.

## Configuration options

The following properties can be configured:

<table width="100%">
	<!-- why, markdown... -->
	<thead>
		<tr>
			<th>Option</th>
			<th width="100%">Description</th>
		</tr>
	<thead>
	<tbody>	
		<tr>
			<td><code>Host</code></td>
			<td>Envisakit".<br>
				<br><b>Example:</b> <code>192.168.1.100</code>
				<br>This value is <b>REQUIRED</b>
			</td>
		</tr>		
		<tr>
			<td><code>deviceType</code></td>
			<td>Device Name to appear in homekit<br>
				<br><b>Example:</b> <code>Honeywell Vista</code>
				<br><b>Default value:</b> <code>Honeywell Vista</code>
				<br>This value is <b>OPTIONAL</b>
			</td>
		</tr>
		<tr>
			<td><code>password</code></td>
			<td>PIN to enable and disable alarm.<br>
       <br><b>Example:</b> <code>user</code>
				<br><b>Default:</b> <code>user</code>
				<br>This value is <b>OPTIONAL</b>
			</td>
		</tr>
		<tr>
			<td><code>pin</code></td>
			<td>PIN to enable and disable alarm.<br>
				<br><b>Example:</b> <code>1234</code>
				<br>This value is <b>REQUIRED</b>
			</td>
		</tr>    
        <tr>
			<td><code>partitions</code></td>
			<td>Alarm partition name<br>
				<br><b>Example:</b> <code>Alarm</code>
				<br><b>Default value:</b> <code>Alarm</code>
				<br>This value is <b>OPTIONAL</b>
			</td>
		</tr>
        <tr>
			<td><code>zones</code></td>
			<td>Zones to display in HomeKit<br>
				<br><b>Description:</b> <code> 
        "name": "<Name>",
        "sensorType": "<door|leak|motion|smoke|window>",
        "partition": "<Partition Number associated with sensor>",
        "zoneNumber": "<Define zone number>"
    </code>
				<br>This value is <b>OPTIONAL</b>
			</td>
		</tr>      
    </tbody>
</table>


Example configuration is below. 


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
          "sensorType": "door",
          "partition": 1
        },
        {
          "name": "Master Bedroom Window",
          "sensorType": "window",
          "partition": 1
        }
    }
  ]
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
    "zoneNumber": 1
  },
  {
    "name": "Patio Door",
    "sensorType": "door",
    "partition": 1,
    "zoneNumber": 2
  },
  {
    "name": "Garage Door",
    "sensorType": "door",
    "partition": 1,
    "zoneNumber": 5
  }
]
...
