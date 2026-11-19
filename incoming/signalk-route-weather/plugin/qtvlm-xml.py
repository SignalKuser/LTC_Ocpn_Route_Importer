"""Read the KML and XML variants of qtVlm's Data Exchanger."""

import base64
import json
import sys
import xml.etree.ElementTree as ET


def text(node, tag, default=""):
    result = node.findtext(tag)
    return default if result is None else result.strip()


def route_points(document):
    if document.tag != "{http://www.opengis.net/kml/2.2}kml":
        raise ValueError("Expected a KML route")
    route = document.find("{*}Document")
    if route is None:
        raise ValueError("Missing KML document")
    points = []
    for index, mark in enumerate(route.findall("{*}Placemark")):
        coordinate = mark.find("./{*}Point/{*}coordinates")
        if coordinate is None:
            continue
        longitude, latitude, *_ = coordinate.text.strip().split(",")
        sequence = text(mark, "./{*}ExtendedData/{*}sequence", str(index))
        points.append((int(sequence), {"name": text(mark, "{*}name"), "position": [float(longitude), float(latitude)]}))
    points.sort(key=lambda point: point[0])
    return {"name": text(route, "{*}name"), "points": [point for _, point in points]}


def waypoint(node, archive):
    if archive:
        return {
            "name": text(node, "Name"),
            "position": [float(text(node, "Longitude")), float(text(node, "Latitude"))],
            "description": text(node, "Comment"),
            "symbol": text(node, "GpxSym"),
        }
    return {
        "name": base64.b64decode(text(node, "name"), validate=True).decode("utf-8"),
        "position": [float(text(node, "Lon")), float(text(node, "Lat"))],
        "arrivalRadius": float(text(node, "arrivalRadius", "0")),
        "description": text(node, "comment"),
        "symbol": text(node, "gpxsym"),
    }


def main():
    kind = sys.argv[1]
    raw = sys.stdin.buffer.read()
    if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw or b"\x00" in raw:
        raise ValueError("Unsupported XML declaration")
    document = ET.fromstring(raw)
    if kind == "ROUTE":
        result = route_points(document)
    elif kind == "ARCHIVE" and document.tag == "Archive":
        result = {"name": text(document, "Name"), "points": [waypoint(node, True) for node in document.findall("Poi")]}
    elif kind == "POI" and document.tag == "qtVLM_config":
        result = {"points": [waypoint(node, False) for node in document.findall("./POIs/POI")]}
    else:
        raise ValueError("Unexpected XML document")
    print(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (ET.ParseError, ValueError, AttributeError, TypeError) as error:
        sys.exit(str(error))
