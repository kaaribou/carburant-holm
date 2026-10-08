"""Carburant HOLM : prix des carburants autour de chez vous (données data.economie.gouv.fr)."""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, Platform
from homeassistant.core import CoreState, HomeAssistant, callback
from homeassistant.helpers.event import async_call_later

from .const import CARD_FILENAME, CARD_URL_PATH, DOMAIN, FUELS, VERSION
from .coordinator import FuelCoordinator

_LOGGER = logging.getLogger(__name__)
PLATFORMS = [Platform.SENSOR, Platform.BUTTON]
_CARD_KEY = f"{DOMAIN}_card"
_WS_KEY = f"{DOMAIN}_ws"

FuelConfigEntry = ConfigEntry


async def async_setup_entry(hass: HomeAssistant, entry: FuelConfigEntry) -> bool:
    coordinator = FuelCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    _register_ws(hass)

    async def _frontend(_event=None) -> None:
        await _register_card(hass)

    if hass.state == CoreState.running:
        await _frontend()
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _frontend)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    unsub = coordinator.async_start_tracking()
    if unsub:
        entry.async_on_unload(unsub)
    entry.async_on_unload(entry.add_update_listener(_update_listener))
    return True


async def _update_listener(hass: HomeAssistant, entry: FuelConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: FuelConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


# ------------------------------------------------------------------ carte
def _card_digest() -> str:
    try:
        return hashlib.sha1((Path(__file__).parent / "www" / CARD_FILENAME).read_bytes()).hexdigest()[:8]
    except OSError:
        return "0"


async def _register_card(hass: HomeAssistant, _now=None) -> None:
    if not hass.data.get(_CARD_KEY):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(CARD_URL_PATH, str(Path(__file__).parent / "www" / CARD_FILENAME), cache_headers=True)]
        )
        hass.data[_CARD_KEY] = True
    lovelace = hass.data.get("lovelace")
    resources = getattr(lovelace, "resources", None)
    if resources is None:
        async def _retry(_now) -> None:
            await _register_card(hass)

        async_call_later(hass, 5, _retry)
        return
    # version + empreinte du fichier : toute modification de la carte change l'URL,
    # ce qui force les navigateurs à recharger (le fichier est servi avec un long cache)
    digest = await hass.async_add_executor_job(_card_digest)
    url = f"{CARD_URL_PATH}?v={VERSION}-{digest}"
    if not hasattr(resources, "async_create_item"):
        add_extra_js_url(hass, url)
        return
    try:
        if not getattr(resources, "loaded", False):
            await resources.async_load()
        existing = next((i for i in resources.async_items() if str(i.get("url", "")).split("?", 1)[0] == CARD_URL_PATH), None)
        if existing is None:
            await resources.async_create_item({"res_type": "module", "url": url})
        elif existing.get("url") != url:
            await resources.async_update_item(existing["id"], {"url": url})
    except Exception:  # noqa: BLE001
        _LOGGER.warning("Impossible d'enregistrer la ressource Lovelace, repli sur add_extra_js_url", exc_info=True)
        add_extra_js_url(hass, url)


# ------------------------------------------------------------------ websocket
@callback
def _register_ws(hass: HomeAssistant) -> None:
    if hass.data.get(_WS_KEY):
        return
    websocket_api.async_register_command(hass, ws_data)
    hass.data[_WS_KEY] = True


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/data",
    vol.Optional("entry_id"): str,
    vol.Optional("history_days", default=60): int,
})
@callback
def ws_data(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Toutes les données des zones, pour la carte holm-fuel-card."""
    out = []
    for entry in hass.config_entries.async_loaded_entries(DOMAIN):
        if msg.get("entry_id") and entry.entry_id != msg["entry_id"]:
            continue
        coord: FuelCoordinator = entry.runtime_data
        data = coord.data or {}
        days = msg["history_days"]
        out.append({
            "entry_id": entry.entry_id,
            "title": entry.title,
            "zone": coord.zone_name,
            "center": [coord.lat, coord.lon],
            "mobile": coord.mobile,
            "tracker": coord.tracker,
            "tracker_name": (hass.states.get(coord.tracker).name if coord.tracker and hass.states.get(coord.tracker) else None),
            "radius": coord.radius,
            "fuels": [{"key": f, "label": FUELS[f]} for f in coord.fuels],
            "favorites": coord.favorites,
            "max_age_days": coord.max_age,
            "updated": data.get("updated"),
            "stations": list((data.get("stations") or {}).values()),
            "stats": data.get("stats") or {},
            "history": {f: coord.zone_history(f, days) for f in coord.fuels},
            "favorites_history": {sid: {f: coord.station_history(sid, f, days) for f in coord.fuels} for sid in coord.favorites},
            "stations_history": {
                sid: {f: coord.station_history(sid, f, days) for f in coord.fuels if coord.history["stations"].get(sid, {}).get(f)}
                for sid in (data.get("stations") or {}) if coord.history.get("stations", {}).get(sid)
            },
        })
    connection.send_result(msg["id"], {"version": VERSION, "zones": out})
