# Changelog

## 1.5.0
- **Valeurs sur la courbe de tendance** ([#9](https://github.com/kaaribou/carburant-holm/issues/9)) : prix le plus haut et le plus bas de la période sur l'axe (avec des lignes de repère), meilleur prix et moyenne du jour au bout des courbes, et bulle avec la date, le meilleur prix et la moyenne d'un jour en passant la souris ou en touchant la courbe.
- **Courbe par station** : la fiche dépliée d'une station affiche la courbe de son prix pour le carburant choisi, avec la moyenne de la zone en pointillés pour comparer, les mêmes valeurs et le détail d'un jour au survol.
- L'historique des prix est maintenant enregistré pour **toutes les stations de la zone** (avant : seulement les favorites). Il est fourni à la carte dans `stations_history`. Pour une zone mobile, seules les favorites restent suivies.
- Nouvelle option de carte **Valeurs sur la courbe** (`chart_values`, activée par défaut) pour revenir à la courbe seule.

## 1.4.0
- **Favorites hors zone** : dans l'étape des favorites, une recherche par commune ou code postal ajoute n'importe quelle station de France à la liste (marquée « hors zone ») ([#1](https://github.com/kaaribou/carburant-holm/issues/1)).
- **Plusieurs zones dans une même carte** (`entry_ids`) : stations réunies, classement, meilleur prix et tendance calculés sur l'ensemble ; le bouton ↻ actualise toutes les zones ([#1](https://github.com/kaaribou/carburant-holm/issues/1)).
- **Clic sur une station** (`station_click`) : itinéraire, fiche détaillée ou lecture seule (aucun lien), en vue compacte comme en vue complète ([#2](https://github.com/kaaribou/carburant-holm/issues/2)).
- **Zone mobile** : une zone peut suivre une personne ou un téléphone ; les stations proches sont rechargées quand elle se déplace. Pas d'historique ni de courbe pour une zone mobile ([#3](https://github.com/kaaribou/carburant-holm/issues/3)).
- **Stations homonymes** : deux stations au même nom dans la même ville (ex. deux « Super U Poitiers ») affichent leur adresse, dans la carte comme dans l'assistant. C'était l'origine de l'apparente incohérence entre classement et favorites : il s'agissait de deux stations différentes ([#4](https://github.com/kaaribou/carburant-holm/issues/4)).
- Les stations hors zone sont signalées « hors zone » dans la carte.
- **Tri des stations** (`sort`) : classement puis favorites (par défaut), prix le plus bas d'abord (tout mélangé : favorites et hors zone compris), distance, mise à jour la plus récente ou nom. En vue compacte, les en-têtes *Station* / *Prix* / *MàJ* trient aussi d'un clic.
- Assistant : les stations trouvées par la recherche hors zone s'affichent en cases à cocher (une seule station trouvée = déjà cochée).

## 1.3.5
- **Mise à jour de la carte toujours prise en compte** : l'adresse de la ressource Lovelace dépendait d'un numéro de version qui pouvait rester en retard (1.3.3 alors que la 1.3.4 était installée), et un navigateur pouvait continuer d'afficher l'ancienne carte depuis son cache. Elle contient maintenant la version de l'intégration et une empreinte du fichier de la carte : toute nouvelle carte change l'adresse et force le rechargement.

## 1.3.4
- **Carte : thèmes clairs pris en charge.** Le texte ne s'affiche plus en noir sur le fond sombre de la carte avec un thème clair (Google, thème par défaut…).
- Nouvelle option **Apparence** (`theme`) : Automatique (suit le mode clair / sombre, par défaut), Sombre, Clair, ou Couleurs de mon thème Home Assistant.

## 1.3.3
- **Assistant de configuration plus robuste** : la liste des stations ne dépend plus de la vitesse d'OpenStreetMap. Si OSM est lent ou indisponible, l'assistant continue aussitôt (noms récupérés en arrière-plan) au lieu de tourner puis d'échouer sur « Erreur inconnue » (notamment derrière un proxy qui coupe au bout de 60 s).
- Délais réseau réduits dans l'assistant ; toute erreur inattendue affiche un message clair au lieu d'une erreur inconnue.
- La mise à jour des prix n'attend plus OpenStreetMap plus de 20 s.

## 1.3.2
- Validation HACS complète (plus aucune vérification désactivée), préparation à l'inscription dans la liste officielle HACS.

## 1.3.1
- Icône de l'intégration fournie avec l'intégration (dossier `brand`), affichée par Home Assistant 2026.3 et plus.

## 1.3.0
- **Intégration autonome** : noms, enseignes et logos des stations issus d'OpenStreetMap et de Wikidata / Wikimedia Commons (mis en cache), plus aucune dépendance à une autre intégration.
- Attribution des sources sur les capteurs.

## 1.2.0
- Noms et enseignes des stations téléchargés depuis la liste communautaire et mis en cache chaque semaine (plus besoin du fichier local).
- Publication sur GitHub, compatible HACS (mises à jour depuis Home Assistant).
- Documentation complète.

## 1.1.1
- Carte : bouton d'actualisation dans la vue compacte.

## 1.1.0
- Carte : nouvelle **vue compacte** (tableau des stations, J+n, pastilles moins cher / plus cher, option « uniquement mes favorites »).
- Actualisation réglable jusqu'à 24 h.

## 1.0.0
- Première version : zones autour d'une ville (carte + rayon), favorites, meilleur prix / moyenne / top 5 par carburant, historique 120 jours et tendances, carte `holm-fuel-card` enregistrée automatiquement.
