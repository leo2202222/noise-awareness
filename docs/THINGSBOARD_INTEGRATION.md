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

Classification key update: ESP32 reports sound_class. NAS now requests sound_class and sound_type, prioritizes sound_class, and supports speech/music/noise case-insensitively. A classification is paired only with a sound_db sample at the same time or up to 2 seconds later; future/older classifications are not reused. Responses include soundClassKey and soundClassTs for provenance. sound_type remains a compatibility fallback. This applies to current data and historical records; the ESP32 and Cloud telemetry are not modified.

History display fix: Event History now shows retained telemetry records for all sound categories, including Speech when the device reports Normal. Previously the frontend forced historyMode=incidents and hid these records. Insights continues using observed alert intervals. Latest telemetry is merged into the scoped history cache with timestamp deduplication, without resetting the full-history refresh timer or creating synthetic sensor readings. Read-only Cloud verification found 18 distinct Speech classifications represented by 27 sound-level rows, including 9 Normal Speech rows. Counts describe the data available at verification time, not a fixed total.

Insights completeness update: classification shares and volume now summarize soundRecords (all retained sound-level records paired with real sound_class/sound_type), not only the first sample of an Alert interval. Speech recorded as Normal is included. alertRecords separately contains each device-reported Alert record, without interval aggregation; History continues to show every loaded record and can filter Alert. Percentages use classified Speech/Music/Noise records only. This counts records, not audio clips or durations. Existing raw telemetry is not overwritten and no missing events are fabricated. Counts are bounded by ThingsBoard retention and the declared 20,000-record/key query limit. This does not add a delivery receipt log or guarantee recovery of sensor samples never sent to ThingsBoard.

Existing-device duplicate fix: Cloud connection groups are now named per authenticated user and device, fetched by owner/type/name using the deployed API before creation, and reused on repeat connection. Concurrent duplicate group creation is resolved by looking up the same group. Existing group ownership and NAS management metadata are verified. Existing group permissions are reused; new read roles have unique names. Connection metadata is upserted and keeps the resource manifest. Only newly created resources are rolled back on failure; existing devices are not deleted or renamed. Mock tests enforce real group-name uniqueness and assert that repeat connections do not increase group/role/permission counts.

History status correction: a sound sample uses the most recent noise_limit telemetry recorded at or before its own timestamp to compute Alert when dB >= that limit. It never applies today's Shared attribute retroactively or uses a future threshold. If no valid historical threshold exists, it falls back to the exact recorded device alert; otherwise status remains Unknown. deviceAlertStatus, alertSource, noiseLimit and noiseLimitTs preserve provenance without overwriting Cloud telemetry. Live read-only verification of the reported 22 Nov 20:17 row confirmed 80.9 dB / historical limit 80 => Alert, while its missing device alert remains recorded separately as Unknown. Threshold-version/equality/future-threshold tests passed.

Event-counting version: Insights now uses soundMoments, grouping adjacent records of the same sound type and device when sample gaps are at most 30 seconds. A type change or larger data gap starts a new observed event; the gap is not assumed to be recorded silence. Alert totals use observed Alert intervals, with a new interval after Normal, Unknown or a data gap. History keeps all soundRecords and alertRecords unchanged. Percentages describe observed sound events, not sample counts or audio duration. Read-only verification on the current dataset: 172 raw records -> 51 sound events; 81 Alert records -> 36 observed Alert intervals. Counts may change with incoming/retained data. No Cloud telemetry was modified.

Customer Settings save fix: if a signed-in Customer's own JWT is denied attribute writes, NAS verifies the connected device belongs to the same Cloud Customer and tenant and provisions a private device-scoped GROUP permission with WRITE_ATTRIBUTES. The user's JWT then performs the original write and readback. It does not add PROFILE rights, elevate user authority, or proxy arbitrary device writes with the service key. Settings grants are separate from read-only connection groups and reused on later saves. Live testing on a temporary Customer device verified noise_limit=60 in Shared attributes with verified readback; 15 temporary resources were removed. NAS01's actual threshold was not changed by testing.

## Cloud device-list persistence

Connections now persist per Cloud identity in User additionalInfo.nasV2.deviceConnections (device ID, website name and installation location). Connect/Edit/Disconnect update this manifest with server-side identity validation and Cloud readback, then hydrate local device/member/label caches. Empty lists are authoritative, so disconnected devices do not reappear after a cold start. The User authority, tenant, customer and other additionalInfo are retained; this is not a new role grant and no credentials/tokens are saved in the manifest. Device data requests still use the signed-in user's JWT.

Existing local connections migrate on authenticated access. Older missing lists can be recovered from NAS-managed USER groups for the same customer, with each recovered device checked using the user's own token. Explicitly saved empty manifests are never replaced by this recovery. Local-only legacy labels cannot be reconstructed if already lost before migration. Separate user label caches prevent one user's name/location overwriting another's. Session and push continuity on Render Free still require re-login/re-enrollment; Cloud device lists no longer depend on ephemeral SQLite.

Mock tests clear local users, sessions and devices and verify restoration of connections and labels, persistent disconnection and legacy group recovery without creating grants. Live testing on a temporary account verifies Cloud manifest readback and restoration after local reset; the existing NAS device and telemetry are untouched.
