"""Déclaration de la carte : plusieurs zones qui démarrent en même temps (#11)."""
import asyncio
from types import SimpleNamespace

from homeassistant.core import HomeAssistant

from custom_components.carburant_holm import _register_card
from custom_components.carburant_holm.const import CARD_URL_PATH


class FakeResources:
    loaded = True

    def __init__(self):
        self.items = []

    def async_items(self):
        return self.items

    async def async_create_item(self, data):
        await asyncio.sleep(0)
        self.items.append({"id": str(len(self.items)), **data})

    async def async_update_item(self, item_id, data):
        next(i for i in self.items if i["id"] == item_id).update(data)


async def test_register_card_concurrent(hass: HomeAssistant) -> None:
    res = FakeResources()
    hass.data["lovelace"] = SimpleNamespace(resources=res)
    calls = []
    real = hass.http.async_register_static_paths if hass.http else None

    async def fake_register(configs):
        calls.append([c.url_path for c in configs])
        await asyncio.sleep(0.01)   # comme le vrai : passe par un exécuteur
        if len(calls) > 1:
            raise RuntimeError("Added route will never be executed, method GET is already registered")

    hass.http = SimpleNamespace(async_register_static_paths=fake_register)
    await asyncio.gather(_register_card(hass), _register_card(hass), _register_card(hass))
    assert calls == [[CARD_URL_PATH]]
    assert len(res.items) == 1 and res.items[0]["url"].startswith(CARD_URL_PATH + "?v=1.5.2-")


async def test_register_card_already_registered_is_ignored(hass: HomeAssistant) -> None:
    hass.data["lovelace"] = SimpleNamespace(resources=FakeResources())

    async def boom(configs):
        raise RuntimeError("Added route will never be executed, method GET is already registered")

    hass.http = SimpleNamespace(async_register_static_paths=boom)
    await _register_card(hass)   # pas d'exception
    assert len(hass.data["lovelace"].resources.items) == 1
