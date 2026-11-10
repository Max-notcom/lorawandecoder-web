# Payload Decoder

A static browser tool for decoding LoRaWAN sensor payloads and inspecting measurements in tables and charts.

**[Open the app](https://lorawandecoder.pages.dev)**

## Features

- Paste a single Base64 or hexadecimal payload, a newline list, CSV, Excel cells, or a Markdown table.
- Load CSV files with or without timestamps.
- Inspect raw payloads and decoded values; expand details for status flags, diagnostics, and bytes.
- Filter the table by battery life, measurement group, specific field, or packet type. Search payloads, values, and diagnostic details.
- Navigate with numbered pages or jump directly to a page.
- Select numeric measurements for charts, hover for values, and zoom into a range.
- Highlight repeated payloads without deleting them.
- Export decoded data as CSV. Decoded units and full precision are retained; legacy device-unit uncertainty is labeled explicitly.
- Use a responsive dark interface with keyboard-accessible controls.

## Import data

For CSV, pasted spreadsheet cells or Markdown tables, set **Raw payload header** to the name of the column containing encoded payloads. It defaults to `data`; column position can change. Header names are case-sensitive, with surrounding whitespace ignored. Other imported measurement columns are ignored; values are decoded from the payload itself.

```csv
data,ts
EAAANmFADE8w,2026-10-06 (09:00:00.000)
EQAASRJA4058,2026-10-06 (09:15:00.000)
```

A payload-only list also works:

```text
EAAANmFADE8w
EQAASRJA4058
```

Choose encoding and sensor model as needed, then select **Decode input**. New imports replace the dataset by default; choose **Append rows** to keep existing rows. Large files show a limited preview while the full file is decoded.

Timestamp detection supports the example format, ISO dates, and Unix seconds or milliseconds. Select the timestamp column or date format manually when necessary. Dates without timezone offsets keep their wall-clock values; offset-aware timestamps are charted in UTC. Without timestamps, charts use sample order.

## Table and charts

Table filters combine with the existing issue/duplicate filter. They reset pagination to page one and preserve source order. Table filters do not change the charts or CSV export; the export includes the full dataset.

Charts separate incompatible units. Measurement-error values are excluded by default; reading filters can include them or hide overrange/simulation values. For large datasets, charts render fewer points while retaining the original rows and per-bucket extremes. The app has been tested with 100,000 rows; practical capacity depends on the browser and available memory.

## Supported packets

| Types | Data |
| --- | --- |
| `0x00` | Legacy display-unit codes |
| `0x10`–`0x13` | Axis/composite vibration measurements |
| `0x20`, `0x21` | Temperature channels |
| `0x30`, `0x31` | Pressure and temperature |
| `0x40`–`0x47` | Health, diagnostics, initialization, GPS, and equipment |
| `0x48` | Legacy transmission interval (minutes) |
| `0x51`–`0x58` | Basic/extended vibration channels |
| `0x8000`, `0x8001` | Trap condition and temperature |

Sensor-model selection controls diagnostic interpretation. Unknown or reserved bits remain visible. Invalid payloads and missing cells produce row-specific errors while valid rows continue decoding. Supplied live samples validate vibration decoding; other formats have synthetic checks against the protocol definitions.

## Privacy and browser storage

The host serves only the app files. Payloads, imported files, decoded data, and settings are processed in the browser and are not sent to an external server. No analytics or external scripts are included.

Data normally clears on refresh or closing the tab. **Settings → Browser storage → Remember latest dataset** enables local persistence of the current dataset. Disabling it removes saved data. **Clear saved data** removes the saved copy while keeping the current view. Browser cleanup and storage limits can affect retention.

## Run locally

Clone this repository and start an HTTP server from its folder:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). No installation or build is needed. Opening `index.html` directly is unsupported because the app uses JavaScript modules and a background worker.

## Deployment

Cloudflare Pages deploys this repository's `main` branch automatically. The framework is None, build command is `exit 0`, and output directory is `.`. `_headers` supplies security headers, including a policy that blocks outbound data connections.

This repository contains the runtime assets and this README. Development tests and internal project documentation are maintained separately.

## Special recorded sequence

`AyABAHEDIP8AAQMgAABBBAAFCGjijA==` is recognized by its exact decoded bytes and marked **Special**. Inspect shows a possible sequence of three LinkADRReq commands, DutyCycleReq and RXParamSetupReq, including an RX2 frequency of 923.3 MHz. This interpretation is unconfirmed because the recording lacks direction, FPort, LoRaWAN version and regional settings. These control commands do not produce chartable measurements. The table's Special messages filter finds this record; CSV export retains its flag, caution and details. Other unknown byte sequences remain unsupported.

## Diagnostic reports

`QQAAAAAAAAAA` decodes to `41 00 00 00 00 00 00 00 00`: a diagnostic packet with status and detail words both `0x00000000`. It reports no active diagnostic bits. Inspect shows each raw word and the four category bits: Failure, Function check, Out of specification, and Maintenance required. Select a sensor model to interpret nonzero model-specific bits. Zero words do not require a model and do not establish overall equipment health.

## Legacy transmission interval

`SAAAAAo=` decodes to `48 00 00 00 0A`. Packet type `0x48` contains a four-byte unsigned transmission interval: **10 minutes** in this example. The table and CSV expose `TransmissionInterval` in minutes; use the Reporting interval filter to find it. The value can be selected for charts, but it is not used to invent timestamps.

This legacy format is documented for XS530/XS550 in section 7.7, table 7-11 of the [official Japanese software manual](https://web-material3.yokogawa.com/19/25291/files/IM01W06C01-01JA_001.pdf). It is absent from the English manual initially supplied for this project.

## Protocol edition and legacy unit metadata

Settings → Protocol edition selects **English (current)** or **Japanese (legacy)** status/diagnostic definitions. English is the default. Switching reinterprets the loaded decoded rows; browser storage remembers the edition. Supported packet types remain available in either mode.

The Japanese first edition additionally documents `0x00` display-unit metadata: three UINT16 codes for temperature, voltage and pressure, followed by a reserved UINT16 word expected to be `FFFF`. Inspect shows the raw codes. Use **Data type → Display unit codes** to find them. Code enums are not provided by the compared manuals, so the tool does not guess their unit names or plot them as measurements.

Japanese mode includes the legacy XS770A RF/NFC diagnostic bits and treats the documented reserved bits separately from newer firmware-update/counter meanings. Legacy temperature-module and pressure units can be configured on the device; readings use explicit device-unit labels without conversion. CSV includes ProtocolEdition and per-row units when a field has mixed units. The newer English XS822/XS540 definitions remain available.

## Record summary and custom payload headers

The Record summary table counts the full loaded dataset by packet type and explains each type. GPS types `0x44`–`0x46` are grouped. Special messages, empty records, and other undecoded payloads have separate counts; Total counts every imported row once. A constant transmission interval is shown in minutes. Unsupported and malformed records remain inspectable in the decoded-data table. Filters and pagination do not alter summary counts.

Set **Raw payload header** before importing a named table (for example `payload`, `raw message`, or `RawFrame`). Column suggestions come from the input header. Missing or duplicate matching headers produce an import error, and row errors identify the selected column. Plain payload lists still work. The Load example button uses the default `data` header. Optional browser storage remembers the header setting, and CSV exports preserve the source header name in PayloadColumn while using RawPayload for the encoded data.

## Summary percentages and contributors

The rightmost summary column shows each record type's percentage of all loaded rows, including empty and undecoded records, rounded to one decimal place. A nonempty dataset totals 100%; an empty dataset shows 0%. Rounded rows may not add to exactly 100%.

The text below the table ranks the top three contributors by record count. Vibration types `0x10`–`0x13` and `0x51`–`0x58` count as one Vibration measurements group across all axes/channels. Temperature channels are grouped together, as are geographical-information formats. Each packet counts once, regardless of how many measurement values it contains. The detailed table keeps its individual record-type rows. Fewer than three groups produce a shorter ranking; equal-count groups retain table order.

## Continuous duplicates

Empty payloads are skipped when finding identical payload runs in original imported order. `A, A, A` has three continuous duplicated payload rows and two extra repeats. `A, empty, A` has two continuous duplicated payload rows and one extra repeat. `A, B, A` has none. `A, A` has two continuous duplicated payload rows and one extra repeat. Comparisons use normalized bytes, so equivalent Base64 and hex match.

Select **Continuous duplicates only** in the decoded table to see every matching payload row, including the first occurrence in each run. Empty rows between matching payloads are shown for context but are not counted as duplicated payloads; leading/trailing empty rows are excluded. Search and data-type filters narrow this view after runs are identified in the original full dataset.

The record summary separately shows overall duplicated payload rows and continuous duplicated payload rows. The top indicator counts extra continuous repeats. These overlapping metrics do not change record-type counts or percentages. No rows are deleted, and charts/CSV export still use the full dataset.

Known calendar-date changes and non-empty undecodable records break a run. This also applies to dated empty rows between matching payloads. ISO dates retain their recorded date, epoch timestamps use UTC, and incompatible known date bases are not joined. Counts update across append boundaries and after storage restore. Without timestamps, only source order is available. Identical bytes alone do not prove a retransmission or a meaningless reading.

## Gateway radio frames versus sensor application payloads

Choose **Payload format → Sensor application payload** for decrypted sensor data. XS540 application formats remain `0x51`–`0x58`. Choose **LoRaWAN radio frame (PHYPayload)** for complete gateway `rxpk`/`txpk` frames. These contain radio headers and commonly encrypted FRMPayload, not directly readable sensor measurements.

CSV exports with the header combination `data_base64`, `payload_hex`, and `packet_kind` automatically select radio inspection and the `data_base64` column. `timestamp_utc` is selected when present. You can override these settings before decoding. Fractional-second timestamps up to nine digits are accepted; chart time truncates to milliseconds while source timestamp text and supplied uncertainty notes are retained.

Inspection supports join requests, encrypted join accepts, and confirmed/unconfirmed uplink/downlink data frames. It reports header fields, the low 16-bit counter, port, raw options, encrypted payload bytes and unverified integrity information. Radio fields do not become sensor measurements or chart series, and separate counters distinguish decoded payloads from inspected radio frames. Full counters, MIC validation, model attribution and successful downlink transmission are not inferred.

Records whose source CRC status is `CRC_FAIL` remain errors. `CRC_OK` is source-reported, not an independent verification or proof of authenticity. Join-accept contents remain encrypted. Extracted FRMPayload fields explicitly labeled encrypted are rejected in sensor mode rather than interpreted as vibration data. To obtain XS540 readings, import decrypted application payloads from the network/application server, or use the optional local AppSKey controls with the correct target address and session-counter context. Optional local AppSKey decryption is available as described below.

Exports retain the source CRC status, timestamp method and timestamp uncertainty note. Radio frames remain distinct from sensor packet types in summaries and filters. All processing stays within the browser; no payloads or keys are uploaded.

## Optional local AppSKey decryption

Select **Payload format → LoRaWAN radio frame (PHYPayload)** and expand **Optional local decryption**. Enter the session AppSKey, its target DevAddr, and the high 16 bits of the full session frame counter (0 only when no rollover has occurred). The AppSKey is not the root AppKey or the network integrity key. It applies only to the specified device address and session/counter context; other devices remain encrypted.

Application uplinks on ports 1–223 are decrypted locally in the background worker, then passed to the existing sensor decoder. Recognized readings show **Decrypted · unverified**. MIC is not verified, so a plausible decode is not proof of authenticity or a correct key/counter. Confirm the session context before relying on readings. Original radio bytes, assumed full counter and decrypted application bytes remain visible in Inspect and exports. Downlink plaintext is inspectable but is not treated as sensor measurements. FPort 0/network commands and join-accept decryption are not supported with this AppSKey input.

Keys stay only in the current tab/worker memory. They are never put into browser storage, CSV exports, URLs, logs or repository files. **Clear key** removes the input; refreshing clears it. If browser storage is enabled, the dataset can include decrypted plaintext and readings, but never the key. Saved plaintext can be reinterpreted without retaining keys. CSV exports include decryption status, assumed counter, MICVerified=false and decrypted application Base64. Imported decryption is explicitly unauthenticated; the app never guesses session keys or full counters.

Use the already-decrypted/sensor mode for plaintext application payloads. Gateway CSVs with the recognized radio-export headers select radio mode automatically; they do not automatically supply a key or target address.

## Why some radio rows remain unreadable

A session AppSKey is scoped to the selected device address. Encrypted rows outside that address explicitly say the key was not applied. Control/ACK frames without FRMPayload have no sensor readings to recover. FPort 0 carries network MAC commands and requires network-key handling, not the application key. Malformed headers and source CRC failures remain rejected.

A wrong key can accidentally produce bytes with a recognizable sensor type. Decryption candidates with reserved sensor-status bits set, or measurement types inconsistent with the selected known model, are retained as rejected candidates rather than charted as sensor readings. Inspect and CSV retain a rejection reason and candidate bytes for investigation. These checks reduce misleading results; they do not replace MIC authentication and cannot prove every plausible candidate correct.

Prefer uploading the original gateway CSV. Pasting only timestamp/payload columns loses source CRC status and timing uncertainty. Spreadsheet applications can also interpret Base64 beginning with `+` as a formula, replacing it with an error such as `#NAME?`; that text is not a recoverable radio packet.
