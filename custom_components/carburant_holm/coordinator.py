"""Coordinateur : récupère les stations de la zone, calcule meilleurs prix et historique."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from statistics import mean
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import FuelApi, FuelApiError, haversine, parse_station
from .osm import async_get_osm
from .const import (
    CONF_FAVORITES,
    CONF_FUELS,
    CONF_LATITUDE,
    CONF_LONGITUDE,
    CONF_MAX_AGE,
    CONF_RADIUS,
    CONF_SCAN_INTERVAL,
    CONF_TRACKER,
    CONF_ZONE_NAME,
    DEFAULT_FUELS,
    DEFAULT_MAX_AGE,
    DEFAULT_RADIUS,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    FUELS,
    HISTORY_DAYS,
    MOBILE_MIN_INTERVAL,
    MOBILE_MIN_MOVE_KM,
    TOP_COUNT,
)

_LOGGER = logging.getLogger(__name__)


def tracker_position(hass: HomeAssistant, entity_id: str | None) -> tuple[float, float] | None:
    """Position GPS d'une personne / d'un appareil (ou de la maison s'il y est)."""
    st = hass.states.get(entity_id) if entity_id else None
    if st is None:
        return None
    lat, lon = st.attributes.get("latitude"), st.attributes.get("longitude")
    if lat is not None and lon is not None:
        try:
            return float(lat), float(lon)
        except (TypeError, ValueError):
            pass
    if st.state == "home":
        return float(hass.config.latitude), float(hass.config.longitude)
    return None


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        d = datetime.fromisoformat(value)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt_util.DEFAULT_TIME_ZONE)
    return d


def compute_stats(stations: dict[str, dict], fuels: list[str], max_age_days: int, now: datetime) -> dict[str, dict]:
    """Meilleur prix, moyenne et classement par carburant (fonction pure, testable)."""
    stats: dict[str, dict] = {}
    limit = now - timedelta(days=max_age_days)
    for fuel in fuels:
        rows = []
        for st in stations.values():
            f = st["fuels"].get(fuel)
            if not f or f.get("price") is None:
                continue
            upd = _parse_dt(f.get("updated"))
            if upd is not None and upd < limit:
                continue
            if not st.get("in_zone", True):
                continue
            rows.append((f["price"], st.get("distance") if st.get("distance") is not None else 999, st["id"]))
        rows.sort()
        if not rows:
            stats[fuel] = {"count": 0, "best": None, "average": None, "max": None, "ranking": []}
            continue
        prices = [r[0] for r in rows]
        stats[fuel] = {
            "count": len(rows),
            "best": rows[0][2],
            "best_price": rows[0][0],
            "average": round(mean(prices), 3),
            "max": max(prices),
            "ranking": [r[2] for r in rows],
        }
    return stats


class FuelCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Gestion des données d'une zone."""

    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        opts = {**entry.data, **entry.options}
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{DOMAIN}_{entry.entry_id}",
            update_interval=timedelta(minutes=int(opts.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL))),
        )
        self.api = FuelApi(async_get_clientsession(hass))
        self.zone_name: str = opts.get(CONF_ZONE_NAME) or entry.title
        self.lat = float(opts.get(CONF_LATITUDE, hass.config.latitude))
        self.lon = float(opts.get(CONF_LONGITUDE, hass.config.longitude))
        self.radius = float(opts.get(CONF_RADIUS, DEFAULT_RADIUS))
        self.fuels: list[str] = [f for f in opts.get(CONF_FUELS, DEFAULT_FUELS) if f in FUELS]
        self.favorites: list[str] = [str(s) for s in opts.get(CONF_FAVORITES, [])]
        self.max_age = int(opts.get(CONF_MAX_AGE, DEFAULT_MAX_AGE))
        self.tracker: str | None = opts.get(CONF_TRACKER) or None
        self._last_move_refresh = 0.0
        self.history: dict[str, Any] = {"zone": {}, "stations": {}}
        self._store: Store = Store(hass, 1, f"{DOMAIN}.{entry.entry_id}.history")

    async def _async_setup(self) -> None:
        self.osm = await async_get_osm(self.hass)
        stored = await self._store.async_load()
        if isinstance(stored, dict):
            self.history = {"zone": stored.get("zone", {}), "stations": stored.get("stations", {})}

    @property
    def mobile(self) -> bool:
        return bool(self.tracker)

    @callback
    def async_start_tracking(self) -> CALLBACK_TYPE | None:
        """Zone mobile : recharge les stations quand la personne s'est déplacée."""
        if not self.tracker:
            return None

        @callback
        def _moved(event: Event[EventStateChangedData]) -> None:
            pos = tracker_position(self.hass, self.tracker)
            if pos is None:
                return
            moved = haversine(self.lat, self.lon, pos[0], pos[1])
            now = dt_util.utcnow().timestamp()
            if moved >= max(MOBILE_MIN_MOVE_KM, self.radius / 3) and now - self._last_move_refresh >= MOBILE_MIN_INTERVAL:
                self._last_move_refresh = now
                self.hass.async_create_task(self.async_request_refresh())

        return async_track_state_change_event(self.hass, [self.tracker], _moved)

    async def _async_update_data(self) -> dict[str, Any]:
        if self.tracker:
            pos = tracker_position(self.hass, self.tracker)
            if pos is not None:
                self.lat, self.lon = pos
        center = (self.lat, self.lon)
        try:
            raw = await self.api.stations_in_zone(self.lat, self.lon, self.radius)
            in_zone = {str(r.get("id")) for r in raw}
            missing = [s for s in self.favorites if s not in in_zone]
            extra = await self.api.stations_by_ids(missing) if missing else []
        except FuelApiError as err:
            raise UpdateFailed(f"API prix carburants indisponible : {err}") from err

        infos = await self.osm.async_infos_quick(raw + extra, [(self.lat, self.lon, self.radius)], wait=20)
        stations: dict[str, dict] = {}
        for rec in raw + extra:
            st = parse_station(rec, infos, center)
            if not st:
                continue
            st["in_zone"] = st["id"] in in_zone
            st["favorite"] = st["id"] in self.favorites
            stations[st["id"]] = st

        now = dt_util.now()
        stats = compute_stats(stations, self.fuels, self.max_age, now)
        self._record_history(stations, stats, now)
        for fuel, s in stats.items():
            s["trend_7d"] = self._trend(fuel, 7)
            s["trend_1d"] = self._trend(fuel, 1)
            for rank, sid in enumerate(s["ranking"], start=1):
                stations[sid]["fuels"][fuel]["rank"] = rank
        return {"stations": stations, "stats": stats, "updated": now.isoformat(), "center": [self.lat, self.lon]}

    # ---------- historique ----------
    def _record_history(self, stations: dict, stats: dict, now: datetime) -> None:
        day = now.date().isoformat()
        zone = self.history.setdefault("zone", {})
        for fuel, s in stats.items():
            if not s.get("count") or self.mobile:
                continue
            zone.setdefault(fuel, {})[day] = {"min": s["best_price"], "avg": s["average"]}
        st_hist = self.history.setdefault("stations", {})
        # prix de chaque station suivie : toutes celles de la zone (zone fixe) et les favorites
        tracked = list(self.favorites) if self.mobile else list(stations)
        for sid in tracked:
            st = stations.get(sid)
            if not st:
                continue
            for fuel in self.fuels:
                f = st["fuels"].get(fuel)
                if f and f.get("price") is not None:
                    st_hist.setdefault(sid, {}).setdefault(fuel, {})[day] = f["price"]
        cutoff = (now.date() - timedelta(days=HISTORY_DAYS)).isoformat()
        for series in list(zone.values()) + [v for s in st_hist.values() for v in s.values()]:
            for d in [d for d in series if d < cutoff]:
                series.pop(d, None)
        for sid in list(st_hist):   # stations disparues : on ne garde pas de séries vides
            st_hist[sid] = {f: v for f, v in st_hist[sid].items() if v}
            if not st_hist[sid]:
                st_hist.pop(sid)
        self._store.async_delay_save(lambda: self.history, 30)

    def _trend(self, fuel: str, days: int) -> float | None:
        series = self.history.get("zone", {}).get(fuel) or {}
        if not series:
            return None
        today = max(series)
        target = (date.fromisoformat(today) - timedelta(days=days)).isoformat()
        past = [d for d in series if d <= target]
        if not past:
            return None
        return round(series[today]["min"] - series[max(past)]["min"], 3)

    def zone_history(self, fuel: str, days: int = 60) -> list[dict]:
        series = self.history.get("zone", {}).get(fuel) or {}
        return [{"date": d, **series[d]} for d in sorted(series)[-days:]]

    def station_history(self, sid: str, fuel: str, days: int = 60) -> list[dict]:
        series = self.history.get("stations", {}).get(sid, {}).get(fuel) or {}
        return [{"date": d, "price": series[d]} for d in sorted(series)[-days:]]

    def top(self, fuel: str, n: int = TOP_COUNT) -> list[dict]:
        s = (self.data or {}).get("stats", {}).get(fuel) or {}
        out = []
        for sid in s.get("ranking", [])[:n]:
            st = self.data["stations"][sid]
            f = st["fuels"][fuel]
            out.append({"id": sid, "name": st["name"], "brand": st["brand"], "city": st["city"], "price": f["price"], "distance": st["distance"], "updated": f.get("updated")})
        return out
