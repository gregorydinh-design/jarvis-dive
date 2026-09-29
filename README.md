# JARVIS DIVE

PWA de planification de plongée technique, hors ligne, pour iPhone.

- **Moteur** : Bühlmann ZHL-16C + Gradient Factors, JavaScript pur (`engine/`). Tous les calculs de décompression sont faits ici, jamais par le LLM.
- **Gaz** : OC multi-gaz avec switch libre (chaque gaz de déco est pris à la profondeur que vous choisissez).
- **Blocs** : volume et pression de départ par gaz (200 bar par défaut), pression restante affichée sur chaque gaz, alerte rouge sous 50 bar (réglable).
- **Gaz minimum** : gaz nécessaire pour remonter à 2 plongeurs, SAC fond × 2, 1 min de résolution au fond, jusqu'au premier switch.
- **Plans de secours** : +5 min, +3 m, +3 m +5 min, et perte de chaque gaz de déco.
- **Plongée successive** : la plongée en cours devient la n°1 ; tissus, CNS (demi-vie 90 min) et OTU sont reportés après l'intervalle de surface.
- **Langues** : français / anglais (bouton FR | EN, langue du téléphone par défaut).
- **Hors ligne** : service worker, installable depuis Safari (Partager → Sur l'écran d'accueil).

> ⚠️ Outil d'aide à la planification en cours de validation. Il ne remplace ni la formation, ni l'ordinateur de plongée, ni le jugement du plongeur. Vérifiez chaque plan avec un second outil (Subsurface, MultiDeco…).

## Conventions du moteur

| Réglage | Défaut |
|---|---|
| Profil par défaut | Air (EAN21), 40 m, 20 min, GF 85/85 |
| Temps fond | inclut la descente |
| Descente / remontée | 18 / 9 m/min |
| Paliers | pas de 3 m, dernier palier 3 m (option 6 m), durées entières |
| GF | GF bas ancré au premier palier (Baker), interpolé jusqu'à GF haut en surface |
| Switch de gaz | 1 min minimum au palier de changement |
| Blocs | fond 12 L, déco 7 L, 200 bar ; gaz parfait (pas de correction de compressibilité) |
| Eau | mer, densité 1.03 ; pression surface 1.01325 bar |
| Vapeur d'eau | 0.0627 bar (Bühlmann) |
| ppO2 | 1.4 fond, 1.6 déco, tolérance d'arrondi 0.03 (O2 à 6 m = 1.62 bar en eau de mer) |
| CNS / OTU | tables NOAA / Lambertsen |

## Validation

```
npm test
```

Les tests couvrent la physique tissulaire (Schreiner vs intégration numérique, saturation, demi-périodes), les gaz (MOD, END), la toxicité O2, l'absence de violation de plafond sur chaque plan, et un cas de référence de Subsurface (`tests/testplan.cpp`, `testMetric` : TX15/45, 79 m, 30 min, GF 100/100, EAN36 + O2 → 109 min). Résultat JARVIS DIVE : 109.0 min.

## Structure

```
engine/zhl16c.js   Compartiments, Schreiner, plafonds GF
engine/gases.js    Mélanges, MOD, END, densité
engine/oxygen.js   CNS, OTU
engine/planner.js  Planificateur multi-gaz
engine/errors.js   Codes d'erreur traduisibles
engine/scenarios.js  Plans de secours, perte de gaz, plongées successives
i18n.js            Traductions FR / EN
tests/run.js       Suite de tests (Node 18+)
index.html, app.js, styles.css, sw.js, manifest.json   PWA
```

## Roadmap

- V1 : OC Nitrox + multi-gaz switch libre ← en cours
- V2 : OC Trimix (le moteur gère déjà l'hélium)
- V3 : CCR (setpoint, bailout)
- V4 : Vocal (Web Speech API) + dialogue LLM local
