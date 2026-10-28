"""Constantes de l'intégration Carburant HOLM."""
from __future__ import annotations

from typing import Final

DOMAIN: Final = "carburant_holm"
VERSION: Final = "1.5.2"

API_URL: Final = (
    "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "prix-des-carburants-en-france-flux-instantane-v2/records"
)
GEO_API_URL: Final = "https://geo.api.gouv.fr/communes"

ATTRIBUTION: Final = "Prix : data.economie.gouv.fr · Stations : © contributeurs OpenStreetMap"

# clé API -> libellé
FUELS: Final = {
    "gazole": "Gazole",
    "e10": "E10",
    "sp98": "SP98",
    "sp95": "SP95",
    "e85": "E85",
    "gplc": "GPLc",
}
DEFAULT_FUELS: Final = ["gazole", "e10", "sp98", "e85"]

CONF_ZONE_NAME: Final = "zone_name"
CONF_LOCATION: Final = "location"
CONF_LATITUDE: Final = "latitude"
CONF_LONGITUDE: Final = "longitude"
CONF_RADIUS: Final = "radius_km"
CONF_FUELS: Final = "fuels"
CONF_FAVORITES: Final = "favorites"
CONF_SCAN_INTERVAL: Final = "scan_interval"
CONF_MAX_AGE: Final = "max_age_days"
CONF_CITY: Final = "city"
CONF_TRACKER: Final = "tracker"  # zone mobile : suit une personne / un appareil
CONF_SEARCH: Final = "search"

DEFAULT_RADIUS: Final = 10
DEFAULT_SCAN_INTERVAL: Final = 30  # minutes
DEFAULT_MAX_AGE: Final = 7  # jours : au-delà, un prix n'est plus pris en compte pour le « meilleur prix »
MAX_ZONE_STATIONS: Final = 400
HISTORY_DAYS: Final = 120
TOP_COUNT: Final = 5
MOBILE_MIN_MOVE_KM: Final = 1.0     # déplacement minimal avant de recharger une zone mobile
MOBILE_MIN_INTERVAL: Final = 120    # secondes entre deux rechargements dus au déplacement

CARD_FILENAME: Final = "holm-fuel-card.js"
CARD_URL_PATH: Final = f"/{DOMAIN}/{CARD_FILENAME}"
