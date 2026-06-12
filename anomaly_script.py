# -*- coding: utf-8 -*-
"""Master_Script.py

Optimized for local running environments.
"""

import geopandas as gpd
import rioxarray
from shapely.geometry import mapping
from datetime import time
import os
import sys
import xarray as xr

# Define data path: default to 'daily_data' in the current directory or can be configured via env variable
data_path = os.getenv('DAILY_DATA_PATH', './daily_data')

# Helper function to load files with proper time decoding
def load_data(name):
    full_path = os.path.join(data_path, name)
    if os.path.exists(full_path):
        # Ensures 365_day calendars are decoded correctly using cftime
        time_coder = xr.coding.times.CFDatetimeCoder(use_cftime=True)
        return xr.open_dataset(full_path, decode_times=time_coder)
    else:
        print(f"Warning: File not found: {full_path}")
        return None

## IMP: Daily Data
# Can add more files with more variables

# --- Historical (1950-2014) ---
tas_hist = load_data('IITM-ESM_IMD_historical_tas_daily_1950_2014.nc')
pr_hist = load_data('IITM-ESM_IMD_historical_pr_daily_1950_2014.nc')
tasmax_hist = load_data('IITM-ESM_IMD_historical_tasmax_daily_1950_2014.nc')
tasmin_hist = load_data('IITM-ESM_IMD_historical_tasmin_daily_1950_2014.nc')
# ws_hist = load_data('IITM-ESM_IMD_historical_ws_daily_1950_2014.nc')

# --- SSP126 (2015-2099) ---
tas_ssp126 = load_data('IITM-ESM_IMD_ssp126_tas_daily_2015_2099.nc')
pr_ssp126 = load_data('IITM-ESM_IMD_ssp126_pr_daily_2015_2099.nc')
tasmax_ssp126 = load_data('IITM-ESM_IMD_ssp126_tasmax_daily_2015_2099.nc')
tasmin_ssp126 = load_data('IITM-ESM_IMD_ssp126_tasmin_daily_2015_2099.nc')
# ws_ssp126 = load_data('IITM-ESM_IMD_ssp126_ws_daily_2015_2099.nc')

# --- SSP245 (2015-2099) ---
tas_ssp245 = load_data('IITM-ESM_IMD_ssp245_tas_daily_2015_2099.nc')
pr_ssp245 = load_data('IITM-ESM_IMD_ssp245_pr_daily_2015_2099.nc')
tasmax_ssp245 = load_data('IITM-ESM_IMD_ssp245_tasmax_daily_2015_2099.nc')
tasmin_ssp245 = load_data('IITM-ESM_IMD_ssp245_tasmin_daily_2015_2099.nc')
# ws_ssp245 = load_data('IITM-ESM_IMD_ssp245_ws_daily_2015_2099.nc')

# --- SSP370 (2015-2099) ---
tas_ssp370 = load_data('IITM-ESM_IMD_ssp370_tas_daily_2015_2099.nc')
pr_ssp370 = load_data('IITM-ESM_IMD_ssp370_pr_daily_2015_2099.nc')
tasmax_ssp370 = load_data('IITM-ESM_IMD_ssp370_tasmax_daily_2015_2099.nc')
tasmin_ssp370 = load_data('IITM-ESM_IMD_ssp370_tasmin_daily_2015_2099.nc')
# ws_ssp370 = load_data('IITM-ESM_IMD_ssp370_ws_daily_2015_2099.nc')

# --- SSP585 (2015-2099) ---
tas_ssp585 = load_data('IITM-ESM_IMD_ssp585_tas_daily_2015_2099.nc')
pr_ssp585 = load_data('IITM-ESM_IMD_ssp585_pr_daily_2015_2099.nc')
tasmax_ssp585 = load_data('IITM-ESM_IMD_ssp585_tasmax_daily_2015_2099.nc')
tasmin_ssp585 = load_data('IITM-ESM_IMD_ssp585_tasmin_daily_2015_2099.nc')
# ws_ssp585 = load_data('IITM-ESM_IMD_ssp585_ws_daily_2015_2099.nc')

print("Data loaded and grouped by scenario (Historical and SSPs).")

# Variables and scenarios (add more)
base_year = [1985, 2014]
variables = ['tas', 'pr', 'tasmax', 'tasmin', 'ws']
scenarios = ['ssp126', 'ssp245', 'ssp370', 'ssp585']
timeframes = ['Annual', 'MAM', 'JJAS', 'SON', 'DJF']

def calculate_climate_anomalies(data_path, variables, scenarios, base_period):
    """
    Calculates anomalies for SSP scenarios relative to a historical base period
    for both Annual and seasonal (MAM, JJAS, SON, DJF) timeframes.
    """
    anomalies = {}

    # Mapping timeframes to months (1-indexed)
    season_months = {
        'MAM': [3, 4, 5],
        'JJAS': [6, 7, 8, 9],
        'SON': [10, 11, 12],
        'DJF': [12, 1, 2]
    }

    for var in variables:
        hist_file = f'IITM-ESM_IMD_historical_{var}_daily_1950_2014.nc'
        hist_ds = load_data(hist_file)

        if hist_ds is None:
            print(f"Historical file for {var} not found. Skipping.")
            continue

        hist_base = hist_ds.sel(time=slice(str(base_period[0]), str(base_period[1])))

        # Pre-calculate historical means for each timeframe
        hist_means = {}
        # Annual
        hist_means['Annual'] = hist_base[var].groupby('time.year').mean(dim='time').mean(dim='year')
        # Seasonal
        for season, months in season_months.items():
            hist_season = hist_base.sel(time=hist_base.time.dt.month.isin(months))
            hist_means[season] = hist_season[var].groupby('time.year').mean(dim='time').mean(dim='year')

        anomalies[var] = {}

        for sce in scenarios:
            ssp_file = f'IITM-ESM_IMD_{sce}_{var}_daily_2015_2099.nc'
            ssp_ds = load_data(ssp_file)

            if ssp_ds is None:
                continue

            anomalies[var][sce] = {}

            # Calculate Annual Anomaly
            ssp_annual = ssp_ds[var].groupby('time.year').mean(dim='time')
            anomalies[var][sce]['Annual'] = ssp_annual - hist_means['Annual']

            # Calculate Seasonal Anomalies
            for season, months in season_months.items():
                ssp_season_ds = ssp_ds.sel(time=ssp_ds.time.dt.month.isin(months))
                ssp_seasonal_mean = ssp_season_ds[var].groupby('time.year').mean(dim='time')
                anomalies[var][sce][season] = ssp_seasonal_mean - hist_means[season]

            print(f"Calculated Annual & Seasonal anomalies for {var} in {sce}")
            ssp_ds.close()

        hist_ds.close()

    return anomalies

# Run the calculation with updated timeframe support
climate_anomalies = calculate_climate_anomalies(data_path, variables, scenarios, base_year)

# Example access: climate_anomalies['tas']['ssp126']['MAM']

# Local file paths (using the dashboard's JSON directory as default)
state_geojson_path = 'JSONs/state_ultra_optimized.geojson'
district_geojson_path = 'JSONs/districts_ultra_optimized.geojson'

# Fallback check
if not os.path.exists(state_geojson_path):
    state_geojson_path = input("Enter path to STATE GeoJSON file (e.g. JSONs/state_ultra_optimized.geojson): ").strip()
if not os.path.exists(district_geojson_path):
    district_geojson_path = input("Enter path to DISTRICT GeoJSON file (e.g. JSONs/districts_ultra_optimized.geojson): ").strip()

# Load both GeoJSON files to inspect metadata
if os.path.exists(state_geojson_path):
    gdf_state = gpd.read_file(state_geojson_path)
    print("--- State GeoJSON loaded ---")
    print(f"Columns: {gdf_state.columns.tolist()}")
    print(gdf_state.head(2))
else:
    print(f"Error: State GeoJSON file not found at {state_geojson_path}")
    sys.exit(1)

if os.path.exists(district_geojson_path):
    gdf_district = gpd.read_file(district_geojson_path)
    print("\n--- District GeoJSON loaded ---")
    print(f"Columns: {gdf_district.columns.tolist()}")
    print(gdf_district.head(2))
else:
    print(f"Error: District GeoJSON file not found at {district_geojson_path}")
    sys.exit(1)

# Change these
project = 'cmip6'
mode = 'district' #district or state

import pandas as pd
import numpy as np
from shapely.geometry import mapping

def calculate_regional_anomalies(gdf, anomalies_dict, variables, scenarios, timeframes, project_name, region_col):
    all_results = []
    years = None

    # 1. Calculate INDIA average
    india_data = {}
    for var in variables:
        for sce in scenarios:
            for tf in timeframes:
                col_name = f"{project_name}_{var}_{sce}_{tf}"
                if var in anomalies_dict and sce in anomalies_dict[var] and tf in anomalies_dict[var][sce]:
                    da = anomalies_dict[var][sce][tf]
                    weights = np.cos(np.deg2rad(da.lat))
                    spatial_mean = da.weighted(weights).mean(dim=['lat', 'lon']).to_series()
                    india_data[col_name] = spatial_mean.values
                    if years is None: years = spatial_mean.index
                else:
                    india_data[col_name] = np.nan

    india_df = pd.DataFrame(india_data, index=years)
    india_df.insert(0, 'REGION', 'INDIA')
    india_df = india_df.reset_index().rename(columns={'index': 'year'})
    all_results.append(india_df)

    # 2. Iterate through each region in the GDF
    for index, row in gdf.iterrows():
        region_name = row[region_col]
        region_geom = [mapping(row['geometry'])]
        region_data = {}

        for var in variables:
            for sce in scenarios:
                for tf in timeframes:
                    col_name = f"{project_name}_{var}_{sce}_{tf}"
                    if var in anomalies_dict and sce in anomalies_dict[var] and tf in anomalies_dict[var][sce]:
                        da = anomalies_dict[var][sce][tf]
                        if 'rio' not in da.dims:
                            da = da.rio.write_crs("EPSG:4326")
                        try:
                            weights = np.cos(np.deg2rad(da.lat))
                            clipped_da = da.rio.clip(region_geom, gdf.crs, drop=True)
                            clipped_weights = weights.sel(lat=clipped_da.lat)
                            spatial_mean = clipped_da.weighted(clipped_weights).mean(dim=['lat', 'lon']).to_series()
                            region_data[col_name] = spatial_mean.values
                        except Exception:
                            region_data[col_name] = np.nan
                    else:
                        region_data[col_name] = np.nan

        region_df = pd.DataFrame(region_data, index=years)
        region_df.insert(0, 'REGION', region_name)
        region_df = region_df.reset_index().rename(columns={'index': 'year'})
        all_results.append(region_df)

    return pd.concat(all_results, ignore_index=True)

# Dynamic selection based on 'mode'
if mode.lower() == 'district':
    target_gdf = gdf_district
    name_column = 'DISTRICT'
else:
    target_gdf = gdf_state
    name_column = 'STATE_UT'

print(f"Processing anomalies for mode: {mode} using column: {name_column}")

# Run calculation
anomaly_table = calculate_regional_anomalies(target_gdf, climate_anomalies, variables, scenarios, timeframes, project, name_column)

# Save with dynamic filename
output_filename = f'{project}_{mode}_anomalies.csv'
anomaly_table.to_csv(output_filename, index=False)

print(f"\nSuccess! Results saved to {output_filename}")
print(anomaly_table.head())