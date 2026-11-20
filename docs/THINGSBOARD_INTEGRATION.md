# ThingsBoard integration

The Node server authenticates to ThingsBoard using THINGSBOARD_API_KEY in .env.
Web sessions and per-device permissions protect all data routes. Device catalog
and user grants are persistent in SQLite. Telemetry stays in ThingsBoard.

Device management POST /api/thingsboard/devices connects an existing UUID after
checking it in ThingsBoard. With no id it creates a real ThingsBoard device.
PATCH changes website labels in SQLite. DELETE disconnects the website record
and grants; it never destroys cloud telemetry or the physical device.

GET /api/thingsboard/snapshot?deviceId=UUID&historyMode=samples|incidents loads
only an assigned device (or any device for admin). The selected device determines
current values, graph, events and statistics. Unknown fields remain Unknown.
Real keys: sound_db, sound_type, confidence, noise_limit, alert, presence,
audio_valid, device_status. Related fields join only on identical timestamps.

History uses agg=NONE and paginates backwards in 1,000-value pages per key over
49 days, capped at 20,000 per key. It is cached for 60 seconds; latest values
are fetched on the five-second UI cycle. A truncation flag is displayed if the
cap is reached. Retention in ThingsBoard may shorten the available history.

Samples mode: each sound_db timestamp is one row, no invented duration.
Incidents mode: contiguous recorded Alert states form observed intervals;
a following Normal sample closes an interval. A missing state or a gap over
30 seconds leaves the end/duration unknown. Durations describe observed sample
bounds, not exact continuous sound duration. Insights always aggregates observed alert intervals, regardless of Event History mode.
The graph uses the most recent 24 returned readings, spaced by real timestamps.

GET/PUT /api/thingsboard/settings?deviceId=UUID reads/writes SHARED_SCOPE
attributes. Only admins write. Keys and device acknowledgement are documented
in FIRMWARE_SETTINGS.md. Successful write means cloud persistence; applied means
the device has reported the matching applied_config_version in CLIENT_SCOPE.

Current alert is the real device-reported alert, not recomputed retroactively
using newly edited settings. A timestamp older than 30 seconds is shown stale.
No runtime mock dataset or automatic telemetry generator exists in the web app.

Device online state is read from ThingsBoard SERVER_SCOPE active, with five-second
caching. All assigned devices receive a real status, not only the selected one.
Unavailable status remains Unknown. Connectivity and telemetry freshness are
displayed separately. Insights has no raw-data source selector and summarizes
only observed alert intervals; the raw sample option remains in Event History.
