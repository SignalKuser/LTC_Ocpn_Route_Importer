import json
import math
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

from osgeo import gdal, osr


def read_point(file, longitude, latitude):
    dataset = gdal.Open(str(file))
    if dataset.RasterCount == 0:
        candidates = []
        for name, _ in dataset.GetSubDatasets():
            candidate = gdal.Open(name)
            if candidate.RasterCount == 1 and candidate.GetSpatialRef() is not None:
                candidates.append(candidate)
        if len(candidates) != 1:
            raise ValueError(f"Cannot identify the UKV forecast field in {file.name}")
        dataset = candidates[0]
    target = dataset.GetSpatialRef()
    transform = dataset.GetGeoTransform(can_return_null=True)
    if target is None or transform is None:
        raise ValueError(f"Missing UKV map projection in {file.name}")
    wgs84 = osr.SpatialReference()
    wgs84.ImportFromEPSG(4326)
    wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    x, y, _ = osr.CoordinateTransformation(wgs84, target).TransformPoint(longitude, latitude)
    column, row = gdal.ApplyGeoTransform(gdal.InvGeoTransform(transform), x, y)
    if not (0 <= column < dataset.RasterXSize and 0 <= row < dataset.RasterYSize):
        return None, ""
    band = dataset.GetRasterBand(1)
    value = float(band.ReadAsArray(int(column), int(row), 1, 1)[0, 0])
    if value == band.GetNoDataValue() or not math.isfinite(value):
        return None, ""
    scale = band.GetScale()
    offset = band.GetOffset()
    return value * (1 if scale is None else scale) + (0 if offset is None else offset), band.GetUnitType()


def forecasts(directory, latitude, longitude, now):
    groups = {}
    pattern = re.compile(r"ukv-(\d{8}T\d{4}Z)-PT(\d{4})H00M-(\w+)\.nc")
    for file in Path(directory).glob("ukv-*.nc"):
        match = pattern.fullmatch(file.name)
        if match is None:
            continue
        stamp, step, field = match.groups()
        valid = datetime.strptime(stamp, "%Y%m%dT%H%M%z")
        cycle = valid - timedelta(hours=int(step))
        if valid >= now - timedelta(hours=3):
            groups.setdefault(cycle, {}).setdefault(valid, {})[field] = file

    for cycle in sorted(groups, reverse=True):
        records = []
        for valid, files in sorted(groups[cycle].items()):
            speed_file = files.get("wind_speed_at_10m")
            direction_file = files.get("wind_direction_at_10m")
            if speed_file is None or direction_file is None:
                continue
            speed, _ = read_point(speed_file, longitude, latitude)
            direction, direction_unit = read_point(direction_file, longitude, latitude)
            if speed is None or direction is None:
                continue
            wind = {"speed": speed, "directionTrue": direction if direction_unit.startswith("rad") else math.radians(direction % 360)}
            outside = {}
            for field, key, object_values in [
                ("wind_gust_at_10m", "gust", wind),
                ("temperature_at_screen_level", "temperature", outside),
                ("pressure_at_mean_sea_level", "pressure", outside),
            ]:
                if field in files:
                    value, unit = read_point(files[field], longitude, latitude)
                    if value is not None:
                        if key == "temperature" and unit.lower() in ("c", "degc", "celsius", "degrees_celsius"):
                            value += 273.15
                        if key == "pressure" and unit.lower() in ("hpa", "mbar"):
                            value *= 100
                        object_values[key] = value
            records.append({"date": valid.isoformat(), "wind": wind, "outside": outside, "source": "Met Office UKV"})
        if records:
            return records
    return []


if __name__ == "__main__":
    gdal.UseExceptions()
    if sys.argv[1:] != ["--check"]:
        directory, latitude, longitude, now = sys.argv[1:]
        print(json.dumps(forecasts(directory, float(latitude), float(longitude), datetime.fromisoformat(now.replace("Z", "+00:00")))))
