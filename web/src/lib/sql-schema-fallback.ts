// Bundled copy of GET /schema, used until the API serves that route. Keep in step with docs/data-model.md.
import type { SqlSchema } from "./sql-schema";

export const FALLBACK_SCHEMA: SqlSchema = {
 "views": [
  {
   "name": "observations",
   "description": "Every data point: one row per series, period and extra dimensions. Live rows only (ingested data plus the on-demand cache). The table you will use most.",
   "joins": [
    "series: series.series_key = observations.source_id || ':' || observations.dataset_id || ':' || observations.indicator_id",
    "geos: geos.geo = observations.geo",
    "datasets: datasets.source_id = observations.source_id AND datasets.dataset_id = observations.dataset_id",
    "geo_groups: geo_groups.geo = observations.geo"
   ],
   "columns": [
    {
     "name": "series_id",
     "type": "VARCHAR",
     "description": "source:dataset:indicator:geo. Select it so citations can be attached.",
     "example": "ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT:IND"
    },
    {
     "name": "source_id",
     "type": "VARCHAR",
     "description": "Which provider published it (see sources).",
     "example": "imf"
    },
    {
     "name": "dataset_id",
     "type": "VARCHAR",
     "description": "The source's own dataset code.",
     "example": "CPI"
    },
    {
     "name": "indicator_id",
     "type": "VARCHAR",
     "description": "The source's own indicator code, as published.",
     "example": "CPI._T.YOY_PCH_PA_PT"
    },
    {
     "name": "geo",
     "type": "VARCHAR",
     "description": "Country as ISO alpha-3; region:<code> for aggregates; IN-XX for an Indian state.",
     "example": "IND"
    },
    {
     "name": "period_start",
     "type": "DATE",
     "description": "First day the value covers (inclusive).",
     "example": "2023-01-01"
    },
    {
     "name": "period_end",
     "type": "DATE",
     "description": "Last day the value covers (inclusive).",
     "example": "2023-12-31"
    },
    {
     "name": "freq",
     "type": "VARCHAR",
     "description": "Frequency: A annual, S half-year, Q quarter, M month, W week, D day.",
     "example": "A"
    },
    {
     "name": "value",
     "type": "DOUBLE",
     "description": "The number. May be null when obs_status explains why.",
     "example": "6.51"
    },
    {
     "name": "unit",
     "type": "VARCHAR",
     "description": "Unit as published. Never converted.",
     "example": "Percent"
    },
    {
     "name": "unit_mult",
     "type": "TINYINT",
     "description": "Power of ten beyond what unit says: real value = value * 10^unit_mult.",
     "example": "6"
    },
    {
     "name": "dims",
     "type": "MAP(VARCHAR, VARCHAR)",
     "description": "Extra dimensions, read with dims['sex'], dims['hs'], dims['partner'].",
     "example": "{'SEX': 'SEX_T'}"
    },
    {
     "name": "obs_status",
     "type": "VARCHAR",
     "description": "The source's quality flag, e.g. p for provisional.",
     "example": "p"
    },
    {
     "name": "retrieved_at",
     "type": "TIMESTAMP",
     "description": "When statmesh fetched it (UTC).",
     "example": null
    },
    {
     "name": "vintage",
     "type": "DATE",
     "description": "Release date, when the source gives one.",
     "example": null
    }
   ]
  },
  {
   "name": "observations_vintages",
   "description": "Same columns as observations, plus superseded values, so you can see how a number was revised. Core datasets only.",
   "joins": [
    "Same join keys as observations."
   ],
   "columns": [
    {
     "name": "series_id",
     "type": "VARCHAR",
     "description": "source:dataset:indicator:geo.",
     "example": null
    },
    {
     "name": "source_id",
     "type": "VARCHAR",
     "description": "Provider id.",
     "example": "bls"
    },
    {
     "name": "dataset_id",
     "type": "VARCHAR",
     "description": "Dataset code.",
     "example": null
    },
    {
     "name": "indicator_id",
     "type": "VARCHAR",
     "description": "Indicator code.",
     "example": null
    },
    {
     "name": "geo",
     "type": "VARCHAR",
     "description": "Country or region code.",
     "example": "USA"
    },
    {
     "name": "period_start",
     "type": "DATE",
     "description": "First day covered.",
     "example": null
    },
    {
     "name": "period_end",
     "type": "DATE",
     "description": "Last day covered.",
     "example": null
    },
    {
     "name": "freq",
     "type": "VARCHAR",
     "description": "A, S, Q, M, W or D.",
     "example": null
    },
    {
     "name": "value",
     "type": "DOUBLE",
     "description": "The value as of this vintage.",
     "example": null
    },
    {
     "name": "unit",
     "type": "VARCHAR",
     "description": "Unit as published.",
     "example": null
    },
    {
     "name": "unit_mult",
     "type": "TINYINT",
     "description": "Power of ten beyond unit.",
     "example": null
    },
    {
     "name": "dims",
     "type": "MAP(VARCHAR, VARCHAR)",
     "description": "Extra dimensions.",
     "example": null
    },
    {
     "name": "obs_status",
     "type": "VARCHAR",
     "description": "Source flag.",
     "example": null
    },
    {
     "name": "retrieved_at",
     "type": "TIMESTAMP",
     "description": "When it was fetched.",
     "example": null
    },
    {
     "name": "vintage",
     "type": "DATE",
     "description": "The date this value was current until, for superseded rows.",
     "example": null
    }
   ]
  },
  {
   "name": "series",
   "description": "The catalogue: one row per series key (a source's indicator across all countries). Use it to find what exists and under what licence.",
   "joins": [
    "observations: series.series_key = observations.source_id || ':' || observations.dataset_id || ':' || observations.indicator_id",
    "datasets: datasets.source_id = series.source_id AND datasets.dataset_id = series.dataset_id"
   ],
   "columns": [
    {
     "name": "series_key",
     "type": "VARCHAR",
     "description": "source:dataset:indicator (no country). Not series_id.",
     "example": "imf:CPI:CPI._T.YOY_PCH_PA_PT"
    },
    {
     "name": "source_id",
     "type": "VARCHAR",
     "description": "Provider id.",
     "example": "imf"
    },
    {
     "name": "dataset_id",
     "type": "VARCHAR",
     "description": "Dataset code.",
     "example": null
    },
    {
     "name": "indicator_id",
     "type": "VARCHAR",
     "description": "Indicator code.",
     "example": null
    },
    {
     "name": "title",
     "type": "VARCHAR",
     "description": "Human title.",
     "example": "Consumer price index, all items"
    },
    {
     "name": "description",
     "type": "VARCHAR",
     "description": "Longer description, may be empty.",
     "example": null
    },
    {
     "name": "unit",
     "type": "VARCHAR",
     "description": "Unit as published.",
     "example": null
    },
    {
     "name": "freq",
     "type": "VARCHAR",
     "description": "A, S, Q, M, W or D.",
     "example": null
    },
    {
     "name": "geos",
     "type": "VARCHAR",
     "description": "Countries it covers, space separated.",
     "example": "IND USA"
    },
    {
     "name": "start_date",
     "type": "VARCHAR",
     "description": "Earliest period, as text (ISO date).",
     "example": "2015-01-01"
    },
    {
     "name": "end_date",
     "type": "VARCHAR",
     "description": "Latest period, as text (ISO date).",
     "example": "2023-12-31"
    },
    {
     "name": "dims_json",
     "type": "VARCHAR",
     "description": "The extra dimensions this series carries, as JSON.",
     "example": null
    },
    {
     "name": "licence_name",
     "type": "VARCHAR",
     "description": "Effective licence name (series, then dataset, then source).",
     "example": "CC BY 4.0"
    },
    {
     "name": "licence_url",
     "type": "VARCHAR",
     "description": "Link to the licence text.",
     "example": null
    },
    {
     "name": "redistribute",
     "type": "VARCHAR",
     "description": "May you redistribute this data: yes, no or review.",
     "example": "yes"
    },
    {
     "name": "attribution",
     "type": "VARCHAR",
     "description": "Attribution line to show when you use the data.",
     "example": null
    }
   ]
  },
  {
   "name": "datasets",
   "description": "One row per dataset a source publishes, with how fresh our copy is.",
   "joins": [
    "sources: sources.id = datasets.source_id",
    "series: series.source_id = datasets.source_id AND series.dataset_id = datasets.dataset_id"
   ],
   "columns": [
    {
     "name": "source_id",
     "type": "VARCHAR",
     "description": "Provider id.",
     "example": "ilostat"
    },
    {
     "name": "dataset_id",
     "type": "VARCHAR",
     "description": "Dataset code.",
     "example": null
    },
    {
     "name": "title",
     "type": "VARCHAR",
     "description": "Dataset title.",
     "example": null
    },
    {
     "name": "description",
     "type": "VARCHAR",
     "description": "What is in it.",
     "example": null
    },
    {
     "name": "source_url",
     "type": "VARCHAR",
     "description": "Where it comes from.",
     "example": null
    },
    {
     "name": "freq",
     "type": "VARCHAR",
     "description": "Frequency.",
     "example": null
    },
    {
     "name": "is_core",
     "type": "BOOLEAN",
     "description": "Core datasets are refreshed on a schedule and keep revision history.",
     "example": null
    },
    {
     "name": "status",
     "type": "VARCHAR",
     "description": "ingested, remote or stale.",
     "example": "ingested"
    },
    {
     "name": "source_updated_at",
     "type": "VARCHAR",
     "description": "When the source last changed it (text).",
     "example": null
    },
    {
     "name": "last_ingested_at",
     "type": "VARCHAR",
     "description": "When statmesh last loaded it (ISO text; CAST to TIMESTAMP to compare).",
     "example": "2026-11-19T15:37:41Z"
    },
    {
     "name": "licence_name",
     "type": "VARCHAR",
     "description": "Effective licence name (series, then dataset, then source).",
     "example": "CC BY 4.0"
    },
    {
     "name": "licence_url",
     "type": "VARCHAR",
     "description": "Link to the licence text.",
     "example": null
    },
    {
     "name": "redistribute",
     "type": "VARCHAR",
     "description": "May you redistribute this data: yes, no or review.",
     "example": "yes"
    },
    {
     "name": "attribution",
     "type": "VARCHAR",
     "description": "Attribution line to show when you use the data.",
     "example": null
    }
   ]
  },
  {
   "name": "sources",
   "description": "The data providers statmesh knows about (World Bank, IMF, BIS, Comtrade, SEC EDGAR and so on).",
   "joins": [
    "datasets: datasets.source_id = sources.id"
   ],
   "columns": [
    {
     "name": "id",
     "type": "VARCHAR",
     "description": "Short provider id used as source_id everywhere else.",
     "example": "imf"
    },
    {
     "name": "name",
     "type": "VARCHAR",
     "description": "Provider name.",
     "example": null
    },
    {
     "name": "kind",
     "type": "VARCHAR",
     "description": "How it is reached (api, bulk, ...).",
     "example": null
    },
    {
     "name": "endpoint",
     "type": "VARCHAR",
     "description": "Base URL.",
     "example": null
    },
    {
     "name": "auth",
     "type": "VARCHAR",
     "description": "Authentication it needs.",
     "example": null
    },
    {
     "name": "key_required",
     "type": "BOOLEAN",
     "description": "Whether an API key is needed.",
     "example": null
    },
    {
     "name": "licence_name",
     "type": "VARCHAR",
     "description": "Licence name.",
     "example": null
    },
    {
     "name": "licence_url",
     "type": "VARCHAR",
     "description": "Licence link.",
     "example": null
    },
    {
     "name": "redistribute",
     "type": "VARCHAR",
     "description": "yes, no or review.",
     "example": null
    },
    {
     "name": "attribution",
     "type": "VARCHAR",
     "description": "Attribution line.",
     "example": null
    },
    {
     "name": "discovered_at",
     "type": "VARCHAR",
     "description": "When statmesh first saw it.",
     "example": null
    }
   ]
  },
  {
   "name": "entities",
   "description": "Companies and other legal entities (LEI, SEC CIK, UK company number) with country and industry code.",
   "joins": [
    "entity_xref: entity_xref.from_id = entities.entity_id OR entity_xref.to_id = entities.entity_id",
    "observations: for SEC data, 'cik:' || observations.dims['cik'] = entities.entity_id"
   ],
   "columns": [
    {
     "name": "entity_id",
     "type": "VARCHAR",
     "description": "lei:<LEI>, cik:<10 digits> or uk:<number>.",
     "example": "cik:0000789019"
    },
    {
     "name": "source_id",
     "type": "VARCHAR",
     "description": "Provider id.",
     "example": "sec_edgar"
    },
    {
     "name": "name",
     "type": "VARCHAR",
     "description": "Legal name.",
     "example": "MICROSOFT CORP"
    },
    {
     "name": "country",
     "type": "VARCHAR",
     "description": "ISO alpha-3 country.",
     "example": "USA"
    },
    {
     "name": "industry_code",
     "type": "VARCHAR",
     "description": "Industry code in industry_scheme.",
     "example": "7372"
    },
    {
     "name": "industry_scheme",
     "type": "VARCHAR",
     "description": "SIC, NACE, ISIC or NIC.",
     "example": "SIC"
    },
    {
     "name": "address",
     "type": "VARCHAR",
     "description": "Registered address.",
     "example": null
    },
    {
     "name": "attrs",
     "type": "MAP(VARCHAR, VARCHAR)",
     "description": "Extra attributes.",
     "example": null
    },
    {
     "name": "retrieved_at",
     "type": "TIMESTAMP",
     "description": "When it was fetched.",
     "example": null
    }
   ]
  },
  {
   "name": "entity_xref",
   "description": "Links between identifiers of the same company (LEI, CIK, ISIN, ticker, BIC). Check confidence before relying on an inferred link.",
   "joins": [
    "entities: entities.entity_id = entity_xref.from_id"
   ],
   "columns": [
    {
     "name": "from_id",
     "type": "VARCHAR",
     "description": "Identifier to map from, e.g. cik:...",
     "example": "cik:0000789019"
    },
    {
     "name": "to_id",
     "type": "VARCHAR",
     "description": "Identifier mapped to, e.g. lei:... or isin:....",
     "example": null
    },
    {
     "name": "source_id",
     "type": "VARCHAR",
     "description": "Who supplied the link.",
     "example": null
    },
    {
     "name": "confidence",
     "type": "DOUBLE",
     "description": "1.0 for official mappings, lower for name matches.",
     "example": "1.0"
    },
    {
     "name": "inferred",
     "type": "BOOLEAN",
     "description": "True when statmesh derived the link.",
     "example": null
    },
    {
     "name": "retrieved_at",
     "type": "TIMESTAMP",
     "description": "When it was fetched.",
     "example": null
    }
   ]
  },
  {
   "name": "geos",
   "description": "Countries and regions: the lookup for geo codes.",
   "joins": [
    "observations: observations.geo = geos.geo",
    "geo_groups: geo_groups.geo = geos.geo"
   ],
   "columns": [
    {
     "name": "geo",
     "type": "VARCHAR",
     "description": "Canonical code: ISO alpha-3, or region:<code>.",
     "example": "IND"
    },
    {
     "name": "name",
     "type": "VARCHAR",
     "description": "Display name.",
     "example": "India"
    },
    {
     "name": "iso2",
     "type": "VARCHAR",
     "description": "Two-letter ISO code.",
     "example": "IN"
    },
    {
     "name": "m49",
     "type": "INTEGER",
     "description": "UN M49 numeric code.",
     "example": "356"
    }
   ]
  },
  {
   "name": "geo_groups",
   "description": "Country groups: G20, G7 and EU27. One row per member.",
   "joins": [
    "geos: geos.geo = geo_groups.geo",
    "observations: observations.geo = geo_groups.geo"
   ],
   "columns": [
    {
     "name": "group_id",
     "type": "VARCHAR",
     "description": "G20, G7 or EU27.",
     "example": "G20"
    },
    {
     "name": "geo",
     "type": "VARCHAR",
     "description": "Member country code.",
     "example": "IND"
    }
   ]
  }
 ]
};
