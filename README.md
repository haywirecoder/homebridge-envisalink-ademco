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

This plugin works with the Ademco Envisalink module and Vista series alarm panels. It supports alarm operations (arm, disarm, night, and stay), zone bypassing, and special function keys (fire, panic, and medical), and it exposes alarm system sensors to Homebridge.

> **Note:** This plugin uses the Envisalink Third Party Interface (TPI). Ensure TPI is enabled (that is, *Alert* is checked) for your module.

## Limitations

* Ademco panels provide limited zone information to their peripherals. The panel reports a zone in real time only when it is faulted (open), not when it is restored (closed). However, the virtual keypad is continuously updated with zone information. This plugin automatically sets faulted zones (open) to restored (closed) based on the `openZoneTimeout` attribute. With the default configuration, a zone closes 30 seconds after the virtual keypad stops reporting a fault for that zone.

* When the system is armed, the panel no longer reports the state of each zone. All zones age out and are considered restored once the system is armed. **Note:** A bypassed zone automatically shows as faulted (open) once the alarm is disarmed.

* The Envisalink TPI supports only one connection. Once this plugin is connected, any other connection attempt results in an error. Conversely, if Envisalink is being used for another purpose, this plugin cannot connect. The proxy server function provided by this plugin may offer an alternative way to share the connection (see `proxyEnabled` in [Configuration Options](#configuration-options)).

* Confirm that you have a stable network connection to the Envisalink module before installing this plugin. The auto-reconnect option is designed for occasional network issues only.

* This plugin uses two indicators for *NIGHT STAY*. "Arm-Instant (Zero Delay-Stay)" is similar to STAY mode but without the entry delay feature, and it is usually associated with *NIGHT STAY*. The plugin also uses the virtual keypad text as an indicator of night mode.

* To receive updates for RF low battery, AC failure, low panel battery, and bypass status, reporting must be enabled for the Envisalink module. Refer to the "Panel Programming Options" section of the [Envisalink Honeywell installation guide](https://www.eyezon.com/EZMAIN/evl4honeywell.php). Functionality such as bypass memory is affected if reporting is not properly configured.

> **Please note:** Do not use the master user code or installer code in the configuration file. Create a separate alarm user with the proper access permissions (refer to your panel guide).

## Configuration Options

The options below are grouped to match the sections of the Homebridge configuration UI. Attributes marked *(optional)* may be omitted.

### General Settings

| Attribute         | Description |
| ----------------- | ----------- |
| `name`            | *(optional)* Name of the platform instance. The default is `Envisalink-Ademco`. |
| `host`            | Envisalink server host IP address (IPv4). **Note:** The plugin and Homebridge shut down if this is not configured. |
| `port`            | Envisalink server port. The default is `4025`. |
| `deviceType`      | Device model. One of `10P` (Honeywell VISTA-10P), `15P` (VISTA-15P), `20P` (VISTA-20P), `21IP` (VISTA-21IP), or `128FBP` (VISTA-128FBP). The default is the VISTA-10P (`10P`). |
| `password`        | Envisalink server password. The default is `user`. |
| `pin`             | Global alarm PIN/code. It must be exactly 4 digits (0–9). It is recommended to create a separate alarm user for this plugin. The default is `1234`. |
| `changePartition` | *(optional)* For multi-partition systems, automatically change to the specific partition before executing an alarm command. A partition is a sectioned-off portion of an alarm system that can be operated independently of the rest of the system. This option slightly increases panel command execution time and is not needed for non-partitioned systems. The default is `false`. |
| `partitions`      | *(optional)* List of partitions to monitor in HomeKit (up to 7). See [partitions](#partitions). |
| `zones`           | *(optional)* List of zones to display, monitor, and manage in HomeKit (up to 128). See [zones](#zones). |

### Keypad Button Options

| Attribute      | Description |
| -------------- | ----------- |
| `chimeToggle`  | *(optional)* Create a switch in HomeKit to turn the chime sound on the Ademco panel on or off. The panel allows the chime to be changed only when the alarm is not armed. The default is `false`. |
| `bypass`       | *(optional)* Creates bypass controls (switches) to bypass zones that are being monitored. See [bypass](#bypass). |
| `speedKeys`    | *(optional)* Creates controls (switches) that replicate the special function keys on the Ademco keypad (up to 8). See [speedKeys](#speedkeys). |

### Advanced Settings

| Attribute                   | Description |
| --------------------------- | ----------- |
| `openZoneTimeout`           | *(optional)* Time, in seconds, to wait before a zone is considered closed. Allowed range: 15–120. The default is `30`. **Warning:** Setting this value too low can cause zones to clear and fault unexpectedly. |
| `commandTimeOut`            | *(optional)* Time, in seconds, to wait for an alarm command to return. Allowed range: 10–30. Bypass commands automatically triple this value because those operations take longer. The default is `10`. |
| `autoReconnect`             | *(optional)* Automatically reconnect to the Envisalink server if the session is terminated. This value is automatically set to `true` if `sessionWatcher` is enabled. The default is `true`. |
| `sessionWatcher`            | *(optional)* Automatically disconnect and create a new session if the plugin detects a hung or dropped session. This is done by periodically (every `heartbeatInterval`) checking the last updates from the virtual keypad. Setting this value to `true` causes the `autoReconnect` setting to be ignored and always set to `true`. The default is `true`. |
| `heartbeatInterval`         | *(optional)* Heartbeat interval, in seconds, used to determine whether the Envisalink session is hung. Allowed range: 15–600. The default is `30`. **Note:** Setting this value below 30 seconds may cause hung sessions to be identified incorrectly. |
| `bypassedMemory`            | *(optional)* Enables bypassed zones memory. See [bypassedMemory](#bypassedmemory). |
| `ignoreFireTrouble`         | *(optional)* When the virtual keypad sends a fire trouble signal, treat it as a warning and allow the system to arm. The default is `false`. |
| `ignoreSystemTrouble`       | *(optional)* When the virtual keypad sends a system trouble signal, treat it as a warning and allow the system to arm. The default is `false`. |
| `proxyEnabled`              | *(optional)* Create a proxy server that allows two additional Envisalink TPI clients to share the existing Envisalink TPI connection. These clients can connect to the default TPI port (`4026`) and the default HTTP (web console) port (`4080`) of the Homebridge server running this plugin. The default is `false`. **Note:** Because the connection to the Envisalink server is shared, a secondary TPI client may cause this plugin to malfunction. **Support notice:** Support is limited to the proxy server itself. Issues related to third-party clients are not covered and will not be addressed. |
| `batteryRunTime`            | *(optional)* User-supplied runtime of the main system backup battery, in hours (1–168). This value allows the plugin to estimate the remaining time when the system switches to backup battery power. |
| `envisalinkFailureSuppress` | *(optional)* Turn off alarm tamper events associated with Envisalink module communication errors. **Note:** These errors are still logged in Homebridge. The default is `false`. |
| `maintenanceMode`           | *(optional)* Place the plugin in maintenance mode, which disables communication with the Envisalink module. This allows testing or replacement of the module without affecting existing automations or filling the logs with error messages. **Warning:** This disables all updates and operations. The default is `false`. |

### partitions

- `name`: Partition name. *Required for each entry. The default is "House."*
- `partitionNumber`: Direct management of a specific partition number. *If not present, a consecutive number is used, which is not ideal. Not needed in a single-partition configuration.*
- `partitionPin`: Partition PIN/code. It must be exactly 4 digits (0–9) and overrides the global PIN for this partition. *If not present, the global PIN is used. Not needed in a single-partition configuration.*

### zones

*Optional section. If used, at least one zone must be defined.*

- `name`: Zone name. *Required for each entry.*
- `sensorType`: `co` (carbon monoxide) | `door` | `glass` (glassbreak) | `leak` | `motion` | `smoke` | `tilt` | `window`. *Required for each entry.*
- `partition`: Sensor partition number. *Required for each entry.*
- `zoneNumber`: Panel zone number for the sensor. Including this attribute enables non-consecutive zone numbering (see [Non-Consecutive Zones](#non-consecutive-zones)). *Required if your system has unused zones, uses non-consecutive zone numbering, or if you want to selectively display zones in HomeKit.*
- `bypassEnabled`: `true` | `false`. A value of `true` allows the zone to be bypassed from HomeKit. This setting works in conjunction with the bypass control option (see [bypass](#bypass)). *Optional; defaults to `false`. The alarm system does not allow fire or emergency zones to be bypassed.*

### bypass

*Optional section. Only one entry is allowed.*

- `enabledbyPass`: `true` | `false`.
  - `true` creates a global bypass switch in HomeKit that bypasses faulted zones with `bypassEnabled` set to `true`.
  - `false` (default) creates a zone-specific switch for each zone with `bypassEnabled` set to `true`. A zone-specific switch can bypass zones that are faulted or normal. Unbypassing one zone unbypasses all zones; this is a limitation of the alarm panel.

  **Note:** Once your system is disarmed, bypassed zones must be bypassed again before the system can be armed. An optional feature allows the plugin to remember zone status; see [bypassedMemory](#bypassedmemory).
- `quickbypass`: `true` | `false`. *Optional.* Indicates that the panel supports quick (force) bypass, which must be pre-configured on the alarm panel (refer to your panel programming guide). If `quickbypass` is not enabled, the bypass switch can only bypass zones that are monitored in HomeKit and have `bypassEnabled` set to `true`. If it is enabled, "Quick Bypass" lets you bypass all open (faulted) zones without configuring zones individually, and performs the operation quickly.

### bypassedMemory

*Optional section. Only one entry is allowed.*

- `zoneMemory`: `true` | `false`. Allows the plugin to remember which zones were bypassed and restore them after disarming. This also enables individual zone bypasses to be toggled on and off. The default is `false`. **Note:** Panel reporting must be enabled for the plugin to monitor zone bypasses properly. Refer to the Envisalink installation guide.
- `probeZone`: Zone number used as a bypass probe. On startup, and after any change in bypass state, the plugin uses this zone to trigger the panel to list the currently open zones. *Optional.* **Note:** Verify that this zone is not wired on your panel to ensure it does not cause problems.

### speedKeys

*Optional section. Up to 8 entries are allowed.*

- `name`: Name (label) of the special function key to display in HomeKit. Maximum 12 characters. *Required for each entry. Each name must be unique.*
- `speedcommand`: `A` | `B` | `C` | `D` | `custom`. Indicates which special function key (A, B, C, or D) is associated with this switch. The special keys are usually located on the left side of the keypad, next to the numeric keys, and execute automated sequences pre-stored in the system's memory. `custom` allows you to enter an automated input sequence that imitates keypad input in the `customcommand` field. *Required for each entry.*
- `customcommand`: A custom automated input sequence (macro) to send to the alarm panel. The special `@pin` notation is replaced with the master PIN/code. *Required if `speedcommand` is `custom`.*

## Example Configuration

```json
{
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
      "speedKeys": [
        {
          "name": "Panic",
          "speedcommand": "A"
        },
        {
          "name": "Special key",
          "speedcommand": "custom",
          "customcommand": "@pin03"
        }
      ]
    }
  ]
}
```

## Non-Consecutive Zones

If your system has unused zones, include a `zoneNumber` integer property on **each** zone in the configuration. This is the recommended configuration if you do not want to monitor (display) all zones in HomeKit or do not know the ordering of your system zones.

Example:

```json
{
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
}
```
