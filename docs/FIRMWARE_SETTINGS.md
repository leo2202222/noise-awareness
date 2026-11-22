# Firmware shared-attribute contract

The website now writes real ThingsBoard SHARED_SCOPE attributes. This does not
by itself modify an unknown ESP32 firmware. The device must subscribe to shared
attribute updates (MQTT v1/devices/me/attributes) and request initial shared
attributes when connecting. No firmware source was provided in this web project,
so the website never reports hardware synchronization without acknowledgement.

| Shared attribute | Value |
|---|---|
| noise_limit | numeric threshold in dB |
| config_version | server Unix milliseconds identifying a saved configuration |

Apply all fields together after validating them. Persist configuration if it
must survive a device reboot. Sound-type selection, duration and schedule controls were removed from
the website; this settings endpoint no longer writes those attributes.
Use sound_db, sound_type and presence from the real sensors/model. Do not publish
fabricated telemetry to make the web UI look current.

Only after the firmware actually applies the configuration should it publish a
CLIENT_SCOPE attribute:

```json
{"applied_config_version": 1795000000000}
```

The number must equal the received config_version, not this documentation sample.
Website Settings then reports applied; otherwise it says awaiting-device.
Current Dashboard alert remains the device-reported alert, not an invented
reclassification of historical data using today's threshold.

Reference: https://thingsboard.io/docs/reference/rest-api/

Settings payload update: the website sends noise_limit directly. Backend writes numeric noise_limit plus config_version to ThingsBoard SHARED_SCOPE and reads noise_limit/config_version back before reporting success. Legacy soundLevelThreshold requests remain accepted. Empty, null, boolean and out-of-range values are rejected. No live threshold was changed during this code update; read-only inspection found noise_limit=90 already present in NAS 01 Shared attributes.
