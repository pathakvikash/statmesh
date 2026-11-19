# Importing a GBD download you obtained yourself

The Global Burden of Disease (IHME GBD) results are not bundled and not redistributed. Download the
files yourself from the IHME GBD Results tool, under IHME's own terms, then import them into a
private connector folder on your own machine. The folder is for you only: its manifest says
`redistribute: "no"`, so the data is never served by a hosted instance.

## 1. Create the folder

Pick a folder for your private connectors and point `STATMESH_CONNECTORS_DIR` at it:

```sh
mkdir -p ~/statmesh-connectors/gbd_mine
export STATMESH_CONNECTORS_DIR=~/statmesh-connectors
```

The folder name is the connector id. It must match `^[a-z][a-z0-9_]*$` and the `id` in the manifest.

## 2. Write `manifest.yaml`

Quote `"no"` so YAML keeps it as a string.

```yaml
id: gbd_mine
name: GBD results (my own download)
kind: file
licence:
  name: IHME Free-of-Charge Non-Commercial User Agreement (personal download; not redistributed)
  url: https://www.healthdata.org/about/gbd-data-use-terms
  redistribute: "no"
  attribution: "Source: IHME, Global Burden of Disease Study. Data downloaded by the user under IHME terms"
rate_limit:
  per_second: 1
core_datasets: []
datasets:
  deaths: {url: "file:///Users/you/Downloads/IHME-GBD_deaths.csv"}
```

Check the licence name and URL against the terms you accepted on the IHME site before you import.

`file://` URLs are allowed only on self-hosted installs. A hosted instance (`STATMESH_MODE=hosted`)
refuses them, which is one more reason the import stays on your own machine.

## 3. Write `mapping.yaml`

Use the column names in your own export. Typical GBD results columns are `location_name`,
`sex_name`, `age_name`, `cause_name`, `measure_name`, `metric_name`, `year` and `val`. Check the
header of your file first:

```yaml
datasets:
  deaths:
    title: GBD deaths (my download)
    format: csv
    geo: location_name
    geo_scheme: name
    period: year
    freq: A
    indicator: [cause_name, measure_name, metric_name]
    value: val
    dims: [sex_name, age_name]
    max_uncompressed_mb: 1024
    where:
      metric_name: Number   # keep one metric so the file stays small
```

Add `geo_map.csv` next to the manifest for location names the country lookup does not match.

If the export is larger than the default cap, raise `max_uncompressed_mb`. Use `where` to keep only
the causes, measures and years you need.

## 4. Ingest and check

```sh
statmesh connector test gbd_mine     # offline checks on the folder
statmesh ingest --dataset deaths     # run the import yourself (no schedule: core_datasets is empty)
```

Do not share the resulting data, and do not copy the folder into `src/statmesh/connectors/`.
