# Benchmark report

200 questions on the fixture catalog (offline; it tests the plumbing, not real coverage). Generated 2026-11-19.

| metric | value | threshold |
|---|---|---|
| recall_at_5 | 0.795 | 0.75 |
| answerable | 0.795 | 0.75 |
| cited | 0.795 | 0.75 |
| answer_rate | 0.795 | 0.75 |

## By source

| Source | n | recall@5 | answerable | cited | answer rate |
|---|---|---|---|---|---|
| bea | 4 | 1.00 | 1.00 | 1.00 | 1.00 |
| bis | 8 | 0.88 | 0.88 | 0.88 | 0.88 |
| bls | 8 | 0.62 | 0.62 | 0.62 | 0.62 |
| census | 7 | 0.43 | 0.43 | 0.43 | 0.43 |
| datacommons | 6 | 0.50 | 0.50 | 0.50 | 0.50 |
| ecb | 8 | 0.62 | 0.62 | 0.62 | 0.62 |
| eia | 10 | 0.50 | 0.50 | 0.50 | 0.50 |
| esef | 4 | 0.75 | 0.75 | 0.75 | 0.75 |
| eurostat | 6 | 0.83 | 0.83 | 0.83 | 0.83 |
| fred | 6 | 0.83 | 0.83 | 0.83 | 0.83 |
| ilostat | 7 | 1.00 | 1.00 | 1.00 | 1.00 |
| imf | 7 | 1.00 | 1.00 | 1.00 | 1.00 |
| mospi | 25 | 0.84 | 0.84 | 0.84 | 0.84 |
| oecd | 6 | 1.00 | 1.00 | 1.00 | 1.00 |
| owid | 17 | 0.88 | 0.88 | 0.88 | 0.88 |
| sec_edgar | 6 | 1.00 | 1.00 | 1.00 | 1.00 |
| unsdg | 5 | 0.40 | 0.40 | 0.40 | 0.40 |
| who_gho | 35 | 0.80 | 0.80 | 0.80 | 0.80 |
| worldbank | 25 | 0.88 | 0.88 | 0.88 | 0.88 |

## By topic

| Topic | n | recall@5 | answerable | cited | answer rate |
|---|---|---|---|---|---|
| Companies | 10 | 0.90 | 0.90 | 0.90 | 0.90 |
| Economy | 44 | 0.82 | 0.82 | 0.82 | 0.82 |
| Energy | 10 | 0.50 | 0.50 | 0.50 | 0.50 |
| Environment | 10 | 0.90 | 0.90 | 0.90 | 0.90 |
| Health | 52 | 0.83 | 0.83 | 0.83 | 0.83 |
| Labour | 24 | 0.96 | 0.96 | 0.96 | 0.96 |
| Population | 11 | 0.45 | 0.45 | 0.45 | 0.45 |
| Prices | 26 | 0.73 | 0.73 | 0.73 | 0.73 |
| Trade | 13 | 0.77 | 0.77 | 0.77 | 0.77 |

## Questions that did not pass (41)

- b001 (miss): How many people in India die every year because of outdoor air pollution? | want who_gho:gho:AIR_41 | got who_gho:gho:AIR_17, who_gho:gho:AIR_9, who_gho:gho:AIR_5, who_gho:gho:AIR_51, who_gho:gho:AIR_50
- b015 (miss): How many newborn babies died in Norway? | want who_gho:gho:CM_03 | got owid:grapher:infant-mortality, owid:grapher:number-of-deaths-from-suicide-ghe, owid:grapher:death-rate-from-suicides-gho, open_canada:acf1b0f9-1c52-43f2-8729-db918d769873, oecd:DSD_FUA_CLIM@DF_HEAT_STRESS
- b018 (miss): How many MRI machines does South Africa have per million people? | want who_gho:gho:DEVICES08 | got who_gho:gho:FINPROTECTION_CATA_TOT_10_LEVEL_MILLION, who_gho:gho:FINPROTECTION_CATA_TOT_25_LEVEL_MILLION, who_gho:gho:DEVICES12, who_gho:gho:DEVICES21, who_gho:gho:DEVICES22
- b022 (miss): How many teenagers die each year in South Africa? | want who_gho:gho:DEATHADO | got owid:grapher:child-mortality-igme, owid:grapher:infant-mortality, owid:grapher:maternal-mortality, open_canada:acf1b0f9-1c52-43f2-8729-db918d769873, owid:grapher:number-of-deaths-from-suicide-ghe
- b027 (miss): death rate of 10 to 19 year olds in Brazil | want who_gho:gho:CHILDMORT10TO19 | got who_gho:gho:DEATHADO, cdc_data:9bhg-hcku, cdc_data:nr4s-juj3, cdc_data:hk9y-quqm, who_gho:gho:CHILDMORT_DEATHS_10TO14
- b029 (miss): How many newborns died in Brazil? | want who_gho:gho:CM_03 | got owid:grapher:infant-mortality, owid:grapher:number-of-deaths-from-suicide-ghe, owid:grapher:death-rate-from-suicides-gho, open_canada:acf1b0f9-1c52-43f2-8729-db918d769873, oecd:DSD_FUA_CLIM@DF_HEAT_STRESS
- b033 (miss): Teenage pregnancy rate in Nigeria | want who_gho:gho:asfr1 | got -
- b043 (miss): How many French deaths can be blamed on drinking? | want owid:grapher:alcohol-attributable-fraction-of-mortality | got open_canada:ce99c2c9-c224-43eb-aef0-1f379b70c91d, who_gho:gho:CM_02, who_gho:gho:CM_03, who_gho:gho:CM_01, who_gho:gho:CHOLERA_0000000002
- b051 (miss): traffic fatalities per 100,000 people in South Africa | want owid:grapher:death-rate-road-traffic-injuries | got who_gho:gho:DEVICES00, who_gho:gho:DEVICES01, who_gho:gho:DEVICES02, who_gho:gho:DEVICES04, who_gho:gho:DEVICES05
- b062 (miss): share of farmland that is irrigated in India | want worldbank:WDI:AG.LND.IRIG.AG.ZS | got ilostat:DF_CLD_XCHL_SEX_AGE_RT, ilostat:DF_CLD_XCHL_SEX_AGE_STU_RT, ilostat:DF_CLD_XGPB_SEX_AGE_RT, ilostat:DF_CLD_XCHL_SEX_AGE_GEO_RT, ilostat:DF_CLD_XGPB_SEX_AGE_GEO_RT
- b068 (miss): How much merchandise did the United States import? | want worldbank:WDI:BM.GSR.MRCH.CD | got comtrade:HS-A:M, worldbank:WDI:BM.GSR.GNFS.CD, worldbank:WDI:BM.GSR.TOTL.CD, faostat:TCLI, worldbank:WDI:BG.GSR.NFSV.GD.ZS
- b077 (miss): US current account deficit in dollars | want worldbank:WDI:BN.CAB.XOKA.CD | got worldbank:WDI:BN.FIN.TOTL.CD
- b078 (miss): What share of Brazilians live in extreme poverty? | want unsdg:DF_SDG_GLH:SI_POV_DAY1 | got who_gho:gho:CCO_1, ilostat:DF_CLD_XCHL_SEX_AGE_RT, ilostat:DF_CLD_XCHL_SEX_AGE_STU_RT, ilostat:DF_CLD_XGPB_SEX_AGE_RT, ilostat:DF_CLD_XCHL_SEX_AGE_GEO_RT
- b080 (miss): extreme poverty rate in Nigeria | want unsdg:DF_SDG_GLH:SI_POV_DAY1 | got who_gho:gho:CCO_1, eurostat:TESSI010, eurostat:TESSI012, eurostat:TESSI020, who_gho:gho:FINPROTECTION_IMP_PG_190_STD
- b081 (miss): How many people in Nigeria live below the poverty line? | want unsdg:DF_SDG_GLH:SI_POV_DAY1 | got who_gho:gho:FINPROTECTION_IMP_NP190_POP, who_gho:gho:FINPROTECTION_IMP_NP215_POP, who_gho:gho:FINPROTECTION_IMP_NP310_POP, who_gho:gho:FINPROTECTION_IMP_NP365_POP, who_gho:gho:FINPROTECTION_IMP_P190_POP
- b090 (miss): How much private debt do companies and households owe in the United States? | want bis:WS_TC:P | got worldbank:WDI:DT.NFL.DPNG.CD, worldbank:WDI:DT.DOD.DPNG.CD, ilostat:DF_CCF_XPPP_CUR_RT, bis:WS_DSR, worldbank:WDI:DT.DOD.DPPG.CD
- b095 (miss): What was inflation in France in early 2024? | want ecb:ICP:000000.ANR | got who_gho:gho:ebreast5, who_gho:gho:ebreast, open_canada:8d4c1f24-c6b3-4a5a-8e20-00f487e27af8, imf:CPI:CPI._T.IX, imf:CPI:CPI._T.YOY_PCH_PA_PT
- b097 (miss): euro area inflation rate | want ecb:ICP:000000.ANR | got ecb:BOP, imf:CPI:CPI._T.IX, imf:CPI:CPI._T.YOY_PCH_PA_PT, oecd:DSD_PRICES@DF_PRICES_ALL:CPI.GY, dbnomics:BIS_WS_LONG_CPI
- b098 (miss): How fast were consumer prices rising across the eurozone in March 2024? | want ecb:ICP:000000.ANR | got imf:CPI:CPI._T.IX, imf:CPI:CPI._T.YOY_PCH_PA_PT, oecd:DSD_PRICES@DF_PRICES_ALL:CPI.GY, dbnomics:BIS_WS_LONG_CPI, ecb:ICP:000000.INX
- b102 (miss): How much electricity did the United States generate in January 2024? | want eia:electricity_generation:generation_ALL | got who_gho:gho:EMFPOWERFREQUENCY, who_gho:gho:EMFLIMITPOWERDENSITY, who_gho:gho:EMFLIMITPOWERDENSITY1800, who_gho:gho:EMFLIMITPOWERDENSITY900, unsdg:DF_UNData_EnergyBalance
- b103 (miss): total net electricity generation in Alabama | want eia:electricity_generation:generation_ALL | got worldbank:WDI:DC.ODA.TOTL.CD, worldbank:WDI:DC.ODA.TOTL.GN.ZS, worldbank:WDI:DC.ODA.TOTL.KD, worldbank:WDI:DC.DAC.TOTL.CD, bis:WS_TC:G
- b104 (miss): US power generation from natural gas | want eia:electricity_generation:generation_NG | got who_gho:gho:EMFPOWERFREQUENCY, who_gho:gho:EMFLIMITPOWERDENSITY, who_gho:gho:EMFLIMITPOWERDENSITY1800, who_gho:gho:EMFLIMITPOWERDENSITY900, eia:electricity_generation:generation_ALL
- b105 (miss): How much of Alabama's electricity comes from gas-fired plants? | want eia:electricity_generation:generation_NG | got who_gho:gho:EMFPOWERFREQUENCY, who_gho:gho:EMFLIMITPOWERDENSITY, who_gho:gho:EMFLIMITPOWERDENSITY1800, who_gho:gho:EMFLIMITPOWERDENSITY900, unsdg:DF_UNData_EnergyBalance
- b107 (miss): natural gas electricity output Alabama January | want eia:electricity_generation:generation_NG | got imf:PI_WCA_2026_JAN_VINTAGE, who_gho:gho:EMFPOWERFREQUENCY, who_gho:gho:EMFLIMITPOWERDENSITY, who_gho:gho:EMFLIMITPOWERDENSITY1800, who_gho:gho:EMFLIMITPOWERDENSITY900
- b111 (miss): Total assets of Cloetta, the Swedish confectionery company, in 2020 and 2021 | want esef:facts:Assets | got bis:WS_CBTA, uk_companies_house:snapshot, uk_companies_house:company, datacommons:stat_vars:Count_Person, bis:WS_TC:G
- b119 (miss): What is the population of the United States? | want census:acs5:B01003_001E, census:popest:POP, datacommons:stat_vars:Count_Person | got who_gho:gho:EQ_CONDOMUSE, who_gho:gho:AIR_3, who_gho:gho:AIR_3_1, who_gho:gho:ASSISTIVETECH_Q02, who_gho:gho:GDO_q10x2_HOSUE
- b120 (miss): How many people live in Alaska? | want census:acs5:B01003_001E | got who_gho:gho:EQ_CONDOMUSE, worldbank:WDI:AG.PRD.LVSK.XD, who_gho:gho:AIR_3, who_gho:gho:ASSISTIVETECH_Q02, who_gho:gho:GDO_q10x2_HOSUE
- b123 (miss): How much does the typical household in Alabama earn? | want census:acs5:B19013_001E | got who_gho:gho:Camp_news, who_gho:gho:AIR_11, who_gho:gho:AIR_15, who_gho:gho:AIR_60, who_gho:gho:AIR_13
- b125 (miss): How fast has Alabama's population grown since 2010? | want census:popest:POP | got who_gho:gho:EQ_CONDOMUSE, who_gho:gho:AIR_3, who_gho:gho:AIR_3_1, faostat:FBS, who_gho:gho:ASSISTIVETECH_Q02
- b126 (miss): How many people live in India? | want datacommons:stat_vars:Count_Person | got who_gho:gho:EQ_CONDOMUSE, worldbank:WDI:AG.PRD.LVSK.XD, who_gho:gho:AIR_3, who_gho:gho:ASSISTIVETECH_Q02, who_gho:gho:GDO_q10x2_HOSUE
- b127 (miss): population of California | want datacommons:stat_vars:Count_Person | got who_gho:gho:EQ_CONDOMUSE, who_gho:gho:AIR_3, who_gho:gho:AIR_3_1, who_gho:gho:ASSISTIVETECH_Q02, who_gho:gho:GDO_q10x2_HOSUE
- b131 (miss): India's population in 2023 | want datacommons:stat_vars:Count_Person | got cdc_data:vbim-akqf, oecd:DSD_FUA_ECO@DF_ECONOMY, oecd:DSD_FUA_CLIM@DF_FIRES, open_canada:acf1b0f9-1c52-43f2-8729-db918d769873, oecd:DSD_FUA_CLIM@DF_HEAT_STRESS
- b132 (miss): US gross domestic product 2023 | want fred:series:GDP, bea:nipa:T10105_A191RC | got oecd:DSD_FUA_ECO@DF_ECONOMY
- b143 (miss): consumer price index for all urban consumers, seasonally adjusted | want bls:CU:CUSR0000SA0 | got fred:series:CPIAUCSL, imf:CPI:CPI._T.IX, imf:CPI:CPI._T.YOY_PCH_PA_PT, ecb:ICP:000000.INX, ecb:ICP:000000.ANR
- b145 (miss): How much more expensive is everything in America than a year ago? | want bls:CU:CUSR0000SA0, bls:CU:CUUR0000SA0 | got worldbank:WDI:DT.DOD.DLXF.CD, worldbank:WDI:DT.DOD.MIBR.CD, owid:grapher:alcohol-attributable-fraction-of-mortality, worldbank:WDI:DT.NFL.BOND.CD, worldbank:WDI:BN.KLT.DINV.CD
- b146 (miss): cost of living index December 2024 United States | want bls:CU:CUSR0000SA0, bls:CU:CUUR0000SA0 | got imf:CPI:CPI._T.IX, imf:CPI:CPI._T.YOY_PCH_PA_PT, oecd:DSD_PRICES@DF_PRICES_ALL:CPI.GY, fred:series:CPIAUCSL, ecb:ICP:000000.INX
- b153 (miss): French jobless rate 2023 | want eurostat:une_rt_a:PC_ACT | got ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT, unsdg:DF_SDG_GLH:SL_TLF_UEM, worldbank:WDI:DC.ODA.TOTL.KD, cdc_data:hk9y-quqm, open_canada:933c7f9d-deb0-4367-940d-06c38f494153
- b181 (miss): India all-India consumer price index December 2024 | want mospi:cpi:index | got imf:CPI:CPI._T.IX, imf:CPI:CPI._T.YOY_PCH_PA_PT, ecb:ICP:000000.INX, ecb:ICP:000000.ANR, oecd:DSD_PRICES@DF_PRICES_ALL:CPI.GY
- b185 (miss): real GDP of India for the year 2023-24 in rupees crore | want mospi:nas_annual:gdp_constant | got mospi:nas_annual:gva_current, mospi:nas_annual:gva_constant, mospi:nas_annual:ndp_current, mospi:nas_annual:ndp_constant, mospi:nas_quarterly:gva_current
- b189 (miss): India's real GDP in the January to March 2024 quarter | want mospi:nas_quarterly:gdp_constant | got mospi:nas_quarterly:gva_current, mospi:nas_quarterly:gva_constant, mospi:nas_quarterly:ndp_current, mospi:nas_quarterly:ndp_constant, imf:QGDP_WCA
- b197 (miss): India balance of payments, current account, 2024-25 | want mospi:rbi_bop:value | got worldbank:WDI:BN.CAB.XOKA.CD, worldbank:WDI:BN.CAB.XOKA.GD.ZS, imf:BOP_2026_APR_VINTAGE, imf:BOP_2026_FEB_VINTAGE, worldbank:WDI:BM.TRF.PRVT.CD
