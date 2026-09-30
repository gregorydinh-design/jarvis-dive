# JARVIS DIVE

PWA de planification de plongée technique, hors ligne, pour iPhone.

- **Moteur** : Bühlmann ZHL-16C + Gradient Factors, JavaScript pur (`engine/`). Tous les calculs de décompression sont faits ici, jamais par le LLM.
- **Gaz** : OC multi-gaz avec switch libre (chaque gaz de déco est pris à la profondeur que vous choisissez).
- **Blocs** : volume et pression de départ par gaz (200 bar par défaut), pression restante affichée sur chaque gaz, alerte rouge sous 50 bar (réglable).
- **Gaz minimum** : gaz nécessaire pour remonter à 2 plongeurs, SAC fond × 2, 1 min de résolution au fond, jusqu'au premier switch.
- **Runtime max (DP)** : heure de sortie imposée par le directeur de plongée ; alerte si dépassée, et temps fond maximum calculé (limité par le runtime ou par le gaz).
- **Plans de secours** : +5 min, +3 m, +3 m +5 min, et perte de chaque gaz de déco.
- **Plongée successive** : la plongée en cours devient la n°1 ; tissus, CNS (demi-vie 90 min) et OTU sont reportés après l'intervalle de surface.
- **Parler à JARVIS** : bouton 🎙 (reconnaissance vocale de Safari) ou micro du clavier. Commandes (« 40 mètres 25 minutes EAN27, EAN47 à 12, oxygène à 6 », « rajoute 5 minutes », « bloc fond bi 12 ») et questions (« mon gaz fond tient ? », « et si je perds l'oxy ? », « et avec 10 minutes de plus ? »). Réponses lues à voix haute, **chiffres toujours calculés par le moteur**. Lien `?cmd=` pour Raccourcis / Siri.
- **LLM optionnel** (🧠) : petit Qwen dans Safari (WebGPU), utilisé seulement quand l'analyseur intégré ne comprend pas la phrase. Il choisit quoi faire et quoi annoncer, il n'écrit jamais de chiffre. Téléchargé une fois (0,9 à 1,6 Go), puis disponible hors ligne.
- **Langues** : français / anglais (bouton FR | EN, langue du téléphone par défaut).
- **Hors ligne** : service worker, installable depuis Safari (Partager → Sur l'écran d'accueil).

> ⚠️ Outil d'aide à la planification en cours de validation. Il ne remplace ni la formation, ni l'ordinateur de plongée, ni le jugement du plongeur. Vérifiez chaque plan avec un second outil (Subsurface, MultiDeco…).

## Utilisation

1. **Installer** : ouvrir https://gregorydinh-design.github.io/jarvis-dive/ dans Safari → Partager → « Sur l'écran d'accueil ». Lancer une fois avec du réseau : l'app fonctionne ensuite hors ligne.
2. **Planifier** : profondeur, temps fond (descente incluse), gaz fond, gaz de déco avec leur profondeur de switch ; GF et ppO2 max (fond et déco, séparées) via le bouton à droite du gaz fond ; blocs, réserves et vitesses dans « Réglages avancés ».
3. **Lire le plan** : runtime, DTR, profil de plongée et, juste dessous, la pression de chaque bloc au fil du temps (gaz fond en rouge, gaz de déco en bleu, réserve en pointillés ; toucher un graphe affiche l'instant, la profondeur et les pressions), paliers, gaz restant par bloc (rouge sous la réserve), gaz minimum, plans de secours (+5 min, +3 m, perte de chaque gaz de déco).
4. **Parler** : bouton 🎙 ou micro du clavier dans le champ ; « Lire » répète le plan ; 🔊 coupe la voix.
5. **Plongée successive** : « + Plongée successive » fige la plongée affichée comme n°1, puis on règle la n°2 et l'intervalle de surface (2 plongées maximum en V1).
6. **Avant la mer** : lancer l'app une ou deux fois à terre pour récupérer la dernière version ; si le LLM est utilisé, le charger une fois en Wi-Fi.

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
| ppO2 | 1.4 fond, 1.6 déco, réglables séparément ; la ppO2 déco fixe le switch proposé ; tolérance d'arrondi 0.03 (O2 à 6 m = 1.62 bar en eau de mer) |
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
assistant/commands.js  Outils de pilotage du plan (schéma OpenAI, validation)
assistant/parser.js    Phrases FR/EN → appels d'outils, hors ligne
assistant/summary.js   Résumé texte / vocal du plan
assistant/llm.js       Consignes, schéma JSON imposé et relecture des réponses LLM (commandes + conversation)
assistant/intents.js   Questions FR/EN → faits, sans LLM
assistant/facts.js     Faits vérifiés : toutes les réponses chiffrées, calculées par le moteur
assistant/conversation.js  Compréhension hybride : analyseur d'abord, LLM en relais
assistant/llm-engine.js    Chargement du LLM (WebLLM), hors ligne après le premier téléchargement
llm-test.html          Banc d'essai : petit Qwen dans Safari (WebLLM / WebGPU)
i18n.js            Traductions FR / EN
tests/run.js       Suite de tests (Node 18+)
index.html, app.js, styles.css, sw.js, manifest.json   PWA
```

## Roadmap

1. **Journée jusqu'à 4 plongées successives** (tissus, CNS, OTU reportés de plongée en plongée)
2. **CCR** (setpoint, bailout)
3. **Trimix OC** (le moteur gère déjà l'hélium ; interface à faire)

En parallèle : conversation vocale intégrée à l'app, validation terrain contre la Garmin Descent MK3.
