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
- Export decoded data as CSV. Native units and full decoded precision are retained.
- Use a responsive dark interface with keyboard-accessible controls.

## Import data

For CSV or pasted spreadsheet tables, the payload header must be named `data`. Its column position can change. Other imported measurement columns are ignored; values are decoded from the payload itself.

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
