# JARVIS DIVE

PWA de planification de plongée technique, hors ligne, pour iPhone.

- **Moteur** : Bühlmann ZHL-16C + Gradient Factors, JavaScript pur (`engine/`). Tous les calculs de décompression sont faits ici, jamais par le LLM.
- **Gaz** : OC multi-gaz avec switch libre (chaque gaz de déco est pris à la profondeur que vous choisissez).
- **Hors ligne** : service worker, installable depuis Safari (Partager → Sur l'écran d'accueil).

> ⚠️ Outil d'aide à la planification en cours de validation. Il ne remplace ni la formation, ni l'ordinateur de plongée, ni le jugement du plongeur. Vérifiez chaque plan avec un second outil (Subsurface, MultiDeco…).

## Conventions du moteur

| Réglage | Défaut |
|---|---|
| Profil par défaut | Air (EAN21), 40 m, 20 min, GF 30/85 |
| Temps fond | inclut la descente |
| Descente / remontée | 18 / 9 m/min |
| Paliers | pas de 3 m, dernier palier 3 m (option 6 m), durées entières |
| GF | GF bas ancré au premier palier (Baker), interpolé jusqu'à GF haut en surface |
| Switch de gaz | 1 min minimum au palier de changement |
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
tests/run.js       Suite de tests (Node 18+)
index.html, app.js, styles.css, sw.js, manifest.json   PWA
```

## Roadmap

- V1 : OC Nitrox + multi-gaz switch libre ← en cours
- V2 : OC Trimix (le moteur gère déjà l'hélium)
- V3 : CCR (setpoint, bailout)
- V4 : Vocal (Web Speech API) + dialogue LLM local
