# Benchmark report

200 questions on the fixture catalog (offline; it tests the plumbing, not real coverage). Generated 2026-11-20.

| metric | value | threshold |
|---|---|---|
| recall_at_5 | 0.895 | 0.80 |
| answerable | 0.895 | 0.80 |
| cited | 0.895 | 0.80 |
| answer_rate | 0.895 | 0.80 |

## By source

| Source | n | recall@5 | answerable | cited | answer rate |
|---|---|---|---|---|---|
| bea | 4 | 0.75 | 0.75 | 0.75 | 0.75 |
| bis | 8 | 0.88 | 0.88 | 0.88 | 0.88 |
| bls | 8 | 0.75 | 0.75 | 0.75 | 0.75 |
| census | 7 | 0.71 | 0.71 | 0.71 | 0.71 |
| datacommons | 6 | 1.00 | 1.00 | 1.00 | 1.00 |
| ecb | 8 | 0.88 | 0.88 | 0.88 | 0.88 |
| eia | 10 | 0.70 | 0.70 | 0.70 | 0.70 |
| esef | 4 | 1.00 | 1.00 | 1.00 | 1.00 |
| eurostat | 6 | 0.83 | 0.83 | 0.83 | 0.83 |
| fred | 6 | 0.83 | 0.83 | 0.83 | 0.83 |
| ilostat | 7 | 1.00 | 1.00 | 1.00 | 1.00 |
| imf | 7 | 0.86 | 0.86 | 0.86 | 0.86 |
| mospi | 25 | 1.00 | 1.00 | 1.00 | 1.00 |
| oecd | 6 | 1.00 | 1.00 | 1.00 | 1.00 |
| owid | 17 | 0.94 | 0.94 | 0.94 | 0.94 |
| sec_edgar | 6 | 1.00 | 1.00 | 1.00 | 1.00 |
| unsdg | 5 | 0.60 | 0.60 | 0.60 | 0.60 |
| who_gho | 35 | 0.89 | 0.89 | 0.89 | 0.89 |
| worldbank | 25 | 0.96 | 0.96 | 0.96 | 0.96 |

## By topic

| Topic | n | recall@5 | answerable | cited | answer rate |
|---|---|---|---|---|---|
| Companies | 10 | 1.00 | 1.00 | 1.00 | 1.00 |
| Economy | 44 | 0.86 | 0.86 | 0.86 | 0.86 |
| Energy | 10 | 0.70 | 0.70 | 0.70 | 0.70 |
| Environment | 10 | 0.90 | 0.90 | 0.90 | 0.90 |
| Health | 52 | 0.90 | 0.90 | 0.90 | 0.90 |
| Labour | 24 | 0.96 | 0.96 | 0.96 | 0.96 |
| Population | 11 | 0.91 | 0.91 | 0.91 | 0.91 |
| Prices | 26 | 0.85 | 0.85 | 0.85 | 0.85 |
| Trade | 13 | 1.00 | 1.00 | 1.00 | 1.00 |

## Questions that did not pass (21)

- b001 (miss): How many people in India die every year because of outdoor air pollution? | want who_gho:gho:AIR_41 | got who_gho:gho:AIR_50, who_gho:gho:AIR_51, who_gho:gho:AIR_52, who_gho:gho:AIR_5, who_gho:gho:AIR_42
- b006 (miss): mortality rate of teenagers aged 10 to 19 in India | want who_gho:gho:CHILDMORT10TO19 | got who_gho:gho:asfr1, who_gho:gho:CHILDMORT_MORTALITY_10TO14, who_gho:gho:CHILDMORT5TO14, who_gho:gho:DEATHADO, who_gho:gho:FOODBORNE_DTH_100K_GE5
- b018 (miss): How many MRI machines does South Africa have per million people? | want who_gho:gho:DEVICES08 | got who_gho:gho:EQ_CONDOMUSE, who_gho:gho:E23_vending_machines, who_gho:gho:E21_vending_machines, who_gho:gho:ASSISTIVETECH_Q02, who_gho:gho:GDO_q10x2_HOSUE
- b027 (miss): death rate of 10 to 19 year olds in Brazil | want who_gho:gho:CHILDMORT10TO19 | got who_gho:gho:DEATHADO, who_gho:gho:CHILDMORT5TO14, cdc_data:9bhg-hcku, cdc_data:nr4s-juj3, cdc_data:hk9y-quqm
- b043 (miss): How many French deaths can be blamed on drinking? | want owid:grapher:alcohol-attributable-fraction-of-mortality | got owid:grapher:deaths-from-drowning-ghe, owid:grapher:deaths-from-snakebite-envenoming, open_canada:ce99c2c9-c224-43eb-aef0-1f379b70c91d, eurostat:HLTH_EHIS_FV5E, who_gho:gho:FOODBORNE_DTH
- b062 (miss): share of farmland that is irrigated in India | want worldbank:WDI:AG.LND.IRIG.AG.ZS | got ilostat:DF_CLD_XCHL_SEX_AGE_RT, ilostat:DF_CLD_XCHL_SEX_AGE_STU_RT, ilostat:DF_CLD_XGPB_SEX_AGE_RT, ilostat:DF_CLD_XCHL_SEX_AGE_GEO_RT, ilostat:DF_CLD_XGPB_SEX_AGE_GEO_RT
- b078 (miss): What share of Brazilians live in extreme poverty? | want unsdg:DF_SDG_GLH:SI_POV_DAY1 | got ilostat:DF_CLD_XCHL_SEX_AGE_RT, ilostat:DF_CLD_XCHL_SEX_AGE_STU_RT, ilostat:DF_CLD_XGPB_SEX_AGE_RT, ilostat:DF_CLD_XCHL_SEX_AGE_GEO_RT, ilostat:DF_CLD_XGPB_SEX_AGE_GEO_RT
- b081 (miss): How many people in Nigeria live below the poverty line? | want unsdg:DF_SDG_GLH:SI_POV_DAY1 | got who_gho:gho:FINPROTECTION_IMP_NP190_POP, who_gho:gho:FINPROTECTION_IMP_NP_190_LEVEL_SH, who_gho:gho:FINPROTECTION_IMP_NP_190_LEVEL_MILLION, who_gho:gho:FINPROTECTION_IMP_NP_310_LEVEL_MILLION, who_gho:gho:FINPROTECTION_IMP_NP_215_LEVEL_SH
- b090 (miss): How much private debt do companies and households owe in the United States? | want bis:WS_TC:P | got worldbank:WDI:DT.NFL.DPNG.CD, worldbank:WDI:DT.DOD.DPNG.CD, ilostat:DF_CCF_XPPP_CUR_RT, bis:WS_DSR, who_gho:gho:FINPROTECTION_IMP_BNLFHU_FURIMP_HH
- b095 (miss): What was inflation in France in early 2024? | want ecb:ICP:000000.ANR | got who_gho:gho:ebreast5, who_gho:gho:ebreast, imf:CPI:CPI._T.IX, imf:CPI:CPI._T.YOY_PCH_PA_PT, oecd:DSD_PRICES@DF_PRICES_ALL:CPI.GY
- b103 (miss): total net electricity generation in Alabama | want eia:electricity_generation:generation_ALL | got worldbank:WDI:DC.ODA.TLDC.CD, worldbank:WDI:DC.ODA.TLDC.GN.ZS, worldbank:WDI:DT.NFL.ILOG.CD, worldbank:WDI:DT.NFL.FAOG.CD, worldbank:WDI:DT.NFL.IAEA.CD
- b105 (miss): How much of Alabama's electricity comes from gas-fired plants? | want eia:electricity_generation:generation_NG | got who_gho:gho:EMFPOWERFREQUENCY, who_gho:gho:EMFLIMITPOWERDENSITY, who_gho:gho:EMFLIMITPOWERDENSITY1800, who_gho:gho:EMFLIMITPOWERDENSITY900, unsdg:DF_UNDATA_ENERGY
- b107 (miss): natural gas electricity output Alabama January | want eia:electricity_generation:generation_NG | got imf:QGDP_WCA, worldbank:WDI:BG.GSR.NFSV.GD.ZS, who_gho:gho:EMFPOWERFREQUENCY, who_gho:gho:EMFLIMITPOWERDENSITY, who_gho:gho:EMFLIMITPOWERDENSITY1800
- b123 (miss): How much does the typical household in Alabama earn? | want census:acs5:B19013_001E | got who_gho:gho:Camp_news, who_gho:gho:AIR_11, who_gho:gho:AIR_15, who_gho:gho:AIR_60, who_gho:gho:AIR_13
- b125 (miss): How fast has Alabama's population grown since 2010? | want census:popest:POP | got datacommons:stat_vars:Count_Person, census:acs5:B01003_001E, who_gho:gho:FINPROTECTION_IMP_NP190_POP, who_gho:gho:FINPROTECTION_IMP_NP_190_LEVEL_SH, who_gho:gho:FINPROTECTION_IMP_NP_190_LEVEL_MILLION
- b134 (miss): quarterly GDP in billions of dollars, United States | want fred:series:GDP | got imf:QGDP_WCA, bea:nipa:T10105_A191RC, bea:regional, census:acs5:B19013_001E, unsdg:NASEC_IDCFINA_Q
- b141 (miss): National income and product accounts GDP fourth quarter 2023 | want bea:nipa:T10105_A191RC | got worldbank:WDI:BN.CAB.XOKA.GD.ZS, worldbank:WDI:BG.GSR.NFSV.GD.ZS, worldbank:WDI:BM.GSR.TOTL.CD, worldbank:WDI:BX.GSR.TOTL.CD, worldbank:WDI:DT.DOD.DECT.GN.ZS
- b145 (miss): How much more expensive is everything in America than a year ago? | want bls:CU:CUSR0000SA0, bls:CU:CUUR0000SA0 | got worldbank:WDI:DT.DOD.DLXF.CD, worldbank:WDI:DT.DOD.MIBR.CD, owid:grapher:alcohol-attributable-fraction-of-mortality, worldbank:WDI:DT.NFL.BOND.CD, worldbank:WDI:BN.KLT.DINV.CD
- b146 (miss): cost of living index December 2024 United States | want bls:CU:CUSR0000SA0, bls:CU:CUUR0000SA0 | got fred:series:CPIAUCSL, imf:CPI:CPI._T.IX, imf:CPI:CPI._T.YOY_PCH_PA_PT, oecd:DSD_PRICES@DF_PRICES_ALL:CPI.GY, ecb:ICP:000000.INX
- b153 (miss): French jobless rate 2023 | want eurostat:une_rt_a:PC_ACT | got ilostat:DF_UNE_DEAP_SEX_AGE_RT:UNE_DEAP_RT, unsdg:DF_SDG_GLH:SL_TLF_UEM, open_canada:933c7f9d-deb0-4367-940d-06c38f494153
- b167 (miss): How fast did prices rise in Brazil in 2023? | want imf:CPI:CPI._T.YOY_PCH_PA_PT | got dbnomics:BIS_WS_LONG_CPI, ecb:ICP:000000.INX, ecb:ICP:000000.ANR, bis:WS_CPP, dbnomics:BIS_WS_CPP
